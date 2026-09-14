# 22 — Acceptance Criteria

Expanded from `documentation.md` Section 21. The MVP is accepted when all of the following hold, each traceable to the stage(s) in [21-mvp-roadmap.md](21-mvp-roadmap.md) that deliver it.

| # | Criterion | Verified by (stage) | Testable as |
|---|---|---|---|
| 1 | `agency_admin` can create companies and users | Stage 3 | Given an admin session, creating a company/user persists it and it appears in subsequent listings |
| 2 | Roles and permissions can be defined per user and per company membership | Stage 3 | Given a membership with an override, the effective permission matches [06](06-permissions-and-authorization.md) |
| 3 | Cross-company access is impossible under every role | Stage 3 (and re-verified every later stage) | Given a user authenticated to Company A, every request referencing Company B's resources returns 403/404, never data |
| 4 | Files can be sent from a phone | Stage 6 | E2E upload flow passes on a mobile-viewport/mobile-network-emulated Playwright run |
| 5 | Files are stored in Cloudflare R2, never fully buffered in the backend or VPS | Stage 6 | Architecture review + integration test asserting no full-file read occurs server-side during upload |
| 6 | Author and timestamp are recorded for every upload | Stage 6 | `files.uploaded_by`/`uploaded_at` populated and displayed in the UI |
| 7 | Files are organized by project (and folder) | Stage 5, Stage 6 | Files list correctly scoped/filterable by project and folder |
| 8 | A contributor cannot delete another user's file | Stage 6 | Given a contributor attempting to delete a file they didn't upload, the request is rejected and a deletion request is created instead |
| 9 | Comments and pending requests can be created | Stage 7, Stage 10 | Create/list endpoints work and are tenant/permission-scoped |
| 10 | Authorized users are notified of relevant events | Stage 11 | Given an event (e.g., new pending request), only correctly-scoped recipients receive a notification, in-app and via push if enabled |
| 11 | Future plans can be created (multi-month calendar) | Stage 8 | A content item can be scheduled several months out and appears correctly in month/list views |
| 12 | Overdue items are visible | Stage 8, Stage 12 | Overdue content/pending requests are flagged and surfaced on the relevant dashboard |
| 13 | Production progress can be tracked | Stage 8 | Content production-status transitions persist and reflect on dashboards |
| 14 | Publication per network can be recorded | Stage 9 | Each network's publication status/date/link is recorded independently per content item |
| 15 | Agency-wide and per-company operations are both visible | Stage 12 | Agency dashboard shows cross-company aggregates (scoped to the admin/manager's access); company dashboard shows only that company's data |

## Additional Phase-1-specific acceptance criteria (beyond the source list's 15 items, required by the updated decisions section and this task's instructions)

| # | Criterion | Verified by | Testable as |
|---|---|---|---|
| 16 | Passwords are never recoverable in plaintext by anyone, including admins | Stage 2 | No API response, log, or database column ever contains a plaintext password after initial one-time display |
| 17 | A temporary/reset password forces a change on next login | Stage 2 | `must_change_password` blocks all other routes until changed |
| 18 | Sessions last ~7 days with sliding renewal and are individually revocable | Stage 2 | Revoking a session invalidates it on the very next request |
| 19 | Push notifications work end-to-end with permission control | Stage 11 | Permission prompt → device registration → event → delivery → deep link → marked read, all verified |
| 20 | Campaigns can be tracked manually with full history, with no automatic integration | Stage 13 | Every field edit produces a history row; no outbound call to Meta/TikTok APIs exists in the codebase |
| 21 | Admin can customize branding without a code change | Stage 4 | Changing logo/colors/app name in the admin panel reflects immediately, no deploy required |
| 22 | Admin can manually trigger and download a database backup | Stage 14 | Full backup lifecycle (queued → processing → completed → download → expiry) works and is single-flight |
| 23 | Push to `main` deploys automatically without manual intervention | Stage 15 | A merged PR results in a live, healthy deployment without any manual step |
| 24 | A failed migration or deploy never deletes or corrupts data | Stage 15 | A deliberately-failing migration halts the pipeline; the database volume and prior application version remain intact |

## Performance and reliability acceptance criteria (from this review round)

| # | Criterion | Verified by | Testable as |
|---|---|---|---|
| 25 | API list/detail endpoints meet the p95 latency target | Every stage exposing an endpoint | Integration test with timing assertions per [17-performance-requirements.md](17-performance-requirements.md#targets-concrete-testable); p95 < 500 ms under normal load |
| 26 | Primary mobile screens meet the time-to-interactive target | Stage 8, Stage 12 (calendar, dashboards) | Playwright E2E with network throttling; < 3 s on the reference mobile network condition |
| 27 | Every list/detail/mutating screen has loading, empty, error, retry, and success states | Every UI-facing stage | Component/E2E test asserting all five states render correctly for at least one representative screen per module, per [12-ui-ux-guidelines.md](12-ui-ux-guidelines.md) |
| 28 | Duplicate submission is impossible on slow connections | Every mutation-triggering UI stage | E2E test double-clicking/double-tapping a submit action on a throttled connection; exactly one record/upload session is created |
| 29 | Every destructive action requires explicit confirmation | Every stage with a delete/irreversible action | E2E test asserting the action does not execute without confirming the dialog |
| 30 | Pagination is enforced server-side regardless of client request | Every list endpoint | Integration test requesting a page size above the server-side max; response is capped, never unbounded |

## Out of scope for MVP acceptance (do not block sign-off on these)

Email notifications, ad-platform integrations, automatic metrics, automatic publishing, automatic scheduled backups, advanced search, calendar templates/schedule duplication, native mobile apps — all per [01-product-scope.md](01-product-scope.md).
