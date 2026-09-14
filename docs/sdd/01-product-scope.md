# 01 — Product Scope

## Objective

A single, multi-tenant, mobile-first web platform that centralizes an agency's operation across:

- Social media management
- Content production
- Paid-traffic (ads) operational tracking
- File organization and delivery
- Communication with clients and collaborators

One codebase serves every client company ("tenant"). No per-client forks or deployments.

## Product principles (from `documentation.md`, Section 2)

- pt-BR UI; English code.
- Mobile-first, especially for uploads from a phone.
- Simplicity, clarity, and performance over feature breadth.
- No per-client code duplication.
- All permissions validated server-side — the frontend is never a security boundary.
- Cross-company access is never permitted, under any role.
- Pagination, lazy loading, and progressive loading are the default, not an optimization.
- Videos never autoplay.
- No fabricated data presented as real, at any stage (including in this SDD, demos, or seed data).

## Phase 1 — MVP scope

> **Resolution note:** `documentation.md` contains an earlier phase table (Section 20) and a later "updated decisions" section (Section titled *Requisitos adicionais e decisões atualizadas*) that supersedes it — push notifications, campaign tracking, admin branding, and manual backup all move from "Phase 2" into Phase 1 in the later section. This spec follows the **updated, later section**, which is also consistent with this task's own instructions. See [23-open-questions.md](23-open-questions.md#resolved-phase-1-vs-phase-2-contradiction) for the full trace.

Phase 1 delivers a complete, manually-operated agency workflow:

1. **Authentication & sessions** — admin-issued credentials, forced password change, revocable sessions (~7 days).
2. **Companies** — tenant records with branding-relevant fields, active/archived lifecycle.
3. **Users & roles** — four fixed roles (see [02-personas-and-roles.md](02-personas-and-roles.md)), company membership, admin-managed lifecycle.
4. **Multi-tenant isolation** — enforced server-side on every request, at the database layer as defense-in-depth ([06](06-permissions-and-authorization.md), [16](16-security-requirements.md)).
5. **Projects** — generic container (property, product, service, event, campaign, internal initiative, other) that scopes files, content, and pending requests.
6. **Folders & files** — hierarchical organization within a company/project; resumable multipart upload direct to Cloudflare R2 up to 30 GB per file ([07](07-upload-architecture.md)).
7. **File lifecycle & deletion control** — status pipeline (received → in review → editing → edit complete → approved → archived) and a request/approve/reject deletion workflow for non-owners.
8. **Notes & comments** — attachable to company, project, file, content, or pending request.
9. **Follow-up topics** ("tópicos de acompanhamento") — directed, threaded conversations for accountability/follow-up, distinct from pending requests.
10. **Editorial calendar** — day/week/month/list views, any future period, content types, production status pipeline.
11. **Multi-network publication log** — manual status tracking per network (Instagram, Facebook, TikTok, YouTube Shorts) per content item.
12. **Pending requests** ("pendências") — material/approval/information requests with deadlines, priority, attachments, and status.
13. **Notifications** — internal notification center (read/unread) **and** push notifications (Web Push), both in Phase 1, sharing one event pipeline.
14. **Dashboards** — agency-wide and per-company, answering "what do I need to do now?"
15. **Campaign tracking** — manual, operational record of ad accounts and campaigns (Meta Ads, TikTok Ads) with change history. **No API integration and no automatic metrics** in Phase 1.
16. **Admin branding customization** — logo, favicon, app name, primary colors, login branding — no-code, via admin panel.
17. **Manual database backup** — admin-triggered, background job, protected temporary download. **Automatic scheduled backups are explicitly out of Phase 1 scope** (see [11-backup-and-recovery.md](11-backup-and-recovery.md#scope-resolution) for the contradiction this resolves).
18. **CI/CD** — push-to-`main` automated deploy to the VPS via GitHub Actions and Docker Compose, plus a manual deploy fallback command.

## Phase 2 — Evolution

Deferred deliberately to keep Phase 1 shippable and simple:

- Email notifications and email-based password recovery.
- **Automatic scheduled database backups** with the full 3-2-1 offsite strategy, retention tiers, and restore testing (the complete strategy described in `documentation.md` Section 23 is real and necessary — it is scheduled for Phase 2, not dropped; see [11-backup-and-recovery.md](11-backup-and-recovery.md)).
- Content-approval workflow (formal client sign-off states beyond the current manual status field).
- Advanced/faceted search.
- Calendar templates and schedule duplication.
- Upload UX refinements (e.g., background/offline queueing improvements) beyond the Phase 1 resumable baseline.
- More complete campaign operational tooling (still manual, richer reporting views).

## Phase 3 — Integrations & automation

- Meta Ads and TikTok Ads API integration.
- Automatic metrics synchronization (spend, balance, performance).
- Automatic scheduling and publishing to social networks.
- Automated reports.
- Performance/anomaly alerts.

## Explicitly out of scope (all phases, unless revisited)

- Per-client codebase forks or isolated deployments.
- Native mobile apps (the product is a responsive web app; see [23-open-questions.md](23-open-questions.md)).
- Storing complete media files in the application database or buffering them fully in backend memory — files live in R2; the database stores metadata only.
- Client-side-only permission enforcement.
- Recoverable/plaintext passwords.
- Automatic ad-platform publishing or metrics before Phase 3.
- Fabricated/demo data presented as production data.

## MVP acceptance criteria

See [22-acceptance-criteria.md](22-acceptance-criteria.md) for the full, testable list derived from `documentation.md` Section 21.
