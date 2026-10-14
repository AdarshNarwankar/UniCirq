# Login, signup and university onboarding

UniCirq uses Better Auth with a Prisma PostgreSQL adapter and a restricted connection shared with its existing marketplace repository. The production database is Neon PostgreSQL in Singapore. Google and email providers are enabled independently when their private configuration is complete.

## User flows

| Entry point | Behavior |
| --- | --- |
| `/signup` | Name, email and password (10–128 characters), followed by email verification. Google can also create the account. |
| `/login` | Password, email code or Google. Unverified password accounts must prove email ownership before entering the app. |
| `/forgot-password` | Request a reset code, choose a new password, then sign in. Successful recovery revokes prior sessions. |
| `/auth/complete` | Reads the real server session and profile, then routes to onboarding or the correct role dashboard. |
| `/onboarding` | New students must choose a supported university and confirm their name. Course and year are optional. |

A university choice scopes discovery. It never grants a Student verification badge, Business role or Admin role. Campus verification is a separate reviewed application and must match the selected university. Initial choice is transactionally locked; a later change requires operator support. Business and Admin accounts keep their existing role routing.

The catalog comes from the curated `colleges` table. Insert real pilot colleges through the trusted operator process before accepting real signups. Demo universities are explicitly fictional. An empty catalog offers retry/finish-later states; it does not fabricate a university.

## Add credentials later

All secrets stay in the ignored `.env.local` and server environment. Start with `.env.example` and add:

- `DATABASE_URL`: restricted PostgreSQL runtime connection with an explicit database name and `sslmode=verify-full` for remote connections.
- `MIGRATION_DATABASE_URL`: separate direct operator connection, local only.
- `APP_URL`: exact site origin, including the correct scheme, host and port.
- `BETTER_AUTH_SECRET`: random secret of at least 32 characters.
- `EMAIL_PROVIDER`: `resend` (default) or `gmail` for temporary SMTP testing.
- `RESEND_API_KEY` and `EMAIL_FROM`: a verified Resend sender for signup verification, password/code login and recovery.
- `GMAIL_USER`, `GMAIL_APP_PASSWORD` and matching `EMAIL_FROM`: Gmail SMTP testing credentials when `EMAIL_PROVIDER=gmail`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: matching Google OAuth Web application credentials.

Google can operate without an email sender. Email/password, email-code signin and recovery require the selected email provider. Each method remains disabled until its own configuration and the core database/auth configuration are valid. An invalid selected email provider never falls back to another sender. Set `UNICIRQ_DEMO_MODE=false` before testing live methods; local demo mode never mixes real authentication with fictional identities.

Prisma ORM already queries authentication records through PostgreSQL TCP. For Prisma Postgres hosting, use its pooled/direct TCP connection strings rather than a `prisma+postgres:` Accelerate URL. Direct and pooled URLs alone do not separate privileges: confirm the host supports UniCirq's required operator role creation and restricted runtime login. See [production setup](PRODUCTION-SETUP.md).

### Google OAuth setup

In Google Cloud Console, configure the consent screen and create a **Web application** OAuth client. Add this exact callback URI:

```text
APP_URL/api/auth/callback/google
```

Examples:

```text
http://127.0.0.1:3000/api/auth/callback/google
https://YOUR_DEPLOYED_DOMAIN/api/auth/callback/google
```

