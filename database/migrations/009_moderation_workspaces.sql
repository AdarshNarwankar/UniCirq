-- Keep earlier command implementations owner-only. Only this public entry point
-- may approve/remove inventory or resolve a support case against its current state.
ALTER FUNCTION unicirq_command(jsonb) RENAME TO app_command_before_moderation_workspaces;
REVOKE ALL ON FUNCTION app_command_before_moderation_workspaces(jsonb) FROM PUBLIC,unicirq_app;

CREATE FUNCTION unicirq_command(command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor profiles; listing listings; offer deals; ticket support_tickets;
 action text:=command->>'type'; entity text:=command->>'entity'; decision text:=command->>'decision';
 why text:=btrim(command->>'reason'); target uuid; owner_role text; limit_count integer;
BEGIN
 IF NOT coalesce(action='moderate' AND entity IN('listing','deal','ticket'),false) THEN
  RETURN app_command_before_moderation_workspaces(command);
 END IF;
 SELECT * INTO actor FROM profiles WHERE id=app_user_id() FOR UPDATE;
 IF actor.id IS NULL OR actor.suspended THEN RAISE EXCEPTION 'Sign in with an active account' USING ERRCODE='42501'; END IF;
 IF actor.role<>'admin' THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF octet_length(command::text)>12000 THEN RAISE EXCEPTION 'Request is too large'; END IF;
 IF why IS NULL OR length(why) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'A reason between 5 and 500 characters is required'; END IF;
 IF decision IS NULL OR (entity IN('listing','deal') AND decision NOT IN('approve','remove')) OR (entity='ticket' AND decision<>'resolve') THEN
  RAISE EXCEPTION 'Invalid moderation decision';
 END IF;
 target:=(command->>'target_id')::uuid;
 INSERT INTO action_limits(user_id,window_start,request_count) VALUES(actor.id,now(),1)
 ON CONFLICT(user_id) DO UPDATE SET
  request_count=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN 1 ELSE action_limits.request_count+1 END,
  window_start=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN now() ELSE action_limits.window_start END
 RETURNING request_count INTO limit_count;
 IF limit_count>60 THEN RAISE EXCEPTION 'Please wait a minute before trying again'; END IF;

 IF entity='listing' THEN
  SELECT * INTO listing FROM listings WHERE id=target FOR UPDATE;
  IF listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF (decision='approve' AND listing.status<>'pending') OR (decision='remove' AND listing.status NOT IN('pending','active')) THEN
   RAISE EXCEPTION 'This listing has changed or has already been reviewed. Refresh before continuing';
  END IF;
  UPDATE listings SET status=CASE decision WHEN 'approve' THEN 'active' ELSE 'removed' END WHERE id=target;
 ELSIF entity='deal' THEN
  SELECT * INTO offer FROM deals WHERE id=target FOR UPDATE;
  IF offer.id IS NULL THEN RAISE EXCEPTION 'Deal not found'; END IF;
  IF (decision='approve' AND offer.status<>'pending') OR (decision='remove' AND offer.status NOT IN('pending','active')) THEN
   RAISE EXCEPTION 'This deal has changed or has already been reviewed. Refresh before continuing';
  END IF;
  IF decision='approve' AND offer.expires_on<(current_timestamp AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'This deal has expired and cannot be approved'; END IF;
  UPDATE deals SET status=CASE decision WHEN 'approve' THEN 'active' ELSE 'removed' END WHERE id=target;
 ELSE
  SELECT * INTO ticket FROM support_tickets WHERE id=target FOR UPDATE;
  IF ticket.id IS NULL OR ticket.status<>'open' THEN RAISE EXCEPTION 'This support case is already resolved or unavailable'; END IF;
  UPDATE support_tickets SET status='resolved',resolution=why WHERE id=target;
  SELECT role INTO owner_role FROM profiles WHERE id=ticket.owner_id;
  -- Resolving a case records a response only. It never changes an order, listing,
  -- payment, refund, or the applicant's campus/role/verification state.
  INSERT INTO notifications(user_id,title,body,href) VALUES(ticket.owner_id,'Support case resolved',why,
   CASE owner_role WHEN 'business' THEN '/business/support' WHEN 'admin' THEN '/admin/support' ELSE '/student/support' END);
 END IF;
 INSERT INTO audit_logs(actor_id,action,target_id,reason) VALUES(actor.id,entity||'.'||decision,target,why);
 RETURN jsonb_build_object('id',target);
END $$;
REVOKE ALL ON FUNCTION unicirq_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unicirq_command(jsonb) TO unicirq_app;
