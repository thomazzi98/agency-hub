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

## Next step

**Stage 3 — Companies, users, roles, and tenant isolation**
([roadmap](sdd/21-mvp-roadmap.md#stage-3--companies-users-roles-and-tenant-isolation)).
The roadmap flags this as the highest-consequence stage in the project.

Concrete first action: write the migration that creates the non-superuser
application role and enables RLS (`FORCE ROW LEVEL SECURITY` is not enough on its own
— see the blocker above), then build `shared/tenant-scope.ts` with the mandatory
Prisma interactive-transaction + `set_config(..., true)` pattern from
[14-database-design.md](sdd/14-database-design.md), before any company/user CRUD.
