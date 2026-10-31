
-- Grouped billing: immutable bill-to-order associations.
-- All monetary values are integer paise.
-- Existing boost and business-plan billing remains unchanged.

ALTER TABLE billing_records
  ADD COLUMN billing_category text,
  ADD COLUMN selection_key text;

-- Every existing order bill must have a corresponding order.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM billing_records b
    LEFT JOIN orders o ON o.id = b.reference_id
    WHERE b.purpose = 'order'
      AND o.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate grouped billing: an existing order bill has no matching order';
  END IF;
END $$;

-- Backfill the existing single-order billing records.
UPDATE billing_records b
SET
  billing_category = CASE
    WHEN o.kind IN ('sale', 'hardware') THEN 'sale'
    WHEN o.kind = 'rental' THEN 'rental'
    WHEN o.kind = 'service' THEN 'service'
  END,
  selection_key = md5(o.id::text)
FROM orders o
WHERE b.purpose = 'order'
  AND b.reference_id = o.id;

ALTER TABLE billing_records
  ADD CONSTRAINT billing_category_valid
    CHECK (
      (purpose = 'order'
        AND billing_category IN ('sale', 'rental', 'service'))
      OR
      (purpose <> 'order' AND billing_category IS NULL)
    ),
  ADD CONSTRAINT billing_selection_key_valid
    CHECK (
      (purpose = 'order'
        AND selection_key ~ '^[a-f0-9]{32}$')
      OR
      (purpose <> 'order' AND selection_key IS NULL)
    );

-- The old index only supports one order per bill.
-- Grouped bills use a deterministic selection identity instead.
DROP INDEX billing_order_once;

CREATE UNIQUE INDEX billing_group_selection_once
  ON billing_records (
    owner_id,
    beneficiary_id,
    college_id,
    billing_category,
    payment_mode,
    selection_key
  )
  WHERE purpose = 'order';

CREATE TABLE billing_record_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  billing_id uuid NOT NULL
    REFERENCES billing_records(id) ON DELETE RESTRICT,

  order_id uuid NOT NULL
    REFERENCES orders(id) ON DELETE RESTRICT,

  payment_mode text NOT NULL
    CHECK (payment_mode IN ('direct', 'checkout')),

  listing_id_snapshot uuid NOT NULL,
  kind_snapshot text NOT NULL
    CHECK (kind_snapshot IN ('sale', 'hardware', 'rental', 'service')),

  amount_snapshot bigint NOT NULL
    CHECK (amount_snapshot >= 0),

  terms_snapshot jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT billing_record_order_once
    UNIQUE (billing_id, order_id),

  -- Preserve the existing one-billing-record-per-order-and-mode rule.
  CONSTRAINT billing_order_mode_once
    UNIQUE (order_id, payment_mode)
);

CREATE INDEX billing_record_orders_bill
  ON billing_record_orders(billing_id, created_at, order_id);

CREATE INDEX billing_record_orders_order
  ON billing_record_orders(order_id);

-- Preserve the original order snapshots for historical bills.
INSERT INTO billing_record_orders (
  billing_id,
  order_id,
  payment_mode,
  listing_id_snapshot,
  kind_snapshot,
  amount_snapshot,
  terms_snapshot
)
SELECT
  b.id,
  o.id,
  b.payment_mode,
  o.listing_id,
  o.kind,
  o.amount,
  o.terms_snapshot
FROM billing_records b
JOIN orders o ON o.id = b.reference_id
WHERE b.purpose = 'order';

-- Associations are readable only through an accessible parent bill.
ALTER TABLE billing_record_orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON billing_record_orders
  FROM PUBLIC, unicirq_app, unicirq_billing_backend;

GRANT SELECT ON billing_record_orders TO unicirq_app;

CREATE POLICY billing_record_orders_read
  ON billing_record_orders
  FOR SELECT
  TO unicirq_app
  USING (
    app_active()
    AND EXISTS (
      SELECT 1
      FROM billing_records b
      WHERE b.id = billing_record_orders.billing_id
    )
  );


-- Grouped order billing. The buyer explicitly selects accepted orders.
-- One bill represents exactly one seller and one billing category.
-- The sorted order IDs define an immutable, idempotent selection.

