# UniCirq redesign

The visual direction is a campus circle: warm paper, cobalt blue, sage, generous typography, tactile objects, and editorial layouts.

## What changed

- Public landing page with custom CGI artwork, scroll-driven CSS 3D book/camera/noticeboard scenes, campus explanation, FAQ, and responsive navigation.
- New wordmark, favicon, self-hosted DM Sans and Manrope fonts, and shared light/dark design tokens.
- Rebuilt student and business dashboards; redesigned admin overview and application navigation.
- Shared styling for marketplace, listing details, forms, messages, exchanges, profile, settings, support, verification, moderation, and analytics.
- Redesigned authentication pages and a working demo account switch.
- Reduced-motion support, keyboard menu dismissal, responsive layouts, and locally optimized artwork.

Existing data models, authorization rules, and exchange workflows remain in place. The demo uses fictional local records. Production email, Google authentication, and database services still require the existing configuration described in PRODUCTION-SETUP.md.

## Preview

Use Node 22.12 or newer. Install locked dependencies with `npm ci`. Start locally with:

```sh
UNICIRQ_DEMO_MODE=true APP_URL=http://127.0.0.1:3000 npm run dev
```

Open `/about` for the landing page. Open `/login?preview=1`, expand “Explore a sample campus”, and choose a role. The preview query works only in demo mode.

## Asset provenance

`public/images/campus-orbit.webp` is custom AI-generated CGI created for this redesign and optimized to a 1440px WebP (~99KB). Creative prompt: a high-end tactile 3D editorial still life on warm ivory, with a chunky cobalt loop, cobalt headphones, coral and cream books, a silver camera, sage mug, and pencil; soft studio shadows, photoreal CGI, no text, logos, or people. The scrolling scenes and logo are authored in CSS/SVG.

Font licenses are included beside the self-hosted font files in `public/fonts`.

## Verification

- TypeScript check passed.
- All 193 existing tests passed (two concurrent test workers).
- Desktop browser checks: scroll scene transition, demo sign-in, account switching, student search, business dashboard, admin overview and verification workspace, light/dark marketplace.
- Mobile browser checks at 390px: landing layout, no horizontal overflow, menu and Escape behavior, FAQ disclosure; student navigation was also checked during implementation.
- Production build passed with two build workers. The production landing preview had no browser warnings or errors.

The provided ZIP had no Git history. These are local source changes; no GitHub push or external deployment was performed.

## Editorial refinement — 17 October 2026

The refinement adds serif display accents, a forest-green narrative section, a functional three-chapter index, and individual CSS 3D visuals on mobile. The campus dashboard now features a real listing and direct campus search. Marketplace categories use accessible selection buttons, with larger text and clearer light/dark states throughout the app.

Browser verification covered dashboard search to the matching listing, category filtering on desktop and at 390px, dark mode, mobile campus home, and all three mobile story scenes. No horizontal page overflow was observed on the checked screens.

## Dark mode correction — 17 October 2026

- Centralized dark styling in `src/app/dark.css`, loaded after the shared layouts. Removed the stale blue dashboard override and older conflicting dark rules.
- Added charcoal canvas/navigation/card surfaces, warmer text, consistent semantic status colors, and readable action states.
- Corrected outgoing messages, linked listing text, verification status labels, admin legends/data tables, and chart labels.
- The public landing and authentication artwork now follow the selected theme. `CampusArtwork` exposes only the visible image, chosen with CSS using the existing first-paint preference script.
- Added `campus-orbit-dark.webp`: a custom AI-edited variant of the original campus still life, preserving objects and composition with a charcoal studio background and soft low-key lighting, optimized to a 1440px WebP.

Browser review covered the student home, marketplace, listing detail, conversations, profile, activity, creation/settings screens, business dashboard, admin overview/review screens, authentication, and landing page. Targeted computed text-contrast checks identified and confirmed fixes to chat/status/chart text. A 390px dashboard check showed no page overflow. Switching to light mode preserved its original paper palette and transparent dashboard intro. Both theme tests passed, and the production build including TypeScript validation passed for this correction.


## Dark theme refinement — 17 October 2026

Refined dark mode with neutral graphite surfaces, a quieter sidebar, blue selected-navigation accents, warmer white typography, a softly lit forest-green feature backdrop, more natural product-photo brightness, and subtle card edges and shadows. All visual edits are confined to `html[data-theme=dark]` rules in `src/app/dark.css`. The existing light-art visibility rule was preserved.

Validation: production build and TypeScript validation passed. Visually checked the student dashboard, marketplace at desktop and 390px mobile widths, and landing page. No horizontal overflow on mobile marketplace. Compared computed light-theme colors, backgrounds, borders, shadows, font sizes, padding, and radii across 575 dashboard elements before and after; all matched. Source hashes confirm no other source file changed.
