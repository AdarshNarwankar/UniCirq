-- Preserve existing date-only rental history while supporting precise hourly
-- reservations. A month is a fixed 30-day billing period, not a calendar month.
ALTER TABLE listings DROP CONSTRAINT listings_unit_check;
ALTER TABLE listings ADD CONSTRAINT listings_unit_check CHECK(unit IN('item','hour','day','week','month','session','project'));
ALTER TABLE orders ADD COLUMN starts_at timestamptz, ADD COLUMN ends_at timestamptz;
DO $$ DECLARE rental_check text; BEGIN
 SELECT conname INTO rental_check FROM pg_constraint
 WHERE conrelid='orders'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%starts_on%' AND pg_get_constraintdef(oid) LIKE '%ends_on%';
 IF rental_check IS NULL THEN RAISE EXCEPTION 'Existing rental date guard was not found'; END IF;
 EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I',rental_check);
END $$;
ALTER TABLE orders ADD CONSTRAINT orders_rental_period_check CHECK(kind<>'rental' OR coalesce((
 starts_on IS NOT NULL AND ends_on IS NOT NULL AND (
  -- No backfill: old records retain their original dates and price snapshots.
  (starts_at IS NULL AND ends_at IS NULL AND terms_snapshot->>'unit' IS DISTINCT FROM 'hour'
   AND ends_on>starts_on AND ends_on-starts_on<=30)
  OR
  (starts_at IS NOT NULL AND ends_at IS NOT NULL AND isfinite(starts_at) AND isfinite(ends_at)
   AND ends_at>starts_at AND ends_at-starts_at<=interval '720 hours'
   AND starts_on=(starts_at AT TIME ZONE 'Asia/Kolkata')::date
   AND ends_on=(ends_at AT TIME ZONE 'Asia/Kolkata')::date
   AND (terms_snapshot->>'unit'='hour' OR (
    terms_snapshot->>'unit' IN('day','week','month') AND ends_on>starts_on
    AND starts_at=(starts_on::timestamp AT TIME ZONE 'Asia/Kolkata')
    AND ends_at=(ends_on::timestamp AT TIME ZONE 'Asia/Kolkata')
   )))
 )),false));

-- All callers, including photo creation, use this entry point. The older
-- implementations stay owner-only so runtime callers cannot bypass the guard.
ALTER FUNCTION unicirq_command(jsonb) RENAME TO app_command_before_rental_periods;
REVOKE ALL ON FUNCTION app_command_before_rental_periods(jsonb) FROM PUBLIC,unicirq_app;
CREATE FUNCTION unicirq_command(command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor profiles; listing listings; activity orders;
 action text:=command->>'type'; new_id uuid:=gen_random_uuid(); other_id uuid;
 start_date date; end_date date; start_time timestamptz; end_time timestamptz;
 amount_total bigint; billing_units integer:=1; day_count integer; next_status text; limit_count integer;
 instant_pattern text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}T(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9]([.][0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-5][0-9])$';
