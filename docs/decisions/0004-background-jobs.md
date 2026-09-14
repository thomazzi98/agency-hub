# ADR-0004: Background Jobs via pg-boss (No Redis)

**Status:** Accepted

## Context

Several Phase 1 features need background job processing: manual database backup generation, abandoned-upload cleanup, and notification/push dispatch. The project explicitly prioritizes minimizing infrastructure services and cost.

## Decision

Use **pg-boss**, a job queue backed by PostgreSQL — the database this project already runs — instead of introducing Redis (e.g., for BullMQ) purely to support a job queue.

## Consequences

- No new infrastructure service to provision, secure, back up, or monitor on the VPS.
- Job state lives in the same database already covered by the backup/recovery strategy, rather than in a second system with its own persistence story.
- **Throughput evaluation (added on review):** pg-boss dequeues via `SELECT ... FOR UPDATE SKIP LOCKED` polling against its own schema in the primary database — realistic sustained throughput is in the tens of jobs/second on modest hardware, with dispatch latency bound by the polling interval (low seconds by default), not comparable to Redis-backed pub/sub. This is evaluated as more than sufficient for Phase 1's actual job types: hourly cleanup runs, single-flight rare backups, and notification/push fan-out expected in the low single digits of jobs/second even during a burst — see [17-performance-requirements.md](../sdd/17-performance-requirements.md#load-expectations-phase-1-sizing-assumption-approved-2026-09-14). **Concrete revisit trigger:** sustained throughput approaching ~20–50 jobs/second, or any job type requiring sub-second dispatch latency (none do today).
- **Job concurrency cap (added on review — see [ADR-0011](0011-infrastructure-sizing.md)):** against the assumed 2 vCPU initial VPS, the worker process caps pg-boss at 4 concurrent job handlers, so a burst of background work (e.g., a backup running alongside notification fan-out) cannot starve the API process of CPU. A configuration value, raised freely if a larger box is provisioned.

## Alternatives considered

- **BullMQ + Redis:** higher throughput and a more mature ecosystem, but adds a service, a credential surface, and an operational dependency this project doesn't otherwise need in Phase 1.
- **Cron scripts without a real queue:** insufficient for jobs that need retry, single-flight locking (backup), and status tracking (all required per [11-backup-and-recovery.md](../sdd/11-backup-and-recovery.md) and [07-upload-architecture.md](../sdd/07-upload-architecture.md)).
