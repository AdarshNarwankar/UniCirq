# Validation record

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
