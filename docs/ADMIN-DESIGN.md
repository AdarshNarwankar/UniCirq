# Admin Control Center redesign

The admin workspace follows the supplied UniCirq reference: a fixed navy sidebar, compact search/filter toolbar, campus photo banner, eight metric cards and a three-column operations grid. Student and Business continue to use their existing layouts. On smaller screens the grid collapses and the sidebar becomes a navigation drawer.

The overview uses the authenticated snapshot. Campus and date selectors update the overview scope; search matches listing/owner names, pending applications and support cases. Listing tabs filter the review queue. Review and verification controls use the existing server-authorized moderation command and require a recorded reason. Audit views retain the existing authorization policies.

The reference's invented revenue, growth, uptime and AI fraud figures are not copied into live metrics. Recorded order value is labeled separately from GMV. Revenue and automated fraud/authentication telemetry are marked as unavailable until integrated. The seven-day chart shows actual listing and order creation counts from the current snapshot.

Decorative campus banner: [Unsplash campus photography](https://unsplash.com/s/photos/washington-university-in-st.-louis), image `photo-1737461992631-5f93d0dc95ec`. This illustrative image does not identify the application's pilot campus.

Validation: TypeScript and production build, desktop reference-size review at 1672 × 941, mobile review at 390 × 844 without document overflow, campus filtering, pending-listing filtering, a local demo review saved through the command endpoint and displayed in the audit feed, and mobile drawer navigation. Backend authentication and authorization were not altered by this redesign.
