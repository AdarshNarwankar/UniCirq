-- Only the trusted backend has a DB connection. Application reads additionally use RLS.
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='unicirq_app') THEN CREATE ROLE unicirq_app NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO unicirq_app;
CREATE TABLE colleges (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,short_name text NOT NULL,domain text NOT NULL UNIQUE,city text NOT NULL);
CREATE TABLE profiles (
 id uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),role text NOT NULL DEFAULT 'student' CHECK(role IN('student','business','admin')),
 college_id uuid REFERENCES colleges(id),verified boolean NOT NULL DEFAULT false,bio text NOT NULL DEFAULT '' CHECK(length(bio)<=500),course text NOT NULL DEFAULT '' CHECK(length(course)<=80),
 year text NOT NULL DEFAULT '' CHECK(length(year)<=20),avatar text NOT NULL DEFAULT 'UC',suspended boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT verified OR college_id IS NOT NULL OR role='admin')
);
CREATE FUNCTION create_student_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN INSERT INTO profiles(id,name,avatar) VALUES(new.id,left(coalesce(nullif(new.name,''),'Campus member'),60),'UC');RETURN new;END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION create_student_profile();
CREATE TABLE listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES profiles(id),college_id uuid NOT NULL REFERENCES colleges(id),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 100),description text NOT NULL CHECK(length(description) BETWEEN 10 AND 2000),
 kind text NOT NULL CHECK(kind IN('sale','rental','hardware','service')),category text NOT NULL CHECK(length(category) BETWEEN 3 AND 100),
 price integer NOT NULL CHECK(price BETWEEN 0 AND 100000000),unit text NOT NULL CHECK(unit IN('item','day','hour','session','project')),
 condition text NOT NULL CHECK(condition IN('New','Like new','Good','Fair','Service')),image text NOT NULL DEFAULT '',location text NOT NULL CHECK(length(location) BETWEEN 3 AND 100),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','pending','closed','removed')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_campus_idx ON listings(college_id,status,created_at DESC);
CREATE INDEX listings_owner_idx ON listings(owner_id);
CREATE TABLE student_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES profiles(id),college_id uuid NOT NULL REFERENCES colleges(id),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 100),description text NOT NULL CHECK(length(description) BETWEEN 10 AND 2000),category text NOT NULL CHECK(length(category) BETWEEN 3 AND 100),
 budget integer NOT NULL CHECK(budget BETWEEN 0 AND 100000000),status text NOT NULL DEFAULT 'open' CHECK(status IN('open','fulfilled')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX requests_campus_idx ON student_requests(college_id,status,created_at DESC);
CREATE TABLE conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),member_a uuid NOT NULL REFERENCES profiles(id),member_b uuid NOT NULL REFERENCES profiles(id),
 listing_id uuid REFERENCES listings(id),request_id uuid REFERENCES student_requests(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(member_a<>member_b),CHECK(num_nonnulls(listing_id,request_id)=1)
);
CREATE UNIQUE INDEX conversation_listing_unique ON conversations(member_a,member_b,listing_id) WHERE listing_id IS NOT NULL;
CREATE UNIQUE INDEX conversation_request_unique ON conversations(member_a,member_b,request_id) WHERE request_id IS NOT NULL;
CREATE INDEX conversation_member_b_idx ON conversations(member_b);
CREATE TABLE messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES conversations(id),sender_id uuid NOT NULL REFERENCES profiles(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_conversation_idx ON messages(conversation_id,created_at);
CREATE TABLE orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),listing_id uuid NOT NULL REFERENCES listings(id),buyer_id uuid NOT NULL REFERENCES profiles(id),seller_id uuid NOT NULL REFERENCES profiles(id),college_id uuid NOT NULL REFERENCES colleges(id),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','accepted','handed_over','completed','cancelled','disputed')),
 amount bigint NOT NULL CHECK(amount>=0),kind text NOT NULL CHECK(kind IN('sale','rental','hardware','service')),starts_on date,ends_on date,
 terms_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CHECK(buyer_id<>seller_id),
 CHECK(kind<>'rental' OR (starts_on IS NOT NULL AND ends_on IS NOT NULL AND ends_on>starts_on AND ends_on-starts_on<=30))
);
CREATE UNIQUE INDEX order_active_buyer_unique ON orders(listing_id,buyer_id) WHERE status NOT IN('cancelled','completed');
CREATE INDEX orders_buyer_idx ON orders(buyer_id,created_at DESC);
CREATE INDEX orders_seller_idx ON orders(seller_id,created_at DESC);
CREATE TABLE order_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES orders(id),actor_id uuid NOT NULL REFERENCES profiles(id),status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE saved_items (user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,listing_id uuid NOT NULL REFERENCES listings(id),PRIMARY KEY(user_id,listing_id));
CREATE TABLE support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES profiles(id),college_id uuid REFERENCES colleges(id),order_id uuid REFERENCES orders(id),listing_id uuid REFERENCES listings(id),
 subject text NOT NULL CHECK(length(subject) BETWEEN 3 AND 100),body text NOT NULL CHECK(length(body) BETWEEN 10 AND 2000),type text NOT NULL CHECK(type IN('support','dispute','report','managed_sale')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved')),resolution text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(type<>'dispute' OR order_id IS NOT NULL),CHECK(type<>'report' OR listing_id IS NOT NULL)
);
CREATE UNIQUE INDEX one_open_dispute ON support_tickets(order_id) WHERE type='dispute' AND status='open';
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,title text NOT NULL,body text NOT NULL,href text NOT NULL CHECK(href LIKE '/%'),read boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX notifications_user_idx ON notifications(user_id,created_at DESC);
CREATE TABLE verification_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES profiles(id),college_id uuid NOT NULL REFERENCES colleges(id),kind text NOT NULL CHECK(kind IN('campus','business')),
 detail text NOT NULL CHECK(length(detail) BETWEEN 10 AND 2000),status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_verification ON verification_requests(user_id) WHERE status='pending';
