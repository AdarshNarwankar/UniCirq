# Admin operations

Every admin route requires an active administrator on the server. Application writes use the protected PostgreSQL command function; browser navigation and hidden controls do not grant access.

| Workspace | Route | Purpose |
| --- | --- | --- |
| Listings & services | `/admin/moderation` | Search the full listing and business-offer catalogue. |
| Moderation queue | `/admin/moderation-queue` | Review pending submissions and unresolved listing reports. |
| Trust & safety | `/admin/trust-safety` | Inspect current reports, suspended accounts, disputed exchanges and outstanding reviews. |
| Disputes & support | `/admin/support` | Review and resolve submitted cases. |
| Support Center | `/admin/support-center` | Search admin handling guides and open the relevant workspace. |

## Moderation

- Review links open a listing or offer by `?listing=ID` or `?deal=ID` in the queue.
- Listing reviews show the submitted photo, description, price, condition, campus, owner verification, linked exchange counts, community reports and recorded decisions. Reviews do not expose private conversations.
- Pending submissions can be approved or declined. Active submissions can be removed. Removed or closed records remain read-only. Expired offers cannot be approved; expiry follows India time.
- A decision requires an acknowledgement and a trimmed reason of 5–500 characters. The database locks the current record, rejects stale or repeated decisions, and saves the change and audit entry atomically.
- Removing a listing does not resolve its reports or alter existing exchanges. Open reports remain available for a separate response.
- Campus and period filters scope the queue; a recent report can bring an older listing into the selected period. All records remain available through status filters.

## Cases and safety

- Support links accept `?ticket=ID`, `?type=dispute|support|report|managed_sale` and `?status=open|resolved`. A linked case can appear outside current list filters with an explanatory notice.
- Case details include the full concern, associated listing, saved exchange terms, activity timeline, resolution and audit history when those records exist.
- Resolving an open case records a 5–500 character response and sends an in-app notification to its owner’s current role dashboard. A resolved response cannot be overwritten.
- Resolving a case does not settle an exchange, transfer funds or issue a refund. Managed sale remains an interest stub.
- Trust & safety shows current outstanding concerns regardless of their creation date. Its period filter applies to decision history. Counts are based on loaded records, with no fabricated risk scores or automated fraud claims.

## Database and checks

Apply `009_moderation_workspaces.sql` with the separate migration connection, then run `npm run db:check -- --require-migrations`. Superseded command wrappers stay inaccessible to runtime roles.

The moderation tests execute the actual SQL in an isolated PostgreSQL engine and cover unauthorized access, stale and repeated decisions, expiration, audit rollback, rate limiting, notification privacy and unchanged exchange state. Browser checks use local demo records for decisions and case resolution.
