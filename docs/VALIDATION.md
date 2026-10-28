# Validation record

## Billing pilot — 28 October 2026

- The blueprint pricing table is implemented with integer-paise half-up calculations: free direct deals, optional 5% sale/hardware buyer fee, 8% rental renter fee, 8% service provider deduction, ₹19 transaction minimum, ₹29 seven-day boosts, ₹499/₹999 monthly business plans waived during the pilot. Deposits are not collected or included in fees.
- `npm test`: **291 passing tests**, including three additional signed webhook scenarios inside the isolated server-condition integration fixture. Tests use disposable PostgreSQL and mocked provider calls, never real payments.
- Auth, framework, email and validation packages were updated after a fresh audit reported advisories published since the previous review. Locked versions include Next.js 16.4.3, Better Auth 1.7.14, Nodemailer 10.2.1 and Zod 4.6.7; transitive `fast-uri` was patched within its dependency range.
- Final `npm run typecheck` and `npm run build`: passed. Final `npm audit --json`: zero known advisories across the reported 262-package tree.
- Applied `013_billing.sql` to the verified UniCirq database and granted only the existing restricted runtime login membership in the NOLOGIN billing-backend role. **All 15 remote readiness checks passed**, including TLS, RLS, no direct table writes, private financial functions and migration checksums. No billing payment or customer record was created in production.
- Student browser checks passed for a ₹450 direct reference statement without gateway credentials, a ₹450 + ₹36 rental checkout quote, unavailable provider controls, and light/dark mobile layouts at 390px without document overflow. A later browser-control failure prevented completed Admin/Business visual checks.
- Independent local HTTP checks confirmed Student/Admin/Business billing pages and API access; anonymous rejection; foreign-origin rejection; forged-price rejection; student denial of administrator settings; free business pilot creation despite unconfigured tax; stable duplicate plan creation; test entitlement period; and private history. These checks modified local demo memory only.
- HMAC/amount/currency/order binding, capture retries, partial/full refunds, refund-before-capture, delayed capture-after-refund, atomic entitlement rollback, ownership/RLS, no browser payment-confirmation grants and independent admission limits are covered by tests.
- Razorpay test credentials are **not present**. Actual hosted SDK checkout, provider capture and refund delivery remain to be verified after credentials, test webhook and sandbox tax configuration are supplied. Live charges and payouts stay disabled.
- This billing work does not resolve every issue in the separate security review. In particular, existing dispute/inventory and private business-application publication issues require separate fixes before live payments are introduced.

## Local baseline — 30 September 2026

Checked locally with Node.js 24.11.1 and Next.js 16.3.7.

- `npm test`: 40 passing tests. Includes Better Auth OTP/session/replay/origin checks, application policies, SQL row policies, role/campus isolation, participant privacy, order transitions, rental overlap prevention and moderation audit writes.
- `npm run typecheck`: passed.
- `npm run build`: passed, all three role route trees and API handlers generated.
- `npm audit --omit=dev --audit-level=high`: zero reported vulnerabilities at the time of the check.
- Running development server: eight HTTP smoke checks passed (anonymous/forged session rejection, role redirect, student admin-command denial, cross-origin denial, demo sign-in and authorized snapshot).
- Running production build: demo admin sign-in returned 404 and anonymous snapshot returned 401. Demo credentials cannot be used in production.
- Browser: student demo sign-in, listing publication and private message submission succeeded. Student, Business and Admin dashboards rendered. At a 390 × 844 viewport, all three dashboards fit without horizontal document overflow. The mobile student dashboard was visually inspected.

At this baseline, the auth integration tests used PostgreSQL through PGlite and a captured email sender. No real Neon database, external email delivery or hosted Vercel environment was connected. The migration SQL was exercised in integration tests; the migration runner passed syntax validation but had not been run against a hosted database.

## Hosted database — 14 October 2026

- Provisioned a dedicated Neon free-plan PostgreSQL database in Singapore (`aws-ap-southeast-1`) for UniCirq, retaining Prisma ORM and the existing authentication implementation.
- Applied SQL migrations `001_auth.sql` through `006_auth_verification_ids.sql` to the empty database using the local operator connection.
- Created a separate `unicirq_runtime` login with authentication-table CRUD, schema usage and membership in the non-login `unicirq_app` role. The runtime has no ownership, role administration, schema creation, RLS bypass or direct application-table write access.
- `npm run db:check -- --require-migrations`: all 14 checks passed against the actual remote runtime/operator connections, including pooled runtime TLS, role assumption, table permissions, row policies, protected functions and migration checksums.
- The readiness command checks certificate-authorized TLS on the actual client socket, including providers that terminate TLS at a proxy. `sslmode=verify-full` remains required.
- Readiness regression tests: 11 passed. `npm run typecheck`: passed. Vercel configuration/upload dry run: passed; private environment files and local provider guidance excluded.
- Production `DATABASE_URL` and `BETTER_AUTH_SECRET` were stored as Vercel Secrets. The operator connection remains local and is excluded from deployment. Preview has no production database credentials.

Google OAuth and email credentials are still missing. Hosted sign-in remains unavailable by design, so deployed application-to-database queries and complete user journeys have not yet been verified. Successful local database audits do not prove deployed function networking. Vercel does not return production Secret values through an isolated `env run`; do not replace them with local fallback values and claim a hosted configuration check.
