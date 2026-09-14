# ADR-0002: Multi-Tenancy Model — Shared Schema + Row-Level Security

**Status:** Accepted

## Context

The platform must serve many client companies from one codebase with strict data isolation, at low infrastructure cost, with a single small-to-medium PostgreSQL instance on a single VPS.

## Decision

Use a **shared database, shared schema** model: every tenant-owned table carries a `company_id`. Isolation is enforced at two independent layers:
1. Application-layer authorization — every query is scoped to the actor's authorized companies before it runs.
2. PostgreSQL Row-Level Security policies on every tenant-owned table, as defense-in-depth against an application-layer bug.

## Consequences

- One set of migrations, one database to back up, one connection pool — matches the low-cost, low-ops-burden goal.
- A bug in application-layer scoping is caught by RLS rather than silently leaking data — this is treated as a mandatory second layer, not optional hardening, given how severe a cross-tenant leak would be for an agency handling client media and campaign data.
- Adding a new tenant is a row insert, not a provisioning operation — supports scaling to more client companies without operational overhead growing linearly.
- **Implementation mechanism (added on review — see [14-database-design.md](../sdd/14-database-design.md#row-level-security-defense-in-depth-and-how-prisma-must-use-it)):** because Prisma pools connections and a plain `SET` of the RLS session variable would leak onto a pooled connection across unrelated requests, every tenant-scoped request must run inside a Prisma interactive transaction that sets `app.current_company_ids` via transaction-local `set_config(..., true)`. This is now a documented, mandatory implementation pattern, not an implementation detail left to whoever writes the middleware — getting it wrong doesn't just weaken RLS, it can silently apply the *wrong* tenant's RLS context to a request. Accepted trade-off: this holds a pooled connection for a request's full duration, requiring the Prisma pool size to be sized for concurrent requests rather than concurrent queries.
- **Initial pool sizing (added on review — see [ADR-0011](0011-infrastructure-sizing.md)):** against the assumed 2 vCPU / 8 GB initial VPS, `connection_limit=10` for the API process and `connection_limit=5` for the worker process, against a PostgreSQL `max_connections` of 60 — a starting point explicitly flagged for load-test validation during Stage 3 of [21-mvp-roadmap.md](../sdd/21-mvp-roadmap.md), not a number derived from real production concurrency data yet.

## Alternatives considered

- **Database-per-tenant:** strongest isolation, but each new client company would require provisioning, migrating, and backing up a separate database — too costly operationally at agency scale and directly conflicts with the low-infrastructure-cost requirement.
- **Schema-per-tenant:** partial isolation improvement over shared-schema, but multiplies migration complexity (every migration must run against N schemas) without materially improving on what RLS already provides here.
