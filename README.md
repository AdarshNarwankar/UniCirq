# UniCirq — Your Campus, Connected.

A student-first campus marketplace foundation in `D:\Adarsh\UniCirq`. White-and-cobalt responsive UI, Next.js App Router, TypeScript, PostgreSQL with Prisma ORM, Better Auth email/password, email OTP, Google OAuth and Resend. PostgreSQL hosting is provider-independent; Neon is optional and Supabase is not used.

## Local demo

Use Node.js 22.12 or newer (Node.js 24 recommended). From this project folder:

```powershell
npm ci
# Only if .env.local does not already exist:
Copy-Item .env.example .env.local
npm run dev
```

Open http://127.0.0.1:3000 and choose **Explore the student app**. Seller, Business, Admin and New student previews are also available. All demo people, listings and activity are fictional. Unsplash product photos are illustrative. Demo changes reset when the development server restarts. Demo login is disabled in production and on Vercel, even if its environment flag remains enabled.

## Included

- Separate Student, Business and Admin routes with server-enforced roles.
- Search/filter sale, rental, hardware and service listings; create/close listings and save items.
- Campus requests, private conversations that remain accessible after listing closure, notifications linked to exact records, and student profiles.
- Reviewed transaction requests, participant-specific confirmations, original request terms, timestamped activity history, rental overlap prevention, cancellation and disputes.
- Campus/business verification applications, admin review, listing/deal moderation and audit history.
- Campus business offers, support reports and managed-sale interest intake.

Messages refresh periodically. Payments, uploads, merchandise, storage and managed-sale operations remain modular follow-up work. Orders record participant-confirmed activity, without claiming escrow or payment protection.

See [implementation plan, structure, data model and workflow](docs/IMPLEMENTATION.md) and [exchange workflow and validation](docs/EXCHANGE-FLOW.md).

See [PostgreSQL + Prisma setup and live readiness checks](docs/PRODUCTION-SETUP.md). Prisma manages authentication tables; the marketplace retains its SQL transactions and row policies. SQL migrations remain authoritative. Do not use Prisma db push/migrate against this auth-only schema.

See [login, signup, Google and university onboarding](docs/AUTHENTICATION.md). Proven `@dypiu.ac.in` mailboxes can connect to DYPIU automatically; other students choose their university and request campus verification.

## Database setup

Use a dedicated PostgreSQL database, such as Neon. Keep migration-owner credentials separate from the runtime login. The migration login needs permission to create roles and schema objects. Use the provider's direct connection for migrations.

1. Set `MIGRATION_DATABASE_URL` in your local ignored `.env.local` file to the owner connection. Never add it to Vercel runtime settings.
2. Run `npm run db:migrate`. Migrations are transactional and checksum-verified. Do not edit an already-applied migration.
3. Create a restricted runtime login using the database provider's secure interface. As the owner, grant only these permissions (replace the role name if needed):

```sql
GRANT USAGE ON SCHEMA public TO unicirq_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "user", "session", account, verification, "rateLimit"
  TO unicirq_runtime;
GRANT unicirq_app TO unicirq_runtime;
```

The runtime login must not own application tables, inherit an owner/admin role, have `BYPASSRLS`, or have schema-creation privileges. Check inherited as well as direct permissions. Do not grant application-table writes. Auth manages its own tables; application access uses row policies and a permission-checking command function.

4. Set `DATABASE_URL` to this runtime login's connection, preferably pooled, with an explicit database name and `sslmode=verify-full` for remote connections. Do not disable certificate validation.
5. Insert the real pilot college using the operator connection. `database/seed.example.sql` contains an optional fictional campus catalog, not real campus verification data.

## Email sign-in and environment

All variables below are server-only:

| Variable | Value |
| --- | --- |
| `UNICIRQ_DEMO_MODE` | `false` for database-backed use |
| `APP_URL` | Exact site origin, e.g. `https://your-project.vercel.app` |
| `DATABASE_URL` | Restricted runtime PostgreSQL connection; remote `sslmode=verify-full` |
| `BETTER_AUTH_SECRET` | Cryptographically random secret, at least 32 characters |
| `EMAIL_PROVIDER` | `resend` (default), or `gmail` for temporary SMTP testing |
| `RESEND_API_KEY` | Resend key for your verified sending domain |
| `EMAIL_FROM` | Verified Resend sender, or the exact Gmail address in `GMAIL_USER` |
| `GMAIL_USER` | Dedicated `@gmail.com` sender when `EMAIL_PROVIDER=gmail` |
| `GMAIL_APP_PASSWORD` | Google App Password for temporary Gmail delivery; never the account password |
| `GOOGLE_CLIENT_ID` | Google OAuth Web application client ID |
| `GOOGLE_CLIENT_SECRET` | Matching private Google OAuth client secret |

Never prefix secrets with `NEXT_PUBLIC_`, commit them, or log them. `.env.local` is ignored. Local database mode uses `APP_URL=http://127.0.0.1:3000`. Restart after changing environment variables.

Verified DYPIU mailbox ownership can grant campus access with the badge “DYPIU email verified”; it does not establish current student enrolment. Other campuses and personal email accounts use an eligibility review. Codes expire after five minutes, are stored hashed and have limited attempts. Sessions and OTP rate limits persist in PostgreSQL.

Gmail SMTP testing requires 2-Step Verification and an App Password. It uses verified TLS to `smtp.gmail.com:465`, restricts the sender to the configured Gmail account and preserves the existing signup/code/recovery flows. Gmail limits and account protections apply; switch to a verified transactional sending domain before public launch. See [authentication setup](docs/AUTHENTICATION.md).

To bootstrap the first Admin, sign in with the intended operator email, then use the trusted owner connection:

```sql
UPDATE profiles SET role='admin'
WHERE id=(SELECT id FROM "user"
          WHERE email='replace-with-your-operator-email'
            AND "emailVerified"=true);
```

Verify exactly one expected account changed. Users cannot promote themselves through forms or metadata.

## Vercel

Import as a Next.js project, install with `npm ci` and build with `npm run build`. Select Node.js 22+ and set the runtime variables above. Apply migrations separately before enabling traffic; do not migrate during each Vercel build. Configure `APP_URL` for the environment's canonical origin. Use separate test database/email settings for previews.

No hosted database, email domain or Vercel deployment has been provisioned by this task. A build succeeds without secrets, but production sign-in requires configuration.

## Validation

```powershell
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

The 108 tests cover policies, real PostgreSQL row policies and command transactions via PGlite, and the actual Better Auth handler through both PostgreSQL and Prisma adapters, configuration/TLS validation, sanitized email failures and read-only readiness audits with a captured test email sender. They do not verify live email delivery or hosted database privileges. Google callback tests use mocked provider tokens and keys. Before launch, smoke-test sign-in and role/campus isolation using the hosted restricted runtime login.

## Remaining launch work

Establish independent campus verification and moderator procedures, privileged MFA, privacy/terms and age eligibility, account recovery/deletion, blocking, backup/restore and monitoring. Closing a support ticket currently does not settle a disputed order; final adjudication remains a follow-up. Add signed media uploads before accepting student photos. Snapshots currently cap most entities at 200 records and messages at 500; add pagination before scaling beyond the pilot. Payments/deposits require a separate reviewed provider integration.

This is a working MVP foundation and local demo, not a claim that all production launch requirements are finished.