CREATE TABLE business_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL UNIQUE REFERENCES profiles(id),college_id uuid NOT NULL REFERENCES colleges(id),name text NOT NULL,category text NOT NULL,description text NOT NULL,location text NOT NULL,verified boolean NOT NULL DEFAULT false);
CREATE TABLE deals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES business_profiles(id),owner_id uuid NOT NULL REFERENCES profiles(id),college_id uuid NOT NULL REFERENCES colleges(id),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 100),description text NOT NULL CHECK(length(description) BETWEEN 10 AND 2000),code text NOT NULL CHECK(code ~ '^[A-Za-z0-9-]{2,24}$'),expires_on date NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','active','removed')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES profiles(id),action text NOT NULL,target_id uuid NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 500),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE action_limits (user_id uuid PRIMARY KEY REFERENCES profiles(id),window_start timestamptz NOT NULL,request_count integer NOT NULL);

CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
CREATE FUNCTION app_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT FROM profiles WHERE id=app_user_id() AND role='admin' AND NOT suspended) $$;
CREATE FUNCTION app_campus() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT college_id FROM profiles WHERE id=app_user_id() AND NOT suspended $$;
CREATE FUNCTION app_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT FROM profiles WHERE id=app_user_id() AND NOT suspended) $$;
CREATE FUNCTION app_participant(conversation uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT FROM conversations WHERE id=conversation AND app_user_id() IN(member_a,member_b)) $$;
CREATE FUNCTION app_order_listing(listing uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT FROM orders WHERE listing_id=listing AND app_user_id() IN(buyer_id,seller_id)) $$;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['colleges','profiles','listings','student_requests','conversations','messages','orders','order_events','saved_items','support_tickets','notifications','verification_requests','business_profiles','deals','audit_logs','action_limits'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
 EXECUTE format('GRANT SELECT ON %I TO unicirq_app',t);
END LOOP; END $$;
CREATE POLICY college_read ON colleges FOR SELECT TO unicirq_app USING(app_active());
CREATE POLICY profile_read ON profiles FOR SELECT TO unicirq_app USING(app_active() AND (id=app_user_id() OR app_is_admin() OR college_id=app_campus()));
CREATE POLICY listing_read ON listings FOR SELECT TO unicirq_app USING(app_active() AND (app_is_admin() OR (college_id=app_campus() AND (status='active' OR owner_id=app_user_id() OR app_order_listing(id)))));
CREATE POLICY request_read ON student_requests FOR SELECT TO unicirq_app USING(app_active() AND (app_is_admin() OR college_id=app_campus()));
CREATE POLICY conversation_read ON conversations FOR SELECT TO unicirq_app USING(app_active() AND app_user_id() IN(member_a,member_b));
CREATE POLICY message_read ON messages FOR SELECT TO unicirq_app USING(app_active() AND app_participant(conversation_id));
CREATE POLICY order_read ON orders FOR SELECT TO unicirq_app USING(app_active() AND (app_is_admin() OR app_user_id() IN(buyer_id,seller_id)));
CREATE POLICY order_event_read ON order_events FOR SELECT TO unicirq_app USING(EXISTS(SELECT FROM orders WHERE orders.id=order_events.order_id));
CREATE POLICY saved_read ON saved_items FOR SELECT TO unicirq_app USING(app_active() AND user_id=app_user_id());
CREATE POLICY ticket_read ON support_tickets FOR SELECT TO unicirq_app USING(app_active() AND (owner_id=app_user_id() OR app_is_admin()));
CREATE POLICY notification_read ON notifications FOR SELECT TO unicirq_app USING(app_active() AND user_id=app_user_id());
CREATE POLICY verification_read ON verification_requests FOR SELECT TO unicirq_app USING(app_active() AND (user_id=app_user_id() OR app_is_admin()));
CREATE POLICY business_read ON business_profiles FOR SELECT TO unicirq_app USING(app_active() AND (app_is_admin() OR college_id=app_campus()));
CREATE POLICY deal_read ON deals FOR SELECT TO unicirq_app USING(app_active() AND (app_is_admin() OR (college_id=app_campus() AND (status='active' OR owner_id=app_user_id()))));
CREATE POLICY audit_read ON audit_logs FOR SELECT TO unicirq_app USING(app_is_admin());
-- No write policies or table write grants. Mutations require the command function.
REVOKE ALL ON FUNCTION create_student_profile(),app_user_id(),app_is_admin(),app_campus(),app_active(),app_participant(uuid),app_order_listing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_id(),app_is_admin(),app_campus(),app_active(),app_participant(uuid),app_order_listing(uuid) TO unicirq_app;
