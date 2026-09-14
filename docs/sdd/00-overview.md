# 00 — Overview

## What this is

Agency Hub is a multi-tenant web platform that centralizes operations for a social media, content production, and paid-traffic agency: file organization, editorial planning, production tracking, multi-network publication logging, client/collaborator communication, and manual campaign tracking — for many client companies from a single codebase.

This document set is a **Spec-Driven Development (SDD)** package: a complete technical and product specification written *before* implementation, so that every implementation stage has an unambiguous target, and so that architectural decisions are made deliberately rather than discovered mid-build.

## Guiding principle

> The platform must reduce the agency's disorganization — it must not create more work.

Every feature, permission rule, and UX requirement in this spec traces back to this. When a requirement is ambiguous, the resolution that adds the least friction to daily use — while never compromising tenant isolation or data safety — wins.

## How to read this set

- **Product & people** (01–03): what the platform does, for whom, in what order.
- **Cross-cutting requirements** (04–06): quality bar and the permission model that every feature must satisfy.
- **Deep dives on critical subsystems** (07–11): upload, notifications, campaigns, auth, backup — called out separately because the source requirements treat them as make-or-break.
- **Experience & engineering foundation** (12–20): UI/UX rules, architecture, data design, API/security/performance/testing/deployment/observability conventions that apply to every module.
- **Execution** (21–23): the implementation roadmap, the criteria that define "done" for the MVP, and everything still open.

## Conventions used throughout this spec

- **UI language:** Brazilian Portuguese (pt-BR) — all user-facing text, labels, emails, and notification copy.
- **Code language:** English — identifiers, database tables/columns, API fields, file names, component names, commit messages. See [15-api-conventions.md](15-api-conventions.md) and [14-database-design.md](14-database-design.md).
- **Tenant** = a client company (`Company` entity). "Multi-tenant" and "multi-company" are used interchangeably.
- **MUST / SHOULD / MAY** follow RFC 2119 intent: MUST is a hard requirement for Phase 1 acceptance, SHOULD is strongly expected but negotiable with justification, MAY is optional.
- Every entity that records history uses the audit convention defined in [14-database-design.md](14-database-design.md#audit-columns-convention): who did it, when, and — for state changes — what changed.

## Phases at a glance

Full detail in [01-product-scope.md](01-product-scope.md). Short version:

| Phase | Theme | Examples |
|---|---|---|
| **Phase 1 (MVP)** | Manual operations, done well | Auth, companies/users/roles, projects/folders, resumable uploads to R2, calendar & production tracking, manual multi-network publication log, pending requests, notes/comments, follow-up topics, internal + push notifications, dashboards, manual campaign tracking, admin branding, manual DB backup, automated CI/CD |
| **Phase 2** | Evolution & safety net | Email notifications & recovery, automatic scheduled DB backups (3-2-1 strategy), content-approval workflow, advanced search, calendar templates, upload UX refinements |
| **Phase 3** | Integrations & automation | Meta Ads / TikTok Ads API integration, automatic metrics sync, automatic scheduling/publishing, automated reports, performance alerts |

## Document index

### Product
- [01-product-scope.md](01-product-scope.md)
- [02-personas-and-roles.md](02-personas-and-roles.md)
- [03-functional-requirements.md](03-functional-requirements.md)
- [04-non-functional-requirements.md](04-non-functional-requirements.md)

### Domain & permissions
- [05-domain-model.md](05-domain-model.md)
- [06-permissions-and-authorization.md](06-permissions-and-authorization.md)

### Critical subsystems
- [07-upload-architecture.md](07-upload-architecture.md)
- [08-notifications-and-push.md](08-notifications-and-push.md)
- [09-campaign-management.md](09-campaign-management.md)
- [10-authentication-and-sessions.md](10-authentication-and-sessions.md)
- [11-backup-and-recovery.md](11-backup-and-recovery.md)

### Experience & engineering foundation
- [12-ui-ux-guidelines.md](12-ui-ux-guidelines.md)
- [13-technical-architecture.md](13-technical-architecture.md)
- [14-database-design.md](14-database-design.md)
- [15-api-conventions.md](15-api-conventions.md)
- [16-security-requirements.md](16-security-requirements.md)
- [17-performance-requirements.md](17-performance-requirements.md)
- [18-testing-strategy.md](18-testing-strategy.md)
- [19-deployment-and-cicd.md](19-deployment-and-cicd.md)
- [20-observability-and-error-handling.md](20-observability-and-error-handling.md)

### Execution
- [21-mvp-roadmap.md](21-mvp-roadmap.md)
- [22-acceptance-criteria.md](22-acceptance-criteria.md)
- [23-open-questions.md](23-open-questions.md)

### Decisions
- [../decisions/README.md](../decisions/README.md) — ADR index
