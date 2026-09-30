# Validation record

Checked locally on 30 September 2026 with Node.js 24.11.1 and Next.js 16.3.7.

- `npm test`: 31 passing tests. Includes Better Auth OTP/session/replay/origin checks, application policies, SQL row policies, role/campus isolation, participant privacy, order transitions, rental overlap prevention and moderation audit writes.
- `npm run typecheck`: passed.
- `npm run build`: passed, all three role route trees and API handlers generated.
- `npm audit --omit=dev --audit-level=high`: zero reported vulnerabilities at the time of the check.
- Running development server: eight HTTP smoke checks passed (anonymous/forged session rejection, role redirect, student admin-command denial, cross-origin denial, demo sign-in and authorized snapshot).
- Running production build: demo admin sign-in returned 404 and anonymous snapshot returned 401. Demo credentials cannot be used in production.
- Browser: student demo sign-in, listing publication and private message submission succeeded. Student, Business and Admin dashboards rendered. At a 390 × 844 viewport, all three dashboards fit without horizontal document overflow. The mobile student dashboard was visually inspected.

The auth integration tests use PostgreSQL through PGlite and a captured email sender. No real Neon database, external email delivery or hosted Vercel environment was connected. The migration SQL is exercised in integration tests; the migration runner passed syntax validation but has not been run against a hosted database. Configure staging credentials and verify the restricted runtime role and real OTP delivery before inviting users.
