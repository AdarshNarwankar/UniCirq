# Student and Business dashboard redesign

Both roles now follow the Admin Control Center's navy sidebar, compact toolbar, campus banner, blue accents, white panels and pale-blue canvas. They share `MemberShell` and retain separate role navigation and authorized data. The Admin layout is unchanged.

Student: personal listing/saved/conversation/activity counts, category navigation, working marketplace cards, next steps, notifications, campus requests, deals and managed-sale interest. Header search routes into the existing marketplace search. Saving items updates the sidebar and dashboard totals.

Business: live/pending/total offer counts, support count, searchable offer table, offer-status bars, campus presence, business profile, checklist and notifications. Expired offers are excluded from live counts. Search matches title, description and code. Existing deal creation, profile and support forms remain available through the sidebar and action links. No revenue or redemption figures are fabricated.

The existing catalogue, detail, chat, forms and activity pages inherit the common sidebar and compact card styling. At mobile widths, navigation moves into a drawer; Escape closes it and restores focus to its button. Main panels stack and offer tables scroll within their own container. The campus image is the same illustrative Unsplash asset documented in ADMIN-DESIGN.md.

Validation: production build and TypeScript; desktop inspection at 1440 × 1000; mobile inspection at 390 × 844; marketplace header search; saving a demo listing and refreshed totals; mobile drawer navigation; business offer search by code and no-match state; access to the existing offer form. All backend permissions and authentication code remain unchanged.
