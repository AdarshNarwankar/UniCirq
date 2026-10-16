# UniCirq interface system

The interface uses a shared campus workspace across student, business and administrator accounts. Authentication and role authorization remain server-owned.

## Navigation

- Student: Home, Explore, Inbox, My activity, Account.
- Business: Overview, Campus offers, Business profile, Workspace.
- Admin: Overview, Review desk, Trust & support, Insights, Account.

Related destinations appear in a contextual navigation row. Mobile uses a floating four-item dock and an accessible native dialog listing every destination. The desktop header contains no global search or buy/sell action; searches belong to the relevant page and listing creation lives in the student workspace.

## Visual system

`src/app/design-system.css` owns theme tokens, typography, glass surfaces, buttons, forms, dialogs, and workspace navigation. Module styles follow it in the root layout:

- `redesign-member.css`: student/business home, catalogue and listing detail.
- `redesign-identity.css`: sign-in, onboarding, profile, settings and verification.
- `redesign-admin.css`: review desks, support, trust, analytics and audit.
- `redesign-community.css`: listing editor, inbox, requests, offers, activity and notifications.

Warm ivory and graphite are the base surfaces; jade is the functional accent. Transparent surfaces use blur with an opaque fallback. Serif typography is limited to editorial emphasis. Shared text and surface tokens switch together for light/dark mode. Selected navigation uses both shape and contrast; forms keep visible labels and focus outlines. Motion respects the reduced-motion preference.

## Interaction details

Listing creation is organized into four sections while keeping native validation and the existing photo upload. The inbox uses a desktop list/detail layout and a mobile conversation view with a back action. Its local search covers people and listing/request titles. Settings sections remain mounted when switched, preserving unsaved entries while excluding hidden controls from interaction. Review decisions, request confirmations and account/security operations use the existing API contracts.

## Verification

The redesign retains existing authentication, database, photo, exchange, verification and moderation coverage. Release checks include the production build, TypeScript, stylesheet parsing, all role routes, unauthenticated access, and cross-role redirects. Visual review should cover desktop and phone sizes in both themes, with special attention to navigation, modal scrolling, image fallback, inbox back navigation and long record content.
