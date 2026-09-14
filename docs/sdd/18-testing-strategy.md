# 18 — Testing Strategy

## Tooling

- **Unit & integration:** Vitest (TypeScript-native, fast) for backend service/module logic and frontend component/hook logic.
- **API integration:** Supertest (or Fastify's built-in `inject`) against a real test database (migrated fresh per test run/suite), never mocked at the database layer for permission/tenant tests specifically — the whole point of these tests is to catch a real query that leaks across tenants.
- **End-to-end:** Playwright, including mobile-viewport emulation and network throttling, for flows that must be verified as actually working in a browser (upload lifecycle, deletion-request approval, push permission prompt).
- **CI gating:** lint, type-check, unit, integration, and a curated E2E subset run on every PR; full E2E suite (including long-running upload scenarios) may run on a slower/scheduled cadence if needed to keep PR feedback fast — decided per actual suite runtime once it exists.

## Coverage by area (required, per the source spec)

| Area | Level(s) | What must be proven |
|---|---|---|
| Authentication | Unit + integration + E2E | Password hashing never reversible; login rate limiting triggers; session issued/validated/expired correctly; forced password change on first login blocks other access |
| Role permissions | Integration | Every cell of the permission matrix ([06-permissions-and-authorization.md](06-permissions-and-authorization.md)) — each role attempting each action, allowed and denied cases both asserted |
| Multi-tenant isolation | Integration (critical) | A user from Company A can never read, list, or mutate any resource owned by Company B, across every resource type — includes attempts via a manipulated `company_id` in the request body |
| Company membership | Integration | Access granted only with an active membership; revoked membership immediately removes access to previously-visible resources; permission overrides (`can_manage_campaigns`, `can_delete_company_files`) apply per-membership, not globally to the user |
| Folder and file access | Integration | Contributor sees all folders/files of their company regardless of creator; cannot access another company's folders/files even with a guessed/enumerated ID |
| Upload authorization | Integration + E2E | Session creation rejected without permission/membership; presigned URLs rejected after permission revocation; file-type/size policy enforced before any bytes transfer |
| Large-file upload lifecycle | E2E | Full multipart flow against a real (or emulated) R2-compatible endpoint: create → parts → complete → File row created with correct metadata |
| Retry & resume behavior | Integration + E2E | Simulated network failure mid-upload resumes from the correct part; expired session cannot resume; duplicate completion call is idempotent |
| Deletion request approval | Integration + E2E | Full request → notify → approve/reject → soft-delete flow; only the company's admin can review; rejection leaves the file intact and notifies the requester with the reason |
| Notifications | Integration | Correct recipients resolved per event type; no cross-tenant notification ever created; deduplication collapses repeated events into one unread item |
| Push notification permissions | E2E | Permission prompt flow; device registration persisted; revoked/invalid device marked accordingly on a simulated delivery failure; disabling push for an event type suppresses delivery while in-app notification still fires |
| Campaign history | Integration | Every field change on a campaign produces exactly one `campaign_history` row with correct old/new values and actor |
| Backup authorization | Integration | Only `agency_admin` can trigger/download; single-flight limit rejects a concurrent second request; expired backup file is not downloadable |
| API validation | Unit + integration | Zod schemas reject malformed input with field-level error details before any business logic executes |
| Error handling | Integration | Consistent error envelope/status codes per [15-api-conventions.md](15-api-conventions.md); no stack traces or internal details leak in responses |

## Test data

- No fabricated data is ever presented as production data, per the source spec's explicit rule — seed/fixture data used in tests and local development is clearly synthetic and never inserted into a production database or used in demos as if real.
- Tenant-isolation tests always construct at least two companies with overlapping resource shapes (e.g., both have a "Company A / Company B" pair of otherwise-identical projects) specifically to catch a filter that's missing rather than one that's merely untested.

## What is explicitly not required for Phase 1

- Load/performance testing at scale beyond the sizing assumption in [17-performance-requirements.md](17-performance-requirements.md#load-expectations-phase-1-sizing-assumption-approved-2026-09-14) — revisit if real usage approaches that ceiling.
- Cross-browser E2E matrix beyond current major evergreen browsers plus one mobile browser profile (Web Push behavior differences, e.g. iOS Safari, are tracked as an open question, not a blocking test requirement, until [23-open-questions.md](23-open-questions.md) is resolved).
