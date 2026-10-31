-- Manual UPI settlement for real payments. A submitted UTR is never payment
-- confirmation; an administrator must reconcile it against the bank account.
ALTER TABLE billing_records DROP CONSTRAINT billing_records_status_check;
ALTER TABLE billing_records ADD CONSTRAINT billing_records_status_check
  CHECK(status IN('quoted','pending','manual_pending','paid','recorded','refunded'));
ALTER TABLE billing_records DROP CONSTRAINT billing_records_provider_mode_check;
ALTER TABLE billing_records ADD CONSTRAINT billing_records_provider_mode_check
  CHECK(provider_mode IN('test','upi_manual'));
ALTER TABLE billing_records
  ADD COLUMN manual_utr text UNIQUE,
  ADD COLUMN manual_submitted_at timestamptz,
  ADD COLUMN manual_reviewed_at timestamptz,
  ADD COLUMN manual_reviewer_id uuid REFERENCES profiles(id),
  ADD COLUMN manual_review_note text;

CREATE FUNCTION app_billing_manual_submit(record_id uuid, utr text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor profiles; bill billing_records; cleaned text:=upper(btrim(utr));
BEGIN
 SELECT * INTO actor FROM profiles WHERE id=app_user_id();
 SELECT * INTO bill FROM billing_records WHERE id=record_id AND owner_id=actor.id FOR UPDATE;
 IF bill.id IS NULL OR actor.suspended OR bill.payment_mode<>'checkout'
   OR bill.status NOT IN('quoted','pending') OR bill.quote->>'buyer_total' IS NULL
   OR (bill.quote->>'buyer_total')::bigint = 0 THEN
   RAISE EXCEPTION 'This billing record cannot accept a UPI payment';
 END IF;
 IF cleaned !~ '^[A-Z0-9]{8,40}$' THEN RAISE EXCEPTION 'Enter a valid UPI transaction reference'; END IF;
 IF bill.manual_utr IS NOT NULL THEN
   IF bill.manual_utr<>cleaned THEN RAISE EXCEPTION 'A UPI reference is already submitted for this bill'; END IF;
   RETURN to_jsonb(bill);
 END IF;
 UPDATE billing_records SET provider_mode='upi_manual',status='manual_pending',
   manual_utr=cleaned,manual_submitted_at=now(),manual_reviewed_at=NULL,
   manual_reviewer_id=NULL,manual_review_note=NULL
 WHERE id=bill.id RETURNING * INTO bill;
 INSERT INTO audit_logs(actor_id,action,target_id,reason)
 VALUES(actor.id,'billing.upi_submitted',bill.id,'Buyer submitted a UPI transaction reference for manual reconciliation.');
 RETURN to_jsonb(bill);
END $$;

CREATE FUNCTION app_billing_manual_review(record_id uuid, decision text, note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor profiles; bill billing_records; clean_note text:=btrim(note);
BEGIN
 SELECT * INTO actor FROM profiles WHERE id=app_user_id();
 SELECT * INTO bill FROM billing_records WHERE id=record_id FOR UPDATE;
 IF actor.id IS NULL OR actor.role<>'admin' OR actor.suspended THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF bill.id IS NULL OR bill.status<>'manual_pending' OR bill.manual_utr IS NULL THEN RAISE EXCEPTION 'This UPI payment is not awaiting review'; END IF;
 IF decision NOT IN('approve','reject') OR length(clean_note) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Choose a decision and provide a review note'; END IF;
 UPDATE billing_records SET status=CASE WHEN decision='approve' THEN 'paid' ELSE 'quoted' END,
   paid_at=CASE WHEN decision='approve' THEN now() ELSE NULL END,
   manual_reviewed_at=now(),manual_reviewer_id=actor.id,manual_review_note=clean_note,
   manual_utr=CASE WHEN decision='approve' THEN manual_utr ELSE NULL END,
   manual_submitted_at=CASE WHEN decision='approve' THEN manual_submitted_at ELSE NULL END
 WHERE id=bill.id RETURNING * INTO bill;
 IF decision='approve' THEN
   PERFORM app_billing_grant(bill.id);
   INSERT INTO notifications(user_id,title,body,href) VALUES
     (bill.owner_id,'UPI payment verified','Your UPI payment was verified by UniCirq.','/'||COALESCE((SELECT role FROM profiles WHERE id=bill.owner_id),'student')||'/billing');
 END IF;
 INSERT INTO audit_logs(actor_id,action,target_id,reason)
 VALUES(actor.id,CASE WHEN decision='approve' THEN 'billing.upi_approved' ELSE 'billing.upi_rejected' END,bill.id,clean_note);
 RETURN to_jsonb(bill);
END $$;

REVOKE ALL ON FUNCTION app_billing_manual_submit(uuid,text),app_billing_manual_review(uuid,text,text) FROM PUBLIC,unicirq_app,unicirq_billing_backend;
GRANT EXECUTE ON FUNCTION app_billing_manual_submit(uuid,text) TO unicirq_app;
GRANT EXECUTE ON FUNCTION app_billing_manual_review(uuid,text,text) TO unicirq_app;
