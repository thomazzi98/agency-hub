# Implementation Progress

Continuity log for the staged implementation of the MVP
([docs/sdd/21-mvp-roadmap.md](sdd/21-mvp-roadmap.md)). A new session should read
this file **first**, then confirm the described state against the code (run the
validation commands below) before writing anything.

Format: one section per stage, newest work appended. Decisions taken
autonomously during implementation are recorded here when they do not warrant a
full ADR; anything architectural gets an ADR in [docs/decisions/](decisions/).

---

## Validation commands

Run from the repository root:

```bash
docker compose up -d postgres   # integration tests need a live database
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
docker compose config           # compose file validity
docker compose up -d --build    # full stack: postgres + migrate + api

npm run test:e2e                # Playwright, desktop + mobile viewports
```

The E2E suite drops and recreates the database named by `E2E_DATABASE_URL` and
starts its own API (port 3101) and web server (port 5273), so it never touches the
development database or collides with a running dev stack.

---

## Stage 0 — Project scaffolding ✅

**Status:** complete (commit `122ba54`), re-verified 2026-09-14.

Monorepo with npm workspaces, Fastify API with `/health`, React + Vite web app,
shared TypeScript/ESLint/Prettier config, `docker-compose.yml`, GitHub Actions CI.

**Verified 2026-09-14:** `npm run lint`, `npm run typecheck`, `npm test`,
`npm run build` all pass on a clean checkout.

---

## Stage 1 — Database schema & migrations baseline ✅

**Status:** complete, validated 2026-09-14.

### Delivered

- **Prisma** (`6.19.3`) added to `apps/api`; schema at
  [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma) with the three
  Stage 1 tables from [14-database-design.md](sdd/14-database-design.md):
  `users`, `companies`, `company_memberships` (+ enums `user_role`, `user_status`,
  `company_status`, `membership_status`). Later stages add their own tables
  incrementally, per the roadmap.
- **Migration** `20260914042058_stage1_users_companies_memberships`, with a
  hand-reviewed `down.sql` beside Prisma's generated `migration.sql`.
- **Rollback tooling:** [apps/api/scripts/migrate-down.mjs](../apps/api/scripts/migrate-down.mjs)
  (`npm run db:migrate:down --workspace=@agency-hub/api`) applies the newest
  applied migration's `down.sql` inside a transaction and removes its
  `_prisma_migrations` row, so `migrate deploy` re-applies it cleanly.
- **DB client wrapper:** [apps/api/src/shared/db.ts](../apps/api/src/shared/db.ts)
  — lazy singleton + injectable factory (tests inject a client bound to the test
  database). Decorated onto Fastify as `app.prisma`.
- **Readiness probe:** `GET /health/ready` runs `SELECT 1` and returns 503 when
  the database is unreachable; wired as the `api` container healthcheck.
- **Test infrastructure:** vitest `globalSetup` drops/recreates the test database
  and runs `migrate deploy`; `setupFiles` points `DATABASE_URL` at it. Helpers in
  `apps/api/test/helpers/`. `fileParallelism: false` because integration tests
  share one database.
- **CI:** `build-and-test` now runs a `postgres:16-alpine` service with
  `DATABASE_URL` / `TEST_DATABASE_URL` set.
- **Docker:** `migrate` one-shot service runs `prisma migrate deploy` before `api`
  starts (`service_completed_successfully`); Dockerfile copies the Prisma schema
  before `npm ci` so the workspace `postinstall` can generate the client.

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| UUID PKs via Postgres `gen_random_uuid()` (`dbgenerated`), not Prisma-side generation | Rows inserted by raw SQL, seeds, or migrations get IDs identically to Prisma-inserted rows; `gen_random_uuid()` is built into Postgres 13+, no extension needed. |
| All timestamps `timestamptz(6)` | A naive timestamp is unrecoverable once written; Prisma's default is `timestamp(3)`. |
| `onDelete: Restrict` on every FK | The product soft-deletes and archives ([16-security-requirements.md](sdd/16-security-requirements.md)); an accidental cascade is exactly the data loss that document forbids. |
| Emails stored lower-cased/trimmed by the application, with a plain unique index | Effectively case-insensitive uniqueness without a functional index or `citext`. Enforced in the application layer from Stage 2 onward. |
| Business API routes will be mounted under `/api`; `/health*` stays at the root | Keeps ops probes outside the response envelope ([15-api-conventions.md](sdd/15-api-conventions.md)) and makes the Caddy config trivial in Stage 15 (SPA at `/`, proxy `/api/*`). SDD paths (`/companies`, `/auth/login`) are preserved relative to that prefix. |
| Down migrations are hand-written `down.sql` files per migration directory | Prisma Migrate has no native rollback, but [19-deployment-and-cicd.md](sdd/19-deployment-and-cicd.md) requires reversibility. Generated with `prisma migrate diff` and reviewed. |
| Test databases must contain `_test` in their name (enforced in code) | The test setup drops databases; this guard is the only thing between a misconfigured env var and a dropped real database. |
| `dotenv` loads a single root `.env` for every workspace | One file to copy from `.env.example`; never overrides variables already in the environment, so containers and CI are unaffected. |

No `docs/sdd/23-open-questions.md` items were closed by this stage.

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | pass |
| Typecheck | `npm run typecheck` | pass |
| Tests | `npm test` | 9 passed / 3 files |
| Build | `npm run build` | pass |
| Formatting | `npm run format:check` | pass |
| Migration up → down → up on a fresh scratch database | `apps/api/test/integration/migrations.test.ts` | pass |
| Full Docker stack | `docker compose up -d --build` | `migrate` exits 0, `api` healthy, `GET /health/ready` → `{"status":"ok","database":"ok"}` |