BEGIN
 IF NOT coalesce(action IN('create_listing','create_order','transition_order'),false) THEN
  RETURN app_command_before_rental_periods(command);
 END IF;
 SELECT * INTO actor FROM profiles WHERE id=app_user_id() FOR UPDATE;
 IF actor.id IS NULL OR actor.suspended THEN RAISE EXCEPTION 'Sign in with an active account' USING ERRCODE='42501'; END IF;
 IF octet_length(command::text)>12000 THEN RAISE EXCEPTION 'Request is too large'; END IF;
 IF actor.role<>'student' OR NOT actor.verified OR actor.college_id IS NULL THEN
  RAISE EXCEPTION 'Verified student access is required' USING ERRCODE='42501';
 END IF;
 INSERT INTO action_limits(user_id,window_start,request_count) VALUES(actor.id,now(),1)
 ON CONFLICT(user_id) DO UPDATE SET
  request_count=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN 1 ELSE action_limits.request_count+1 END,
  window_start=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN now() ELSE action_limits.window_start END
 RETURNING request_count INTO limit_count;
 IF limit_count>60 THEN RAISE EXCEPTION 'Please wait a minute before trying again'; END IF;

 IF action='create_listing' THEN
  IF (command->>'kind'='rental' AND (command->>'unit' IS NULL OR command->>'unit' NOT IN('hour','day','week','month')))
   OR (command->>'kind' IN('sale','hardware') AND command->>'unit' IS DISTINCT FROM 'item')
   OR (command->>'kind'='service' AND (command->>'unit' IS NULL OR command->>'unit' NOT IN('hour','session','project'))) THEN
   RAISE EXCEPTION 'Invalid pricing unit';
  END IF;
  INSERT INTO listings(id,owner_id,college_id,title,description,kind,category,price,unit,condition,location)
  VALUES(new_id,actor.id,actor.college_id,btrim(command->>'title'),btrim(command->>'description'),command->>'kind',command->>'category',(command->>'price')::integer,command->>'unit',command->>'condition',btrim(command->>'location'));
 ELSIF action='create_order' THEN
  -- This listing lock serializes creation and acceptance across all buyers.
  SELECT * INTO listing FROM listings WHERE id=(command->>'listing_id')::uuid FOR UPDATE;
  IF listing.id IS NULL OR listing.status<>'active' OR listing.owner_id=actor.id OR listing.college_id IS DISTINCT FROM actor.college_id
   OR NOT EXISTS(SELECT FROM profiles WHERE id=listing.owner_id AND verified AND NOT suspended AND role='student') THEN
   RAISE EXCEPTION 'This transaction is not allowed' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT FROM orders WHERE listing_id=listing.id AND buyer_id=actor.id AND status NOT IN('cancelled','completed')) THEN
   RAISE EXCEPTION 'You already have an active request';
  END IF;
  IF listing.kind='rental' THEN
   IF listing.unit='hour' THEN
    IF NOT coalesce(command->>'starts_at' ~ instant_pattern,false) OR NOT coalesce(command->>'ends_at' ~ instant_pattern,false) THEN
     RAISE EXCEPTION 'Choose rental times with an explicit timezone';
    END IF;
    start_time:=(command->>'starts_at')::timestamptz; end_time:=(command->>'ends_at')::timestamptz;
    IF NOT isfinite(start_time) OR NOT isfinite(end_time) OR start_time<now() OR end_time<=start_time OR end_time-start_time>interval '720 hours' THEN
     RAISE EXCEPTION 'Choose valid rental times within 30 days';
    END IF;
    start_date:=(start_time AT TIME ZONE 'Asia/Kolkata')::date;
    end_date:=(end_time AT TIME ZONE 'Asia/Kolkata')::date;
    billing_units:=ceil(extract(epoch FROM end_time-start_time)/3600)::integer;
   ELSIF listing.unit IN('day','week','month') THEN
    IF NOT coalesce(command->>'starts_on' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',false)
     OR NOT coalesce(command->>'ends_on' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',false) THEN
     RAISE EXCEPTION 'Choose valid rental dates within 30 days';
    END IF;
    start_date:=(command->>'starts_on')::date; end_date:=(command->>'ends_on')::date;
    day_count:=end_date-start_date;
    IF start_date<(current_timestamp AT TIME ZONE 'Asia/Kolkata')::date OR day_count<1 OR day_count>30 THEN
     RAISE EXCEPTION 'Choose valid rental dates within 30 days';
    END IF;
    start_time:=start_date::timestamp AT TIME ZONE 'Asia/Kolkata'; end_time:=end_date::timestamp AT TIME ZONE 'Asia/Kolkata';
    billing_units:=CASE listing.unit WHEN 'week' THEN ceil(day_count::numeric/7)::integer WHEN 'month' THEN ceil(day_count::numeric/30)::integer ELSE day_count END;
   ELSE RAISE EXCEPTION 'Invalid pricing unit'; END IF;
   IF EXISTS(SELECT FROM orders WHERE listing_id=listing.id AND status IN('accepted','handed_over','disputed')
    AND coalesce(starts_at,starts_on::timestamp AT TIME ZONE 'Asia/Kolkata')<end_time
    AND coalesce(ends_at,ends_on::timestamp AT TIME ZONE 'Asia/Kolkata')>start_time) THEN
    RAISE EXCEPTION 'These dates are already reserved';
   END IF;
  END IF;
  -- Never accept price, unit, quantity, identity or total from request data.
  amount_total:=listing.price::bigint*billing_units;
  INSERT INTO orders(id,listing_id,buyer_id,seller_id,college_id,amount,kind,starts_on,ends_on,starts_at,ends_at,terms_snapshot)
  VALUES(new_id,listing.id,actor.id,listing.owner_id,listing.college_id,amount_total,listing.kind,start_date,end_date,start_time,end_time,
   jsonb_build_object('title',listing.title,'description',listing.description,'unit',listing.unit,'price',listing.price,'condition',listing.condition,'location',listing.location,
    'billing_units',billing_units,'billing_period_days',CASE WHEN listing.kind='rental' AND listing.unit='month' THEN 30 ELSE NULL END,'payment_mode','direct','protected',false));
  INSERT INTO order_events(order_id,actor_id,status) VALUES(new_id,actor.id,'requested');
  INSERT INTO notifications(user_id,title,body,href) VALUES(listing.owner_id,'New transaction request',listing.title,'/student/activity?order='||new_id::text);
 ELSE
  SELECT * INTO activity FROM orders WHERE id=(command->>'order_id')::uuid FOR UPDATE;
  IF activity.id IS NULL OR actor.id NOT IN(activity.buyer_id,activity.seller_id) OR activity.college_id IS DISTINCT FROM actor.college_id THEN
   RAISE EXCEPTION 'This activity is private' USING ERRCODE='42501';
  END IF;
  next_status:=command->>'status';
  IF NOT coalesce((next_status='accepted' AND actor.id=activity.seller_id AND activity.status='requested')
   OR (next_status='handed_over' AND actor.id=activity.buyer_id AND activity.status='accepted')
   OR (next_status='completed' AND activity.status='handed_over' AND ((activity.kind='rental' AND actor.id=activity.seller_id) OR (activity.kind<>'rental' AND actor.id=activity.buyer_id)))
   OR (next_status='cancelled' AND activity.status IN('requested','accepted')),false) THEN RAISE EXCEPTION 'Invalid activity transition'; END IF;
  SELECT * INTO listing FROM listings WHERE id=activity.listing_id FOR UPDATE;
  IF next_status='accepted' THEN
   IF listing.status<>'active' THEN RAISE EXCEPTION 'Listing is no longer available'; END IF;
   IF EXISTS(SELECT FROM orders x WHERE x.id<>activity.id AND x.listing_id=activity.listing_id AND x.status IN('accepted','handed_over','disputed')
    AND CASE WHEN activity.kind='rental' THEN
     coalesce(x.starts_at,x.starts_on::timestamp AT TIME ZONE 'Asia/Kolkata')<coalesce(activity.ends_at,activity.ends_on::timestamp AT TIME ZONE 'Asia/Kolkata')
     AND coalesce(x.ends_at,x.ends_on::timestamp AT TIME ZONE 'Asia/Kolkata')>coalesce(activity.starts_at,activity.starts_on::timestamp AT TIME ZONE 'Asia/Kolkata')
     ELSE activity.kind<>'service' END) THEN RAISE EXCEPTION 'Another request already reserves this item'; END IF;
  END IF;
  UPDATE orders SET status=next_status WHERE id=activity.id;
  INSERT INTO order_events(order_id,actor_id,status) VALUES(activity.id,actor.id,next_status);
  IF next_status='completed' AND activity.kind IN('sale','hardware') THEN UPDATE listings SET status='closed' WHERE id=activity.listing_id; END IF;
  other_id:=CASE WHEN activity.buyer_id=actor.id THEN activity.seller_id ELSE activity.buyer_id END;
  INSERT INTO notifications(user_id,title,body,href) VALUES(other_id,'Activity updated','Your transaction is '||replace(next_status,'_',' '),'/student/activity?order='||activity.id::text);
 END IF;
 RETURN jsonb_build_object('id',new_id);
END $$;
REVOKE ALL ON FUNCTION unicirq_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unicirq_command(jsonb) TO unicirq_app;
