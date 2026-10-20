-- A university suffix alone is not verification. Only the trusted auth backend
-- may record proof after validating a fresh Google identity or email OTP.
-- Existing accounts deliberately receive no proof or automatic backfill.
ALTER TABLE "user" ADD COLUMN "campusEmailProof" text;
ALTER TABLE profiles
 ADD COLUMN campus_verification_source text CHECK(campus_verification_source='university_email'),
 ADD COLUMN campus_email_verified_at timestamptz;

CREATE FUNCTION app_apply_university_email_verification(member_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 identity_record "user"; member profiles; university uuid; verified_at timestamptz:=now();
BEGIN
 SELECT * INTO identity_record FROM "user" WHERE id=member_id FOR UPDATE;
 IF identity_record.id IS NULL OR NOT identity_record."emailVerified" OR
    identity_record."campusEmailProof" IS DISTINCT FROM lower(btrim(identity_record.email)) OR
    identity_record.email IS DISTINCT FROM btrim(identity_record.email) OR
    lower(identity_record.email) !~ '^[^@[:space:]]+@dypiu[.]ac[.]in$' THEN
  RETURN;
 END IF;

 -- The provisioned campus record, rather than client input, owns the mapping.
 SELECT id INTO university FROM colleges WHERE lower(domain)='dypiu.ac.in' ORDER BY id LIMIT 1;
 IF university IS NULL THEN RETURN; END IF;
 SELECT * INTO member FROM profiles WHERE id=member_id FOR UPDATE;
 IF member.id IS NULL OR member.role<>'student' OR member.suspended OR member.verified OR
    (member.college_id IS NOT NULL AND member.college_id<>university) THEN
  RETURN;
 END IF;
 -- Do not silently undo moderation or rewrite another campus's application.
 IF EXISTS(SELECT FROM verification_requests WHERE user_id=member_id AND kind='campus' AND
    (status='rejected' OR (status='pending' AND college_id<>university))) THEN
  RETURN;
 END IF;

 UPDATE profiles SET college_id=university,verified=true,
  campus_verification_source='university_email',campus_email_verified_at=verified_at
  WHERE id=member_id;
 UPDATE verification_requests SET status='approved',reviewed_at=verified_at,
  reviewed_by=NULL,review_method='campus_email',
  reason='DYPIU university email ownership confirmed through a verified sign-in. This does not confirm current student enrollment.'
  WHERE user_id=member_id AND kind='campus' AND college_id=university AND status='pending';
 INSERT INTO notifications(user_id,title,body,href)
  VALUES(member_id,'DYPIU email verified',
   'Your DYPIU university email has been verified and your campus is connected. This badge confirms email ownership, not current student enrollment.',
   '/student/profile#verification');
 INSERT INTO audit_logs(actor_id,action,target_id,reason)
  VALUES(member_id,'university_email.verified',member_id,
   'DYPIU campus access verified through university email ownership. No enrollment claim was made.');
END $$;
REVOKE ALL ON FUNCTION app_apply_university_email_verification(uuid) FROM PUBLIC,unicirq_app;

-- The profile must exist before either auth path can apply the proof.
CREATE OR REPLACE FUNCTION create_student_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO profiles(id,name,avatar)
  VALUES(NEW.id,left(coalesce(nullif(NEW.name,''),'Campus member'),60),'UC');
 PERFORM app_apply_university_email_verification(NEW.id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION create_student_profile() FROM PUBLIC,unicirq_app;

CREATE FUNCTION app_refresh_university_email_verification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM app_apply_university_email_verification(NEW.id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_refresh_university_email_verification() FROM PUBLIC,unicirq_app;
CREATE TRIGGER on_auth_university_email_verified
 AFTER UPDATE OF email,"emailVerified","campusEmailProof" ON "user"
 FOR EACH ROW EXECUTE FUNCTION app_refresh_university_email_verification();
