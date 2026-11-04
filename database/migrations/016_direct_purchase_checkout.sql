-- Direct sale checkout lifecycle. Existing rental and service booking behavior is preserved.
DO $$
DECLARE constraint_name text;
BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='orders'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%status%'
 LOOP EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I',constraint_name); END LOOP;
END $$;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status IN('requested','payment_pending','accepted','handed_over','completed','cancelled','disputed'));
CREATE OR REPLACE FUNCTION unicirq_command(command jsonb) RETURNS jsonb
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
  IF listing.kind IN('sale','hardware') AND EXISTS(
    SELECT FROM orders WHERE listing_id=listing.id
      AND status IN('payment_pending','accepted','handed_over','completed','disputed')
  ) THEN
    RAISE EXCEPTION 'This item is already reserved for another purchase';
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
  INSERT INTO orders(id,listing_id,buyer_id,seller_id,college_id,amount,kind,starts_on,ends_on,starts_at,ends_at,terms_snapshot,status)
  VALUES(new_id,listing.id,actor.id,listing.owner_id,listing.college_id,amount_total,listing.kind,start_date,end_date,start_time,end_time,
   jsonb_build_object('title',listing.title,'description',listing.description,'unit',listing.unit,'price',listing.price,'condition',listing.condition,'location',listing.location,
    'billing_units',billing_units,'billing_period_days',CASE WHEN listing.kind='rental' AND listing.unit='month' THEN 30 ELSE NULL END,'payment_mode','direct','protected',false),CASE WHEN listing.kind IN('sale','hardware') THEN 'payment_pending' ELSE 'requested' END);
  INSERT INTO order_events(order_id,actor_id,status) VALUES(new_id,actor.id,CASE WHEN listing.kind IN('sale','hardware') THEN 'payment_pending' ELSE 'requested' END);
  INSERT INTO notifications(user_id,title,body,href) VALUES(listing.owner_id,CASE WHEN listing.kind IN('sale','hardware') THEN 'New purchase awaiting payment' ELSE 'New transaction request' END,listing.title,'/student/activity?order='||new_id::text);
 ELSE
  SELECT * INTO activity FROM orders WHERE id=(command->>'order_id')::uuid FOR UPDATE;
  IF activity.id IS NULL OR actor.id NOT IN(activity.buyer_id,activity.seller_id) OR activity.college_id IS DISTINCT FROM actor.college_id THEN
   RAISE EXCEPTION 'This activity is private' USING ERRCODE='42501';
  END IF;
  next_status:=command->>'status';
  IF NOT coalesce((next_status='accepted' AND actor.id=activity.seller_id AND activity.status='requested' AND activity.kind IN('rental','service'))
   OR (next_status='handed_over' AND actor.id=activity.seller_id AND activity.status='accepted' AND activity.kind IN('sale','hardware'))
   OR (next_status='handed_over' AND actor.id=activity.buyer_id AND activity.status='accepted' AND activity.kind IN('rental','service'))
   OR (next_status='completed' AND activity.status='handed_over' AND ((activity.kind='rental' AND actor.id=activity.seller_id) OR (activity.kind<>'rental' AND actor.id=activity.buyer_id)))
   OR (next_status='cancelled' AND (
    (activity.kind NOT IN('sale','hardware') AND activity.status IN('requested','accepted'))
    OR (activity.kind IN('sale','hardware') AND activity.status='payment_pending'
      AND actor.id=activity.buyer_id
      AND NOT EXISTS(SELECT FROM billing_record_orders bro WHERE bro.order_id=activity.id)
    )
   )),false) THEN RAISE EXCEPTION 'Invalid activity transition'; END IF;
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
  IF next_status='accepted' AND activity.kind IN('sale','hardware') THEN UPDATE listings SET status='closed' WHERE id=activity.listing_id; END IF;
  other_id:=CASE WHEN activity.buyer_id=actor.id THEN activity.seller_id ELSE activity.buyer_id END;
  INSERT INTO notifications(user_id,title,body,href) VALUES(other_id,'Activity updated','Your transaction is '||replace(next_status,'_',' '),'/student/activity?order='||activity.id::text);
 END IF;
 RETURN jsonb_build_object('id',new_id);
