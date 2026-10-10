# Admin Control Center redesign

The admin workspace follows the supplied UniCirq reference: a fixed navy sidebar, compact search/filter toolbar, campus photo banner, eight metric cards and a three-column operations grid. Student and Business now share this design language through a separate member shell and role-specific dashboard panels; see MEMBER-DESIGN.md. On smaller screens the grid collapses and the sidebar becomes a navigation drawer.

The overview and `/admin/analytics` use the authenticated snapshot. Campus and date selectors update charts and totals on the current page; search matches listing/owner names, pending applications and support cases on the overview. Listing tabs filter the review queue. Review and verification controls use the existing server-authorized moderation command and require a recorded reason. The analytics route requires the admin role on the server, using the same authorized data source as the rest of the dashboard.

The reference's invented revenue, growth, uptime and AI fraud figures are not copied into live metrics. Requested order value is labeled separately from revenue and settled GMV, and excludes currently cancelled requests. Revenue and automated fraud/authentication telemetry are marked as unavailable until integrated.

## Admin graphs

The overview includes community activity trends, grouped campus performance bars and a dispute resolution donut. The dedicated Analytics page adds marketplace composition, requested order value, order status, verification application decisions and support case breakdowns. Charts offer pointer and keyboard interaction, visible legends and expandable numerical tables. Empty views display an explicit empty state, with no invented historical values.

All charts and overview totals share one pure aggregation function. Last 7 and Last 30 days include today and the preceding 6 or 29 calendar days in India Standard Time. All time means the history in the currently loaded records, grouped into at most twelve contiguous time buckets. Invalid timestamps and future records are excluded. Campus filtering is applied before choosing the historical range. Status graphs describe the current states of records created within the selected period; they do not claim historical status transitions or resolution timing.

Production coverage is currently limited by the existing snapshot endpoint: it loads up to 200 latest records per relevant table, not the complete database. This limitation is disclosed on the analytics page and overview. High-volume reporting will need a server-authorized aggregate query before charts can represent full platform totals. Demo graphs are identified as sample campus data. Search filters operational queues; it does not change analytical totals.

Decorative campus banner: [Unsplash campus photography](https://unsplash.com/s/photos/washington-university-in-st.-louis), image `photo-1737461992631-5f93d0dc95ec`. This illustrative image does not identify the application's pilot campus.

Validation: aggregation tests cover calendar boundaries, campus isolation, empty views, invalid/future timestamps, status totals and cancellation exclusions. TypeScript and production build checks plus desktop/mobile browser checks cover chart rendering, filter changes, data tables, keyboard interaction and the server-protected analytics route. Existing moderation permissions are retained.