**What would invalidate this:** any change to `apps/api/prisma/schema.prisma`
(requires a new migration *and* its `down.sql`), to `shared/db.ts`, or to the
test setup files.

---

## Stage 2 — Authentication & sessions ✅

**Status:** complete, validated 2026-09-14.

### Delivered — backend

- **Migration** `20260914043630_stage2_sessions_and_auth_audit` (+ `down.sql`):
  `sessions`, `password_reset_audits`, `audit_logs`, `login_attempts`, plus
  `users.failed_login_attempts` / `users.locked_until`.
- **Password hashing** ([password.ts](../apps/api/src/modules/auth/password.ts)):
  Argon2id via `@node-rs/argon2` with the ADR-0009 parameters (19 MiB / 2 / 1) and a
  server-side pepper passed as Argon2's `secret`, all configuration-driven.
- **Sessions** ([session-service.ts](../apps/api/src/modules/auth/session-service.ts)):
  opaque 32-byte token in an httpOnly / `SameSite=Lax` cookie, SHA-256 of the token
  stored, 7-day sliding expiry capped at 30 days since login, individually revocable.
- **Endpoints:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`,
  `POST /api/auth/change-password`, `POST /api/auth/reauthenticate`,
  `GET /api/sessions`, `DELETE /api/sessions/:id`, `POST /api/sessions/revoke-all`.
- **Authentication middleware** ([authentication.ts](../apps/api/src/shared/authentication.ts)):
  registered once for the whole `/api` scope; routes opt out via
  `config.isPublic` / `config.allowWhilePasswordChangePending`.
- **Error envelope** ([errors.ts](../apps/api/src/shared/errors.ts)) matching
  [15-api-conventions.md](sdd/15-api-conventions.md), with a catch-all that never
  leaks internals.
- **Bootstrap seed:** `npm run db:seed --workspace=@agency-hub/api` creates the first
  `agency_admin` and prints its password exactly once; re-running is a no-op.

### Delivered — frontend

Tailwind CSS v4, TanStack Query, React Router, a pt-BR strings layer
([strings.ts](../apps/web/src/lib/strings.ts)), a shared UI kit
([ui.tsx](../apps/web/src/components/ui.tsx)) implementing the required
loading/empty/error/success/confirm states, and the real screens: login, forced
password change, home, active sessions. Every screen calls the real API — the Vite
dev server proxies `/api`, so the session cookie is same-origin in development
exactly as it is behind Caddy in production.

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| `login_attempts` is its own table, not a query over `audit_logs` | An audit retention policy must never be able to weaken a security control. |
| Per-account lockout state lives on `users` (`failed_login_attempts`, `locked_until`) | Consecutive-failure counting with exponential backoff needs a counter, not a scan; it is read on the same row the login already loads. |
| An unknown email still pays for a real Argon2 verification against a throwaway hash | Otherwise response time distinguishes "no such account" from "wrong password", which is account enumeration. |
| Changing a password revokes every **other** session, keeping the current one | A password change is also the remedy for a suspected compromise; bouncing the user who just changed it would be hostile. |
| Password minimum length: 10 characters (`PASSWORD_MIN_LENGTH`) | The SDD sets no number; 10 is above the OWASP floor of 8 and configurable. |
| Frontend dev talks to the API through the Vite proxy rather than CORS | Keeps the cookie same-origin in development exactly as in production, so `SameSite` behaviour is never environment-specific. |
| E2E fixture accounts are scoped per Playwright project (`desktop` / `mobile`) | Several flows mutate accounts irreversibly; sharing them would make the mobile run depend on the desktop run not having happened. |
| Session cookie `Secure` flag defaults from `NODE_ENV` rather than a literal | An insecure cookie must be impossible in production, but a developer on plain http needs it off. |

### Carried into Stage 3 — RLS blocker found during this stage

`POSTGRES_USER` in `docker-compose.yml` is the database superuser, and **PostgreSQL
always bypasses Row-Level Security for superusers and table owners** (the latter
unless `FORCE ROW LEVEL SECURITY` is set). If the API keeps connecting as that role,
the RLS policies required by
[14-database-design.md](sdd/14-database-design.md#row-level-security-defense-in-depth-and-how-prisma-must-use-it)
would exist but never apply — a defence-in-depth layer that silently does nothing.

**Stage 3 must therefore:** create a dedicated non-superuser, non-owner application
role, grant it only DML on the application tables, point `DATABASE_URL` at it
(migrations continue to run as the owner), and add a test that proves RLS actually
blocks a cross-tenant read for that role.

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | pass (api, web, e2e) |
| Unit + integration | `npm test` | 48 passed / 6 files |
| End-to-end (desktop + mobile viewport) | `npm run test:e2e` | 16 passed / 2 projects |
| Formatting | `npm run format:check` | pass |
| Migration up → down → up (both migrations) | `apps/api/test/integration/migrations.test.ts` | pass |
| Manual login flow against the running API | `curl` against `localhost:3000` | cookie flags correct; `password_change_required` gate returns 403 |

**What would invalidate this:** changes to `shared/authentication.ts`, `errors.ts`,
the session service, the Prisma schema, or the `/api` route registration.

---

## Stage 3 - Companies, users, roles, and tenant isolation (done)

**Status:** complete, validated 2026-09-14. The roadmap flags this as the
highest-consequence stage in the project; it took three commits.

### The RLS blocker found in Stage 2, resolved

PostgreSQL ignores every RLS policy for a superuser and for a table owner, and the
Postgres image creates `POSTGRES_USER` as a superuser. Written as specified, the
policies would have existed and never applied.

- The application now connects as **`agency_hub_app`**: `NOSUPERUSER`,
  `NOBYPASSRLS`, owns nothing, holds only DML privileges, and cannot run DDL.
  Created by [provision-app-role.mjs](../apps/api/scripts/provision-app-role.mjs)
  from the credentials already in `DATABASE_URL`.
- Migrations, test-database creation, and rollback use the **owner** role instead,
  resolved by swapping credentials via `DB_OWNER_USER` / `DB_OWNER_PASSWORD`
  ([database-url.mjs](../apps/api/scripts/database-url.mjs)).
- The API **refuses to start** if its role is a superuser or carries BYPASSRLS
  (`assertLeastPrivilegeDatabaseRole`), because that misconfiguration has no symptom
  until it is a cross-tenant leak.

### Delivered

- **Migration** `20260914060000_stage3_row_level_security` (+ `down.sql`): RLS on
  `companies`, `company_memberships`, and `audit_logs`, with two SQL helper functions
  (`app_bypass_rls()`, `app_current_company_ids()`). `audit_logs` gets SELECT and
  INSERT policies **only**, so UPDATE and DELETE are denied by the database - the
  table is append-only in fact, not by convention.
- **[tenant-scope.ts](../apps/api/src/shared/tenant-scope.ts):** `withTenantScope`,
  `withSystemScope`, and the `tenantScoped()` route wrapper that hands a handler an
  already-scoped client, exactly as [14-database-design.md](sdd/14-database-design.md)
  requires. Route authors never touch `app.prisma`.
- **[permissions.ts](../apps/api/src/shared/permissions.ts)** and
  **[pagination.ts](../apps/api/src/shared/pagination.ts)** (page/pageSize with a
  server-enforced max, and an allow-list for sortable columns).
- **Modules:** `companies` (list/detail/create/edit/archive/restore),
  `users` (list/detail/create/edit/reset-password), `memberships`
  (list/grant/update/revoke).
- **Frontend:** companies list + form, users list + form, per-membership permission
  toggles, one-time temporary-password dialog, admin-only navigation and route guard.
- **E2E:** [administration.spec.ts](../e2e/tests/administration.spec.ts) covering the
  company lifecycle, the admin-only guard, user creation with the one-time password,
  and membership grant/override/revoke - on desktop and mobile viewports.

### Bugs the tests caught (both looked correct while reading)

1. **A scoped handler that called `reply.send()` replied before its transaction
   committed** - a client could be told a write succeeded and then not see it on the
   next request, or be told it succeeded when the commit later failed. Handlers now
   return their payload and set the status with `reply.code()`; `tenantScoped` throws
   if a handler sends inside the transaction.
2. **The company lookup spread the scope filter over the id filter**
   (`{ id, ...{ id: { in: scope } } }`), dropping the requested id and returning
   whichever company the actor could reach. Now an explicit `AND`.

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| Two database roles (owner for DDL, app role for runtime) rather than one owner with `FORCE ROW LEVEL SECURITY` | One role would also let application code run DDL. Two roles cost three environment variables and remove that entire class of blast radius. |
| Cross-tenant reads return `404` with a body byte-identical to a never-existing id | A `403` would confirm the id belongs to a real company in another tenant. Role-based denials (e.g. a contributor creating a company) still return `403`. |
| Revoking a membership or deactivating a user drops that user's sessions immediately | "Access is removed at once" and "access is removed when the session happens to expire" are very different promises; the spec asks for the first. |
| Re-granting a revoked membership reactivates the existing row | Keeps the unique `(user, company)` pair and the row's history intact instead of creating a second record of the same relationship. |
| An admin cannot change their own role or deactivate themselves (`422`) | That is how an installation ends up with no reachable administrator, and there is no recovery path through the product. |
| Company list defaults to `status=active` | Archiving must hide a company from active lists ([03-functional-requirements.md](sdd/03-functional-requirements.md#companies)); `?status=archived` and `?status=all` remain available. |
| `LOGIN_IP_MAX_ATTEMPTS_PER_HOUR` is raised for the E2E API only | Every browser in the suite shares one loopback address. The limit itself is proven by the integration suite, which controls the source IP per case. |

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | pass (api, web, e2e) |
| Unit + integration | `npm test` | 91 passed / 8 files |
| RLS behaviour | `apps/api/test/integration/rls.test.ts` | 11 passed - includes 24 concurrent scoped transactions never leaking a tenant context across the pool, a known company id invisible from outside its tenant, the role being unable to run DDL, and `audit_logs` refusing UPDATE/DELETE even under the bypass |
| Cross-tenant + permission matrix | `apps/api/test/integration/tenant-isolation.test.ts` | 32 passed across all four roles |
| End-to-end (desktop + mobile) | `npm run test:e2e` | 26 passed / 2 projects |
| Clean bootstrap from an empty volume | `docker compose up -d --build` | role provisioned, 3 migrations applied, `api` healthy |

**Still open from the roadmap:** the connection-pool load test under realistic
concurrency ([23-open-questions.md](sdd/23-open-questions.md) item 8). The RLS
concurrency test exercises 24 simultaneous scoped transactions against a pool of 10
without exhaustion, which is evidence but not the load test the roadmap asks for.

**What would invalidate this:** changes to `tenant-scope.ts`, `permissions.ts`, the
RLS migration, the provisioning script, or any new tenant-owned table (which needs
its own RLS policy **and** a cross-tenant test).

---

## Stage 4 - Branding settings (done)

**Status:** complete, validated 2026-09-14.

### Scope decision (recorded from the Stage 3 checkpoint)

The roadmap allowed resequencing Stage 4 after Stage 6 so branding assets could reuse
the real upload system. **Taken now, with asset URLs instead of asset upload:** the
theming plumbing is worth having early, and a second, throwaway upload path would be
pure duplication. `logoUrl`, `faviconUrl`, and `loginImageUrl` accept plain links
today; Stage 6 adds an upload control that fills those same fields, so neither the
schema nor the API contract changes then.

### Delivered

- **Migration** `20260914054940_stage4_branding_settings` (+ `down.sql`): the
  `branding_settings` table, seeded with the default brand, and a
  `CREATE UNIQUE INDEX ... ((true))` that lets the database hold exactly one row.
- **[contrast.ts](../apps/api/src/modules/branding/contrast.ts):** WCAG 2.1 relative
  luminance and contrast ratio. A brand colour becomes the background of primary
  buttons and dark surfaces, both carrying white text, so a colour below WCAG AA
  (4.5:1) is refused with `422 insufficient_contrast` and a message naming the
  measured ratio - rejected loudly rather than substituted silently.
- **Endpoints:** `GET /api/branding` (**public** - the login screen renders the brand
  before anyone authenticates) and `PATCH /api/branding` (`agency_admin` only).
- **Frontend:** `BrandingProvider` overrides the CSS custom properties Tailwind's
  utilities already read, so a colour change lands everywhere at once with no rebuild
  and no second styling pathway; app name drives `document.title`; the login screen
  and header show the logo or the brand name; `/identidade-visual` is the admin
  screen, with a live preview and a contrast warning that disables Save before the
  server has to refuse it.

### Open question #6 resolved (branding asset limits)

[23-open-questions.md](sdd/23-open-questions.md) item 6 asked for concrete asset
constraints before Stage 4. Decided, to be enforced by the upload path in Stage 6:

| Asset | Max size | Accepted formats |
|---|---|---|
| Logo | 2 MB | SVG, PNG, WebP |
| Favicon | 256 KB | PNG, ICO |
| Login image | 4 MB | JPEG, PNG, WebP |

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| The one-row invariant is a unique index on a constant expression, not a convention | A rule only application code respects is one careless insert away from two brands. |
| An inaccessible colour is rejected with `422`, not silently replaced by a safe default | The spec forbids saving it *silently*; a substitution the admin did not ask for is its own surprise. Refusing names the measured ratio so they can judge how far off they are. |
| `updated_at` now carries a database default alongside Prisma's `@updatedAt` | `@updatedAt` is maintained by the client, so the migration's own seed INSERT hit a NOT NULL with no default. The up/down test caught it. |
| The test reset preserves and re-seeds `branding_settings` instead of deleting it | Deleting it would break the one-row invariant the database enforces; its `updated_by` reference also has to be cleared before users can be deleted. |
| The frontend duplicates the contrast maths (`apps/web/src/lib/color.ts`) | So Save is disabled before a round-trip. The server check remains authoritative and is tested independently. |

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | pass (api, web, e2e) |
| Unit + integration | `npm test` | 117 passed / 10 files |
| Contrast maths | `apps/api/test/unit/contrast.test.ts` | 15 passed, including the WCAG reference values (black on white is 21:1) |
| Branding API | `apps/api/test/integration/branding.test.ts` | 11 passed - public read, admin-only write for all three non-admin roles, contrast refusal, singleton preserved |
| End-to-end (desktop + mobile) | `npm run test:e2e` | 32 passed / 2 projects |

**A mobile layout bug the E2E caught:** the "encerrar as outras sessões" bulk action
sat below the session list, so on a phone a dozen sessions pushed it under other
content and it could not be clicked. It now sits beside the heading.

**What would invalidate this:** changes to the branding migration, `contrast.ts`, or
`BrandingProvider`.

---

## Stage 5 - Projects and folders (done)

**Status:** complete, validated 2026-09-14.

### Delivered

- **Migration** `20260914060146_stage5_projects_and_folders` (+ `down.sql`): the
  `projects` and `folders` tables, **their RLS policies in the same migration**, and a
  `UNIQUE ... NULLS NOT DISTINCT` index on
  `(company_id, project_id, parent_folder_id, lower(name))` so two folders cannot share
  a name in the same place - `NULLS NOT DISTINCT` is what makes that hold at the
  company root, where both project and parent are NULL.
- **`modules/projects`:** list (company/status/type/search filters, paginated), detail,
  create, update. A `companyId` in the query picks *which* authorized company to look
  at and is checked against the actor's set; it is never the scope itself.
- **`modules/folders`:** list (by company, project, or parent; `parentFolderId=root`
  for top level), detail, create, rename/move, delete. Cycle detection walks the
  ancestor chain inside the same transaction as the write, because Postgres will not
  catch a folder moved under its own descendant.
- **Frontend:** projects list and form, and a folder browser with breadcrumb
  navigation, inline rename, and delete.

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| `client_manager` cannot create or edit projects | The matrix shows "🔶 (rare; default ❌)", but the only membership overrides the data model carries are campaigns and file deletion ([23-open-questions.md](sdd/23-open-questions.md) #9), so the default applies. |
| Project status enum: `planned / active / paused / completed / archived` | The spec names a status field without enumerating it; these are the states an agency actually tracks, and `archived` matches the company-archival vocabulary already in use. |
| A folder is deletable only when empty, and by its creator or an agency role | Files inside follow the deletion-request workflow instead, so a folder never takes files down with it. |
| Folder names are unique case-insensitively within a place | Two folders called "Contratos" and "contratos" side by side are indistinguishable to a user. |
| `ON DELETE RESTRICT` from folders to projects | Archiving a project must not touch its folders, and nothing in the product deletes a project. |

### Three real UI bugs the E2E suite caught

1. **The navigation row could not wrap or scroll.** With seven sections it overflowed
   a 393 px phone, so mobile Chrome zoomed the whole page out by 1.44x - which also
   made buttons below the fold unclickable. The nav is now a horizontally scrollable
   strip: the one place sideways scrolling is the right answer. This was a real
   violation of the no-horizontal-scroll rule in
   [12-ui-ux-guidelines.md](sdd/12-ui-ux-guidelines.md#mobile-first), not a test artifact.
2. **`height: 100%` on `html`/`body`** capped the document at the viewport while the
   content overflowed it, breaking scroll-into-view on a phone.
3. **Form controls did not shrink.** An `<input>`'s intrinsic width is its min-content
   width and grid/flex items default to `min-width: auto`, so a bare input widened its
   track past the viewport. Controls now carry `w-full` inside a `min-w-0` wrapper.

Also fixed while there: the "new folder" field is locked while a create is in flight,
because it is cleared on success and would otherwise silently discard whatever the
user typed meanwhile; and a user with no company now sees a visible message rather
than a disabled dropdown whose only `<option>` explains the problem.

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | pass (api, web, e2e) |
| Unit + integration | `npm test` | 141 passed / 11 files |
| Projects and folders, including cross-tenant | `apps/api/test/integration/projects-folders.test.ts` | 24 passed |
| End-to-end (desktop + mobile) | `npm run test:e2e` | 44 passed / 2 projects |
| Migration up → down → up (all five) | `apps/api/test/integration/migrations.test.ts` | pass |

**What would invalidate this:** changes to the folder placement/cycle checks, the
uniqueness index, or the shared form controls in `apps/web/src/components/ui.tsx`.

---

## Stage 6 - Upload architecture (mostly done; one acceptance item cannot be done here)

**Status:** implemented and validated in automated tests, 2026-09-14. **Not signed
off**, because the roadmap's acceptance criteria include a real-device validation pass
that cannot be performed from this environment - see [What is not done](#stage-6--what-is-not-done) below.

### Delivered

- **Migration** `20260914063524_stage6_files_uploads_deletion_requests` (+ `down.sql`):
  `files`, `upload_sessions`, `upload_parts`, `deletion_requests`, their RLS policies,
  a partial index for the live-files query, and a partial unique index allowing one
  pending deletion request per target.
- **Storage layer** ([storage.ts](../apps/api/src/shared/storage.ts)) over the S3 API:
  MinIO in development and tests, Cloudflare R2 in production, with nothing in the code
  branching on which is behind `STORAGE_ENDPOINT`.
- **Control plane** ([uploads](../apps/api/src/modules/uploads/routes.ts)): the six
  endpoints from the spec plus `GET /uploads/config`, which hands the browser the same
  limits the server enforces so it can split the file and refuse a bad one without a
  round-trip.
- **Files** ([files](../apps/api/src/modules/files/routes.ts)): list/detail/status,
  short-lived signed downloads, soft delete.
- **Deletion requests** ([deletion-requests](../apps/api/src/modules/deletion-requests/routes.ts)):
  request, approve, reject - `agency_admin` only for review.
- **Worker** ([worker.ts](../apps/api/src/worker.ts)) running pg-boss with the hourly
  abandoned-upload cleanup, as its own container so a heavy job never competes with
  request handling.
- **Frontend:** an Uppy-driven uploader with per-file progress, pause, resume and
  cancel; the merged files-and-folders screen; the admin deletion-request queue.
- **Branding asset upload** (the item Stage 4 deferred): logo, favicon and login image,
  with the limits recorded in Stage 4.
- **[configure-storage-bucket.mjs](../apps/api/scripts/configure-storage-bucket.mjs):**
  bucket CORS (the browser PUTs directly, and `ETag` must be an exposed header or
  multipart completion has nothing to assemble from) and the 7-day
  abort-incomplete-multipart lifecycle rule.

### Bugs found by the tests

1. **The uploader destroyed and rebuilt Uppy mid-transfer.** `onUploaded` was a
   dependency of the effect owning the Uppy instance and changed identity on every
   parent render, abandoning every part in flight. This would have broken real uploads,
   not just tests; the E2E suite surfaced it as an intermittent failure.
2. **Files chosen before Uppy finished initializing were silently dropped.** They are
   now held and flushed on ready.
3. **A branding asset path failed its own validation.** The upload endpoint produced
   `/api/branding/assets/...` while the update schema demanded an absolute URL, so
   re-saving the form rejected a value the server had just written.

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| MinIO in `docker-compose.yml` for development and tests | No R2 credentials are needed to run or test the upload path, and the same S3 API code serves both. The test setup refuses any endpoint on `r2.cloudflarestorage.com` and requires a bucket name containing `test`, because `.env` holds real R2 credentials. |
| `multiScoped` for handlers that call storage between database steps | One scoped transaction per step instead of one held open across a network call. The pool is sized for concurrent requests, not concurrent waits (ADR-0011). |
| Part registration failures are swallowed on the client | The `upload_parts` table is a performance cache; completion reconciles against the provider's own `ListParts`, so correctness never depends on that call arriving. |
| `uploadPartBytes` is hand-written | Uppy v4 exposes no per-part completion hook, and only XHR reports upload progress - on a slow connection that is the difference between a visible transfer and a frozen bar. |
| Branding assets **do** pass through the API | The no-bytes-through-the-backend rule targets the 30 GB media path. A logo needs a *stable, public* URL, which a short-lived signed URL cannot be, and bucket objects are private. They are capped at 2 MB / 256 KB / 4 MB and served with `immutable` cache headers against a UUID key. |
| The cleanup job treats "already gone at the provider" as success | A lifecycle rule or a partial previous run must not leave the row retrying forever. |
| Completion requires every expected part | `ListParts` returning fewer parts than the declared size needs means the upload is genuinely incomplete; assembling it anyway would produce a truncated file that looks fine. |

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | pass |
| Unit + integration | `npm test` | 192 passed / 14 files |
| Upload control plane against real storage | `apps/api/test/integration/uploads.test.ts` | 19 passed - single-part and multi-part uploads of real bytes to MinIO, idempotent completion, refusal to complete while parts are missing, resume reconciled from the provider when the register call never arrived, abort actually releasing provider-side parts, and cross-tenant denial on every endpoint |
| Files and deletion workflow | `apps/api/test/integration/files.test.ts` | 21 passed |
| Cleanup job | `apps/api/test/integration/cleanup-job.test.ts` | 5 passed, including a real provider-side part being released |
| Branding assets | `apps/api/test/integration/branding.test.ts` | 15 passed |
| End-to-end (desktop + mobile) | `npm run test:e2e` | 54 passed - includes a real browser upload, a genuinely multipart one, a signed download URL that serves the right bytes and does not point at the API, and the full request-then-approve deletion path |

### Stage 6 - what is not done

1. **The real-device validation pass**
   ([07-upload-architecture.md](sdd/07-upload-architecture.md#validation-plan-real-devices-and-unstable-networks),
   [23-open-questions.md](sdd/23-open-questions.md) item 7) has **not** run. It requires
   physical Android and iOS devices on real mobile data, including a genuinely unstable
   connection, and files up to ~30 GB. None of that is possible from this environment.
   **The 16 MiB chunk size and the concurrency defaults therefore remain documented
   initial configuration, not measured optima** - which is exactly the status the spec
   assigns them until this pass runs. Every one of those numbers is an environment
   variable, so adjusting them after the pass needs no code change.
2. **The bucket CORS and lifecycle rules have not been applied to the real R2 bucket.**
   The script exists and was exercised against MinIO, which reports that it implements
   neither (it allows all origins and rejects an abort-only lifecycle rule). Running it
   against production R2 changes a live resource, so it needs an explicit decision:
   `npm run storage:configure --workspace=@agency-hub/api -- --origin https://your-domain`
   with `STORAGE_*` pointed at R2. **Direct browser uploads to R2 will fail without the
   CORS rule.**
