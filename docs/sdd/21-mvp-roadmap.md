# 21 — MVP Roadmap

Per the source spec's development process requirement: implementation proceeds in small, independent stages. Each stage is implemented, tested, reviewed for security/isolation and mobile experience, and summarized for approval **before** the next stage begins. No stage implements more than its stated scope.

This roadmap sequences the modules from [03-functional-requirements.md](03-functional-requirements.md) by dependency order (a module that others rely on for tenant scoping or auth ships first).

## Stage 0 — Project scaffolding

- **Objective:** A running, empty application skeleton, locally and via Docker Compose, with CI checks passing on an empty codebase.
- **Scope:** Repo/workspace structure ([13-technical-architecture.md](13-technical-architecture.md#code-organization)), TypeScript/lint/format config, base Fastify app with `/health`, base React/Vite app, Docker Compose for local dev (app + Postgres), `.env.example`.
- **Files/modules:** `apps/api`, `apps/web`, root config files, `docker-compose.yml`.
- **Dependencies:** None.
- **Acceptance criteria:** `docker compose up` runs both services locally; `/health` returns 200; CI runs lint/type-check/test (even if trivial) on push.
- **Tests required:** A smoke test hitting `/health`.
- **Risks:** Over-scaffolding (adding structure for modules that don't exist yet) — keep this stage minimal.

## Stage 1 — Database schema & migrations baseline

- **Objective:** The core schema from [14-database-design.md](14-database-design.md) exists as reviewed, versioned migrations.
- **Scope:** `users`, `companies`, `company_memberships` tables only (enough for auth + tenancy — later stages add their own tables incrementally rather than migrating everything up front).
- **Files/modules:** Prisma schema/migrations, DB client wrapper in `shared/`.
- **Dependencies:** Stage 0.
- **Acceptance criteria:** Migrations run cleanly on a fresh database; rollback of the migration is verified in a non-production run.
- **Tests required:** Migration up/down test.
- **Risks:** Over-designing enum values before role/permission behavior (Stage 3) is implemented — keep schema aligned strictly to [14-database-design.md](14-database-design.md).

## Stage 2 — Authentication & sessions

- **Objective:** A user can log in with admin-issued credentials, is forced to change a temporary password, and has a revocable, sliding-expiry session.
- **Scope:** Login, logout, forced password change, session issuance/validation middleware, admin session revocation endpoint. Per [10-authentication-and-sessions.md](10-authentication-and-sessions.md).
- **Files/modules:** `modules/auth`, `sessions`, `password_reset_audits` tables/migration.
- **Dependencies:** Stage 1.
- **Acceptance criteria:** Login issues an httpOnly session cookie; a revoked session is rejected on the next request; a `must_change_password` account cannot reach any other route until it changes its password; rate limiting triggers after repeated failed logins.
- **Tests required:** Unit (hashing), integration (login flow, revocation, lockout), E2E (forced password change screen).
- **Risks:** Session/cookie configuration mistakes (missing `Secure`/`httpOnly`) — explicitly checked in review.

## Stage 3 — Companies, users, roles, and tenant isolation

- **Objective:** `agency_admin` can create companies and users, assign roles and memberships, and every subsequent request is correctly tenant-scoped.
- **Scope:** Company CRUD, user CRUD (admin-only), `company_memberships` management including `can_manage_campaigns`/`can_delete_company_files` overrides, tenant-scoping middleware, RLS policies on the tables that exist so far.
- **Files/modules:** `modules/companies`, `modules/users`, tenant-scoping shared middleware, RLS migration.
- **Dependencies:** Stage 2.
- **Acceptance criteria:** Every permission-matrix cell for these resources ([06-permissions-and-authorization.md](06-permissions-and-authorization.md)) is enforced; a user from Company A cannot see Company B's data under any role.
- **Tests required:** Full cross-tenant integration suite (this stage sets the pattern every later stage's tests follow).
- **Risks:** This is the highest-consequence stage in the whole roadmap — a gap here undermines every later module. Extra review time budgeted here explicitly.

## Stage 4 — Branding settings

- **Objective:** `agency_admin` can customize logo, favicon, app name, colors, and login branding without a code change.
- **Scope:** `branding_settings` singleton table/endpoint, asset upload (small images — can reuse a minimal version of the upload pattern ahead of the full system, or be deferred to reuse Stage 6's upload infra if simpler), frontend theming from these values.
- **Files/modules:** `modules/branding`.
- **Dependencies:** Stage 3 (admin-only).
- **Acceptance criteria:** Changing a brand color/logo reflects across the app without a deploy; minimum contrast ratio enforced on custom colors.
- **Tests required:** Integration (admin-only access), unit (contrast validation).
- **Risks:** Low. May be resequenced after Stage 6 if asset upload is easier to build once the real upload system exists — see [23-open-questions.md](23-open-questions.md) if this reordering is preferred.

## Stage 5 — Projects and folders

- **Objective:** Companies can organize work into projects and folders, visible per the contributor-visibility rule.
- **Scope:** Project CRUD, folder CRUD (with nesting), visibility per [06-permissions-and-authorization.md](06-permissions-and-authorization.md).
- **Files/modules:** `modules/projects`, folder endpoints (may live in `modules/files` since folders are tightly coupled to files — see Stage 6).
- **Dependencies:** Stage 3.
- **Acceptance criteria:** A contributor sees all folders in their company regardless of creator; folders nest correctly; archiving a project doesn't delete its folders/files.
- **Tests required:** Integration (visibility rules, nesting).
- **Risks:** Low.

## Stage 6 — Upload architecture (the critical path)

- **Objective:** Full resumable multipart upload direct to Cloudflare R2, per [07-upload-architecture.md](07-upload-architecture.md).
- **Scope:** `upload_sessions`/`upload_parts` tables, presign/create/parts/complete/abort endpoints, abandoned-upload cleanup job, `files` table + status pipeline, deletion-request workflow ([06](06-permissions-and-authorization.md#deletion-request-workflow)).
- **Files/modules:** `modules/files` (folders, files, upload sessions), `jobs/cleanup-abandoned-uploads`.
- **Dependencies:** Stage 5, R2 credentials/bucket provisioned.
- **Acceptance criteria:** A 30 GB file (or a realistic large test file) uploads successfully with pause/resume/cancel working; killing the browser mid-upload and resuming completes correctly; an abandoned session is aborted by the cleanup job within its configured TTL; deletion by a non-owner requires approval; the [real-device/unstable-network validation plan](07-upload-architecture.md#validation-plan-real-devices-and-unstable-networks) has run at least once, with its results recorded (defaults confirmed or adjusted) before this stage is signed off.
- **Tests required:** Integration (authorization boundaries, idempotent completion), E2E (full upload lifecycle including simulated network failure), job test (cleanup), manual device-matrix validation pass (not automatable — see the validation plan linked above).
- **Risks:** Highest technical-complexity stage in the roadmap. Budget for a spike/prototype of the R2 multipart flow before committing to exact chunk-size/concurrency defaults — the numbers in the spec today are initial configuration values, not the validated final answer.

## Stage 7 — Notes, comments, and follow-up topics

- **Objective:** Comments/notes on any supported resource, and the full follow-up topic conversation flow.
- **Scope:** `comments`, `topics`, `topic_replies`, promote-note-to-pending-request action (UI/endpoint convenience; the underlying pending request is a normal create).
- **Files/modules:** `modules/comments`, `modules/topics`.
- **Dependencies:** Stage 5 (needs resources to comment on), Stage 3.
- **Acceptance criteria:** Topic views (created by me / awaiting my response / awaiting others / open / resolved) return correct, tenant-scoped results; sequential replies preserved with author/timestamp.
- **Tests required:** Integration (visibility, status transitions).
- **Risks:** Low.

## Stage 8 — Editorial calendar, content, and production tracking

- **Objective:** Full calendar (day/week/month/list), content types, and production-status pipeline.
- **Scope:** `content` table/endpoints, calendar query endpoints (range-based), production-status aggregate queries feeding dashboards (Stage 12).
- **Files/modules:** `modules/calendar`.
- **Dependencies:** Stage 5, Stage 6 (content can reference a related file).
- **Acceptance criteria:** Multi-month future planning works; overdue/today flags compute correctly; duplication of a single content item works (schedule templates are Phase 2).
- **Tests required:** Integration (range queries, status aggregation correctness).
- **Risks:** Low-medium — calendar range queries need the index from [14-database-design.md](14-database-design.md#indexing-strategy) in place from the start.

## Stage 9 — Multi-network publications

- **Objective:** Manual per-network publication status tracking for content.
- **Scope:** `publications` table/endpoints (one per content per network), status transitions.
- **Files/modules:** `modules/publications`.
- **Dependencies:** Stage 8.
- **Acceptance criteria:** A content item clearly shows which networks are published/pending; independent status per network.
- **Tests required:** Integration.
- **Risks:** Low.

## Stage 10 — Pending requests

- **Objective:** Full pending-request lifecycle with attachments and responses.
- **Scope:** `pending_requests` table/endpoints, response flow (comment + optional file attachment linked to the request).
- **Files/modules:** `modules/pending-requests`.
- **Dependencies:** Stage 6 (attachments), Stage 7 (responses reuse comment infra).
- **Acceptance criteria:** Recipient can respond from a mobile viewport; attached response files link correctly to the request.
- **Tests required:** Integration, E2E (mobile response flow).
- **Risks:** Low.

## Stage 11 — Notifications (internal + push)

- **Objective:** The shared notification pipeline from [08-notifications-and-push.md](08-notifications-and-push.md), covering every event type emitted by Stages 3–10, plus Web Push.
- **Scope:** `notifications`, `notification_preferences`, `push_devices` tables; the Notification Service module; event emission wired into prior stages' mutation points; Web Push registration/dispatch; deduplication logic.
- **Files/modules:** `modules/notifications`, service worker (frontend), VAPID key setup.
- **Dependencies:** Stages 3–10 (it observes their events) — implemented after they exist so the event catalog is grounded in real mutation points rather than speculative hooks.
- **Acceptance criteria:** No cross-tenant notification ever created (explicit test); push permission flow works end-to-end on a real mobile browser; disabling push for an event type suppresses only that channel; deep links navigate correctly and mark read.
- **Tests required:** Integration (recipient resolution, dedup), E2E (permission prompt, device registration, deep link).
- **Risks:** Retrofitting event emission into every prior module's mutation points is easy to under-scope — track exhaustively against the event catalog in [08-notifications-and-push.md](08-notifications-and-push.md#event-catalog-phase-1).

## Stage 12 — Dashboards

- **Objective:** Agency-wide and per-company dashboards answering "what do I need to do now?"
- **Scope:** Aggregate query endpoints per [03-functional-requirements.md](03-functional-requirements.md#dashboards), dashboard UI with filters.
- **Files/modules:** `modules/dashboard` (read-only aggregation layer over prior modules).
- **Dependencies:** Stages 6, 8, 9, 10, 11 (aggregates data from all of them).
- **Acceptance criteria:** Filters (company, responsible, period, priority, status) work correctly and remain tenant-scoped; client dashboard is visibly simpler than the agency dashboard.
- **Tests required:** Integration (aggregation correctness and tenant scoping).
- **Risks:** Query performance — review against [17-performance-requirements.md](17-performance-requirements.md) before merge.

## Stage 13 — Campaign management

- **Objective:** Manual ad-account and campaign registry with full change history.
- **Scope:** `ad_accounts`, `campaigns`, `campaign_history` tables/endpoints, the `can_manage_campaigns` permission check.
- **Files/modules:** `modules/campaigns`.
- **Dependencies:** Stage 3.
- **Acceptance criteria:** Every field edit produces exactly one history row; manual values are visibly labeled as manual; a manager without the override cannot edit.
- **Tests required:** Integration (history correctness, permission override enforcement).
- **Risks:** Low.

## Stage 14 — Manual database backup

- **Objective:** Admin-triggered backup with protected download, per [11-backup-and-recovery.md](11-backup-and-recovery.md).
- **Scope:** `backup_jobs` table, trigger/status/download endpoints, `pg_dump` background job, single-flight enforcement, temp-file cleanup job.
- **Files/modules:** `modules/backups`, `jobs/run-backup`, `jobs/cleanup-expired-backups`.
- **Dependencies:** Stage 3 (admin-only), background job infra from Stage 6.
- **Acceptance criteria:** A backup completes and downloads correctly for a realistic database size; a second concurrent request is rejected; the temp file is gone after its retention window regardless of download.
- **Tests required:** Integration (authorization, single-flight, expiry), manual verification of an actual restore from a generated dump.
- **Risks:** Resource contention on the VPS during dump generation — validate against [11-backup-and-recovery.md](11-backup-and-recovery.md#operational-impact).

## Stage 15 — CI/CD hardening & production deploy

- **Objective:** Every push to `main` deploys automatically per [19-deployment-and-cicd.md](19-deployment-and-cicd.md), with a working manual fallback and documented rollback.
- **Scope:** `.github/workflows/deploy.yml`, production `Dockerfile`(s)/`docker-compose.yml`, `scripts/deploy.sh`, VPS provisioning documentation, GitHub Secrets documentation, rollback runbook.
- **Files/modules:** `.github/workflows/`, `scripts/`, root Docker files, `docs/` deploy runbook.
- **Dependencies:** A deployable application exists (practically, this stage is exercised incrementally alongside earlier stages once Stage 0 exists, but is only considered *complete* — with full rollback/migration-safety documentation — once the real migration and backup stages exist).
- **Acceptance criteria:** A push to `main` results in a successful automated deploy with a passing health check; a deliberately broken migration halts the pipeline without touching the database volume; rollback to the previous image tag is exercised at least once successfully.
- **Tests required:** Pipeline dry-run against a staging-like VPS or environment; rollback drill.
- **Risks:** First real production deploy always surfaces environment-specific issues — budget extra time here, and do not treat this stage as "just YAML."

## Sequencing notes

- Stages 4 (branding) and 13 (campaigns) have few dependents and can be reordered relative to their neighbors if priorities shift, without breaking the roadmap.
- Stage 11 (notifications) intentionally comes late because it observes events from nearly every earlier module — building it earlier would mean re-wiring event emission repeatedly.
- Stage 6 (upload) is the highest-risk, highest-value stage and should not be split further or rushed — see [07-upload-architecture.md](07-upload-architecture.md).
