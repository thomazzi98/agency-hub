# Agency Hub

A multi-tenant, mobile-first web platform that centralizes a social media, content-production, and paid-traffic agency's operation: file organization, editorial planning, production tracking, multi-network publication logging, client/collaborator communication, and manual campaign tracking — one codebase, many client companies, each fully isolated.

> The platform must reduce the agency's disorganization — it must not create more work.

## Status

**Stage 0: project scaffolding.** The complete technical and product specification — written before implementation, per Spec-Driven Development — lives in [`docs/`](docs/README.md), derived from the original product requirements in [`documentation.md`](documentation.md) (Portuguese); see [docs/sdd/23-open-questions.md](docs/sdd/23-open-questions.md) for resolved ambiguities and what's still open. The repository currently contains only the scaffolding described below — no business features yet. Implementation proceeds per [docs/sdd/21-mvp-roadmap.md](docs/sdd/21-mvp-roadmap.md), one stage at a time.

## Local development

Requires Node.js 22.12+ (see `.nvmrc`) and Docker.

```bash
npm install
cp .env.example .env

# Start PostgreSQL (the API doesn't use it yet — provisioned ahead of Stage 1)
docker compose up -d postgres

# Backend (http://localhost:3000/health)
npm run dev --workspace=@agency-hub/api

# Frontend, in another terminal (http://localhost:5173)
npm run dev --workspace=@agency-hub/web
```

Common workspace-wide commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

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

Implementation follows the staged roadmap in [docs/sdd/21-mvp-roadmap.md](docs/sdd/21-mvp-roadmap.md), one small, independently reviewable stage at a time, starting with project scaffolding (Stage 0) and the auth/tenant-isolation foundation (Stages 1–3) before any user-facing module is built.
