# 04 — Non-Functional Requirements

These requirements apply across every module in [03-functional-requirements.md](03-functional-requirements.md) and are the quality bar for MVP acceptance.

## Performance
- Mobile-first performance target: usable on a mid-range Android phone over a throttled 4G connection.
- List/dashboard endpoints paginated (default page size defined in [15-api-conventions.md](15-api-conventions.md)); no endpoint returns unbounded result sets.
- All frequent query paths backed by a PostgreSQL index — see [14-database-design.md](14-database-design.md#indexing-strategy).
- Detailed budgets in [17-performance-requirements.md](17-performance-requirements.md).

## Mobile-first
- Every screen designed for a phone viewport first, then extended to tablet/desktop.
- Upload flow specifically optimized for mobile network instability — see [07-upload-architecture.md](07-upload-architecture.md).
- Touch targets, form inputs, and navigation usable one-handed on common screen sizes.

## Scalability
- Single-VPS, single-environment Phase 1 deployment, but every architectural choice must not preclude horizontal scaling later (stateless app servers, externalized session store in Postgres, file storage already externalized to R2).
- No design decision may assume a fixed, small number of tenants (e.g., no per-tenant schema or per-tenant deployment).

## Cost
- Minimize the number of paid/managed services. Defaults favor self-hosted or already-required infrastructure (PostgreSQL for job queue via `pg-boss` instead of adding Redis; Cloudflare R2 has no egress fees) over adding new managed dependencies. Trade-offs recorded per decision in [13-technical-architecture.md](13-technical-architecture.md#technology-decisions).

## Maintainability
- One codebase, modular by domain (not by technical layer alone) — see [13-technical-architecture.md](13-technical-architecture.md#code-organization).
- No per-client forks, feature flags used only where a real Phase 1/Phase 2 boundary requires it.
- Comments only where intent isn't obvious from code (see root guidance and [15-api-conventions.md](15-api-conventions.md#comments-code)).

## Accessibility
- Semantic HTML, sufficient color contrast (branding customization must enforce a minimum contrast ratio — see [12-ui-ux-guidelines.md](12-ui-ux-guidelines.md#branding-assets)), keyboard-navigable forms, visible focus states, alt text for meaningful images.

## Availability & resilience
- Phase 1 target: best-effort single-VPS availability with automated health checks post-deploy and a documented rollback (see [19-deployment-and-cicd.md](19-deployment-and-cicd.md)). No formal SLA in Phase 1 — this is an internal/agency-client tool, not a public consumer product.
- Deploys must not cause data loss; database volume is never recreated by any automated process (see [11](11-backup-and-recovery.md), [16](16-security-requirements.md), [19](19-deployment-and-cicd.md)).

## Security baseline
Every non-functional requirement above is subordinate to security: isolation and server-side authorization are never traded off for performance or convenience. Full detail: [16-security-requirements.md](16-security-requirements.md).

## Observability
- Structured logs, health endpoint, and audit trail from day one of Phase 1 (lightweight — full metrics/tracing stack is not required). Detail: [20-observability-and-error-handling.md](20-observability-and-error-handling.md).
