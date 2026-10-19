-- Opening one notification must not clear the member's other unread records.
-- Retain the previous command entry point for mark-all and other commands,
-- but keep every superseded implementation unavailable to runtime callers.
ALTER FUNCTION unicirq_command(jsonb) RENAME TO app_command_before_notification_reads;
REVOKE ALL ON FUNCTION app_command_before_notification_reads(jsonb) FROM PUBLIC,unicirq_app;

CREATE FUNCTION unicirq_command(command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor profiles; target uuid; changed integer; limit_count integer;
BEGIN
 IF command->>'type' IS DISTINCT FROM 'read_notifications' OR NOT (command ? 'notification_id') THEN
  RETURN app_command_before_notification_reads(command);
 END IF;

 SELECT * INTO actor FROM profiles WHERE id=app_user_id() FOR UPDATE;
 IF actor.id IS NULL OR actor.suspended THEN RAISE EXCEPTION 'Sign in with an active account' USING ERRCODE='42501'; END IF;
 IF octet_length(command::text)>12000 THEN RAISE EXCEPTION 'Request is too large'; END IF;
 -- A supplied null or invalid ID must fail rather than fall back to mark-all.
 IF jsonb_typeof(command->'notification_id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Choose a valid notification'; END IF;
 target:=(command->>'notification_id')::uuid;

 INSERT INTO action_limits(user_id,window_start,request_count) VALUES(actor.id,now(),1)
 ON CONFLICT(user_id) DO UPDATE SET
  request_count=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN 1 ELSE action_limits.request_count+1 END,
  window_start=CASE WHEN action_limits.window_start<now()-interval '1 minute' THEN now() ELSE action_limits.window_start END
 RETURNING request_count INTO limit_count;
 IF limit_count>60 THEN RAISE EXCEPTION 'Please wait a minute before trying again'; END IF;

 -- Identity comes exclusively from the verified server session, including admins.
 -- Repeating this update is harmless and returns the same notification reference.
 UPDATE notifications SET read=true WHERE id=target AND user_id=actor.id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=0 THEN RAISE EXCEPTION 'Notification is unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',target);
END $$;
REVOKE ALL ON FUNCTION unicirq_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unicirq_command(jsonb) TO unicirq_app;
