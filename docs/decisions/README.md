# Architecture Decision Records

This log captures *why* the major technical choices in [../sdd/13-technical-architecture.md](../sdd/13-technical-architecture.md) were made — the alternatives considered and the trade-offs accepted — so a future contributor doesn't have to reverse-engineer the reasoning or accidentally re-litigate a settled trade-off without the original context.

## Format

Each ADR is a short file: **Status**, **Context**, **Decision**, **Consequences**, **Alternatives considered**. Numbered sequentially, never renumbered or deleted — a superseded decision gets a new ADR that says so, and its `Status` changes to `Superseded by ADR-000X`.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-language-and-runtime.md) | Language, runtime, and web framework | Accepted |
| [0002](0002-multi-tenancy-model.md) | Multi-tenancy model: shared schema + RLS | Accepted |
| [0003](0003-upload-architecture.md) | Direct-to-R2 resumable multipart upload | Accepted |
| [0004](0004-background-jobs.md) | Background jobs via pg-boss (no Redis) | Accepted |
| [0005](0005-push-notifications.md) | Web Push (VAPID) over a native push provider | Accepted |
| [0006](0006-authentication-sessions.md) | Server-side sessions over stateless JWT | Accepted |
| [0007](0007-backup-scope-mvp.md) | Manual-only backup for Phase 1 | Accepted |
| [0008](0008-upload-client-library.md) | Upload client library: Uppy (self-hosted signing) | Accepted |
| [0009](0009-security-parameters.md) | Concrete security parameters (password hashing, sessions, login abuse) | Accepted |
| [0010](0010-reauthentication-for-sensitive-operations.md) | Step-up reauthentication for sensitive operations | Accepted |
| [0011](0011-infrastructure-sizing.md) | Initial infrastructure sizing (2 vCPU / 8 GB VPS) | Accepted |

All eleven are logged as **Accepted** because they're the working basis for [21-mvp-roadmap.md](../sdd/21-mvp-roadmap.md); none has been implemented and validated in production yet. Several carry an explicit open question in [../sdd/23-open-questions.md](../sdd/23-open-questions.md) — "Accepted" here means "this is the spec's committed direction," not "this is beyond reconsideration." ADR-0002, ADR-0004, and ADR-0009 were amended (not superseded) during the 2026-09-14 architecture/security review and its 2026-09-14 follow-up approval round to add implementation-critical mechanism detail and concrete infrastructure-derived numbers; see their "added on review" notes.