CREATE FUNCTION app_billing_group_quote(request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  actor profiles;
  activity orders;
  settings billing_settings;

  selected_ids uuid[];
  supplied_count integer;
  selected_count integer;

  seller uuid;
  campus uuid;
  category text;
  current_category text;

  principal numeric := 0;
  fee bigint := 0;
  tax bigint;
  payable bigint;
  net bigint;
  rate_bps integer := 0;
  payer text := 'none';
  description text;

  item_list jsonb := '[]'::jsonb;
  selection text;
BEGIN
  IF jsonb_typeof(request) IS DISTINCT FROM 'object'
    OR octet_length(request::text) > 12000
    OR EXISTS (
      SELECT FROM jsonb_object_keys(request) key
      WHERE key NOT IN ('order_ids', 'payment_mode')
    )
    OR jsonb_typeof(request->'order_ids') IS DISTINCT FROM 'array'
    OR jsonb_array_length(request->'order_ids') NOT BETWEEN 1 AND 20
    OR request->>'payment_mode' NOT IN ('direct', 'checkout')
  THEN
    RAISE EXCEPTION 'Invalid grouped billing selection';
  END IF;

  IF EXISTS (
    SELECT FROM jsonb_array_elements(request->'order_ids') value
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
      OR value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'Choose valid orders';
  END IF;

  SELECT
    count(*),
    count(DISTINCT value #>> '{}')
  INTO supplied_count, selected_count
  FROM jsonb_array_elements(request->'order_ids') value;

  IF supplied_count <> selected_count THEN
    RAISE EXCEPTION 'An order cannot appear more than once';
  END IF;

  SELECT array_agg((value #>> '{}')::uuid ORDER BY (value #>> '{}')::uuid)
  INTO selected_ids
  FROM jsonb_array_elements(request->'order_ids') value;

  selection := md5(array_to_string(selected_ids, ','));

  SELECT * INTO actor
  FROM profiles
  WHERE id = app_user_id();

  IF actor.id IS NULL OR actor.suspended THEN
    RAISE EXCEPTION 'Sign in with an active account'
      USING ERRCODE='42501';
  END IF;

  IF actor.role <> 'student'
    OR NOT actor.verified
    OR actor.college_id IS NULL
  THEN
    RAISE EXCEPTION 'Verified student access is required'
      USING ERRCODE='42501';
  END IF;

  SELECT * INTO settings
  FROM billing_settings
  WHERE singleton;

  FOR activity IN
    SELECT o.*
    FROM orders o
    WHERE o.id = ANY(selected_ids)
    ORDER BY o.id
    FOR UPDATE
  LOOP
    IF activity.buyer_id <> actor.id
      OR activity.seller_id = actor.id
      OR activity.college_id <> actor.college_id
      OR activity.status <> 'accepted'
      OR NOT EXISTS (
        SELECT FROM profiles p
        WHERE p.id = activity.seller_id
          AND p.verified
          AND NOT p.suspended
          AND p.role = 'student'
          AND p.college_id = activity.college_id
      )
    THEN
      RAISE EXCEPTION
        'Only your accepted exchanges with an active verified campus seller can be billed'
        USING ERRCODE='42501';
    END IF;

    current_category := CASE
      WHEN activity.kind IN ('sale', 'hardware') THEN 'sale'
      WHEN activity.kind = 'rental' THEN 'rental'
      WHEN activity.kind = 'service' THEN 'service'
    END;

    IF category IS NULL THEN
      category := current_category;
      seller := activity.seller_id;
      campus := activity.college_id;
    ELSIF category <> current_category
      OR seller <> activity.seller_id
      OR campus <> activity.college_id
    THEN
      RAISE EXCEPTION
        'A bill can contain orders from only one seller and one category';
    END IF;

    principal := principal + activity.amount;

    item_list := item_list || jsonb_build_array(
      jsonb_build_object(
        'order_id', activity.id,
        'listing_id', activity.listing_id,
        'kind', activity.kind,
        'amount', activity.amount,
        'terms_snapshot', activity.terms_snapshot
      )
    );
  END LOOP;

  IF cardinality(selected_ids) <> (
    SELECT count(*)
    FROM orders
    WHERE id = ANY(selected_ids)
  ) THEN
    RAISE EXCEPTION 'One or more selected orders are unavailable';
  END IF;

  IF principal > 9223372036854775807 THEN
    RAISE EXCEPTION 'The selected total is too large';
  END IF;

  IF request->>'payment_mode' = 'checkout' AND principal > 0 THEN
    rate_bps := CASE category
      WHEN 'sale' THEN 500
      WHEN 'rental' THEN 800
      WHEN 'service' THEN 800
    END;

    fee := greatest(
      1900,
      round(principal * rate_bps / 10000)::bigint
    );

    payer := CASE category
      WHEN 'sale' THEN 'buyer'
      WHEN 'rental' THEN 'renter'
      WHEN 'service' THEN 'provider'
    END;
  END IF;

  IF fee = 0 THEN
    tax := 0;
  ELSIF settings.tax_bps IS NULL THEN
    tax := NULL;
  ELSE
    tax := round(fee::numeric * settings.tax_bps / 10000)::bigint;
  END IF;

  IF tax IS NULL THEN
    payable := NULL;
    net := NULL;
  ELSIF category = 'service' AND payer = 'provider' THEN
    payable := principal::bigint;
    net := principal::bigint - fee - tax;

    IF net < 0 THEN
      RAISE EXCEPTION
        'The service price must cover its platform fee and tax';
    END IF;
  ELSE
    payable := principal::bigint + fee + tax;
    net := principal::bigint;
  END IF;

  description := CASE
    WHEN request->>'payment_mode' = 'direct'
      THEN 'Direct campus exchange'
    WHEN category = 'sale'
      THEN 'UniCirq sale checkout'
    WHEN category = 'rental'
      THEN 'UniCirq rental checkout'
    ELSE 'UniCirq service checkout'
  END;

  RETURN jsonb_build_object(
    'policy_version', '2026-10-pilot',
    'purpose', 'order',
    'currency', 'INR',
    'billing_category', category,
    'seller_id', seller,
    'college_id', campus,
    'selection_key', selection,
    'order_ids', to_jsonb(selected_ids),
    'items', item_list,
    'base_amount', principal::bigint,
    'platform_fee', fee,
    'tax_amount', tax,
    'tax_bps', settings.tax_bps,
    'delivery_amount', 0,
    'deposit_amount', 0,
    'buyer_total', payable,
    'seller_net', net,
    'fee_payer', payer,
    'payment_mode', request->>'payment_mode',
    'pilot_waived', false,
    'description', description
  );
END $$;


CREATE FUNCTION app_billing_group_create(request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  actor profiles;
  bill billing_records;
  calculated jsonb;
  selected_ids uuid[];
  selected_mode text;
  selected_key text;
  selected_seller uuid;
  selected_campus uuid;
  selected_category text;
  anchor_order uuid;
BEGIN
  SELECT * INTO actor
  FROM profiles
  WHERE id = app_user_id()
  FOR UPDATE;

  IF actor.id IS NULL OR actor.suspended THEN
    RAISE EXCEPTION 'Sign in with an active account'
      USING ERRCODE='42501';
  END IF;

  -- The quote function owns selection validation and all financial calculations.
  calculated := app_billing_group_quote(request);

  selected_mode := request->>'payment_mode';
  selected_key := calculated->>'selection_key';
  selected_seller := (calculated->>'seller_id')::uuid;
  selected_campus := (calculated->>'college_id')::uuid;
  selected_category := calculated->>'billing_category';

  SELECT array_agg((value #>> '{}')::uuid ORDER BY (value #>> '{}')::uuid)
  INTO selected_ids
  FROM jsonb_array_elements(request->'order_ids') value;

  anchor_order := selected_ids[1];

  -- Exact retries return the original bill and its original quote.
  SELECT * INTO bill
  FROM billing_records
  WHERE purpose = 'order'
    AND owner_id = actor.id
    AND beneficiary_id = selected_seller
    AND college_id = selected_campus
    AND billing_category = selected_category
    AND payment_mode = selected_mode
    AND selection_key = selected_key
  FOR UPDATE;

  IF bill.id IS NOT NULL THEN
    RETURN to_jsonb(bill);
  END IF;

  -- An order already attached to another bill in this payment mode
  -- cannot silently be moved or billed again.
  IF EXISTS (
    SELECT FROM billing_record_orders
    WHERE order_id = ANY(selected_ids)
      AND payment_mode = selected_mode
  ) THEN
    RAISE EXCEPTION
      'One or more selected orders already belong to another bill';
  END IF;

  IF (calculated->>'buyer_total') IS NULL THEN
    RAISE EXCEPTION
      'Tax settings must be confirmed before checkout';
  END IF;

  INSERT INTO billing_records (
    owner_id,
    beneficiary_id,
    college_id,
    purpose,
    reference_id,
    payment_mode,
    quote,
    status,
    billing_category,
    selection_key
  )
  VALUES (
    actor.id,
    selected_seller,
    selected_campus,
    'order',
    anchor_order,
    selected_mode,
    calculated,
    CASE
      WHEN selected_mode = 'direct'
        OR (calculated->>'buyer_total')::bigint = 0
      THEN 'recorded'
      ELSE 'quoted'
    END,
    selected_category,
    selected_key
  )
  RETURNING * INTO bill;

  INSERT INTO billing_record_orders (
    billing_id,
    order_id,
    payment_mode,
    listing_id_snapshot,
    kind_snapshot,
    amount_snapshot,
    terms_snapshot
  )
  SELECT
    bill.id,
    o.id,
    selected_mode,
    o.listing_id,
    o.kind,
    o.amount,
    o.terms_snapshot
  FROM orders o
  WHERE o.id = ANY(selected_ids)
  ORDER BY o.id;

  RETURN to_jsonb(bill);
END $$;


REVOKE ALL ON FUNCTION app_billing_group_quote(jsonb)
  FROM PUBLIC;

REVOKE ALL ON FUNCTION app_billing_group_create(jsonb)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_billing_group_quote(jsonb)
  TO unicirq_app;

GRANT EXECUTE ON FUNCTION app_billing_group_create(jsonb)
  TO unicirq_app;