3. **Deletion requests for `content` targets** return `unsupported_target` until Stage 8
   creates the `content` table. The enum value and the whole workflow already exist, so
   that stage only has to resolve the target.

---

## Stage 7 - Notes, comments, and follow-up topics (done)

**Status:** complete, validated 2026-09-14.

### Delivered

- **Migration** `stage7_comments_and_topics` (+ `down.sql`): `comments`, `topics`,
  `topic_replies`, their RLS policies (`topic_replies` follows its topic, having no
  `company_id` of its own), and a partial index for the live-comments thread.
- **[comments](../apps/api/src/modules/comments/routes.ts):** create, list, edit,
  soft-delete. The company always comes from the row being commented on, resolved
  inside the actor's scope - never from the request.
- **[topics](../apps/api/src/modules/topics/routes.ts):** create, list with every view
  the spec requires, detail with the reply thread, status changes, replies.
- **[companies/:id/members](../apps/api/src/modules/companies/routes.ts):** who can be
  assigned work in a company. Added because naming a responsible party needs a list of
  candidates, and the user directory is admin-only - this is company-scoped data any
  member legitimately reads.
- **Frontend:** a shared `CommentThread` on files and projects, the topics screen with
  the view strip, and the topic detail with its thread.

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| Topic status follows who last spoke: the responsible party answering moves it to `in_review`, anyone else moves it to `awaiting_response` | The spec lists the statuses but not the transitions. This keeps "awaiting my response" and "awaiting someone else" meaningful without anyone having to set a status by hand. |
| Only the creator (or an `agency_admin`) changes a topic's lifecycle | It is their question; the responsible party answers it rather than deciding it is finished. |
| Replying is limited to the responsible party, the creator, and agency staff | A topic is a directed conversation, not a company-wide thread - that is what distinguishes it from a comment. |
| Moderating someone else's comment uses `can_delete_company_files` | The matrix marks the manager case 🔶, and that is the only override the data model carries that speaks to authority over other people's content ([23-open-questions.md](sdd/23-open-questions.md) #9). |
| The view and an explicit status filter combine with `AND` | `?view=open&status=resolved` returns nothing rather than silently dropping whichever the object literal happened to overwrite. |
| Comments on `content` and `pending_request` return `unsupported_target` | Those tables arrive in Stages 8 and 10. The enum value and the whole surrounding flow already exist, so those stages only add target resolution. |

### A real limitation the E2E suite exposed

**Every company selector only loaded the first page of companies.** An agency with more
than 20 clients simply could not pick some of them - the dropdown showed 20 and gave no
indication there were more. Selectors now use `useAllCompanies()` (100, the
server-enforced maximum). **Past 100 companies a searchable picker is needed**; that is
beyond the Phase 1 sizing assumption ("dozens of client companies",
[17-performance-requirements.md](sdd/17-performance-requirements.md)) but is a real
ceiling worth knowing about.

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | pass |
| Unit + integration | `npm test` | 217 passed / 15 files |
| Comments and topics | `apps/api/test/integration/comments-topics.test.ts` | 25 passed - cross-tenant refusal on both, attachment scoping, moderation rights per role, the full status dance, and each required view |
| End-to-end (desktop + mobile) | `npm run test:e2e` | 58 passed - includes a topic raised by the agency, answered by a collaborator, and resolved by its creator |

---

## Stage 8 - Editorial calendar, content, and production tracking (done)

**Status:** complete, validated 2026-09-14.

### Delivered

- **Migration** `stage8_content_calendar` (+ `down.sql`): the `content` table, its RLS
  policy, and **the `(company_id, scheduled_at)` index from the start** - plus a partial
  version of it for live rows, since every calendar query filters on `deleted_at`.
  Adding that index after a slow screen is noticed is explicitly what
  [17-performance-requirements.md](sdd/17-performance-requirements.md#indexing) says not
  to do.
- **[calendar](../apps/api/src/modules/calendar/routes.ts):** list with filters,
  `GET /content/calendar` for a bounded window, `GET /content/summary` for production
  tracking, create, update (reschedule and status changes included), duplicate, and
  soft delete.
- **Frontend:** month, week, day and list views with period navigation, the production
  summary strip, and a content dialog.

### Two placeholders closed

Stage 6 and Stage 7 both left `content` unsupported because the table did not exist
yet. Both now resolve it, exactly as those stages' notes said they would:

- commenting on a content item works;
- a deletion request can target one, and approving it soft-deletes the content row.

The Stage 7 test that pinned the `content` placeholder now pins `pending_request`, the
only one left (Stage 10).

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| The `today` / `overdue` / `blocked` flags are computed server-side | Every screen then agrees on what "overdue" means, rather than each view re-deriving it slightly differently. |
| "Overdue" means past its date in any unfinished state | A completed or cancelled item is not late, it is done. |
| "Blocked on client" is `awaiting_material` | It is the one state the agency cannot clear on its own, which is exactly what the spec's "client-blocked" flag is for. |
| The calendar window is capped at 400 days | The endpoint returns everything in the range rather than a page, which is only safe because the range is bounded. A year covers the multi-month planning the spec asks for. |
| A duplicated item restarts at `planned` | Carrying `approved` across to a new date would claim work that has not happened for it. |
| Deleting content follows the same rule as files | Your own goes directly; anyone else's goes through the deletion-request workflow, with the same `deletion_requires_approval` code pointing the way. |
| The month grid lists the selected day underneath | A month grid cannot show titles in a cell on a phone. Tapping a day and reading it below is the mobile-first shape; the grid still shows per-day counts. |

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | pass |
| Unit + integration | `npm test` | 239 passed / 16 files |
| Calendar and production tracking | `apps/api/test/integration/calendar.test.ts` | 22 passed - range queries including a year ahead, the over-large window refusal, each flag, the summary aggregate, duplication resetting the pipeline, and cross-tenant refusal on creation, calendar and deletion requests |
| End-to-end (desktop + mobile) | `npm run test:e2e` | 64 passed |

---

## Stage 9 - Multi-network publications (done)

**Status:** complete, validated 2026-09-14.

### Delivered

- **Migration** `stage9_publications` (+ `down.sql`): the `publications` table, the
  `UNIQUE (content_id, network)` natural key from
  [14-database-design.md](sdd/14-database-design.md), and an RLS policy that reaches
  `company_id` **through the parent content** - the same shape `topic_replies` uses,
  because the table deliberately has no `company_id` of its own.
- **[publications](../apps/api/src/modules/publications/routes.ts):** the per-content
  network list, a single `PUT` that registers *and* updates one network's record,
  `DELETE` to stop tracking a network, and `GET /publications` - the cross-content view
  the "pending publications" dashboards need.
- **`GET /content/summary`** now carries `pendingPublication` and `failedPublication`,
  the aggregate Stage 8 could not compute because the table did not exist.
- **Content rows carry their networks.** The calendar, the list and the detail endpoint
  all embed the publication records, read in one extra query for the whole page rather
  than one per row.
- **Frontend:** network chips on every content row (all four networks always shown, so
  "no record" is as visible as "published"), a per-network dialog, and a **Publicações**
  page with a "somente pendentes" filter.

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| One `PUT /content/:id/publications/:network` instead of POST + PATCH | The row's identity *is* `(content, network)`. Splitting it would make the client ask "does this exist yet?" before every write, and a double submit would race against the unique index. |
| Marking a post published with no date stamps *now* | A publication record with no date is a log nobody can audit later. Now is what the person clicking "published" means; the field is there for when they disagree. |
| `not_planned` refuses a date or a link | It is the one status that asserts nothing happened, so carrying evidence of a post would contradict itself. Enforced server-side, and the form disables the fields to match. |
| Removing a record is kept distinct from `not_planned` | "We decided not to post here" is a decision worth recording; "we are not tracking this network" is the absence of one. Collapsing them would lose the first. |
| Publications never change the content's production status | Auto-completing a content item when its last network goes out is a rule the spec does not state, and an automatic status change that nobody asked for is hard to trust. |
| `failed` is counted separately from pending | Both are unfinished, but a failure needs a retry and a pending post needs a nudge. One number could not drive both. |
| The tone for each publication status lives in [lib/tones.ts](../apps/web/src/lib/tones.ts) | [12-ui-ux-guidelines.md](sdd/12-ui-ux-guidelines.md) requires one visual treatment per status everywhere it appears; a shared map is the only way that stays true as screens are added. |

### Added while here

`rls.test.ts` now asserts that **every** tenant-owned table has RLS enabled and a
`tenant_isolation` policy, against an explicit list. A stage that adds a tenant table
and forgets its policy now fails a test instead of shipping a silently readable table -
which is exactly the class of mistake the two-database-roles finding in Stage 3 showed
this project can make.

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | pass |
| Unit + integration | `npm test` | 267 passed / 17 files |
| Publications | `apps/api/test/integration/publications.test.ts` | 27 passed - the upsert writing one row twice, per-network independence, the date stamp, the `not_planned` refusal, both aggregates, the role matrix, and a cross-tenant read that is byte-identical to a missing id |
| RLS coverage | `apps/api/test/integration/rls.test.ts` | 12 passed - including the new every-tenant-table check |
| End-to-end (desktop + mobile) | `npm run test:e2e` | 68 passed |

### What is not done

A publication cannot be commented on or made a follow-up topic's subject: neither
`commentable_type` nor `topic_related_type` has a publication member, in the schema or
in [14-database-design.md](sdd/14-database-design.md) that defines them. That matches
the spec - the discussion belongs on the content item, not on one of its network rows -
so this is recorded as intended, not as a gap to close later.

---

## Stage 10 - Pending requests (done)

**Status:** complete, validated 2026-09-14.

### Delivered

- **Migration** `stage10_pending_requests` (+ `down.sql`): the `pending_requests` table
  with its own `company_id` and the direct `tenant_isolation` policy, plus a partial
  index on the unfinished statuses - which is the only set any screen opens on.
- **[pending-requests](../apps/api/src/modules/pending-requests/routes.ts):** list with
  the six server-resolved views, `GET /pending-requests/summary` for the dashboards,
  detail, create, update, and `POST /:id/respond`.
- **Frontend:** the **Pendências** list (opening on "esperando por mim"), the creation
  dialog, and a detail page that combines the response box, the attachment and the
  comment thread.

### The last placeholder is closed

`pending_request` was the only `commentable_type` with no table behind it. It now
resolves like every other target, so the `unsupported_target` branch in
[comments](../apps/api/src/modules/comments/routes.ts) is gone - the test that pinned it
now asserts a plain 404 instead, and the error string was deleted from the client.

**Every enum member in the codebase now has a table behind it.**

### Decisions taken autonomously

| Decision | Rationale |
|---|---|
| A response is a comment on the request, not a new kind of row | It is what [14-database-design.md](sdd/14-database-design.md) already provides for: `comments` carries `attachment_file_id`, and `pending_request` was already a `commentable_type`. A response file is linked to the request because the comment is. |
| `POST /:id/respond` writes the comment and the status in one transaction | Two calls could leave a thread showing an answer the request itself had not registered. |
| Only the addressed recipient moves it to `respondida` | Anyone in the company may comment, but a colleague adding a note has not answered the request. Checked against `responsible_user_id`, never against who happens to be typing. |
| A closed request refuses new responses | `completed` and `cancelled` are decisions; letting a reply land after one would quietly reopen something that was closed on purpose. |
| `client_manager` cannot open a request | The matrix marks it "🔶 (rare)" and the data model carries no override for it (23-open-questions.md #9), so the default applies - the same call the projects module already makes for the same marking. |
| The recipient cannot `PATCH` the request | Rewriting or closing it is the creator's side of the conversation. The recipient's side is answering, which has its own endpoint and its own permission. |
| `due_date` stays a `date`, and "atrasada" is computed against UTC midnight | "Entregar até quinta" has no time zone. Comparing a date column against an instant would make a request look late for some readers and not others. |

### Changed while here

`FileUploader` now hands back the file the server created (`{ id, originalName }`)
rather than a bare "something finished" signal. The id only ever existed inside
`completeMultipartUpload`, and attaching a file to a response needs exactly that id.
The files screen ignores the argument, so nothing else changed.

### Validated 2026-09-14

| Check | Command | Result |
|---|---|---|
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | pass |
| Pending requests | `apps/api/test/integration/pending-requests.test.ts` | 20 passed - the role matrix, the recipient-only status move, the attachment link read back through the comment thread, a closed request refusing a reply, every view, the aggregates, and a cross-tenant read byte-identical to a missing id |
| Comments + RLS coverage | `comments-topics.test.ts`, `rls.test.ts` | 37 passed - including the flipped placeholder and `pending_requests` in the tenant-table list |
| End-to-end (desktop + mobile) | `pending-requests.spec.ts`, `uploads.spec.ts` | 7 passed per project - the full request → mobile response with a file → agency closes it flow |

### What is not done

Nobody is *told* a request is waiting for them: the screens answer "o que estão
esperando de mim?" only when someone opens them. That is Stage 11's job, and pending
requests are on its event list.

---

## Next step

**Stage 11 - Notifications (internal + push)**
([roadmap](sdd/21-mvp-roadmap.md#stage-11--notifications-internal--push)).

Concrete first action: add `notifications`, `notification_preferences` and
`push_devices` in one migration (with `down.sql`). Note the split from
[14-database-design.md](sdd/14-database-design.md): `notifications` is tenant data with
a **nullable** `company_id` and gets a `tenant_isolation` policy; the other two are
per-user and global, so they are role-scoped in application code and belong in the
`rls.test.ts` list's non-tenant side, not in `TENANT_TABLES`.

Then wire the event list from
[08-notifications-and-push.md](sdd/08-notifications-and-push.md#events) into the places
that already raise audit entries - the recipient resolution rules there are what decide
who each event reaches, and they are per-company, so they must be resolved on the server
inside the tenant scope.
