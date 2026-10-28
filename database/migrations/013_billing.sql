-- Pilot billing is deliberately restricted to Razorpay test mode. All amounts
-- use integer paise. A test payment never settles an exchange or moves money.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='unicirq_billing_backend') THEN
  CREATE ROLE unicirq_billing_backend NOLOGIN;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO unicirq_billing_backend;

CREATE TABLE billing_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 tax_bps integer CHECK(tax_bps BETWEEN 0 AND 10000),
 business_pilot boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO billing_settings(singleton) VALUES(true);

CREATE TABLE billing_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES profiles(id),
 beneficiary_id uuid REFERENCES profiles(id),
 college_id uuid NOT NULL REFERENCES colleges(id),
 purpose text NOT NULL CHECK(purpose IN('order','boost','business_plan')),
 reference_id uuid,
 plan text CHECK(plan IN('featured','growth')),
 payment_mode text NOT NULL CHECK(payment_mode IN('direct','checkout')),
 quote jsonb NOT NULL,
 status text NOT NULL CHECK(status IN('quoted','pending','paid','recorded','refunded')),
 provider_mode text NOT NULL DEFAULT 'test' CHECK(provider_mode='test'),
 provider_order_id text UNIQUE,
 provider_payment_id text UNIQUE,
 refunded_amount bigint NOT NULL DEFAULT 0 CHECK(refunded_amount>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 paid_at timestamptz,
 CHECK((purpose='business_plan' AND plan IS NOT NULL) OR (purpose<>'business_plan' AND plan IS NULL)),
 CHECK(payment_mode='checkout' OR purpose='order'),
 CHECK(purpose='business_plan' OR reference_id IS NOT NULL)
);
CREATE UNIQUE INDEX billing_order_once ON billing_records(reference_id,payment_mode) WHERE purpose='order';
CREATE INDEX billing_owner_history ON billing_records(owner_id,created_at DESC,id DESC);
CREATE INDEX billing_beneficiary_history ON billing_records(beneficiary_id,created_at DESC,id DESC);

