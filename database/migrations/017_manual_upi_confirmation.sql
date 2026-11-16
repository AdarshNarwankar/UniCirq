-- Manual UPI uses a snapshotted payee and an auditable transaction reference.
ALTER TABLE billing_records ADD COLUMN manual_upi_id text, ADD COLUMN manual_payee_name text;
CREATE TABLE billing_manual_references (
 utr text PRIMARY KEY CHECK(utr ~ '^[A-Z0-9]{8,40}$'),
 billing_id uuid NOT NULL REFERENCES billing_records(id),
 submitted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE billing_manual_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_manual_references FROM PUBLIC,unicirq_app,unicirq_billing_backend;
INSERT INTO billing_manual_references(utr,billing_id)
 SELECT upper(manual_utr),id FROM billing_records WHERE manual_utr IS NOT NULL;

CREATE FUNCTION app_billing_prepare_manual(record_id uuid, member_id uuid, upi_id text, payee text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bill billing_records; member profiles;
BEGIN
 SELECT * INTO member FROM profiles WHERE id=member_id;
 IF member.id IS NULL OR member.suspended OR NOT member.verified OR member.role<>'student' THEN RAISE EXCEPTION 'Verified student access is required' USING ERRCODE='42501'; END IF;
 SELECT * INTO bill FROM billing_records WHERE id=record_id AND owner_id=member_id FOR UPDATE;
 IF bill.id IS NULL OR bill.purpose<>'order' OR bill.college_id IS DISTINCT FROM member.college_id OR
    bill.payment_mode<>'checkout' OR bill.provider_order_id IS NOT NULL OR (bill.quote->>'buyer_total')::bigint<=0 OR
    NOT EXISTS(SELECT FROM billing_record_orders WHERE billing_id=bill.id) OR bill.status NOT IN('quoted','manual_pending','paid') THEN RAISE EXCEPTION 'Manual payment is unavailable for this statement'; END IF;
 IF upi_id IS NULL OR upi_id !~ '^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,64}$' OR
    payee IS NULL OR length(btrim(payee)) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'Receiving UPI account is not configured'; END IF;
 IF bill.manual_upi_id IS NULL THEN
  UPDATE billing_records SET provider_mode='upi_manual',manual_upi_id=upi_id,manual_payee_name=btrim(payee)
   WHERE id=bill.id RETURNING * INTO bill;
 END IF;
 RETURN to_jsonb(bill);
END $$;
REVOKE ALL ON FUNCTION app_billing_prepare_manual(uuid,uuid,text,text) FROM PUBLIC,unicirq_app;
GRANT EXECUTE ON FUNCTION app_billing_prepare_manual(uuid,uuid,text,text) TO unicirq_billing_backend;

CREATE OR REPLACE FUNCTION app_billing_manual_submit(record_id uuid, utr text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor profiles; bill billing_records; cleaned text:=upper(btrim(utr)); used_by uuid;
BEGIN
 SELECT * INTO actor FROM profiles WHERE id=app_user_id();
 IF actor.id IS NULL OR actor.suspended OR NOT actor.verified THEN RAISE EXCEPTION 'Verified access is required' USING ERRCODE='42501'; END IF;
 SELECT * INTO bill FROM billing_records WHERE id=record_id AND owner_id=actor.id FOR UPDATE;
 IF bill.id IS NULL OR bill.payment_mode<>'checkout' OR bill.provider_mode<>'upi_manual' OR
    bill.provider_order_id IS NOT NULL OR bill.manual_upi_id IS NULL OR bill.college_id IS DISTINCT FROM actor.college_id OR
    bill.quote->>'buyer_total' IS NULL OR (bill.quote->>'buyer_total')::bigint<=0 THEN
  RAISE EXCEPTION 'This statement cannot accept a manual UPI payment';
 END IF;
 IF cleaned IS NULL OR cleaned !~ '^[A-Z0-9]{8,40}$' THEN RAISE EXCEPTION 'Enter a valid UPI transaction reference'; END IF;
 IF bill.status IN('manual_pending','paid') AND bill.manual_utr=cleaned THEN RETURN to_jsonb(bill); END IF;
 IF bill.status<>'quoted' THEN RAISE EXCEPTION 'This payment already has a reference awaiting review'; END IF;
 INSERT INTO billing_manual_references(utr,billing_id) VALUES(cleaned,bill.id) ON CONFLICT DO NOTHING;
 SELECT billing_id INTO used_by FROM billing_manual_references WHERE billing_manual_references.utr=cleaned;
 IF used_by IS DISTINCT FROM bill.id THEN RAISE EXCEPTION 'That transaction ID is already linked to another payment'; END IF;
 UPDATE billing_records SET status='manual_pending',manual_utr=cleaned,manual_submitted_at=now(),
  manual_reviewed_at=NULL,manual_reviewer_id=NULL,manual_review_note=NULL
 WHERE id=bill.id RETURNING * INTO bill;
 INSERT INTO audit_logs(actor_id,action,target_id,reason)
 VALUES(actor.id,'billing.upi_submitted',bill.id,'Buyer submitted a transaction ID for manual account reconciliation.');
 INSERT INTO notifications(user_id,title,body,href)
 SELECT id,'UPI payment awaiting review','A buyer submitted a transaction ID. Check the receiving account before approving.','/admin/billing'
 FROM profiles WHERE role='admin' AND NOT suspended;
 RETURN to_jsonb(bill);
END $$;

CREATE OR REPLACE FUNCTION app_billing_manual_review(record_id uuid, decision text, note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor profiles; bill billing_records; clean_note text:=btrim(note);
BEGIN
 SELECT * INTO actor FROM profiles WHERE id=app_user_id();
 SELECT * INTO bill FROM billing_records WHERE id=record_id FOR UPDATE;
 IF actor.id IS NULL OR actor.role<>'admin' OR actor.suspended THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF bill.id IS NULL OR bill.status<>'manual_pending' OR bill.manual_utr IS NULL THEN RAISE EXCEPTION 'This UPI payment is not awaiting review'; END IF;
 IF decision IS NULL OR decision NOT IN('approve','reject') OR clean_note IS NULL OR length(clean_note) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Choose a decision and provide a review note'; END IF;
 UPDATE billing_records SET status=CASE WHEN decision='approve' THEN 'paid' ELSE 'quoted' END,
   paid_at=CASE WHEN decision='approve' THEN now() ELSE NULL END,
   manual_reviewed_at=now(),manual_reviewer_id=actor.id,manual_review_note=clean_note,
   manual_utr=CASE WHEN decision='approve' THEN manual_utr ELSE NULL END,
   manual_submitted_at=CASE WHEN decision='approve' THEN manual_submitted_at ELSE NULL END
 WHERE id=bill.id RETURNING * INTO bill;
 IF decision='reject' THEN
   INSERT INTO notifications(user_id,title,body,href) VALUES(bill.owner_id,'Payment needs attention',clean_note,'/student/billing');
 END IF;
 IF decision='approve' THEN
   IF bill.owner_id=actor.id OR bill.beneficiary_id=actor.id THEN RAISE EXCEPTION 'You cannot approve a payment you participate in' USING ERRCODE='42501'; END IF;
   IF bill.provider_mode<>'upi_manual' OR bill.provider_order_id IS NOT NULL THEN RAISE EXCEPTION 'This is not a manual UPI payment'; END IF;
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
