# 17 — Performance Requirements

## Targets (concrete, testable)

These are Phase 1 acceptance targets, measured under the sizing assumption below, on the reference condition of a mid-range Android device over Playwright's "Fast 3G"/throttled-4G network emulation profile ([18-testing-strategy.md](18-testing-strategy.md)):

| Metric | Target | How it's verified |
|---|---|---|
| API list/detail endpoint response time | p95 < 500 ms under normal load (excludes upload data-plane traffic, which never touches the API) | Integration test with timing assertions against a seeded database of realistic size; monitored in production via request-duration logging ([20-observability-and-error-handling.md](20-observability-and-error-handling.md)) |
| Upload control-plane call (presign, part registration) | p95 < 300 ms | Same as above — these payloads are tiny by construction ([07-upload-architecture.md](07-upload-architecture.md)) |
| Dashboard/list first meaningful content | Loading state renders immediately (< 100 ms, no network round-trip); first page of real data visible within 2 s on the reference mobile network condition | Playwright E2E with network throttling |
| Time-to-interactive on primary mobile screens (dashboard, file list, calendar) | < 3 s on the reference mobile network condition | Playwright E2E with network throttling |

These numbers are **final Phase 1 acceptance targets**, not aspirational — see [22-acceptance-criteria.md](22-acceptance-criteria.md) for the corresponding testable criteria. They assume the [load expectations](#load-expectations-phase-1-sizing-assumption-approved-2026-09-14) below; if actual production scale differs materially, revisit them rather than silently missing them.

## Pagination

- Every list endpoint is paginated; default and maximum page sizes are fixed server-side per resource (e.g., default 20, max 100) and a client cannot override the max.
- Cursor-based pagination is preferred for high-churn, append-heavy lists (notifications, audit logs, campaign history) to avoid page-drift; offset pagination is acceptable for smaller, stable lists (companies, projects).

## Indexing

- Every query pattern used by a list/filter screen has a matching index — the concrete list is in [14-database-design.md](14-database-design.md#indexing-strategy).
- New filters added to an existing list screen require an index review before merge, not after a production slowdown is noticed.

## Caching

- Server-state caching on the frontend via TanStack Query (stale-while-revalidate for lists, aggressive caching for rarely-changing data like branding settings and role/permission metadata).
- Static/brand assets served with long cache lifetimes plus cache-busting on change (per [12-ui-ux-guidelines.md](12-ui-ux-guidelines.md#branding-assets)).
- No caching of any per-tenant data at a layer that could leak it across tenants (e.g., no shared CDN caching of authenticated API responses).

## Lazy loading & progressive loading

- Images lazy-load below the fold; video never preloads or autoplays ([12-ui-ux-guidelines.md](12-ui-ux-guidelines.md)).
- Large lists (file browser, calendar in list view, audit log) load progressively (paginated fetch triggered by scroll or explicit "load more"), never all at once.
- Frontend code-splitting by route/module so a user loads only the JS needed for the screen they're on.

## Upload performance

- Chunked/multipart upload with tuned chunk size for mobile networks ([07-upload-architecture.md](07-upload-architecture.md)) — the goal is resilience and resumability over raw throughput; a slower-but-reliable upload beats a fast-but-fragile one on unstable connections.
- Configurable concurrency (parallel chunks, parallel files) balances throughput against saturating a mobile connection's usable bandwidth.

## Query efficiency

- No N+1 query patterns in list endpoints — related data (e.g., file counts, latest comment) is fetched via joins/batched queries, not per-row follow-up queries.
- Aggregation-heavy dashboard queries are reviewed for index coverage and, if needed, precomputed/cached rather than run live on every dashboard load at scale (not required for Phase 1 at expected agency data volumes, but the design should not preclude adding a materialized view later).

## Load expectations (Phase 1 sizing assumption — approved 2026-09-14)

Designed for an agency's realistic scale: dozens of client companies, tens of internal staff, hundreds of concurrent files/content items per company — not internet-scale traffic. **Confirmed initial VPS: 2 vCPU / 8 GB RAM** ([ADR-0011](../decisions/0011-infrastructure-sizing.md)), running the entire Docker Compose stack (reverse proxy, API, worker, PostgreSQL) — the concrete tuning knobs this implies (Postgres `max_connections`, Prisma pool sizes, pg-boss concurrency) are documented in [13-technical-architecture.md](13-technical-architecture.md#infrastructure-sizing-phase-1-initial-assumption-approved-2026-09-14). This assumption is explicit so architecture decisions (single VPS, shared Postgres, pg-boss) are evaluated against the right bar; if actual usage approaches this ceiling, vertical scaling (a larger VPS) or the horizontal-scaling path already kept open ([Future scalability path](13-technical-architecture.md#future-scalability-path-not-built-now-not-precluded)) are both available without a redesign.