CREATE TABLE billing_entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles(id),
 listing_id uuid REFERENCES listings(id),
 feature text NOT NULL CHECK(feature IN('listing_boost','featured','growth')),
 starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 billing_id uuid NOT NULL UNIQUE REFERENCES billing_records(id),
 provider_mode text NOT NULL DEFAULT 'test' CHECK(provider_mode='test'),
 CHECK(expires_at>=starts_at), CHECK((feature='listing_boost')=(listing_id IS NOT NULL))
);
CREATE INDEX billing_entitlement_owner ON billing_entitlements(owner_id,expires_at);
CREATE TABLE billing_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), billing_id uuid NOT NULL REFERENCES billing_records(id),
 event_id text NOT NULL UNIQUE CHECK(length(event_id) BETWEEN 3 AND 200),
 event_type text NOT NULL CHECK(event_type IN('payment.captured','payment.refunded')),
 amount bigint NOT NULL CHECK(amount>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_limits (
 key text PRIMARY KEY CHECK(length(key) BETWEEN 3 AND 160), count integer NOT NULL,
 until_at timestamptz NOT NULL
);

DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['billing_settings','billing_records','billing_entitlements','billing_events','billing_limits'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,unicirq_app,unicirq_billing_backend',table_name);
 END LOOP;
END $$;
GRANT SELECT ON billing_settings,billing_records,billing_entitlements,billing_events TO unicirq_app;
CREATE POLICY billing_settings_read ON billing_settings FOR SELECT TO unicirq_app USING(app_active());
CREATE POLICY billing_record_read ON billing_records FOR SELECT TO unicirq_app
 USING(app_active() AND (owner_id=app_user_id() OR beneficiary_id=app_user_id() OR app_is_admin()));
CREATE POLICY billing_entitlement_read ON billing_entitlements FOR SELECT TO unicirq_app
 USING(app_active() AND (owner_id=app_user_id() OR app_is_admin()));
CREATE POLICY billing_event_read ON billing_events FOR SELECT TO unicirq_app
 USING(app_active() AND EXISTS(SELECT FROM billing_records WHERE billing_records.id=billing_id));

CREATE FUNCTION app_billing_quote(request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor profiles; activity orders; item listings; business business_profiles; settings billing_settings;
 purpose text:=request->>'purpose'; mode text:=request->>'payment_mode'; chosen_plan text:=request->>'plan';
 principal bigint:=0; fee bigint:=0; tax bigint; payable bigint; net bigint; payer text:='none';
 waived boolean:=false; description text; period_days integer;
BEGIN
 IF jsonb_typeof(request) IS DISTINCT FROM 'object' OR octet_length(request::text)>12000
  OR EXISTS(SELECT FROM jsonb_object_keys(request) key WHERE key NOT IN('purpose','reference_id','payment_mode','plan')) THEN
  RAISE EXCEPTION 'Invalid billing request';
 END IF;
 SELECT * INTO actor FROM profiles WHERE id=app_user_id();
 IF actor.id IS NULL OR actor.suspended THEN RAISE EXCEPTION 'Sign in with an active account' USING ERRCODE='42501'; END IF;
 IF actor.college_id IS NULL OR NOT actor.verified THEN RAISE EXCEPTION 'Verified campus access is required' USING ERRCODE='42501'; END IF;
 IF purpose IS NULL OR purpose NOT IN('order','boost','business_plan') OR mode IS NULL OR mode NOT IN('direct','checkout')
  OR (purpose<>'order' AND mode<>'checkout') THEN RAISE EXCEPTION 'Invalid billing selection'; END IF;
 SELECT * INTO settings FROM billing_settings WHERE singleton;
 IF purpose='order' THEN
  IF actor.role<>'student' OR request ? 'plan' OR NOT request ? 'reference_id' THEN RAISE EXCEPTION 'Student order billing is required' USING ERRCODE='42501'; END IF;
  SELECT * INTO activity FROM orders WHERE id=(request->>'reference_id')::uuid;
  IF activity.id IS NULL OR activity.buyer_id<>actor.id OR activity.seller_id=actor.id OR activity.college_id<>actor.college_id
   OR activity.status<>'accepted' OR NOT EXISTS(SELECT FROM profiles WHERE id=activity.seller_id AND verified AND NOT suspended AND role='student') THEN
   RAISE EXCEPTION 'Only the buyer can bill an accepted campus exchange' USING ERRCODE='42501';
  END IF;
  principal:=activity.amount;
  IF mode='direct' THEN description:='Direct campus exchange';
  ELSE
   fee:=CASE WHEN principal=0 THEN 0 ELSE greatest(1900,round(principal::numeric*CASE WHEN activity.kind IN('sale','hardware') THEN 500 ELSE 800 END/10000)::bigint) END;
   payer:=CASE WHEN principal=0 THEN 'none' WHEN activity.kind='rental' THEN 'renter' WHEN activity.kind='service' THEN 'provider' ELSE 'buyer' END;
   description:=CASE WHEN activity.kind='rental' THEN 'UniCirq rental checkout' WHEN activity.kind='service' THEN 'UniCirq service checkout' ELSE 'UniCirq sale checkout' END;
  END IF;
 ELSIF purpose='boost' THEN
  IF actor.role<>'student' OR request ? 'plan' OR NOT request ? 'reference_id' THEN RAISE EXCEPTION 'Student listing billing is required' USING ERRCODE='42501'; END IF;
  SELECT * INTO item FROM listings WHERE id=(request->>'reference_id')::uuid;
  IF item.id IS NULL OR item.owner_id<>actor.id OR item.college_id<>actor.college_id OR item.status<>'active' THEN
   RAISE EXCEPTION 'Only your own active listing can be boosted' USING ERRCODE='42501';
  END IF;
  principal:=2900; fee:=2900; payer:='seller'; period_days:=7; description:='Listing boost · 7 days';
 ELSE
  IF actor.role<>'business' OR request ? 'reference_id' OR chosen_plan IS NULL OR chosen_plan NOT IN('featured','growth') THEN RAISE EXCEPTION 'Choose a business plan' USING ERRCODE='42501'; END IF;
  SELECT * INTO business FROM business_profiles WHERE owner_id=actor.id AND verified AND college_id=actor.college_id;
  IF business.id IS NULL THEN RAISE EXCEPTION 'Approved business access is required' USING ERRCODE='42501'; END IF;
  principal:=CASE chosen_plan WHEN 'featured' THEN 49900 ELSE 99900 END;
  waived:=settings.business_pilot; fee:=CASE WHEN waived THEN 0 ELSE principal END; payer:='business';
  description:=CASE chosen_plan WHEN 'featured' THEN 'Featured business plan · monthly' ELSE 'Growth business plan · monthly' END;
 END IF;
 IF purpose='order' AND payer='provider' AND fee>principal THEN RAISE EXCEPTION 'The service price must cover its platform fee and tax'; END IF;
 IF fee=0 THEN tax:=0;
 ELSIF settings.tax_bps IS NULL THEN tax:=NULL;
 ELSE tax:=round(fee::numeric*settings.tax_bps/10000)::bigint; END IF;
 IF tax IS NULL THEN payable:=NULL; net:=NULL;
 ELSIF purpose<>'order' THEN payable:=fee+tax; net:=0;
 ELSIF payer='provider' THEN payable:=principal; net:=principal-fee-tax;
 ELSE payable:=principal+fee+tax; net:=principal; END IF;
 IF net<0 THEN RAISE EXCEPTION 'The service price must cover its platform fee and tax'; END IF;
 RETURN jsonb_build_object('policy_version','2026-10-pilot','purpose',purpose,'currency','INR','base_amount',principal,
  'platform_fee',fee,'tax_amount',tax,'tax_bps',settings.tax_bps,'deposit_amount',0,'buyer_total',payable,'seller_net',net,
  'fee_payer',payer,'payment_mode',mode,'pilot_waived',waived,'description',description,'period_days',period_days);
END $$;

-- The only entitlement writer is private to the protected functions below.
CREATE FUNCTION app_billing_grant(record_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bill billing_records; BEGIN
 SELECT * INTO bill FROM billing_records WHERE id=record_id;
 IF bill.id IS NULL OR bill.purpose='order' OR bill.status NOT IN('paid','recorded') OR bill.refunded_amount>0 THEN RETURN; END IF;
 INSERT INTO billing_entitlements(owner_id,listing_id,feature,starts_at,expires_at,billing_id)
 VALUES(bill.owner_id,CASE WHEN bill.purpose='boost' THEN bill.reference_id END,
  CASE WHEN bill.purpose='boost' THEN 'listing_boost' ELSE bill.plan END,now(),
  CASE WHEN bill.purpose='boost' THEN now()+interval '7 days' ELSE ((now() AT TIME ZONE 'Asia/Kolkata')+interval '1 month') AT TIME ZONE 'Asia/Kolkata' END,bill.id)
 ON CONFLICT(billing_id) DO NOTHING;
END $$;

CREATE FUNCTION app_billing_create(request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor profiles; bill billing_records; calculated jsonb; ref uuid; beneficiary uuid; wanted_plan text:=request->>'plan'; BEGIN
 SELECT * INTO actor FROM profiles WHERE id=app_user_id() FOR UPDATE;
 calculated:=app_billing_quote(request);
 IF request->>'purpose'='business_plan' THEN SELECT id INTO ref FROM business_profiles WHERE owner_id=actor.id;
 ELSE ref:=(request->>'reference_id')::uuid; END IF;
 IF request->>'purpose'='order' THEN
  SELECT seller_id INTO beneficiary FROM orders WHERE id=ref;
  SELECT * INTO bill FROM billing_records WHERE purpose='order' AND reference_id=ref AND payment_mode=request->>'payment_mode' FOR UPDATE;
 ELSE
  SELECT records.* INTO bill FROM billing_records records WHERE records.owner_id=actor.id AND records.purpose=request->>'purpose'
   AND records.reference_id=ref AND records.plan IS NOT DISTINCT FROM wanted_plan
   AND (records.status IN('quoted','pending') OR EXISTS(SELECT FROM billing_entitlements access WHERE access.billing_id=records.id AND access.expires_at>now()))
   ORDER BY records.created_at DESC LIMIT 1 FOR UPDATE;
 END IF;
 IF bill.id IS NOT NULL THEN
  IF bill.status='quoted' AND bill.provider_order_id IS NULL AND bill.expires_at<now() THEN
   IF (calculated->>'buyer_total') IS NULL THEN RAISE EXCEPTION 'Tax settings must be confirmed before test checkout'; END IF;
   UPDATE billing_records SET quote=calculated,expires_at=now()+interval '15 minutes' WHERE id=bill.id RETURNING * INTO bill;
  END IF;
  RETURN to_jsonb(bill);
 END IF;
 IF (calculated->>'buyer_total') IS NULL THEN RAISE EXCEPTION 'Tax settings must be confirmed before test checkout'; END IF;
 INSERT INTO billing_records(owner_id,beneficiary_id,college_id,purpose,reference_id,plan,payment_mode,quote,status)
 VALUES(actor.id,beneficiary,actor.college_id,request->>'purpose',ref,wanted_plan,request->>'payment_mode',calculated,
  CASE WHEN request->>'payment_mode'='direct' OR (calculated->>'buyer_total')::bigint=0 THEN 'recorded' ELSE 'quoted' END)
 RETURNING * INTO bill;
 IF bill.status='recorded' THEN PERFORM app_billing_grant(bill.id); END IF;
 RETURN to_jsonb(bill);
END $$;

CREATE FUNCTION app_billing_configure(request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor profiles; settings billing_settings; why text:=btrim(request->>'reason'); tax integer; pilot boolean; BEGIN
 SELECT * INTO actor FROM profiles WHERE id=app_user_id() FOR UPDATE;
 IF actor.id IS NULL OR actor.suspended OR actor.role<>'admin' THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(request) IS DISTINCT FROM 'object' OR octet_length(request::text)>2000
  OR EXISTS(SELECT FROM jsonb_object_keys(request) key WHERE key NOT IN('tax_bps','business_pilot','reason'))
  OR NOT request ? 'tax_bps' OR NOT request ? 'business_pilot' OR jsonb_typeof(request->'business_pilot') IS DISTINCT FROM 'boolean'
  OR (jsonb_typeof(request->'tax_bps') NOT IN('number','null')) OR why IS NULL OR length(why) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Confirm billing settings and give a reason'; END IF;
 IF request->'tax_bps'<>'null'::jsonb AND request->>'tax_bps' !~ '^[0-9]{1,5}$' THEN RAISE EXCEPTION 'Use a whole tax basis-point rate'; END IF;
 tax:=(request->>'tax_bps')::integer; pilot:=(request->>'business_pilot')::boolean;
 IF tax<0 OR tax>10000 THEN RAISE EXCEPTION 'Invalid tax rate'; END IF;
 UPDATE billing_settings SET tax_bps=tax,business_pilot=pilot,updated_at=now() WHERE singleton RETURNING * INTO settings;
 INSERT INTO audit_logs(actor_id,action,target_id,reason) VALUES(actor.id,'billing.configure',actor.id,why);
 RETURN to_jsonb(settings);
END $$;

CREATE FUNCTION app_billing_backend_record(record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bill billing_records; BEGIN SELECT * INTO bill FROM billing_records WHERE id=record_id FOR UPDATE; RETURN CASE WHEN bill.id IS NOT NULL THEN to_jsonb(bill) END; END $$;
CREATE FUNCTION app_billing_gateway_record(order_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bill billing_records; BEGIN SELECT * INTO bill FROM billing_records WHERE provider_order_id=order_id FOR UPDATE; RETURN CASE WHEN bill.id IS NOT NULL THEN to_jsonb(bill) END; END $$;

CREATE FUNCTION app_billing_attach(record_id uuid,order_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bill billing_records; BEGIN
 SELECT * INTO bill FROM billing_records WHERE id=record_id FOR UPDATE;
 IF bill.id IS NULL OR bill.payment_mode<>'checkout' OR bill.status NOT IN('quoted','pending')
  OR order_id IS NULL OR order_id !~ '^order_[A-Za-z0-9]{1,80}$' THEN RAISE EXCEPTION 'Invalid test checkout attachment'; END IF;
 IF bill.provider_order_id IS NOT NULL THEN
  IF bill.provider_order_id<>order_id THEN RAISE EXCEPTION 'This billing record already has a checkout'; END IF;
  RETURN to_jsonb(bill);
 END IF;
 IF bill.expires_at<now() THEN RAISE EXCEPTION 'Refresh the expired billing quote'; END IF;
 UPDATE billing_records SET provider_order_id=order_id,status='pending' WHERE id=bill.id RETURNING * INTO bill;
 RETURN to_jsonb(bill);
END $$;

CREATE FUNCTION app_billing_capture(record_id uuid,order_id text,payment_id text,paid_amount bigint,currency text,event_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bill billing_records; existing billing_events; role_name text; BEGIN
 SELECT * INTO bill FROM billing_records WHERE id=record_id FOR UPDATE;
 IF bill.id IS NULL OR bill.payment_mode<>'checkout' OR bill.provider_order_id IS DISTINCT FROM order_id OR bill.provider_mode<>'test'
  OR currency IS DISTINCT FROM 'INR' OR paid_amount IS DISTINCT FROM (bill.quote->>'buyer_total')::bigint OR paid_amount<=0
  OR payment_id IS NULL OR payment_id !~ '^pay_[A-Za-z0-9]{1,80}$' OR event_key IS NULL OR length(event_key) NOT BETWEEN 3 AND 200 THEN
  RAISE EXCEPTION 'Captured test payment does not match its billing record';
 END IF;
 IF bill.provider_payment_id IS NOT NULL AND bill.provider_payment_id<>payment_id THEN RAISE EXCEPTION 'This record already has another captured payment'; END IF;
 IF bill.status NOT IN('pending','paid','refunded') THEN RAISE EXCEPTION 'This billing record cannot accept a payment'; END IF;
 INSERT INTO billing_events(billing_id,event_id,event_type,amount) VALUES(bill.id,event_key,'payment.captured',paid_amount) ON CONFLICT(event_id) DO NOTHING;
 SELECT * INTO existing FROM billing_events WHERE event_id=event_key;
 IF existing.billing_id<>bill.id OR existing.event_type<>'payment.captured' OR existing.amount<>paid_amount THEN RAISE EXCEPTION 'Payment event does not match'; END IF;
 IF bill.status IN('paid','refunded') THEN RETURN to_jsonb(bill); END IF;
 UPDATE billing_records SET status='paid',provider_payment_id=payment_id,paid_at=now() WHERE id=bill.id RETURNING * INTO bill;
 PERFORM app_billing_grant(bill.id);
 SELECT role INTO role_name FROM profiles WHERE id=bill.owner_id;
 INSERT INTO notifications(user_id,title,body,href) VALUES(bill.owner_id,'Test payment confirmed','Your Razorpay test payment was verified. No real money was charged.','/'||role_name||'/billing');
 INSERT INTO audit_logs(actor_id,action,target_id,reason) VALUES(bill.owner_id,'billing.test_paid',bill.id,'Captured Razorpay test payment verified against the stored amount and currency.');
 RETURN to_jsonb(bill);
END $$;

CREATE FUNCTION app_billing_refund(record_id uuid,payment_id text,refund_amount bigint,event_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bill billing_records; existing billing_events; total bigint; BEGIN
 SELECT * INTO bill FROM billing_records WHERE id=record_id FOR UPDATE;
 IF bill.id IS NULL OR bill.provider_payment_id IS DISTINCT FROM payment_id OR bill.status NOT IN('paid','refunded')
  OR bill.provider_mode<>'test' OR refund_amount IS NULL OR refund_amount<=0 OR event_key IS NULL OR event_key !~ '^refund:[A-Za-z0-9_]{1,100}$' THEN RAISE EXCEPTION 'Invalid processed test refund'; END IF;
 SELECT * INTO existing FROM billing_events WHERE event_id=event_key;
 IF existing.id IS NOT NULL THEN
  IF existing.billing_id<>bill.id OR existing.event_type<>'payment.refunded' OR existing.amount<>refund_amount THEN RAISE EXCEPTION 'Refund event does not match'; END IF;
  RETURN to_jsonb(bill);
 END IF;
 total:=(bill.quote->>'buyer_total')::bigint;
 IF bill.refunded_amount+refund_amount>total THEN RAISE EXCEPTION 'Refund exceeds the captured amount'; END IF;
 INSERT INTO billing_events(billing_id,event_id,event_type,amount) VALUES(bill.id,event_key,'payment.refunded',refund_amount);
 UPDATE billing_records SET refunded_amount=refunded_amount+refund_amount,
  status=CASE WHEN refunded_amount+refund_amount=total THEN 'refunded' ELSE 'paid' END WHERE id=bill.id RETURNING * INTO bill;
 UPDATE billing_entitlements SET expires_at=least(expires_at,now()) WHERE billing_id=bill.id;
 INSERT INTO audit_logs(actor_id,action,target_id,reason) VALUES(bill.owner_id,'billing.test_refunded',bill.id,'Processed Razorpay test refund reconciled; related test access was revoked.');
 RETURN to_jsonb(bill);
END $$;

-- Commit this independent admission check before starting work which can fail.
-- Returning false (rather than raising) keeps denied attempts in the counter.
CREATE FUNCTION app_billing_limit(bucket text,maximum integer,window_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE observed integer; BEGIN
 IF bucket IS NULL OR length(bucket) NOT BETWEEN 3 AND 160 OR maximum IS NULL OR maximum NOT BETWEEN 1 AND 10000 OR window_seconds IS NULL OR window_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'Invalid billing limit'; END IF;
 DELETE FROM billing_limits WHERE until_at<now()-interval '1 day';
 INSERT INTO billing_limits(key,count,until_at) VALUES(bucket,1,now()+make_interval(secs=>window_seconds))
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN billing_limits.until_at<=now() THEN 1 ELSE least(billing_limits.count+1,10001) END,
  until_at=CASE WHEN billing_limits.until_at<=now() THEN now()+make_interval(secs=>window_seconds) ELSE billing_limits.until_at END
 RETURNING count INTO observed;
 RETURN observed<=maximum;
END $$;

REVOKE ALL ON FUNCTION app_billing_quote(jsonb),app_billing_create(jsonb),app_billing_configure(jsonb),app_billing_grant(uuid),
 app_billing_backend_record(uuid),app_billing_gateway_record(text),app_billing_attach(uuid,text),app_billing_capture(uuid,text,text,bigint,text,text),
 app_billing_refund(uuid,text,bigint,text),app_billing_limit(text,integer,integer) FROM PUBLIC,unicirq_app,unicirq_billing_backend;
GRANT EXECUTE ON FUNCTION app_billing_quote(jsonb),app_billing_create(jsonb),app_billing_configure(jsonb) TO unicirq_app;
GRANT EXECUTE ON FUNCTION app_billing_backend_record(uuid),app_billing_gateway_record(text),app_billing_attach(uuid,text),
 app_billing_capture(uuid,text,text,bigint,text,text),app_billing_refund(uuid,text,bigint,text),app_billing_limit(text,integer,integer) TO unicirq_billing_backend;
-- Grant this NOLOGIN role only to the trusted runtime login through the separate
-- operator connection. Never grant it to unicirq_app or any browser identity.
