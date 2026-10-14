# PostgreSQL + Prisma setup

UniCirq uses Prisma ORM 7.10 for Better Auth's user, session, account, verification and rate-limit tables. Its client shares the restricted `pg` connection pool used by the marketplace. Client generation needs no database credentials; `npm ci`, tests and builds generate it automatically.

Marketplace reads still run under a transaction-local identity and PostgreSQL row policies. All marketplace writes still go through the protected command function. SQL migrations in `database/migrations` remain the source of truth for the database, including triggers, policies and grants. Do **not** run `prisma db push`, `prisma migrate dev` or Prisma Migrate against this database: the Prisma schema intentionally contains only authentication tables.

Login/signup also support verified email/password and Google, with required university onboarding. See [authentication setup and verification](AUTHENTICATION.md).

## 1. Choose a PostgreSQL host

Use a dedicated database whose operator account can create roles and whose runtime connection can authenticate as a separate restricted login. Prisma ORM works with standard PostgreSQL; Neon is optional. Prisma Postgres is a separate hosting product. Its documented pooled/direct connection strings share credentials, so choosing a direct connection alone does not separate owner and runtime privileges. Verify custom login/role support before using any host with UniCirq's security model.

Primary references: [Prisma PostgreSQL connector](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql), [Prisma Postgres connections](https://www.prisma.io/docs/postgres/database/connecting-to-your-database), [Prisma with SQL migrations](https://www.prisma.io/docs/orm/v7/prisma-schema/introspection).

## 2. Keep credentials private

Use Node.js 22.12+ (Node.js 24 recommended). Keep the following in the ignored project-root `.env.local`; never paste them into chat or commit them:

```dotenv
UNICIRQ_DEMO_MODE=false
APP_URL=http://127.0.0.1:3000
DATABASE_URL=RESTRICTED_RUNTIME_CONNECTION
MIGRATION_DATABASE_URL=SEPARATE_DIRECT_OPERATOR_CONNECTION
BETTER_AUTH_SECRET=RANDOM_SECRET_AT_LEAST_32_CHARACTERS
RESEND_API_KEY=VERIFIED_DOMAIN_SENDING_KEY
EMAIL_FROM="UniCirq <signin@YOUR_VERIFIED_DOMAIN>"
GOOGLE_CLIENT_ID=GOOGLE_WEB_APPLICATION_CLIENT_ID
GOOGLE_CLIENT_SECRET=MATCHING_PRIVATE_GOOGLE_CLIENT_SECRET
```

These are placeholders, not usable credentials. Generate the auth secret with a trusted password generator. Remote database URLs must specify a database name and `sslmode=verify-full` to validate the server certificate and hostname. Local loopback databases may omit TLS. Do not disable certificate validation.

`MIGRATION_DATABASE_URL` stays on the operator's local machine. Never upload it to Vercel, CI secrets or the hosted app runtime. Public variables such as `NEXT_PUBLIC_DATABASE_URL` are rejected by the setup check.

## 3. Apply schema and restrict runtime access

After confirming the operator connection points to the intended dedicated database:

```powershell
npm run db:migrate
```

Use the provider's secure database interface to create the runtime login. As the operator, grant only:

```sql
GRANT USAGE ON SCHEMA public TO unicirq_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "user", "session", account, verification, "rateLimit"
  TO unicirq_runtime;
GRANT unicirq_app TO unicirq_runtime;
```

Replace `unicirq_runtime` if you use a different login name. Keep its password private. The runtime must not own the database/tables/functions, have `BYPASSRLS`, inherit or assume an owner/admin role, create schema objects, access the migration ledger, or write directly to application tables. Provider-created roles sometimes have excess privileges; use the audit below before accepting traffic.

Add the real pilot college through the operator connection. `database/seed.example.sql` is optional fictional campus data; it does not create trusted users or student activity.

## 4. Configure email

Verify a domain in Resend and use a sending key scoped to that domain. Set `EMAIL_FROM` to an address on it. Email OTP verifies access to the email address; campus membership still needs admin approval. The development `resend.dev` sender is rejected in hosted configuration.

[Resend domain setup](https://resend.com/docs/dashboard/domains/introduction) and [sending API](https://resend.com/docs/api-reference/emails/send-email) describe provider requirements.

## 5. Verify before live use

```powershell
npm run setup:check
npm run db:check -- --require-migrations
npm test
npm run typecheck
npm run build
```

`setup:check` checks private configuration formats and whether demo mode remains enabled. It prints variable names and fixed explanations, never their values. It cannot verify a key, password or sending domain remotely.

`db:check` connects with the actual runtime login and checks the connected client's TLS socket for encryption and certificate authorization to the database endpoint or its proxy. Remote URLs must still use `sslmode=verify-full`; a proxy's separate PostgreSQL connection does not determine the client connection's TLS result. The audit also checks catalog metadata, reachable roles, table/column grants, RLS and protected function ownership/access. It checks migration checksums through the separate operator connection. All audits are read-only and roll back; no personal table rows are queried. The command fails when any check fails. Without `--require-migrations`, omitted operator credentials are explicitly reported as **NOT CHECKED**.

If you choose to send a real test email, run this with your own recipient address:

```powershell
npm run email:check -- --to YOUR_OWN_EMAIL_ADDRESS
```

This sends one setup email, containing no OTP. Resend acceptance is not proof of inbox delivery: confirm arrival and inspect the provider dashboard. The application sends branded HTML and plain text OTP emails with a 10-second request deadline; provider errors and responses are not logged.

Then start the app and test: sign in with a new student email, submit campus verification, approve as the operator, publish a listing, and request/complete an exchange with a second account. Check Student, Business and Admin routing and reject another campus's access.

To assign the first Admin, sign in as the intended operator first, then use the trusted owner connection:

```sql
UPDATE profiles SET role='admin'
WHERE id=(SELECT id FROM "user"
          WHERE email='REPLACE_WITH_OPERATOR_EMAIL'
            AND "emailVerified"=true);
```

Verify exactly one expected account changed. The app does not expose self-promotion.

## 6. Configure Vercel when deployment is requested

The deployment uses Singapore for PostgreSQL (Neon region `aws-ap-southeast-1`) and Vercel Functions (`sin1`, configured in `vercel.json`) to keep server work close to the database and users in India. Region changes require a new deployment. This setting does not establish database connectivity; complete the database audit before live use. Keep the Neon integration's owner connection out of project runtime variables and configure only the separately restricted login. See [Vercel regions](https://vercel.com/docs/regions) and [function region configuration](https://vercel.com/docs/functions/configuring-functions/region).

Set only runtime credentials and the deployed HTTPS `APP_URL` in the appropriate Vercel environment. Use a separate database and sender for previews. Run `setup:check -- --production` locally with the deployed origin to validate its format; run the read-only database audit separately. Apply migrations through the trusted operator process, never during a build.

GitHub checks run schema validation, tests, typecheck, build and production dependency audit on pushes/PRs. They use no live database or email secrets and do not deploy.

## Schema and tool maintenance

Append SQL migrations, then update the matching auth Prisma model if an auth table changed and run `npm run prisma:generate`. Avoid broad introspection overwriting the auth-only boundary with marketplace models. The generated client is ignored by Git.

Prisma tools are pinned to 7.10.0. Scoped dependency overrides replace vulnerable `deepmerge-ts` and `mysql2` versions; the configuration loader, generation, auth tests and build are checked with those replacements. Reassess the overrides on a Prisma upgrade; do not accept npm's suggested force downgrade to Prisma 6.
