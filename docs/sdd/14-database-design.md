# 14 — Database Design

This is a proposed schema to validate the domain model in [05-domain-model.md](05-domain-model.md) — not final migrations. Table/column names are illustrative and English per [15-api-conventions.md](15-api-conventions.md#naming); exact types are finalized when migrations are written (Stage 1 of [21-mvp-roadmap.md](21-mvp-roadmap.md)).

## Audit columns convention

Every table includes, unless noted otherwise:
- `id` — UUID primary key (avoids sequential-ID enumeration across tenants).
- `created_at`, `created_by` (nullable FK to `users`, null only for system-generated rows).
- `updated_at`, `updated_by` — present on any mutable table.
- `deleted_at` — present on tables subject to soft delete (`files`, `content`, and any table reachable by the deletion-request workflow).

Field-level history (who changed what, from what to what) is **not** duplicated on every table — it exists only where the source spec explicitly requires a change timeline (`campaign_history`) or a review trail (`deletion_requests`, `password_reset_audits`). Everything else relies on `updated_at`/`updated_by` plus the general `audit_logs` table for security-relevant events ([16-security-requirements.md](16-security-requirements.md#audited-actions)).

## Core tables

```text
users
  id, name, email (unique), password_hash, role (enum: agency_admin|agency_manager|client_manager|contributor),
  status (enum: active|inactive), must_change_password (bool), last_login_at,
  created_at, updated_at

companies
  id, name, logo_url, segment, responsible_name, email, phone,
  status (enum: active|archived), notes, created_at, updated_at, created_by

company_memberships
  id, user_id (FK users), company_id (FK companies), status (enum: active|revoked),
  can_manage_campaigns (bool, default false), can_delete_company_files (bool, default false),
  created_at, updated_at, created_by
  UNIQUE (user_id, company_id)

projects
  id, company_id (FK), name, code, type, description,
  status, start_date, end_date, notes,
  created_at, updated_at, created_by

folders
  id, company_id (FK), project_id (FK, nullable), parent_folder_id (FK folders, nullable),
  name, created_at, updated_at, created_by

files
  id, company_id (FK), project_id (FK, nullable), folder_id (FK, nullable),
  content_id (FK content, nullable), pending_request_id (FK pending_requests, nullable),
  original_name, mime_type, size_bytes, storage_key (unique),
  status (enum: received|in_review|editing|edit_complete|approved|archived),
  uploaded_by (FK users), uploaded_at, archived_at,
  deleted_at, created_at, updated_at

upload_sessions
  id, company_id (FK), folder_id (FK, nullable), project_id (FK, nullable),
  initiated_by (FK users), storage_key, original_name, mime_type,
  declared_size_bytes, max_allowed_size_bytes, provider_upload_id (R2 multipart upload id),
  status (enum: pending|in_progress|completed|aborted|expired),
  created_at, expires_at, completed_at

upload_parts
  id, upload_session_id (FK), part_number, etag, size_bytes, uploaded_at
  UNIQUE (upload_session_id, part_number)
```

## Calendar, production, publications

```text
content
  id, company_id (FK), project_id (FK, nullable), title, description,
  type (enum: video|image|carousel|story|reels|youtube_short|text|custom),
  scheduled_at, responsible_user_id (FK users), related_file_id (FK files, nullable),
  production_status (enum: planned|awaiting_material|in_production|in_review|approved|completed|cancelled),
  priority (enum: low|medium|high), notes,
  deleted_at, created_at, updated_at, created_by

publications
  id, content_id (FK), network (enum: instagram|facebook|tiktok|youtube_shorts),
  status (enum: not_planned|planned|scheduled|published|not_published|failed|cancelled),
  published_at, link, responsible_user_id (FK users), notes,
  created_at, updated_at
  UNIQUE (content_id, network)
```

## Requests, comments, topics

```text
pending_requests
  id, company_id (FK), project_id (FK, nullable), title, description,
  responsible_user_id (FK users), created_by (FK users), due_date, priority,
  status (enum: open|awaiting_client|answered|in_review|completed|cancelled),
  created_at, updated_at

comments
  id, company_id (FK), commentable_type (enum: company|project|file|content|pending_request),
  commentable_id (UUID), author_id (FK users), body, attachment_file_id (FK files, nullable),
  deleted_at, created_at, updated_at

topics
  id, company_id (FK), title, initial_message, creator_id (FK users),
  responsible_user_id (FK users), related_type (enum: project|content|campaign|pending_request|file, nullable),
  related_id (UUID, nullable), priority, due_date,
  status (enum: open|awaiting_response|in_review|resolved|cancelled),
  created_at, updated_at

topic_replies
  id, topic_id (FK), author_id (FK users), body, created_at

deletion_requests
  id, company_id (FK), target_type (enum: file|content), target_id (UUID),
  requested_by (FK users), reason,
  status (enum: pending|approved|rejected),
  reviewed_by (FK users, nullable), reviewed_at, review_notes,
  created_at
```

## Notifications & push

```text
notifications
  id, recipient_id (FK users), company_id (FK, nullable), type, title, message,
  actor_id (FK users, nullable), related_type, related_id (nullable),
  read_at, created_at

notification_preferences
  id, user_id (FK users), event_type, channel (enum: in_app|push), enabled (bool, default true)
  UNIQUE (user_id, event_type, channel)

push_devices
  id, user_id (FK users), endpoint, p256dh_key, auth_key, user_agent,
  enabled (bool), revoked_at, created_at, last_seen_at
```

## Campaigns

```text
ad_accounts
  id, company_id (FK), platform (enum: meta|tiktok), name, external_account_id,
  status, notes, created_at, updated_at, created_by

campaigns
  id, company_id (FK), ad_account_id (FK), platform, name, objective,
  status (enum: active|paused|ended|with_problem|awaiting_approval|needs_attention),
  daily_budget, total_budget, reported_spend, reported_balance,
  last_checked_at, visible_to_client (bool, default true),
  responsible_user_id (FK users), notes,
  created_at, updated_at, created_by

campaign_history
  id, campaign_id (FK), changed_by (FK users), field_name, old_value, new_value,
  note, created_at
```

## Platform tables

```text
sessions
  id, user_id (FK), session_token_hash (unique), ip_address, user_agent,
  created_at, last_active_at, expires_at, revoked_at

password_reset_audits
  id, target_user_id (FK), performed_by (FK users), action (enum: temp_password_generated|password_reset),
  created_at

audit_logs
  id, actor_id (FK users, nullable), company_id (FK, nullable), action, entity_type,
  entity_id (nullable), metadata (JSONB), ip_address, created_at

backup_jobs
  id, requested_by (FK users), status (enum: queued|processing|completed|failed),
  file_name, file_size_bytes, storage_path, error_message,
  started_at, completed_at, expires_at, created_at

branding_settings
  id, logo_url, favicon_url, app_name, primary_color, secondary_color,
  login_image_url, login_message, updated_by (FK users), updated_at
  -- single global row in Phase 1 (confirmed 2026-09-14); per-company branding is postponed, not planned as a near-term follow-up
```

## Indexing strategy

- Every foreign key gets an index (Postgres does not create one automatically for FKs).
- Composite indexes on the columns every list screen filters by: `(company_id, status)`, `(company_id, created_at desc)` for recency-ordered lists, `(company_id, project_id)` where projects scope a list.
- `content(company_id, scheduled_at)` for calendar range queries.
- `notifications(recipient_id, read_at)` for the unread-count query, which runs on nearly every page load.
- `files(company_id, folder_id, status)` for the primary file-browser query.
- Partial indexes on soft-deletable tables (`WHERE deleted_at IS NULL`) to keep the common-case index small and fast.
- Unique constraints double as indexes where noted above (`(upload_session_id, part_number)`, `(content_id, network)`, etc.).

## Tenant-scope audit

Every table from [Core tables](#core-tables) through [Platform tables](#platform-tables), and its scoping key:

| Table | Scope | Notes |
|---|---|---|
| `users` | Global | Identity only; access to a company comes exclusively via `company_memberships` |
| `companies` | Is the tenant | — |
| `company_memberships` | `company_id` direct | The access-granting join table itself |
| `projects`, `folders`, `files`, `upload_sessions`, `upload_parts` | `company_id` direct | `upload_parts` via its parent `upload_sessions.company_id` |
| `content`, `publications` | `company_id` direct / via `content` | `publications` via `content.company_id` |
| `pending_requests`, `comments`, `topics`, `topic_replies`, `deletion_requests` | `company_id` direct / via parent | `topic_replies` via `topics.company_id` |
| `notifications` | `company_id` (nullable) | Null only for account-level notifications with no company context (rare in Phase 1); every event-driven notification is created with a company |
| `notification_preferences`, `push_devices` | Global (per-user) | Not tenant data — a preference/device belongs to the user, not a company; the *content* delivered through them is scoped at send time (see [08-notifications-and-push.md](08-notifications-and-push.md#recipient-resolution-rules)) |
| `ad_accounts`, `campaigns`, `campaign_history` | `company_id` direct / via `campaigns` | — |
| `sessions`, `password_reset_audits` | Global (per-user) | Authentication is not a tenant concept |
| `audit_logs` | `company_id` (nullable) | Null only for platform-level events with no single company (e.g., a failed login before any company context exists) |
| `backup_jobs` | Global, `agency_admin`-only | Backups are whole-database, not per-tenant — access is gated by role, not by company scope |
| `branding_settings` | Global singleton | Deliberately not tenant-scoped in Phase 1 — see [23-open-questions.md](23-open-questions.md) |

Every row above with a `company_id` gets an RLS policy per [below](#row-level-security-defense-in-depth-and-how-prisma-must-use-it). Rows with no `company_id` are, by construction, not reachable through a tenant-scoped query path — their authorization is role-based (checked in application code) rather than tenant-based.

## Row-Level Security (defense-in-depth) — and how Prisma must use it

Every tenant-owned table gets an RLS policy of the shape:

```sql
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON files
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR company_id = ANY (current_setting('app.current_company_ids', true)::uuid[])
  );
```

The `app.bypass_rls` escape hatch is set only for an authenticated `agency_admin` request (never from client input — it's derived from the already-authorized actor, exactly like `app.current_company_ids`); every other actor relies solely on the company-list check.

### The Prisma connection-pooling problem

Prisma maintains a connection pool and does not guarantee that two sequential calls on the top-level `prisma` client run on the same physical connection. PostgreSQL session-scoped settings (a plain `SET app.current_company_ids = ...`, without `LOCAL`) live on the **connection**, not the logical request. If the application did a plain `SET` and then returned the connection to the pool, a **later, unrelated request from a different tenant could reuse that same connection and inherit the previous tenant's RLS context** — a real, silent cross-tenant leak, and exactly the class of bug RLS exists to catch, not cause.

### Required pattern: a transaction-scoped session setting, applied inside a Prisma interactive transaction

Every tenant-scoped request **must** run its Prisma calls through an interactive transaction that sets the RLS context with `set_config(name, value, is_local = true)` — the `true` third argument makes the setting automatically revert at transaction end, regardless of commit or rollback, so it can never leak onto the pooled connection for the next request:

```ts
async function withTenantScope<T>(
  actor: AuthenticatedActor,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    if (actor.role === 'agency_admin') {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
    } else {
      await tx.$executeRaw`SELECT set_config('app.current_company_ids', ${actor.companyIdsCsv}, true)`;
    }
    return fn(tx);
  });
}
```

- This is wired in as shared request middleware (`shared/tenant-scope.ts` per [13-technical-architecture.md](13-technical-architecture.md#code-organization)), not something each route author remembers to call — a route handler receives an already-scoped `tx` client, never the raw `prisma` singleton.
- **Hard rule:** no module handling a tenant-owned table imports the top-level `prisma` client directly inside a request handler. Code review and, ideally, a lint rule enforce this — the only legitimate direct uses of the raw client are the tenant-scope middleware itself and genuinely global queries (e.g., looking up a user by email at login, before any tenant context exists).
- **Trade-off accepted:** wrapping every request in an interactive transaction holds a pooled connection for the request's full duration instead of releasing it between queries. This requires the Prisma connection pool size (`connection_limit` in `DATABASE_URL`) to be sized for concurrent *requests*, not just concurrent *queries* — validated under realistic concurrency as part of Stage 3 of [21-mvp-roadmap.md](21-mvp-roadmap.md), before that stage is considered done.
- Application-layer authorization ([06-permissions-and-authorization.md](06-permissions-and-authorization.md)) is still the primary control; RLS is the second, independent layer so an application-code bug (a forgotten `WHERE company_id = ...`) cannot silently leak rows across tenants even if it ships.

## Migrations

Managed via Prisma Migrate (or an equivalent versioned migration tool — see [ADR](../decisions/README.md)); every migration is reviewed for destructive operations (dropped columns/tables) per [19-deployment-and-cicd.md](19-deployment-and-cicd.md#migrations). No migration is written as part of this SDD stage — this document is the pre-implementation proposal it will be built from.
