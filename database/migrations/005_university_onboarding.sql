-- A first university choice scopes discovery; it does not verify enrollment.
-- Authentication creates an unverified Student profile before this function runs.
CREATE FUNCTION app_choose_university(command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 p profiles; selected uuid; display_name text; selected_course text; selected_year text;
BEGIN
 SELECT * INTO p FROM profiles WHERE id=app_user_id() FOR UPDATE;
 IF p.id IS NULL OR p.suspended OR p.role<>'student' THEN
  RAISE EXCEPTION 'Active student access is required' USING ERRCODE='42501';
 END IF;
 IF p.verified THEN RAISE EXCEPTION 'Your university is already verified'; END IF;
 IF command->>'type' IS DISTINCT FROM 'choose_university' OR octet_length(command::text)>12000 THEN
  RAISE EXCEPTION 'Invalid university choice';
 END IF;
 IF jsonb_typeof(command->'college_id') IS DISTINCT FROM 'string' OR
    (command->>'college_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION 'Choose a supported university';
 END IF;
 selected:=(command->>'college_id')::uuid;
 IF NOT EXISTS(SELECT FROM colleges WHERE id=selected) THEN RAISE EXCEPTION 'Choose a supported university'; END IF;
 IF p.college_id IS NOT NULL AND p.college_id<>selected THEN
  RAISE EXCEPTION 'Your university is already selected. Contact support to request a change';
 END IF;
 IF EXISTS(SELECT FROM verification_requests WHERE user_id=p.id AND status='pending' AND college_id<>selected) THEN
  RAISE EXCEPTION 'Your pending verification belongs to another university. Contact support';
 END IF;
 IF jsonb_typeof(command->'name') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Enter your display name'; END IF;
 display_name:=regexp_replace(command->>'name','^[[:space:]]+|[[:space:]]+$','','g');
 IF length(display_name) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Enter a display name between 2 and 60 characters'; END IF;
 IF command ? 'course' AND jsonb_typeof(command->'course') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Enter valid course details'; END IF;
 IF command ? 'year' AND jsonb_typeof(command->'year') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Enter valid year details'; END IF;
 selected_course:=CASE WHEN command ? 'course' THEN regexp_replace(command->>'course','^[[:space:]]+|[[:space:]]+$','','g') ELSE p.course END;
 selected_year:=CASE WHEN command ? 'year' THEN regexp_replace(command->>'year','^[[:space:]]+|[[:space:]]+$','','g') ELSE p.year END;
 IF length(selected_course)>80 OR length(selected_year)>20 THEN RAISE EXCEPTION 'Course or year details are too long'; END IF;
 UPDATE profiles SET college_id=selected,name=display_name,course=selected_course,year=selected_year,
  avatar=upper(left(display_name,1)||left(coalesce((regexp_split_to_array(display_name,'\s+'))[2],''),1)),
  verified=false WHERE id=p.id;
 RETURN jsonb_build_object('id',p.id);
END $$;
REVOKE ALL ON FUNCTION app_choose_university(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_choose_university(jsonb) TO unicirq_app;

-- Verification always confirms the campus chosen during onboarding.
-- Reject a stale approval before the legacy moderation function can reassign it.
CREATE FUNCTION app_check_campus_verification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE selected uuid;
BEGIN
 IF NEW.kind='campus' AND (TG_OP='INSERT' OR NEW.status='approved' OR NEW.college_id IS DISTINCT FROM OLD.college_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
  SELECT college_id INTO selected FROM profiles WHERE id=NEW.user_id FOR UPDATE;
  IF selected IS NULL OR selected IS DISTINCT FROM NEW.college_id THEN
   RAISE EXCEPTION 'Campus verification must match the selected university';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_check_campus_verification() FROM PUBLIC;
CREATE TRIGGER verification_university_guard BEFORE INSERT OR UPDATE OF college_id,user_id,status
 ON verification_requests FOR EACH ROW EXECUTE FUNCTION app_check_campus_verification();
