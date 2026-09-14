# Agency Hub

A multi-tenant, mobile-first web platform that centralizes a social media, content-production, and paid-traffic agency's operation: file organization, editorial planning, production tracking, multi-network publication logging, client/collaborator communication, and manual campaign tracking — one codebase, many client companies, each fully isolated.

> The platform must reduce the agency's disorganization — it must not create more work.

## Status

**Stage 10: pending requests.** The complete technical and product specification — written before implementation, per Spec-Driven Development — lives in [`docs/`](docs/README.md), derived from the original product requirements in [`documentation.md`](documentation.md) (Portuguese); see [docs/sdd/23-open-questions.md](docs/sdd/23-open-questions.md) for resolved ambiguities and what's still open. Implementation proceeds per [docs/sdd/21-mvp-roadmap.md](docs/sdd/21-mvp-roadmap.md), one stage at a time; running progress and the next concrete step are tracked in [docs/PROGRESS.md](docs/PROGRESS.md).

## Local development

Requires Node.js 22.12+ (see `.nvmrc`) and Docker.

```bash
npm install
cp .env.example .env

# Start PostgreSQL and the local S3-compatible storage
docker compose up -d postgres minio minio-buckets

# Create the least-privilege application role, migrate, and seed the first admin
npm run db:setup --workspace=@agency-hub/api
npm run db:seed --workspace=@agency-hub/api   # prints the temporary password once

# Backend (http://localhost:3000/health)
npm run dev --workspace=@agency-hub/api

# Background worker, in another terminal (abandoned-upload cleanup)
npm run dev:worker --workspace=@agency-hub/api

# Frontend, in another terminal (http://localhost:5173)
npm run dev --workspace=@agency-hub/web
```

### Object storage

Uploads go **straight from the browser to S3-compatible storage** — no file byte passes through the API. Locally that is MinIO from `docker-compose.yml`; in production it is Cloudflare R2. The same code talks to both through `STORAGE_*`.

Before the first production deploy, apply the bucket rules the upload path depends on:

```bash
npm run storage:configure --workspace=@agency-hub/api -- --origin https://your-domain
```

That sets CORS (the browser PUTs directly, and `ETag` must be an exposed header or multipart completion has nothing to assemble from) and a lifecycle rule aborting incomplete multipart uploads after 7 days, as an independent net behind the hourly cleanup job.

Or run the whole backend stack in containers — this also applies migrations:

```bash
docker compose up -d --build
curl http://localhost:3000/health/ready
```

Common workspace-wide commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run format`.

### Database

Migrations live in `apps/api/prisma/migrations/`. Each directory holds Prisma's generated `migration.sql` **and** a hand-reviewed `down.sql`, because Prisma Migrate has no native rollback and [docs/sdd/19-deployment-and-cicd.md](docs/sdd/19-deployment-and-cicd.md) requires every migration to be reversible.

```bash
cd apps/api
npm run db:provision          # create/refresh the least-privilege application role
npm run db:migrate            # create + apply a migration in development
npm run db:migrate:deploy     # apply pending migrations (CI/production)
npm run db:migrate:down       # roll back the most recent migration
npm run db:studio             # browse data
```

**Two database roles, on purpose.** PostgreSQL ignores Row-Level Security for superusers _and_ for table owners, so an application connecting as either would have tenant-isolation policies that exist and never apply. `DATABASE_URL` therefore points at `agency_hub_app` - no superuser, no `BYPASSRLS`, no DDL - while migrations and database management use the owner named by `DB_OWNER_USER`/`DB_OWNER_PASSWORD`. The API refuses to start if its role can bypass RLS.

### Tests

Integration tests need a running PostgreSQL. They drop and recreate the database named by `TEST_DATABASE_URL` on every run — the tooling refuses any database whose name does not contain `_test`.

```bash
docker compose up -d postgres
npm test          # unit + integration (Vitest)
npm run test:e2e  # end-to-end (Playwright), desktop and mobile viewports
```

The E2E suite starts its own API and web server on dedicated ports and uses `E2E_DATABASE_URL`, so it never disturbs a running development stack.

## Documentation

- **Start here:** [docs/README.md](docs/README.md)
- **Product scope & phases:** [docs/sdd/01-product-scope.md](docs/sdd/01-product-scope.md)
- **Roles & permissions:** [docs/sdd/02-personas-and-roles.md](docs/sdd/02-personas-and-roles.md) · [docs/sdd/06-permissions-and-authorization.md](docs/sdd/06-permissions-and-authorization.md)
- **Critical subsystems:** [upload](docs/sdd/07-upload-architecture.md) · [notifications & push](docs/sdd/08-notifications-and-push.md) · [campaigns](docs/sdd/09-campaign-management.md) · [auth & sessions](docs/sdd/10-authentication-and-sessions.md) · [backup & recovery](docs/sdd/11-backup-and-recovery.md)
- **Technical architecture:** [docs/sdd/13-technical-architecture.md](docs/sdd/13-technical-architecture.md) · [database design](docs/sdd/14-database-design.md) · [API conventions](docs/sdd/15-api-conventions.md)
- **Quality bar:** [security](docs/sdd/16-security-requirements.md) · [performance](docs/sdd/17-performance-requirements.md) · [testing](docs/sdd/18-testing-strategy.md) · [deployment & CI/CD](docs/sdd/19-deployment-and-cicd.md)
- **Execution:** [MVP roadmap](docs/sdd/21-mvp-roadmap.md) · [acceptance criteria](docs/sdd/22-acceptance-criteria.md) · [open questions](docs/sdd/23-open-questions.md)
- **Why we chose what we chose:** [docs/decisions/README.md](docs/decisions/README.md)
- **Full index:** [docs/sdd/00-overview.md](docs/sdd/00-overview.md)

## Tech stack (Phase 1 — proposed, see ADRs for rationale)

- **Backend:** Node.js + TypeScript, Fastify, Zod validation, Prisma/PostgreSQL
- **Frontend:** React + Vite (SPA), TanStack Query, Tailwind CSS
- **Storage:** Cloudflare R2 (direct resumable multipart upload, no file bytes through the backend)
- **Background jobs:** pg-boss (PostgreSQL-backed — no Redis)
- **Push notifications:** Web Push (VAPID)
- **Infrastructure:** Docker + Docker Compose on a single VPS, Caddy reverse proxy, GitHub Actions CI/CD

## Conventions

- **UI language:** Brazilian Portuguese (pt-BR)
- **Code language:** English (identifiers, database, API, files, components)
- Full conventions: [docs/sdd/15-api-conventions.md](docs/sdd/15-api-conventions.md), [docs/sdd/12-ui-ux-guidelines.md](docs/sdd/12-ui-ux-guidelines.md)

## Next step

Implementation follows the staged roadmap in [docs/sdd/21-mvp-roadmap.md](docs/sdd/21-mvp-roadmap.md), one small, independently reviewable stage at a time. Stages 0–10 are done (scaffolding, schema, authentication, tenant isolation, branding, projects and folders, the upload subsystem, notes/comments/follow-up topics, the editorial calendar, the multi-network publication log, and pending requests); Stage 11 (notifications) is next. One Stage 6 acceptance item — the real-device upload validation pass — needs physical devices and has not run; see [docs/PROGRESS.md](docs/PROGRESS.md).
