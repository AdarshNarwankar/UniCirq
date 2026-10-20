# UniCirq exchange flow

Implemented 30 September 2026. Matches the shared Student, Business and Admin design.

## Student workflow

1. Create or discover a sale, rental, hardware or service listing.
2. Use a private listing conversation to agree on the details.
3. Review the listed price and terms before sending a request. Rentals offer hourly, daily, weekly or monthly pricing with a maximum duration of 30 days. Hourly requests include pickup and return times in IST; other rentals use dates. One week is 7 days and one month is 30 days. Partial pricing periods round up, and the exact quantity and total appear before confirmation. Service requests cover one listed pricing unit.
4. The owner reviews and accepts or declines. Both participants can cancel before handover.
5. The requester inspects and receives the item, or checks the service delivery, then confirms receipt.
6. For a sale, hardware or service exchange, the requester confirms completion. For a rental, the owner inspects the returned item and confirms completion.

Rental amounts and availability are calculated again by the backend using the listing's stored unit and rate. The order keeps its quoted billing quantity and original terms. Timestamp-based overlap checks cover both new hourly bookings and existing date-only rentals; adjacent bookings remain valid. Existing order amounts and dates are retained.
7. Original request terms and participant confirmations stay available in activity. Completed sale and hardware listings close automatically. Existing conversations stay available after listing closure.

Activity has search, status filters, a listing management tab and a detail view at `/student/activity?order=<id>`. Dashboard cards and notifications link directly to the affected record. Messages show the listing/request context and related activity, with a separate draft for each conversation.

## Backend and data

- `orders.terms_snapshot` saves the original title, description, price, unit, condition and meeting place. The displayed amount is the recorded request amount; it is not a payment confirmation.
- `order_events` contains the actor, status and time for each confirmation. Runtime clients cannot rewrite events. History is exposed through the authenticated snapshot for visible orders only, up to 1,200 events for 200 orders.
- `/api/commands` validates inputs and authenticates the session. PostgreSQL command checks independently enforce verified Student roles, campus, order participants and valid transitions.
- `start_order_conversation` obtains recipients from the persisted order. Callers cannot supply a recipient. Existing listing conversations are reused for the same two participants, even when the listing is closed.
- Archived listing context is readable by the owner, existing conversation participants, order participants and authorized admins within the existing campus policies.
- Migration `004_exchange_context.sql` appends the new command and archived conversation policy. Previous migrations remain unchanged. Apply pending migrations with the operator connection before enabling this version against a hosted database.
- Demo mode mirrors terms and event history. Restart the development server after updating from the older demo state shape.

## Verification

- 40 tests pass, including PostgreSQL RLS, immutable event access, role/campus/participant isolation, original terms, conversation continuation and precise notification destinations.
- TypeScript and production build pass.
- Browser walkthrough: student review/send, linked chat and message, seller acceptance, buyer receipt and completion. All four history entries were visible and the sale listing closed.
- Browser rental walkthrough: native date picker, two days at ₹120/day gave ₹240, review/send and cancellation preserved the original dates and history.
- Activity details and messages fit a 390 × 844 viewport without document overflow.

## Remaining production setup

Hosted PostgreSQL, restricted runtime privileges and real email delivery still require staging configuration. Media uploads and provider payments remain modular follow-up work. Resolving a support ticket does not adjudicate a disputed order; the order stays paused pending a separate dispute resolution implementation. Pagination beyond the pilot remains a follow-up.
