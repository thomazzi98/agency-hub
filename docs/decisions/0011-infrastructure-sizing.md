# ADR-0011: Initial Infrastructure Sizing (2 vCPU / 8 GB VPS)

**Status:** Accepted

## Context

Several already-final decisions had numeric parameters that could only be sanity-checked, not truly finalized, without knowing the actual VPS the application would run on: Argon2id's memory cost ([ADR-0009](0009-security-parameters.md)), the Prisma connection pool size required by the mandatory RLS interactive-transaction pattern ([ADR-0002](0002-multi-tenancy-model.md)), and pg-boss's safe job concurrency ([ADR-0004](0004-background-jobs.md)). A 2026-09-14 review round supplied a concrete initial assumption to unblock these.

## Decision

Assume an initial production VPS of **2 vCPU / 8 GB RAM**, running the entire Docker Compose stack (reverse proxy, API, worker, PostgreSQL) as a single-box deployment, per [13-technical-architecture.md](../sdd/13-technical-architecture.md#infrastructure-sizing-phase-1-initial-assumption-approved-2026-09-14). Derived tuning values:

- PostgreSQL `max_connections`: 60
- Prisma pool (API process): `connection_limit=10`
- Prisma pool (worker process): `connection_limit=5`
- pg-boss job concurrency: 4 concurrent handlers
- No server-side video processing (transcoding/thumbnailing) on this box — file preview relies on browser-native playback against the original R2 object

## Consequences

- Argon2id's 19 MiB/2-iteration setting ([ADR-0009](0009-security-parameters.md)) is confirmed comfortable: even a 20-concurrent-login burst uses under 400 MiB, a small fraction of 8 GB.
- The Prisma pool size (10) is deliberately sized for concurrent *requests*, not concurrent queries, because of the interactive-transaction RLS pattern holding a connection for a request's full duration — this is the number most likely to need real-world tuning, and is explicitly flagged for load-testing during Stage 3 of [21-mvp-roadmap.md](../sdd/21-mvp-roadmap.md) before that stage is considered fully signed off.
- Capping pg-boss at 4 concurrent handlers prevents a burst of background work (e.g., a backup running alongside notification fan-out) from starving the API process's share of 2 vCPUs — a real risk on a box this size that wouldn't be worth worrying about on a larger one.
- Explicitly ruling out server-side video processing avoids the single most likely way this sizing could be blown — transcoding is CPU-intensive in a way nothing else in Phase 1's scope is.
- This is a **starting assumption, not a permanent ceiling** — vertical scaling (a larger VPS) is a configuration change, and the architecture's stateless-app-server design ([13-technical-architecture.md](../sdd/13-technical-architecture.md#future-scalability-path-not-built-now-not-precluded)) keeps horizontal scaling available without a redesign if this box is ever outgrown.

## Alternatives considered

- **Leaving these values unresolved until a VPS is provisioned during Stage 15:** rejected — three already-"final" decisions (Argon2id, Prisma pooling, pg-boss concurrency) had numbers that were only defensible relative to some real hardware assumption; deferring this meant those decisions weren't actually verifiable, just asserted.
- **Assuming a larger box (e.g., 4 vCPU / 16 GB) to remove sizing pressure entirely:** rejected as the default assumption — starting conservative and documenting the exact tuning knobs that would need to move if a larger box is chosen later is more useful than sizing for headroom that may not be needed, especially given the low-infrastructure-cost principle running through this whole spec.
