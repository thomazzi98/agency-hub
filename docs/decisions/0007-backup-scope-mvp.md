# ADR-0007: Manual-Only Backup for Phase 1

**Status:** Accepted

## Context

`documentation.md` contains two backup-related sections that conflict when read together: one describes a full automatic 3-2-1 backup strategy as if baseline, while a later "updated decisions" section states the MVP will have manual backup only, with automatic backups explicitly out of scope. This task's own instructions confirm the latter. Full trace: [23-open-questions.md](../sdd/23-open-questions.md#resolved-automatic-vs-manual-backup-contradiction).

## Decision

Phase 1 ships **only** an admin-triggered manual backup (background `pg_dump` job, protected temporary download, single-flight, fully audited — [11-backup-and-recovery.md](../sdd/11-backup-and-recovery.md)). The full automatic, offsite, 3-2-1 backup strategy is deferred to Phase 2, with its complete requirements preserved in the spec so it isn't lost or re-derived from scratch later.

## Consequences

- Faster, simpler Phase 1 delivery — no scheduler, no offsite storage credentials/bucket, no retention-tier logic, no restore-testing automation to build before shipping.
- **Accepted risk:** data protection between Phase 1 and Phase 2 depends on a human remembering to trigger and safely store a manual backup. This is explicitly flagged, not hidden — the manual backup is documented as an interim safety net, not a substitute for the automatic strategy, exactly per the source document's own caveat.
- Phase 2 planning does not need to rediscover requirements — the schedule, retention tiers, encryption, offsite storage, and restore-testing procedure are already fully specified.

## Alternatives considered

- **Implement the full automatic strategy in Phase 1 anyway:** would directly contradict the explicit, later, more specific instruction in the source document and in this task's own scope. Rejected in favor of following the documented authority.
- **Skip documenting the automatic strategy until Phase 2:** rejected — writing it now, while the context from the source document is fresh, avoids losing detail and gives Phase 2 planning a running start.
