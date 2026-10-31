# Billing pilot

UniCirq billing follows the pricing table discussed in the UniCirq blueprint chat. Checkout supports a real UPI QR/manual-verification path using the configured UniCirq UPI account, plus optional Razorpay test mode. A UPI payment is real money, but it is sent to the displayed UniCirq account; this release does not automatically split or pay sellers.

## Published rules

| Activity | Platform charge | Charged to |
| --- | --- | --- |
| Registration, verification, standard listings, requests and chat | Free | Nobody |
| Direct campus exchange | 0% | Nobody; payment is arranged directly |
| Optional sale / hardware checkout | 5%, minimum ₹19 | Buyer |
| Rental checkout | 8%, minimum ₹19 | Renter |
| Service checkout | 8%, minimum ₹19 | Deducted from the provider's share |
| Listing boost | ₹29 / 7 days | Listing owner |
| Featured business plan | ₹499 / calendar month | Business; waived during the pilot |
| Growth business plan | ₹999 / calendar month | Business; waived during the pilot |

All monetary values are stored as integer paise. Percentages round half-up once at paise precision. An exchange fee applies once to the order total, rather than separately to each rental billing period. Refundable deposits are excluded; this pilot does not collect them. Gateway processing is included in the platform charge, rather than added to the buyer's bill. Zero-price exchanges have no fee. A service's gross amount must cover its fee and any configured fee tax.

The examples below exclude tax:

- ₹1,000 sale: ₹50 fee, buyer total ₹1,050, seller allocation ₹1,000.
- ₹400 rental: ₹32 fee, renter total ₹432, owner allocation ₹400.
- ₹500 service: ₹40 fee, buyer total ₹500, provider allocation ₹460.

Tax configuration starts **unconfirmed**, not silently zero. An administrator can confirm a platform-charge tax rate in **Admin → Billing → Billing settings**; an explicit zero rate is supported for sandbox testing. The configured rate applies to the platform charge only. Service fee tax is also deducted from the provider allocation. A paid checkout cannot start with an unconfirmed tax rate. This is a configurable pricing mechanism, not a determination of the applicable tax law. Test statements and manually verified UPI statements are not GST tax invoices. A UPI transaction reference is retained for reconciliation and is not proof of payment until an administrator approves it.

Business plans remain free while the pilot waiver is enabled. Plans renew manually for one calendar month; listing boosts last seven days. Test entitlements are stored separately and do not change live marketplace ranking, activate live promotion/reporting benefits or authorize real payouts. Storage and merchandise remain later-phase modules.

## Screens and API

- `/student/billing`: accepted buyer exchanges, direct arrangement records, UPI payment QR/manual verification, optional test checkout, own-listing boost previews, history and printable statements.
- `/business/billing`: free pilot plan selection, monthly test plan quotes, history and test access periods.
- `/admin/billing`: test financial allocations, records and audited pilot/tax configuration.

These pages retain the app's server role guards. Billing is fetched separately from general dashboard snapshots, with cursor pagination and a persistent per-user admission limit.

Each quote and saved statement has a bill summary with the related item/plan, campus and available participant details, rental quantity/period, line items and final customer total. Service-provider deductions are shown separately from the customer's bill. Pilot plan discounts show the numeric deduction. Captured statements distinguish original totals, refunds and the remaining captured test amount; direct arrangements are explicitly unverified. Saved statements include full references, creation/capture timestamps and a print/save-PDF action. These summaries use the stored quote and do not recalculate historical charges.

`GET /api/billing` returns only the caller's records/beneficiary records, or the administrator's network-wide view. Its totals cover all RLS-visible billing history, not just the current page. Captured value includes principal; fee/tax/seller-share allocations are **before refunds and operating costs**. Refunds are shown separately. None of these metrics is profit or a payout confirmation.

`POST /api/billing` supports:

```json
{"action":"quote","selection":{"purpose":"order","reference_id":"ORDER_UUID","payment_mode":"checkout"}}
```

Use `action:create` with the same selection to persist a server-priced statement and prepare checkout. If Razorpay test credentials are unavailable, the buyer can pay the displayed UPI QR and submit `{"action":"manual_submit","billing_id":"BILL_UUID","utr":"UPI_TRANSACTION_REFERENCE"}`. Submission creates an awaiting-review record; it never marks the bill paid. An administrator must reconcile the bank transaction and submit `{"action":"manual_review","billing_id":"BILL_UUID","decision":"approve|reject","note":"RECONCILIATION_NOTE"}`. Resume an existing checkout with `{"action":"resume","billing_id":"BILL_UUID"}` so the original quote is retained. Only the owner can resume or submit a UTR; only an administrator can review it.

