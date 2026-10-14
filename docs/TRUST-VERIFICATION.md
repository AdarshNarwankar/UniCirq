# Trust and verification

Email sign-in, campus selection, campus eligibility and business approval are separate checks. Profile completeness never grants access. Demo statuses are explicitly marked as samples.

## Member workflow

1. Confirm the email address through the configured sign-in method.
2. Choose a supported university during onboarding. This scopes campus discovery; it does not verify enrollment.
3. Open **Profile → Trust & verification**. Submit the course, year/affiliation, an independently checkable campus contact and an explanation of the campus connection. Do not submit ID numbers, passwords or sensitive documents.
4. Follow the submitted application, review timeline and notifications. A rejected application shows the reviewer’s reason and permits a new application. Only one application may be pending at a time.
5. A verified Student can apply separately as a business for the same campus. Business approval changes the account role to Business, so unfinished student exchanges must be resolved first.

## Admin workflow

Open `/admin/verifications` to filter applications by status, type, campus, submission period or search. Open an application to inspect its statement and current profile details.

Approval requires an independently completed check, a matching check method, an explicit confirmation and a 5–500 character reason. Available methods are institution-issued email control, campus office confirmation, in-person eligibility, and (for businesses) public business records. UniCirq records the reviewer, decision time, method and reason. Selecting a method does not itself perform that external check.

Rejection requires a reason explaining what to correct; it does not require an approval attestation. Both outcomes notify the applicant and append an audit record. Already decided applications show a read-only outcome. Historical decisions without review metadata retain their original status without invented proof or dates.

## Server enforcement

SQL migration `007_verification_reviews.sql` adds review metadata and wraps the existing protected command function. The superseded function is owner-only; the database readiness audit detects accidental runtime execution grants to it.

The server rejects anonymous/non-Admin decisions, self-review, suspended or non-Student applicants, duplicate pending applications, mismatched campus approval, forged reviewer fields and business applications before campus verification. The reviewer and timestamp always come from the authenticated database context. Students can read only their own applications through existing row policies; Admins can inspect the review queue.

Apply the additive migration through the private operator connection before releasing the UI. Keep operator credentials off Vercel. Run `npm test`, `npm run build` and `npm run db:check -- --require-migrations`. The isolated PostgreSQL tests cover protected reviews, request privacy, reviewer ownership, rejection/resubmission, business prerequisites and legacy-function grants.

No document storage, automatic campus-email challenge, identity provider, trust score or payment guarantee is introduced by this workflow.