END $$;

REVOKE ALL ON FUNCTION unicirq_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unicirq_command(jsonb) TO unicirq_app;
CREATE OR REPLACE FUNCTION app_billing_group_quote(request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  actor profiles;
  activity orders;
  settings billing_settings;

  selected_ids uuid[];
  supplied_count integer;
  selected_count integer;

  seller uuid;
  campus uuid;
  category text;
  current_category text;

  principal numeric := 0;
  fee bigint := 0;
  tax bigint;
  payable bigint;
  net bigint;
  rate_bps integer := 0;
  payer text := 'none';
  description text;

  item_list jsonb := '[]'::jsonb;
  selection text;
BEGIN
  IF jsonb_typeof(request) IS DISTINCT FROM 'object'
    OR octet_length(request::text) > 12000
    OR EXISTS (
      SELECT FROM jsonb_object_keys(request) key
      WHERE key NOT IN ('order_ids', 'payment_mode')
    )
    OR jsonb_typeof(request->'order_ids') IS DISTINCT FROM 'array'
    OR jsonb_array_length(request->'order_ids') NOT BETWEEN 1 AND 20
    OR request->>'payment_mode' NOT IN ('direct', 'checkout')
  THEN
    RAISE EXCEPTION 'Invalid grouped billing selection';
  END IF;

  IF EXISTS (
    SELECT FROM jsonb_array_elements(request->'order_ids') value
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
      OR value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'Choose valid orders';
  END IF;

  SELECT
    count(*),
    count(DISTINCT value #>> '{}')
  INTO supplied_count, selected_count
  FROM jsonb_array_elements(request->'order_ids') value;

  IF supplied_count <> selected_count THEN
    RAISE EXCEPTION 'An order cannot appear more than once';
  END IF;

  SELECT array_agg((value #>> '{}')::uuid ORDER BY (value #>> '{}')::uuid)
  INTO selected_ids
  FROM jsonb_array_elements(request->'order_ids') value;

  selection := md5(array_to_string(selected_ids, ','));

  SELECT * INTO actor
  FROM profiles
  WHERE id = app_user_id();

  IF actor.id IS NULL OR actor.suspended THEN
    RAISE EXCEPTION 'Sign in with an active account'
      USING ERRCODE='42501';
  END IF;

  IF actor.role <> 'student'
    OR NOT actor.verified
    OR actor.college_id IS NULL
  THEN
    RAISE EXCEPTION 'Verified student access is required'
      USING ERRCODE='42501';
  END IF;

  SELECT * INTO settings
  FROM billing_settings
  WHERE singleton;

  FOR activity IN
    SELECT o.*
    FROM orders o
    WHERE o.id = ANY(selected_ids)
    ORDER BY o.id
    FOR UPDATE
  LOOP
    IF activity.buyer_id <> actor.id
      OR activity.seller_id = actor.id
      OR activity.college_id <> actor.college_id
      OR NOT (activity.status='accepted' OR (activity.kind IN('sale','hardware') AND activity.status='payment_pending'))
      OR NOT EXISTS (
        SELECT FROM profiles p
        WHERE p.id = activity.seller_id
          AND p.verified
          AND NOT p.suspended
          AND p.role = 'student'
          AND p.college_id = activity.college_id
      )
    THEN
      RAISE EXCEPTION
        'Only your eligible purchases or accepted bookings with an active verified campus seller can be billed'
        USING ERRCODE='42501';
    END IF;

    current_category := CASE
      WHEN activity.kind IN ('sale', 'hardware') THEN 'sale'
      WHEN activity.kind = 'rental' THEN 'rental'
      WHEN activity.kind = 'service' THEN 'service'
    END;

    IF category IS NULL THEN
      category := current_category;
      seller := activity.seller_id;
      campus := activity.college_id;
    ELSIF category <> current_category
      OR seller <> activity.seller_id
      OR campus <> activity.college_id
    THEN
      RAISE EXCEPTION
        'A bill can contain orders from only one seller and one category';
    END IF;

    principal := principal + activity.amount;

    item_list := item_list || jsonb_build_array(
      jsonb_build_object(
        'order_id', activity.id,
        'listing_id', activity.listing_id,
        'kind', activity.kind,
        'amount', activity.amount,
        'terms_snapshot', activity.terms_snapshot
      )
    );
  END LOOP;

  IF cardinality(selected_ids) <> (
    SELECT count(*)
    FROM orders
    WHERE id = ANY(selected_ids)
  ) THEN
    RAISE EXCEPTION 'One or more selected orders are unavailable';
  END IF;

  IF principal > 9223372036854775807 THEN
    RAISE EXCEPTION 'The selected total is too large';
  END IF;

  IF category='sale' AND EXISTS (
    SELECT FROM orders WHERE id=ANY(selected_ids) AND status='payment_pending'
  ) AND request->>'payment_mode'<>'checkout' THEN
    RAISE EXCEPTION 'Direct purchases require UPI checkout so payment can be verified before fulfillment';
  END IF;

  IF request->>'payment_mode' = 'checkout' AND principal > 0 THEN
    rate_bps := CASE category
      WHEN 'sale' THEN 500
      WHEN 'rental' THEN 800
      WHEN 'service' THEN 800
    END;

    fee := greatest(
      1900,
      round(principal * rate_bps / 10000)::bigint
    );

    payer := CASE category
      WHEN 'sale' THEN 'buyer'
      WHEN 'rental' THEN 'renter'
      WHEN 'service' THEN 'provider'
    END;
  END IF;

  IF fee = 0 THEN
    tax := 0;
  ELSIF settings.tax_bps IS NULL THEN
    tax := NULL;
  ELSE
    tax := round(fee::numeric * settings.tax_bps / 10000)::bigint;
  END IF;

  IF tax IS NULL THEN
    payable := NULL;
    net := NULL;
  ELSIF category = 'service' AND payer = 'provider' THEN
    payable := principal::bigint;
    net := principal::bigint - fee - tax;

    IF net < 0 THEN
      RAISE EXCEPTION
        'The service price must cover its platform fee and tax';
    END IF;
  ELSE
    payable := principal::bigint + fee + tax;
    net := principal::bigint;
  END IF;

  description := CASE
    WHEN request->>'payment_mode' = 'direct'
      THEN 'Direct campus exchange'
    WHEN category = 'sale'
      THEN 'UniCirq sale checkout'
    WHEN category = 'rental'
      THEN 'UniCirq rental checkout'
    ELSE 'UniCirq service checkout'
  END;

  RETURN jsonb_build_object(
    'policy_version', '2026-10-pilot',
    'purpose', 'order',
    'currency', 'INR',
    'billing_category', category,
    'seller_id', seller,
    'college_id', campus,
    'selection_key', selection,
    'order_ids', to_jsonb(selected_ids),
    'items', item_list,
    'base_amount', principal::bigint,
    'platform_fee', fee,
    'tax_amount', tax,
    'tax_bps', settings.tax_bps,
    'delivery_amount', 0,
    'deposit_amount', 0,
    'buyer_total', payable,
    'seller_net', net,
    'fee_payer', payer,
    'payment_mode', request->>'payment_mode',
    'pilot_waived', false,
    'description', description
  );
END $$;



REVOKE ALL ON FUNCTION app_billing_group_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_billing_group_quote(jsonb) TO unicirq_app;
CREATE OR REPLACE FUNCTION app_billing_manual_review(record_id uuid, decision text, note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor profiles; bill billing_records; clean_note text:=btrim(note);
BEGIN
 SELECT * INTO actor FROM profiles WHERE id=app_user_id();
 SELECT * INTO bill FROM billing_records WHERE id=record_id FOR UPDATE;
 IF actor.id IS NULL OR actor.role<>'admin' OR actor.suspended THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF bill.id IS NULL OR bill.status<>'manual_pending' OR bill.manual_utr IS NULL THEN RAISE EXCEPTION 'This UPI payment is not awaiting review'; END IF;
 IF decision NOT IN('approve','reject') OR length(clean_note) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Choose a decision and provide a review note'; END IF;
 UPDATE billing_records SET status=CASE WHEN decision='approve' THEN 'paid' ELSE 'quoted' END,
   paid_at=CASE WHEN decision='approve' THEN now() ELSE NULL END,
   manual_reviewed_at=now(),manual_reviewer_id=actor.id,manual_review_note=clean_note,
   manual_utr=CASE WHEN decision='approve' THEN manual_utr ELSE NULL END,
   manual_submitted_at=CASE WHEN decision='approve' THEN manual_submitted_at ELSE NULL END
 WHERE id=bill.id RETURNING * INTO bill;
 IF decision='approve' THEN
   IF bill.purpose='order' THEN
     PERFORM 1 FROM orders o JOIN billing_record_orders bro ON bro.order_id=o.id
     WHERE bro.billing_id=bill.id ORDER BY o.id FOR UPDATE OF o;
     IF EXISTS (SELECT FROM orders o JOIN billing_record_orders bro ON bro.order_id=o.id
       WHERE bro.billing_id=bill.id AND NOT (o.status='accepted' OR (o.kind IN('sale','hardware') AND o.status='payment_pending')))
       THEN RAISE EXCEPTION 'One or more orders are no longer eligible for payment verification'; END IF;
     IF EXISTS (SELECT FROM orders o JOIN billing_record_orders bro ON bro.order_id=o.id
       JOIN listings l ON l.id=o.listing_id WHERE bro.billing_id=bill.id AND o.kind IN('sale','hardware')
       AND (l.status<>'active' OR EXISTS(SELECT FROM orders other WHERE other.listing_id=o.listing_id AND other.id<>o.id AND other.status IN('accepted','handed_over','completed','disputed'))))
       THEN RAISE EXCEPTION 'A purchase listing is no longer available'; END IF;
     WITH released AS (
       UPDATE orders o SET status='accepted'
       FROM billing_record_orders bro
       WHERE bro.billing_id=bill.id AND bro.order_id=o.id
         AND o.kind IN('sale','hardware') AND o.status='payment_pending'
       RETURNING o.id
     )
     INSERT INTO order_events(order_id,actor_id,status)
       SELECT id,actor.id,'accepted' FROM released;
     UPDATE listings l SET status='closed' FROM billing_record_orders bro JOIN orders o ON o.id=bro.order_id
       WHERE bro.billing_id=bill.id AND o.kind IN('sale','hardware') AND l.id=o.listing_id;
     INSERT INTO notifications(user_id,title,body,href)
       SELECT o.seller_id,'Payment verified — fulfill order','The buyer payment was verified. Please arrange the handover.','/student/activity?order='||o.id::text
       FROM orders o JOIN billing_record_orders bro ON bro.order_id=o.id
       WHERE bro.billing_id=bill.id AND o.kind IN('sale','hardware');
   END IF;
   PERFORM app_billing_grant(bill.id);
   INSERT INTO notifications(user_id,title,body,href) VALUES
     (bill.owner_id,'UPI payment verified','Your UPI payment was verified by UniCirq.','/'||COALESCE((SELECT role FROM profiles WHERE id=bill.owner_id),'student')||'/billing');
 END IF;
 INSERT INTO audit_logs(actor_id,action,target_id,reason)
 VALUES(actor.id,CASE WHEN decision='approve' THEN 'billing.upi_approved' ELSE 'billing.upi_rejected' END,bill.id,clean_note);
 RETURN to_jsonb(bill);
END $$;


REVOKE ALL ON FUNCTION app_billing_manual_review(uuid,text,text) FROM PUBLIC,unicirq_app,unicirq_billing_backend;
GRANT EXECUTE ON FUNCTION app_billing_manual_review(uuid,text,text) TO unicirq_app;
