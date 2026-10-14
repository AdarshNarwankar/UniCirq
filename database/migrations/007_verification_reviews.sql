-- Historical decisions keep their original status and have no invented review proof.
ALTER TABLE verification_requests
 ADD COLUMN reviewed_at timestamptz,
 ADD COLUMN reviewed_by uuid REFERENCES profiles(id),
 ADD COLUMN review_method text CHECK(review_method IN('campus_email','campus_office','in_person','public_business'));

-- Keep every existing command behind the same protected public entry point.
-- The previous function is owner-only so runtime callers cannot bypass these checks.
ALTER FUNCTION unicirq_command(jsonb) RENAME TO app_command_before_verification_reviews;
REVOKE ALL ON FUNCTION app_command_before_verification_reviews(jsonb) FROM PUBLIC,unicirq_app;

CREATE FUNCTION unicirq_command(command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor profiles; applicant profiles; request verification_requests;
 action text:=command->>'type'; entity text:=command->>'entity'; decision text:=command->>'decision';
 why text:=btrim(command->>'reason'); method text:=command->>'review_method';
 new_id uuid:=gen_random_uuid(); selected uuid; limit_count integer;
BEGIN
 IF action IS DISTINCT FROM 'request_verification' AND NOT coalesce(action='moderate' AND entity='verification',false) THEN
  RETURN app_command_before_verification_reviews(command);
 END IF;
 SELECT * INTO actor FROM profiles WHERE id=app_user_id() FOR UPDATE;
 IF actor.id IS NULL OR actor.suspended THEN RAISE EXCEPTION 'Sign in with an active account' USING ERRCODE='42501'; END IF;
 IF octet_length(command::text)>12000 THEN RAISE EXCEPTION 'Request is too large'; END IF;
 INSERT INTO action_limits(user_id,window_start,request_count) VALUES(actor.id,now(),1)
 ON CONFLICT(user_id) DO UPDATE SET
  request_count=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN 1 ELSE action_limits.request_count+1 END,
  window_start=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN now() ELSE action_limits.window_start END
 RETURNING request_count INTO limit_count;
 IF limit_count>60 THEN RAISE EXCEPTION 'Please wait a minute before trying again'; END IF;

 IF action='request_verification' THEN
  IF actor.role<>'student' THEN RAISE EXCEPTION 'Student access required' USING ERRCODE='42501'; END IF;
  IF (command->>'kind') IS NULL OR (command->>'kind') NOT IN('campus','business') THEN RAISE EXCEPTION 'Choose a valid verification type'; END IF;
  selected:=(command->>'college_id')::uuid;
  IF actor.college_id IS NULL OR selected IS DISTINCT FROM actor.college_id THEN
   RAISE EXCEPTION 'Verification must match the selected university';
  END IF;
  IF command->>'kind'='campus' AND actor.verified THEN RAISE EXCEPTION 'Your campus is already verified'; END IF;
  IF command->>'kind'='business' AND NOT actor.verified THEN
   RAISE EXCEPTION 'Complete campus verification before applying as a business' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT FROM verification_requests WHERE user_id=actor.id AND status='pending') THEN RAISE EXCEPTION 'A review is already pending'; END IF;
  -- The applicant row lock and existing partial unique index serialize submissions.
  INSERT INTO verification_requests(id,user_id,college_id,kind,detail)
   VALUES(new_id,actor.id,actor.college_id,command->>'kind',btrim(command->>'detail'));
  RETURN jsonb_build_object('id',new_id);
 END IF;

 IF actor.role<>'admin' THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF decision IS NULL OR decision NOT IN('approve','reject') THEN RAISE EXCEPTION 'Invalid moderation decision'; END IF;
 IF why IS NULL OR length(why) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'A reason between 5 and 500 characters is required'; END IF;
 SELECT * INTO request FROM verification_requests WHERE id=(command->>'target_id')::uuid FOR UPDATE;
 IF request.id IS NULL OR request.status<>'pending' THEN RAISE EXCEPTION 'This verification has already been reviewed'; END IF;
 IF request.user_id=actor.id THEN RAISE EXCEPTION 'You cannot review your own verification' USING ERRCODE='42501'; END IF;
 SELECT * INTO applicant FROM profiles WHERE id=request.user_id FOR UPDATE;
 IF applicant.id IS NULL OR applicant.suspended OR applicant.role<>'student' THEN
  RAISE EXCEPTION 'The applicant must be an active student' USING ERRCODE='42501';
 END IF;
 IF method IS NOT NULL AND method NOT IN('campus_email','campus_office','in_person','public_business') THEN RAISE EXCEPTION 'Choose a valid review method'; END IF;
 IF decision='approve' THEN
  IF applicant.college_id IS NULL OR applicant.college_id IS DISTINCT FROM request.college_id THEN
   RAISE EXCEPTION 'Verification must match the selected university';
  END IF;
  IF request.kind='business' AND NOT applicant.verified THEN RAISE EXCEPTION 'Campus verification is required before business approval'; END IF;
  IF command->'evidence_checked' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Confirm that you independently checked the evidence'; END IF;
  IF method IS NULL OR (request.kind='campus' AND method='public_business') THEN RAISE EXCEPTION 'Choose a review method appropriate for this application'; END IF;
  IF request.kind='business' AND EXISTS(SELECT FROM orders WHERE request.user_id IN(buyer_id,seller_id) AND status NOT IN('completed','cancelled')) THEN
   RAISE EXCEPTION 'Resolve active student transactions before changing account role';
  END IF;
 END IF;

 UPDATE verification_requests SET status=CASE decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
  reason=why,reviewed_at=now(),reviewed_by=actor.id,review_method=method WHERE id=request.id;
 IF decision='approve' THEN
  -- Confirm enrollment; never move a member to a different campus as a side effect.
  UPDATE profiles SET verified=true,role=CASE WHEN request.kind='business' THEN 'business' ELSE role END WHERE id=applicant.id;
  IF request.kind='business' THEN
   INSERT INTO business_profiles(owner_id,college_id,name,category,description,location,verified)
    VALUES(applicant.id,applicant.college_id,applicant.name,'Campus business',request.detail,'Location pending',true);
  END IF;
 END IF;
 INSERT INTO notifications(user_id,title,body,href) VALUES(applicant.id,'Verification reviewed',why,
  CASE WHEN decision='approve' AND request.kind='business' THEN '/business/profile' ELSE '/student/profile' END);
 INSERT INTO audit_logs(actor_id,action,target_id,reason) VALUES(actor.id,'verification.'||decision,request.id,why);
 RETURN jsonb_build_object('id',request.id);
END $$;
REVOKE ALL ON FUNCTION unicirq_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unicirq_command(jsonb) TO unicirq_app;
