# Account, settings and appearance

Students, businesses and administrators each have server-protected `/profile` and `/settings` routes under their own dashboard. The Settings link is available in each sidebar; the profile header also links to it. The top toolbar and login/onboarding pages include a light/dark toggle.

## Appearance

Light, Dark and System preferences apply across dashboards, profiles, settings, marketplace, messages, forms, dialogs, authentication and admin graphs. System follows the device setting and listens for changes. The choice is stored on the current browser under `unicirq.theme.v1`, with cross-tab synchronization. Preferences are not synchronized between devices or saved as account data. An inline script applies the validated preference before first paint; the provider uses the same rules after hydration. Blocked storage still allows switching for the current page and displays an honest persistence notice. Color-scheme is applied to native form controls. The existing reduced-motion support remains in place.

## Profiles

Profiles display the real account role, selected campus, member date, initials, and current verification status. Students can edit name, bio, course and year. Businesses and administrators can edit name and bio without erasing existing academic fields. Campus, role and verification cannot be changed through the profile payload; the existing server command and PostgreSQL permission checks enforce this.

The edit form supports cancel, validation, busy/error/success feedback, and preserves unsaved drafts across snapshot refreshes. Activity figures are derived from owned records. Profile completeness measures filled profile fields and never grants trust or permissions. Avatar uploads and reputation scoring are not presented as working features.

Students can submit campus verification for their selected university, see pending status, inspect application history and reasons, and reapply after rejection. Verified students can submit a business application. Business directory entries are read-only, with a support link for corrections. Administrators see their assigned access rather than a student verification claim.

## Settings and security

Settings contain appearance, account/campus details, real unread notifications, marking notifications as read, support links and sign-out. Email notification preferences and self-service campus reassignment are not implied by nonfunctional switches.

`GET /api/account` requires the verified server session and an active application profile. The server queries only the current user's authentication accounts and sessions, then returns a minimal response: account email, sign-in methods, password-change availability and session metadata. Password hashes, session tokens, raw user agents, IP addresses and provider secrets are never returned by this endpoint. Responses are private and uncached.

Live email/password accounts can change their password through the existing Better Auth handler using the current password. The browser requests revocation of older sessions and keeps the refreshed cookie supplied by the auth response. Active-session metadata is readable on the settings page, with a control to sign out other sessions. Better Auth enforces session ownership, current authentication and origin checks for mutations. Google passwords remain managed by Google; email-code accounts use recovery to create a password. Demo accounts clearly identify password/session management as unavailable.

Reference behavior: [Better Auth session management](https://better-auth.com/docs/concepts/session-management) and the installed package's route implementations. Actual installed-version behavior is exercised by the Prisma/PostgreSQL integration tests.

## Validation

- All 125 tests passed, including Prisma/PostgreSQL role restrictions, campus isolation, messaging/order permissions, Google callback safeguards, profile privilege stripping and new theme/security coverage.
- New security integration tests check incorrect current passwords, hostile origins, foreign-session isolation, cookie rotation after password changes and revocation of older owned sessions.
- Browser checks covered more than 30 routes across all roles, profile save/cancel/reload, drafts surviving a real background refresh, notification actions, messaging, desktop/mobile layouts, theme persistence, system changes, cross-tab synchronization and blocked-storage fallback.
- Demo workflows exercised university selection, verification submission/reload/rejection/reapplication/approval/history, listing publish/close, business offer creation/moderation/student visibility and administrator profile saving.
- Security-form browser fixtures checked service-error retry, password confirmation, invalid-password errors, show/hide controls, password clearing, session refresh and signing out other sessions. These fixtures are separate from the real Prisma/PostgreSQL security tests.
- Browser console checks found and fixed nondeterministic donut coordinates during hydration and an invalid browser pattern on deal codes. Coordinates now use a fixed precision; deal-code hyphens are escaped for the browser's Unicode-set pattern syntax.

Live hosted PostgreSQL, Google OAuth and email delivery still require the operator's credentials. These checks used local demo workflows, in-process PostgreSQL and controlled provider/UI fixtures; they do not claim a live provider connection or deployment.
