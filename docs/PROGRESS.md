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

## Next step

**Stage 5 - Projects and folders** ([roadmap](sdd/21-mvp-roadmap.md#stage-5--projects-and-folders)).

Concrete first action: add the `projects` and `folders` tables to the Prisma schema
plus a migration (with `down.sql`) that **also enables RLS and a `tenant_isolation`
policy on both** - every new tenant-owned table needs its policy in the same
migration that creates it, and a cross-tenant test in
`apps/api/test/integration/tenant-isolation.test.ts` before the stage is done. Then
build `modules/projects` using `tenantScoped()`, with the contributor-visibility rule
from [06-permissions-and-authorization.md](sdd/06-permissions-and-authorization.md):
a contributor sees every folder in their company regardless of who created it.