`POST /api/billing/verify` verifies the browser's order/payment HMAC against the **stored provider order**, then fetches the payment server-side. The order, amount, INR currency and captured state must match. A browser success message alone cannot mark a statement paid. Authorization-only payments remain pending.

`POST /api/billing/webhook` validates the HMAC over the bounded raw body with the separate webhook secret. It handles `payment.captured`, `order.paid` and `refund.processed`, re-fetching provider data before reconciliation. Capture/refund identifiers deduplicate retries across browser and webhook paths. Partial refunds accumulate safely; any refund revokes the related test entitlement. Refund-before-capture and delayed capture-after-refund deliveries are covered by integration tests.

No endpoint takes card details, bank credentials or a client-supplied monetary amount. Direct records are reference statements, not verified payment receipts. Test payments do not change an exchange's existing direct-payment terms, order progress, handover or dispute status.

## Database setup

Apply `013_billing.sql` with the separate operator connection after tests pass. Existing application data and earlier migration checksums are preserved. New tables have RLS and no runtime direct-write grants.

The ordinary `unicirq_app` role can quote, create records and perform administrator-checked configuration. It **cannot** attach provider orders, confirm captures, issue refunds or write entitlements. Those functions require a separate restricted `unicirq_billing_backend` NOLOGIN role. Through the trusted operator connection, grant it only to the existing restricted runtime login:

```sql
GRANT unicirq_billing_backend TO YOUR_RESTRICTED_RUNTIME_LOGIN;
```

Do not grant that role to `unicirq_app`, PUBLIC, or browser identities. Its functions are called only by the server after session/ownership or provider signature checks. They have fixed search paths and separate ownership. The readiness audit checks this boundary, function grants, table access, TLS, roles and migration checksums:

```powershell
npm run db:check -- --require-migrations
```

## Connect Razorpay test mode

Keep secrets in the ignored `.env.local` and the corresponding private hosted environment. Never send them in chat or publish them in `NEXT_PUBLIC_` variables.

```dotenv
RAZORPAY_KEY_ID=rzp_test_YOUR_TEST_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_PRIVATE_TEST_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=YOUR_SEPARATE_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
```

In Razorpay's **test** dashboard, configure automatic payment capture. Add an HTTPS webhook at `APP_URL/api/billing/webhook`, using the exact same separate webhook secret, and subscribe to the three supported events. A local browser can open test checkout, but Razorpay's webhook requires an accessible HTTPS endpoint. Use separate test credentials, database and webhook configuration for previews.

Confirm a sandbox tax rate through the administrator billing screen. Configure keys in the hosted environment and redeploy when intentionally activating test checkout. Missing keys leave free direct records and pilot plans usable while paid test checkout is clearly unavailable. Real provider checkout has not been validated until actual test credentials are supplied and a provider test payment and refund are completed.

The public Razorpay key ID is returned only with an authenticated checkout preparation. Private keys never enter client props. Checkout loads Razorpay's hosted SDK; CSP permits the specific checkout/API origins. Provider requests use fixed URLs, TLS, bounded responses, deadlines, no redirects, and sanitized failures.

## Retry and recovery

Database row locks serialize checkout creation. Repeated attempts reuse the attached gateway order, and persisted quotes remain unchanged. Capture and refund updates, their events and entitlement changes commit atomically. Rate-limit counters commit in a separate transaction, so failed business operations do not erase attempts.

If an external order is created and the subsequent database attach/commit fails, the browser receives no order to pay. The provider may retain an **unexposed orphan test order** with the billing UUID as its receipt. Inspect the test dashboard and logs using that receipt before recovery; no raw credentials or provider error body should be logged. Before live activation, add provider order reconciliation and a reviewed recovery process rather than assuming an HTTP retry is an exactly-once external operation.

## Validation and remaining activation work

Automated checks cover policy arithmetic, pending tax, free pilot plans, server ownership/RLS, forbidden direct writes, private gateway function access, duplicate captures, wrong amount/currency/order, signature failures, partial refunds, delivery ordering, period expiry and rollback. Browser checks use explicitly marked local demo data.

Before a later live-payment release, implement and verify seller/provider linked-account onboarding and payout reconciliation, deposit/refund/cancellation rules, actual gateway/marketplace costs, applicable tax invoices, admin stronger authentication, dispute/inventory rules, monitoring and support procedures. Existing issues from the separate security review are not all resolved by this billing release. Live keys must remain rejected until that reviewed release is ready.

Primary integration references: [Razorpay integration and signature/capture checks](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [webhook validation](https://razorpay.com/docs/webhooks/validate-test/), [marketplace payouts with Route](https://razorpay.com/route/).
