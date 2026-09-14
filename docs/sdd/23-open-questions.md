# 23 — Open Questions and Assumptions

This spec makes deliberate, documented calls to avoid stalling on every ambiguity. This page lists every place a real decision (not just a formatting choice) was made without explicit confirmation, plus what should be confirmed before or during early implementation. Nothing here should be read as "blocked" — each item has a working assumption already reflected in the rest of the spec; this page exists so those assumptions are visible and revisable.

## Resolved contradictions in the source document

### Resolved: Phase 1 vs. Phase 2 contradiction

`documentation.md` Section 20 (original phase table) places push notifications, deep campaign tracking, and richer branding in "Phase 2." A later section, "Requisitos adicionais e decisões atualizadas," explicitly overrides this and moves push notifications, manual campaign tracking, admin branding, and manual backup into Phase 1. **This spec follows the later section** — it reads as the product owner's updated decision, and it matches this task's own explicit instructions (push in Phase 1, campaigns in Phase 1, backup manual-only in Phase 1). See [01-product-scope.md](01-product-scope.md#phase-1-mvp-scope).

### Resolved: automatic vs. manual backup contradiction

Section 23 ("Banco de dados, Docker, backups e recuperação") describes a full automatic 3-2-1 backup strategy as if baseline. The later "updated decisions" section states the MVP will have manual backup **only**, with automatic backups explicitly out of scope. **This spec follows the later, explicit statement** and defers the automatic strategy to Phase 2, while preserving its full detail so it isn't lost — see [11-backup-and-recovery.md](11-backup-and-recovery.md#scope-resolution). This is flagged as an accepted **risk**, not just a scheduling choice: a manual-only backup depends on a human remembering to click a button, which the source document itself acknowledges as a weakness of the manual approach.

### Resolved: `master` vs. `main`

The source document specifies `master` as the production branch and deploy trigger. This repository's actual default branch (already initialized) is `main`. This spec uses `main` throughout ([19-deployment-and-cicd.md](19-deployment-and-cicd.md)) rather than renaming the existing branch or introducing a second production branch.

## Resolved in the 2026-09-14 architecture/security review

The architecture/security review pass firmed up the following from "open question" to **final decision**. Each is now documented with concrete parameters and, where the decision itself was contested, an ADR:

| Former question | Resolution | Reference |
|---|---|---|
| Exact frontend framework | **React + Vite SPA** — final | [13-technical-architecture.md](13-technical-architecture.md#decision-status) |
| Upload protocol/library on the client | **Uppy** (`@uppy/core` + `@uppy/aws-s3`), self-hosted signing, no Companion — final | [ADR-0008](../decisions/0008-upload-client-library.md), [07-upload-architecture.md](07-upload-architecture.md#client-library-uppy-final-decision) |
| ORM choice | **Prisma** — final, with the mandatory Prisma-interactive-transaction pattern for RLS correctness now specified | [14-database-design.md](14-database-design.md#row-level-security-defense-in-depth-and-how-prisma-must-use-it) |
| Background job mechanism | **pg-boss** — final, with a concrete throughput evaluation and revisit trigger (~20–50 jobs/sec sustained) | [ADR-0004](../decisions/0004-background-jobs.md) |
| Session duration | **7-day sliding, 30-day hard cap** — final concrete values, configuration-driven | [ADR-0009](../decisions/0009-security-parameters.md) |
| Password hashing parameters | **Argon2id, 19 MiB / 2 iterations / parallelism 1** — final default (OWASP minimum), re-tunable once VPS sizing is known | [ADR-0009](../decisions/0009-security-parameters.md) |
| Login abuse protection thresholds | **5 failed attempts → exponential lockout capped at 15 min; 20 attempts/hour per IP** — final defaults | [ADR-0009](../decisions/0009-security-parameters.md) |
| Storage bucket/key structure | `{company_id}/{project_id}/{file_id}/{original_filename}`, UUID-based — confirmed final, no change from the original working assumption | [07-upload-architecture.md](07-upload-architecture.md) |
| Multi-company membership | **Confirmed as supported for every role**, not merely "not prevented by the schema" — moved out of the assumptions list below into a real decision | [06-permissions-and-authorization.md](06-permissions-and-authorization.md#multi-company-membership-is-supported-for-every-role) |

Upload chunk size (16 MiB) and concurrency defaults (3 parts/file, 2 files/queue, 5 sessions/company) are now concrete Phase 1 defaults rather than a range — see the next section for the one piece of residual risk carried forward from this.

## Resolved in the 2026-09-14 follow-up approval round

A second pass approved the architecture as-is and resolved several remaining items with concrete decisions:

| Former question | Resolution | Reference |
|---|---|---|
| VPS resource limits | **2 vCPU / 8 GB RAM**, confirmed as the initial Phase 1 assumption, with derived tuning values (Postgres `max_connections=60`, Prisma pools, pg-boss concurrency) | [ADR-0011](../decisions/0011-infrastructure-sizing.md), [13-technical-architecture.md](13-technical-architecture.md#infrastructure-sizing-phase-1-initial-assumption-approved-2026-09-14) |
| Per-company (white-label) branding vs. single global brand | **Single global identity confirmed for Phase 1** (logo, favicon, app name, main colors) — per-company branding explicitly postponed, not a near-term follow-up | [14-database-design.md](14-database-design.md#platform-tables), [12-ui-ux-guidelines.md](12-ui-ux-guidelines.md#branding-assets) |
| Whether uploads require true immutable limits or configurable ones | **Confirmed configurable, not fixed** — chunk size, concurrency, and retry limits are explicitly initial configuration values with a documented validation methodology, not hardcoded rules | [07-upload-architecture.md](07-upload-architecture.md#status-of-the-numeric-defaults-below-approved-2026-09-14), [Validation plan](07-upload-architecture.md#validation-plan-real-devices-and-unstable-networks) |
| Should any operation require more than a role check? | **Yes — step-up reauthentication added** for manual database backup generation (the single most consequential Phase 1 action); a new, narrower open question below covers whether to extend it further | [ADR-0010](../decisions/0010-reauthentication-for-sensitive-operations.md) |

Campaign management scope (manual registration/notes/status/history only, no ad-platform API) was reconfirmed unchanged — see [09-campaign-management.md](09-campaign-management.md).

## Open questions requiring product or technical confirmation

| # | Question | Current working assumption | Where it matters |
|---|---|---|---|
| 1 | Are campaigns visible to `client_manager` by default? | Default `visible_to_client = true` per campaign, agency can hide specific campaigns | [09-campaign-management.md](09-campaign-management.md), [14-database-design.md](14-database-design.md) |
| 2 | Native mobile apps, ever? | Assumed no for Phase 1–3 — "mobile-first" is interpreted as a responsive web app, not a native app requirement | [01-product-scope.md](01-product-scope.md) |
| 3 | Error tracking service | Optional (e.g., Sentry free tier) — not mandatory, must remain fully debuggable via logs alone if skipped | [20-observability-and-error-handling.md](20-observability-and-error-handling.md) |
| 4 | Monorepo tooling | To be resolved during Stage 0 implementation itself (npm/pnpm workspaces vs. two repos) — low-risk, implementer's call | [13-technical-architecture.md](13-technical-architecture.md) |
| 5 | iOS Safari Web Push support | Treated as a known platform limitation to design around; feature-detected and gracefully degrades to in-app-only for **any** unsupported browser/device, not a hardcoded iOS check — not a blocking requirement | [08-notifications-and-push.md](08-notifications-and-push.md) |
| 6 | Branding asset size/format limits | Not numerically specified — needs a concrete value (e.g., logo ≤ 2 MB, SVG/PNG) before Stage 4 implementation | [12-ui-ux-guidelines.md](12-ui-ux-guidelines.md#branding-assets) |
| 7 | Upload chunk size / concurrency — real-device validation execution | The *values* (16 MiB parts, 3 parallel parts/file, 2 files/queue) and the *validation methodology* are both now defined; what remains is actually running that validation pass on real devices during Stage 6 and recording the result — treat current numbers as "documented initial configuration," not "measured optimum," until then | [07-upload-architecture.md](07-upload-architecture.md#validation-plan-real-devices-and-unstable-networks) |
| 8 | Prisma connection-pool sizing under the interactive-transaction RLS pattern — load-test execution | Initial values are now set (`connection_limit=10` API / `5` worker, Postgres `max_connections=60` — [ADR-0011](../decisions/0011-infrastructure-sizing.md)); what remains is validating them under realistic concurrency before Stage 3 is considered fully signed off | [14-database-design.md](14-database-design.md#required-pattern-a-transaction-scoped-session-setting-applied-inside-a-prisma-interactive-transaction) |
| 9 | Role customization model | Fixed 4 roles + per-membership boolean overrides (`can_manage_campaigns`, `can_delete_company_files`) — not a fully custom/granular RBAC | [06-permissions-and-authorization.md](06-permissions-and-authorization.md) |
| 10 | Which operations beyond manual backup should require step-up reauthentication? | Only backup generation is confirmed in scope today; candidates for the same treatment (not yet decided) include changing another user's role and revoking all of a user's sessions | [ADR-0010](../decisions/0010-reauthentication-for-sensitive-operations.md), [10-authentication-and-sessions.md](10-authentication-and-sessions.md#reauthentication-for-sensitive-operations-approved-2026-09-14) |

## Assumptions carried throughout the spec (lower-risk, stated for transparency)

- "Corretor" (real estate broker) in the source document is treated as a historical/domain-specific synonym for the generic `contributor` role, not a fifth role — the platform's `Project` entity already generalizes past a real-estate-only original use case.
- A "topic" ([03-functional-requirements.md](03-functional-requirements.md#follow-up-topics)) never automatically becomes a pending request; conversion is always an explicit user action.
- Seed/demo data used during development is synthetic and clearly marked as such, never inserted into a production database — per the source spec's explicit rule against fabricated data presented as real.

## How to resolve these

Each row above should be confirmed with the product owner (or decided and recorded as an ADR — [../decisions/README.md](../decisions/README.md)) before or during the roadmap stage listed in its "where it matters" column — not necessarily before implementation starts overall. Stage 0–1 of [21-mvp-roadmap.md](21-mvp-roadmap.md) does not depend on any of these being resolved.
