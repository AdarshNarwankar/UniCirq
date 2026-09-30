-- Preserve archived listing context only for its existing conversation participants.
CREATE FUNCTION app_conversation_listing(listing uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT FROM conversations WHERE listing_id=listing AND app_user_id() IN(member_a,member_b))
$$;
REVOKE ALL ON FUNCTION app_conversation_listing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_conversation_listing(uuid) TO unicirq_app;
ALTER POLICY listing_read ON listings USING(app_active() AND (app_is_admin() OR (college_id=app_campus() AND (status='active' OR owner_id=app_user_id() OR app_order_listing(id) OR app_conversation_listing(id)))));

-- Add order-specific conversation initiation and precise notification destinations.
-- Prior migrations stay unchanged so their recorded checksums remain valid.
CREATE OR REPLACE FUNCTION unicirq_command(command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 p profiles; l listings; r student_requests; cv conversations; o orders; v verification_requests; b business_profiles; t support_tickets;
 action text:=command->>'type'; new_id uuid:=gen_random_uuid(); target uuid; other_id uuid; campus uuid;
 start_date date; end_date date; amount_total bigint; next_status text; row_count integer; limit_count integer;
 entity text:=command->>'entity'; decision text:=command->>'decision'; why text:=btrim(command->>'reason');
BEGIN
 SELECT * INTO p FROM profiles WHERE id=app_user_id() FOR UPDATE;
 IF p.id IS NULL OR p.suspended THEN RAISE EXCEPTION 'Sign in with an active account' USING ERRCODE='42501'; END IF;
 IF octet_length(command::text)>12000 THEN RAISE EXCEPTION 'Request is too large'; END IF;
 INSERT INTO action_limits(user_id,window_start,request_count) VALUES(p.id,now(),1)
 ON CONFLICT(user_id) DO UPDATE SET
 request_count=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN 1 ELSE action_limits.request_count+1 END,
 window_start=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN now() ELSE action_limits.window_start END
 RETURNING request_count INTO limit_count;
 IF limit_count>60 THEN RAISE EXCEPTION 'Please wait a minute before trying again'; END IF;
 IF action IN('create_listing','close_listing','create_request','fulfill_request','start_conversation','start_order_conversation','send_message','create_order','transition_order') THEN
  IF p.role<>'student' OR NOT p.verified OR p.college_id IS NULL THEN RAISE EXCEPTION 'Verified student access is required' USING ERRCODE='42501'; END IF;
 END IF;
 CASE action
 WHEN 'create_listing' THEN
  IF (command->>'kind'='rental' AND command->>'unit'<>'day') OR (command->>'kind' IN('sale','hardware') AND command->>'unit'<>'item') OR (command->>'kind'='service' AND command->>'unit' NOT IN('hour','session','project')) THEN RAISE EXCEPTION 'Invalid pricing unit'; END IF;
  INSERT INTO listings(id,owner_id,college_id,title,description,kind,category,price,unit,condition,location)
  VALUES(new_id,p.id,p.college_id,btrim(command->>'title'),btrim(command->>'description'),command->>'kind',command->>'category',(command->>'price')::integer,command->>'unit',command->>'condition',btrim(command->>'location'));
 WHEN 'save_listing' THEN
  SELECT * INTO l FROM listings WHERE id=(command->>'listing_id')::uuid;
  IF p.role<>'student' OR l.id IS NULL OR l.college_id IS DISTINCT FROM p.college_id OR (l.status<>'active' AND l.owner_id<>p.id) THEN RAISE EXCEPTION 'Listing unavailable' USING ERRCODE='42501'; END IF;
  DELETE FROM saved_items WHERE user_id=p.id AND listing_id=l.id;GET DIAGNOSTICS row_count=ROW_COUNT;
  IF row_count=0 THEN INSERT INTO saved_items VALUES(p.id,l.id); END IF;
 WHEN 'close_listing' THEN
  UPDATE listings SET status='closed' WHERE id=(command->>'listing_id')::uuid AND owner_id=p.id AND status='active';GET DIAGNOSTICS row_count=ROW_COUNT;
  IF row_count=0 THEN RAISE EXCEPTION 'Only the owner can close an active listing' USING ERRCODE='42501'; END IF;
 WHEN 'create_request' THEN
  INSERT INTO student_requests(id,owner_id,college_id,title,description,category,budget) VALUES(new_id,p.id,p.college_id,btrim(command->>'title'),btrim(command->>'description'),command->>'category',(command->>'budget')::integer);
  INSERT INTO notifications(user_id,title,body,href)
  SELECT DISTINCT owner_id,'Someone needs an item you offer',left(command->>'title',100),'/student/requests' FROM listings WHERE college_id=p.college_id AND category=command->>'category' AND status='active' AND owner_id<>p.id LIMIT 20;
 WHEN 'fulfill_request' THEN
  UPDATE student_requests SET status='fulfilled' WHERE id=(command->>'request_id')::uuid AND owner_id=p.id;GET DIAGNOSTICS row_count=ROW_COUNT;
  IF row_count=0 THEN RAISE EXCEPTION 'Only the requester can fulfill a request' USING ERRCODE='42501'; END IF;
 WHEN 'start_conversation' THEN
  IF num_nonnulls(command->>'listing_id',command->>'request_id')<>1 THEN RAISE EXCEPTION 'Choose one conversation context'; END IF;
  IF command ? 'listing_id' THEN
   SELECT * INTO l FROM listings WHERE id=(command->>'listing_id')::uuid FOR UPDATE;other_id:=l.owner_id;campus:=l.college_id;
  ELSE SELECT * INTO r FROM student_requests WHERE id=(command->>'request_id')::uuid FOR UPDATE;other_id:=r.owner_id;campus:=r.college_id;END IF;
  IF other_id IS NULL OR other_id=p.id OR campus IS DISTINCT FROM p.college_id THEN RAISE EXCEPTION 'Conversation is not allowed' USING ERRCODE='42501'; END IF;
  SELECT id INTO target FROM conversations WHERE ((member_a=p.id AND member_b=other_id) OR (member_b=p.id AND member_a=other_id)) AND listing_id IS NOT DISTINCT FROM l.id AND request_id IS NOT DISTINCT FROM r.id ORDER BY created_at LIMIT 1;
  IF target IS NOT NULL THEN RETURN jsonb_build_object('id',target); END IF;
  IF (l.id IS NOT NULL AND l.status<>'active') OR (r.id IS NOT NULL AND r.status<>'open') OR NOT EXISTS(SELECT FROM profiles WHERE id=other_id AND verified AND NOT suspended) THEN RAISE EXCEPTION 'Conversation is not allowed' USING ERRCODE='42501'; END IF;
  INSERT INTO conversations(id,member_a,member_b,listing_id,request_id) VALUES(new_id,p.id,other_id,l.id,r.id);
 WHEN 'start_order_conversation' THEN
  SELECT * INTO o FROM orders WHERE id=(command->>'order_id')::uuid;
  IF o.id IS NULL OR p.id NOT IN(o.buyer_id,o.seller_id) OR o.college_id IS DISTINCT FROM p.college_id THEN RAISE EXCEPTION 'This activity is private' USING ERRCODE='42501'; END IF;
  -- Serialize against listing conversation creation without requiring active inventory.
  SELECT * INTO l FROM listings WHERE id=o.listing_id FOR UPDATE;
  SELECT id INTO target FROM conversations WHERE listing_id=o.listing_id AND request_id IS NULL AND ((member_a=o.buyer_id AND member_b=o.seller_id) OR (member_b=o.buyer_id AND member_a=o.seller_id)) ORDER BY created_at LIMIT 1;
  IF target IS NOT NULL THEN RETURN jsonb_build_object('id',target); END IF;
  INSERT INTO conversations(id,member_a,member_b,listing_id,request_id) VALUES(new_id,o.buyer_id,o.seller_id,o.listing_id,NULL);
 WHEN 'send_message' THEN
  SELECT * INTO cv FROM conversations WHERE id=(command->>'conversation_id')::uuid;
  IF cv.id IS NULL OR p.id NOT IN(cv.member_a,cv.member_b) THEN RAISE EXCEPTION 'This conversation is private' USING ERRCODE='42501'; END IF;
  INSERT INTO messages(id,conversation_id,sender_id,body) VALUES(new_id,cv.id,p.id,btrim(command->>'body'));
  other_id:=CASE WHEN cv.member_a=p.id THEN cv.member_b ELSE cv.member_a END;
  INSERT INTO notifications(user_id,title,body,href) VALUES(other_id,p.name||' sent a message',left(command->>'body',100),'/student/messages?conversation='||cv.id::text);
 WHEN 'create_order' THEN
  SELECT * INTO l FROM listings WHERE id=(command->>'listing_id')::uuid FOR UPDATE;
  IF l.id IS NULL OR l.status<>'active' OR l.owner_id=p.id OR l.college_id IS DISTINCT FROM p.college_id OR NOT EXISTS(SELECT FROM profiles WHERE id=l.owner_id AND verified AND NOT suspended AND role='student') THEN RAISE EXCEPTION 'This transaction is not allowed' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT FROM orders WHERE listing_id=l.id AND buyer_id=p.id AND status NOT IN('cancelled','completed')) THEN RAISE EXCEPTION 'You already have an active request'; END IF;
  amount_total:=l.price;
  IF l.kind='rental' THEN
   start_date:=(command->>'starts_on')::date;end_date:=(command->>'ends_on')::date;
   IF start_date IS NULL OR end_date IS NULL OR start_date<current_date OR end_date<=start_date OR end_date-start_date>30 THEN RAISE EXCEPTION 'Choose valid rental dates within 30 days'; END IF;
   IF EXISTS(SELECT FROM orders WHERE listing_id=l.id AND status IN('accepted','handed_over','disputed') AND starts_on<end_date AND ends_on>start_date) THEN RAISE EXCEPTION 'These dates are already reserved'; END IF;
   amount_total:=l.price::bigint*(end_date-start_date);
  END IF;
  INSERT INTO orders(id,listing_id,buyer_id,seller_id,college_id,amount,kind,starts_on,ends_on,terms_snapshot)
  VALUES(new_id,l.id,p.id,l.owner_id,l.college_id,amount_total,l.kind,start_date,end_date,jsonb_build_object('title',l.title,'description',l.description,'unit',l.unit,'price',l.price,'condition',l.condition,'location',l.location,'payment_mode','direct','protected',false));
  INSERT INTO order_events(order_id,actor_id,status) VALUES(new_id,p.id,'requested');
  INSERT INTO notifications(user_id,title,body,href) VALUES(l.owner_id,'New transaction request',l.title,'/student/activity?order='||new_id::text);
 WHEN 'transition_order' THEN
  SELECT * INTO o FROM orders WHERE id=(command->>'order_id')::uuid FOR UPDATE;
  IF o.id IS NULL OR p.id NOT IN(o.buyer_id,o.seller_id) OR o.college_id IS DISTINCT FROM p.college_id THEN RAISE EXCEPTION 'This activity is private' USING ERRCODE='42501'; END IF;
  next_status:=command->>'status';
  IF NOT coalesce((next_status='accepted' AND p.id=o.seller_id AND o.status='requested') OR (next_status='handed_over' AND p.id=o.buyer_id AND o.status='accepted') OR (next_status='completed' AND o.status='handed_over' AND ((o.kind='rental' AND p.id=o.seller_id) OR (o.kind<>'rental' AND p.id=o.buyer_id))) OR (next_status='cancelled' AND o.status IN('requested','accepted')),false) THEN RAISE EXCEPTION 'Invalid activity transition'; END IF;
  SELECT * INTO l FROM listings WHERE id=o.listing_id FOR UPDATE;
  IF next_status='accepted' THEN
   IF l.status<>'active' THEN RAISE EXCEPTION 'Listing is no longer available'; END IF;
   IF EXISTS(SELECT FROM orders x WHERE x.id<>o.id AND x.listing_id=o.listing_id AND x.status IN('accepted','handed_over','disputed') AND CASE WHEN o.kind='rental' THEN x.starts_on<o.ends_on AND x.ends_on>o.starts_on ELSE o.kind<>'service' END) THEN RAISE EXCEPTION 'Another request already reserves this item'; END IF;
  END IF;
  UPDATE orders SET status=next_status WHERE id=o.id;
  INSERT INTO order_events(order_id,actor_id,status) VALUES(o.id,p.id,next_status);
  IF next_status='completed' AND o.kind IN('sale','hardware') THEN UPDATE listings SET status='closed' WHERE id=o.listing_id; END IF;
  other_id:=CASE WHEN o.buyer_id=p.id THEN o.seller_id ELSE o.buyer_id END;
  INSERT INTO notifications(user_id,title,body,href) VALUES(other_id,'Activity updated','Your transaction is '||replace(next_status,'_',' '),'/student/activity?order='||o.id::text);
 WHEN 'create_ticket' THEN
  IF command->>'kind'='managed_sale' AND (p.role<>'student' OR NOT p.verified) THEN RAISE EXCEPTION 'Verified student access required' USING ERRCODE='42501'; END IF;
  IF command->>'order_id' IS NOT NULL THEN
   SELECT * INTO o FROM orders WHERE id=(command->>'order_id')::uuid FOR UPDATE;
   IF o.id IS NULL OR p.id NOT IN(o.buyer_id,o.seller_id) THEN RAISE EXCEPTION 'This activity is private' USING ERRCODE='42501'; END IF;
  END IF;
  IF command->>'kind'='dispute' AND (o.id IS NULL OR o.status IN('cancelled','disputed')) THEN RAISE EXCEPTION 'Choose an eligible activity to dispute'; END IF;
  IF command->>'listing_id' IS NOT NULL THEN
   SELECT * INTO l FROM listings WHERE id=(command->>'listing_id')::uuid;
   IF l.id IS NULL OR l.college_id IS DISTINCT FROM p.college_id OR (l.status<>'active' AND l.owner_id<>p.id) THEN RAISE EXCEPTION 'Listing is unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  INSERT INTO support_tickets(id,owner_id,college_id,order_id,listing_id,subject,body,type)
  VALUES(new_id,p.id,p.college_id,o.id,l.id,btrim(command->>'subject'),btrim(command->>'body'),command->>'kind');
  IF command->>'kind'='dispute' THEN UPDATE orders SET status='disputed' WHERE id=o.id;INSERT INTO order_events(order_id,actor_id,status) VALUES(o.id,p.id,'disputed');END IF;
 WHEN 'update_profile' THEN
  IF length(btrim(command->>'name')) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Enter a valid display name'; END IF;
  UPDATE profiles SET name=btrim(command->>'name'),bio=coalesce(command->>'bio',''),course=coalesce(command->>'course',''),year=coalesce(command->>'year',''),avatar=upper(left(command->>'name',2)) WHERE id=p.id;
 WHEN 'request_verification' THEN
  IF p.role<>'student' OR (p.verified AND command->>'kind'='campus') THEN RAISE EXCEPTION 'Verification is not available' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT FROM verification_requests WHERE user_id=p.id AND status='pending') THEN RAISE EXCEPTION 'A review is already pending'; END IF;
  INSERT INTO verification_requests(id,user_id,college_id,kind,detail) VALUES(new_id,p.id,(command->>'college_id')::uuid,command->>'kind',btrim(command->>'detail'));
 WHEN 'read_notifications' THEN UPDATE notifications SET read=true WHERE user_id=p.id;
 WHEN 'create_deal' THEN
  SELECT * INTO b FROM business_profiles WHERE owner_id=p.id AND verified;
  IF p.role<>'business' OR NOT p.verified OR b.id IS NULL THEN RAISE EXCEPTION 'Approved business access required' USING ERRCODE='42501'; END IF;
  IF (command->>'expires_on')::date<current_date THEN RAISE EXCEPTION 'Choose a future expiry date'; END IF;
  INSERT INTO deals(id,business_id,owner_id,college_id,title,description,code,expires_on) VALUES(new_id,b.id,p.id,b.college_id,btrim(command->>'title'),btrim(command->>'description'),command->>'code',(command->>'expires_on')::date);
 WHEN 'moderate' THEN
  IF p.role<>'admin' THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF why IS NULL OR length(why) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  target:=(command->>'target_id')::uuid;
  IF entity='listing' AND decision IN('approve','remove') THEN
   UPDATE listings SET status=CASE decision WHEN 'approve' THEN 'active' ELSE 'removed' END WHERE id=target;GET DIAGNOSTICS row_count=ROW_COUNT;
  ELSIF entity='deal' AND decision IN('approve','remove') THEN
   UPDATE deals SET status=CASE decision WHEN 'approve' THEN 'active' ELSE 'removed' END WHERE id=target AND (decision<>'approve' OR expires_on>=current_date);GET DIAGNOSTICS row_count=ROW_COUNT;
  ELSIF entity='verification' AND decision IN('approve','reject') THEN
   SELECT * INTO v FROM verification_requests WHERE id=target FOR UPDATE;
   IF v.id IS NULL OR v.status<>'pending' THEN RAISE EXCEPTION 'This verification has already been reviewed'; END IF;
   IF decision='approve' AND v.kind='business' AND EXISTS(SELECT FROM orders WHERE v.user_id IN(buyer_id,seller_id) AND status NOT IN('completed','cancelled')) THEN RAISE EXCEPTION 'Resolve active student transactions before changing account role'; END IF;
   UPDATE verification_requests SET status=CASE decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END,reason=why WHERE id=target;
   IF decision='approve' THEN
    UPDATE profiles SET verified=true,college_id=v.college_id,role=CASE WHEN v.kind='business' THEN 'business' ELSE role END WHERE id=v.user_id;
    IF v.kind='business' THEN INSERT INTO business_profiles(owner_id,college_id,name,category,description,location,verified) SELECT id,v.college_id,name,'Campus business',v.detail,'Location pending',true FROM profiles WHERE id=v.user_id; END IF;
   END IF;
   INSERT INTO notifications(user_id,title,body,href) VALUES(v.user_id,'Verification reviewed',why,CASE WHEN decision='approve' AND v.kind='business' THEN '/business/profile' ELSE '/student/profile' END);row_count:=1;
  ELSIF entity='ticket' AND decision='resolve' THEN
   UPDATE support_tickets SET status='resolved',resolution=why WHERE id=target AND status='open' RETURNING * INTO t;
   IF t.id IS NULL THEN RAISE EXCEPTION 'This support case is already resolved or unavailable'; END IF;
   INSERT INTO notifications(user_id,title,body,href) VALUES(t.owner_id,'Support case resolved',why,'/student/support');row_count:=1;
  ELSE RAISE EXCEPTION 'Invalid moderation decision';END IF;
  IF row_count=0 THEN RAISE EXCEPTION 'Record not found'; END IF;
  INSERT INTO audit_logs(actor_id,action,target_id,reason) VALUES(p.id,entity||'.'||decision,target,why);
 ELSE RAISE EXCEPTION 'Unknown command';
 END CASE;
 RETURN jsonb_build_object('id',new_id);
END $$;
REVOKE ALL ON FUNCTION unicirq_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unicirq_command(jsonb) TO unicirq_app;