If the local app uses `localhost`, register that exact hostname instead. Do not mix `localhost` and `127.0.0.1`. Testing-mode consent screens may need explicit test users. Use a stable preview origin for OAuth. [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server), [Better Auth Google setup](https://better-auth.com/docs/authentication/google).

For the current production deployment, use JavaScript origin `https://unicirq.vercel.app` and redirect URI `https://unicirq.vercel.app/api/auth/callback/google`. Select **Web application** and keep basic sign-in scopes (`openid`, email, profile). Student Google sign-in does not require Gmail access. Save the client ID/secret in the private environment, then configure the same values in Vercel Production and redeploy.

### Temporary Gmail SMTP setup

Use a dedicated Gmail testing account. Enable 2-Step Verification yourself, then create an App Password named **UniCirq email**. App Password availability depends on the Google account's security and organization policies. Save the 16-letter App Password as `GMAIL_APP_PASSWORD`; never enter the Google account password. Spaces in Google's displayed App Password are accepted.

Set `EMAIL_PROVIDER=gmail`, `GMAIL_USER` to that exact `@gmail.com` address and `EMAIL_FROM` to `UniCirq <THE_SAME_GMAIL_ADDRESS>`. The server uses only `smtp.gmail.com:465` with verified TLS, bounded timeouts and no file/URL attachment access. SMTP acceptance is checked for the intended recipient, but inbox arrival must still be confirmed. No credentials, recipient addresses, OTPs or provider responses are logged.

Run `npm run email:check -- --to YOUR_OWN_EMAIL_ADDRESS` only after explicitly authorizing that recipient. Then test real signup verification and recovery. Gmail sending limits and account protections apply; use a verified transactional sender for public launch. Switching back to Resend requires `EMAIL_PROVIDER=resend`, a verified domain and its private sending key. [Google App Password instructions](https://support.google.com/accounts/answer/185833), [Nodemailer SMTP settings](https://nodemailer.com/smtp), [Gmail sending limits](https://support.google.com/mail/answer/22839).

## Apply and check

```powershell
npm ci
npm run db:migrate
npm run setup:check
npm run db:check -- --require-migrations
npm run dev
```

Do not run migrations until the operator URL is confirmed for the intended database. Migration `005` adds initial university selection and the campus-verification guard. Migration `006` changes verification IDs from UUID to text to support Better Auth's deterministic cleanup-lock IDs while preserving existing values. Authentication users, sessions and accounts keep UUID IDs. Earlier migrations remain unchanged. Prisma schema generation does not change the database; SQL migrations remain authoritative.

## Security behavior

- Sessions use HTTP-only cookies and are checked on the server. Suspended users lose access; browser-supplied roles and university privilege fields are ignored.
- Layouts and APIs block students who have not chosen a university. The onboarding command alone is available at that point.
- Password hashes, OTP hashes, sessions and rate limits persist in PostgreSQL. Codes expire after five minutes and have attempt limits; signup, signin, verification and reset endpoints are rate limited.
- Email verification for an unverified password account also requires its signup/signin password. A duplicate signup cannot activate somebody else's earlier password. The password is held only in React memory through the verification step.
- Email-code signin uses Better Auth's cleanup of an unverified identity: pre-existing unproven passwords, linked accounts and standing sessions are removed before the mailbox owner receives a session. The owner can set a new password through recovery.
- Google uses Better Auth's state, signed browser-cookie binding, PKCE and token validation. Unknown state, replay, forged identity tokens, cross-origin requests and external callback redirects fail.
- Automatic identity linking is disabled. A Google login using an email already registered through another method is rejected with a friendly message to use the original method; accounts are not silently merged.
- Client redirects allow only the exact HTTPS Google accounts origin. Client errors display fixed messages; passwords, codes, provider tokens and database URLs are not exposed in UI diagnostics.
- Signup creation uses Prisma transactions. The installed OTP password-reset implementation executes its updates sequentially; this release does not claim the entire reset is one atomic transaction.

[Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [Email OTP](https://better-auth.com/docs/plugins/email-otp), [Hooks](https://better-auth.com/docs/concepts/hooks).

## Validation completed

108 automated checks cover PostgreSQL row policies and commands, real Prisma-backed password signup/verification/reset, email-code signin, Google OAuth callbacks, account-ownership safeguards, university selection and safe UI request handling. The Google token endpoint and signing keys are test fixtures; tests make no real Google requests.

Browser checks verified responsive login/signup/recovery, required university selection, persisted campus choice, campus isolation, Student/Business/Admin routing, logout and disabled live providers. Real inbox delivery, Google consent and hosted database privileges still require credentials and a live smoke test.
