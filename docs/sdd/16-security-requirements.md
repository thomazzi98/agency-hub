# 16 — Security Requirements

Security is never traded off for convenience or performance anywhere in this system. This document consolidates security requirements referenced throughout the rest of the SDD into one checklist.

## Tenant isolation

- Enforced at two independent layers: application-layer authorization ([06-permissions-and-authorization.md](06-permissions-and-authorization.md)) and PostgreSQL Row-Level Security ([14-database-design.md](14-database-design.md#row-level-security-defense-in-depth-and-how-prisma-must-use-it)).
- **The `company_id` sent by the frontend on any request is never trusted as authorization input.** For existing resources, the authoritative company comes from the database record; for creation, the target company is checked against the actor's memberships before the write.
- Cross-tenant access attempts return `403`/`404` (per [15-api-conventions.md](15-api-conventions.md#http-status-usage)) and are written to `audit_logs`.

## Server-side authorization

- Every mutation and every list/detail read re-checks authorization at request time — never relies on a prior check, a cached permission, or client-side route guarding.
- Frontend route/UI guards exist only for UX (hiding actions a user can't perform) and carry zero security weight on their own.

## Password & credential security

- Argon2id hashing with per-password salt and a server-side pepper (see [10-authentication-and-sessions.md](10-authentication-and-sessions.md)).
- No code path — including admin tooling, support scripts, or logs — ever exposes a plaintext password after its one-time display at creation/reset.
- Session tokens stored as hashes, never plaintext, mirroring password hygiene.

## Session security

- httpOnly, `Secure`, `SameSite=Lax` cookies; HTTPS-only transport.
- Individually revocable sessions; admin-triggered "log out everywhere."
- Rate limiting and lockout on login attempts (below).
- **Step-up reauthentication for the most sensitive operations** — a valid session alone is not sufficient authorization for triggering a manual database backup; see [10-authentication-and-sessions.md](10-authentication-and-sessions.md#reauthentication-for-sensitive-operations-approved-2026-09-14) and [ADR-0010](../decisions/0010-reauthentication-for-sensitive-operations.md).

## Rate limiting

- Login endpoint: per-IP and per-account limits with exponential backoff/lockout on repeated failures.
- Password-reset-triggering admin actions and backup-trigger endpoints: limited to prevent abuse even by an authenticated but compromised admin account (e.g., single-flight backup limit doubles as a rate limit).
- General API rate limiting at the reverse-proxy or middleware layer to blunt basic abuse/DoS attempts, sized for legitimate mobile-upload traffic patterns (many small control-plane calls during a large upload) so it never blocks normal use.

## Temporary/signed URLs

- File downloads: short-lived signed URLs scoped to a single object, minted only after a fresh authorization check.
- Upload presigned URLs: short TTL, single object key, single HTTP method, minted in small batches (see [07-upload-architecture.md](07-upload-architecture.md)).
- Backup downloads: protected, single-purpose, short-lived URL — never a permanent public link ([11-backup-and-recovery.md](11-backup-and-recovery.md)).

## File validation

- MIME type and extension allow-listed per upload context.
- Max size enforced server-side (admin-configurable), never trusting a client-reported size alone — the multipart completion step verifies actual transferred size against R2's object metadata.
- Uploads are authorized (company/folder/permission) before a session is created, and re-checked at part-request and completion time.

## Secrets management

- All secrets (database credentials, R2 access keys, VAPID keys, session pepper, SSH deploy key) live in environment variables / GitHub Secrets — never committed to the repository, never logged.
- Dedicated, minimally-scoped SSH key used only for deploy, distinct from any personal/admin SSH access to the VPS.
- `.env.example` documents required variables without real values.

## Protection against unauthorized file access

- No file is ever served from a public, guessable URL — the storage key includes a UUID (not the original filename) precisely to prevent enumeration, and R2 objects are private by default, accessible only via time-limited signed URLs issued after an authorization check.

## Protection against accidental or malicious deletion

- File and content deletion by a non-owner always goes through the request/approve/reject workflow ([06-permissions-and-authorization.md](06-permissions-and-authorization.md#deletion-request-workflow)) — never a direct delete.
- All deletions are soft deletes (`deleted_at`) at the database level, so an approved-but-mistaken deletion remains recoverable by an admin/operator, and so the audit trail of what existed is never destroyed.
- The database volume itself is never deleted or recreated by any deploy or migration automation ([11](11-backup-and-recovery.md#rules-that-apply-in-every-phase), [19](19-deployment-and-cicd.md#migrations)).

## Audited actions

Written to the append-only `audit_logs` table (in addition to each entity's own `created_by`/`updated_by`): login (success/failure), upload, file/content deletion request and its resolution, status changes, content creation, calendar changes, pending-request creation/completion, comments, campaign field changes, permission/role/membership changes, backup requests and downloads, and password reset/temp-password actions (which additionally get their own `password_reset_audits` record — [10-authentication-and-sessions.md](10-authentication-and-sessions.md)).

## Safe migrations

- Versioned migrations only, reviewed for destructive operations (dropped columns/tables) before merge.
- Migrations tested in a non-production environment first.
- A backup is taken immediately before any migration flagged as potentially destructive.
- No automatic destructive migration ever runs as part of the standard deploy pipeline without an explicit, separate, reviewed step.

## Safe deployment commands

- The CI/CD pipeline can update application code/images, restart services, and run controlled migrations.
- The CI/CD pipeline **can never**: run `docker compose down -v`, delete or recreate the PostgreSQL volume, or delete data to "fix" a failed deploy.
- The pipeline halts on any critical step failure rather than proceeding or auto-remediating destructively. Full detail: [19-deployment-and-cicd.md](19-deployment-and-cicd.md).

## Security testing

Covered in detail in [18-testing-strategy.md](18-testing-strategy.md): permission matrix tests per role, cross-tenant access attempts (must all fail), deletion-ownership validation, upload authorization boundary tests.
