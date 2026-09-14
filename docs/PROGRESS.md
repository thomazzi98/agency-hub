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
```

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

## Next step

**Stage 2 — Authentication & sessions** ([roadmap](sdd/21-mvp-roadmap.md#stage-2--authentication--sessions),
spec: [10-authentication-and-sessions.md](sdd/10-authentication-and-sessions.md)).

Concrete first action: add the `sessions` and `password_reset_audits` tables to
the Prisma schema plus a `SessionAction`-free migration (with `down.sql`), then
implement Argon2id hashing (19 MiB / 2 iterations / parallelism 1, plus a
server-side pepper from `PASSWORD_PEPPER`) in `apps/api/src/modules/auth/`.
