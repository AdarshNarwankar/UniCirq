-- One bounded, server-normalized photo per listing. Application metadata remains small.
CREATE TABLE listing_photos (
 listing_id uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 12 AND 819200),
 content_type text NOT NULL DEFAULT 'image/webp' CHECK(content_type='image/webp'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(CASE WHEN octet_length(bytes)>=12 THEN
  substring(bytes FROM 1 FOR 4)=decode('52494646','hex') AND
  substring(bytes FROM 9 FOR 4)=decode('57454250','hex') AND
  get_byte(bytes,4)+get_byte(bytes,5)*256+get_byte(bytes,6)*65536+get_byte(bytes,7)*16777216::bigint=octet_length(bytes)-8
 ELSE false END)
);
ALTER TABLE listing_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON listing_photos FROM PUBLIC,unicirq_app;
GRANT SELECT ON listing_photos TO unicirq_app;
-- The nested listing read is evaluated with the caller's existing listing RLS.
-- This also preserves private archived context for order/conversation participants.
CREATE POLICY listing_photo_read ON listing_photos FOR SELECT TO unicirq_app
 USING(EXISTS(SELECT FROM listings WHERE listings.id=listing_photos.listing_id));

CREATE FUNCTION app_create_listing_with_photo(command jsonb,photo bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor profiles; result jsonb; listing uuid; recent_photos integer; byte_count integer;
BEGIN
 -- Serialize a member's submissions before checking the rolling photo quota.
 SELECT * INTO actor FROM profiles WHERE id=app_user_id() FOR UPDATE;
 IF actor.id IS NULL OR actor.suspended THEN RAISE EXCEPTION 'Sign in with an active account' USING ERRCODE='42501'; END IF;
 IF command->>'type' IS DISTINCT FROM 'create_listing' THEN RAISE EXCEPTION 'Only listing creation supports a photo'; END IF;
 byte_count:=octet_length(photo);
 IF byte_count IS NULL OR byte_count<12 OR byte_count>819200 THEN RAISE EXCEPTION 'Photo must be a WebP image no larger than 800 KB'; END IF;
 IF substring(photo FROM 1 FOR 4)<>decode('52494646','hex') OR substring(photo FROM 9 FOR 4)<>decode('57454250','hex')
  OR get_byte(photo,4)+get_byte(photo,5)*256+get_byte(photo,6)*65536+get_byte(photo,7)*16777216::bigint<>byte_count-8 THEN
  RAISE EXCEPTION 'Photo must be a valid normalized WebP image';
 END IF;
 SELECT count(*) INTO recent_photos FROM listing_photos lp JOIN listings l ON l.id=lp.listing_id
  WHERE l.owner_id=actor.id AND lp.created_at>now()-interval '24 hours';
 IF recent_photos>=20 THEN RAISE EXCEPTION 'Daily photo limit reached. Try again later'; END IF;
 -- The existing command owns student/campus authorization and all listing validation.
 -- Its insert and the photo attachment share this statement's atomic transaction.
 result:=unicirq_command(command);
 listing:=(result->>'id')::uuid;
 INSERT INTO listing_photos(listing_id,bytes) VALUES(listing,photo);
 UPDATE listings SET image='/api/listings/'||listing::text||'/image' WHERE id=listing AND owner_id=actor.id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_create_listing_with_photo(jsonb,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_listing_with_photo(jsonb,bytea) TO unicirq_app;
