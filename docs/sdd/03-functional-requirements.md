# 03 — Functional Requirements

This document enumerates Phase 1 functional modules. Critical subsystems (upload, notifications/push, campaigns, auth, backup) have dedicated deep-dive documents linked from each section — this document defines *what* exists; those documents define *how it behaves under failure, concurrency, and scale*.

## Companies

- CRUD for company records: name, logo, segment, responsible person, email, phone, status (`active` | `archived`), notes, created date.
- Archiving a company hides it from active lists but never deletes its data.
- Only `agency_admin` manages companies.

## Users & company membership

- Fields: name, email, role, linked companies (memberships), status, last access timestamp, notification preferences, registered push devices.
- `agency_admin` creates accounts (name, email, company/companies, role, status, initial password) and can later change role, memberships, status, and credentials.
- Password lifecycle: see [10-authentication-and-sessions.md](10-authentication-and-sessions.md).

## Projects

- Generic container type: property, product, service, event, campaign, internal project, other (extensible enum/string).
- Fields: name, code/reference, company, type, description, status, optional start/end dates, notes.
- Owns: files, folders, content, pending requests, comments, history, related publications.

## Folders & files

- Folders organize files within a company/project; may be nested.
- A contributor sees all folders/files of a company they belong to, regardless of who created the folder, and may add content to any of them.
- File metadata: original name, MIME type, size, uploader, timestamp, company, project, optional linked content/pending request, status.
- File status pipeline: `received → in_review → editing → edit_complete → approved → archived` (not strictly linear; `archived` reachable from any state).
- Search and filters by company, project, file type, status, uploader.
- Image preview on demand; video playback on demand (never autoplay, never pre-fetched).
- Download exclusively via short-lived signed URLs.
- Full upload behavior: [07-upload-architecture.md](07-upload-architecture.md).
- Deletion rules: [06-permissions-and-authorization.md](06-permissions-and-authorization.md#deletion-request-workflow).

## Editorial calendar

- Views: day, week, month, list; supports any future period (multi-month planning).
- Filters: company, responsible user, status.
- Content fields: company, optional project, title, description, type, date/time, responsible user, related file, production status, priority, notes.
- Content types: video, image, carousel, story, reels, YouTube Short, text, custom.
- Actions: create/edit, reschedule, duplicate content, duplicate a schedule, save as template (Phase 2 for templates/duplication of full schedules — single-item duplication is Phase 1), flag today's items, flag overdue items, flag client-blocked items.

## Production tracking

Per content item, track progression through: material received → editing started → editing complete → review requested → approval received → content prepared → publication registered.

Aggregate views per company: planned, in production, completed, awaiting material, overdue, awaiting approval, pending publication.

## Multi-network publication log

- Networks (Phase 1): Instagram, Facebook, TikTok, YouTube Shorts.
- One content item may have one independent publication record per network.
- Per-network fields: network, status, publication date, link, responsible user, notes, last update timestamp.
- Status values: `not_planned, planned, scheduled, published, not_published, failed, cancelled`.
- The UI must make it visually unambiguous which networks are done vs. pending for a given content item.
- **Manual only** in Phase 1 — no scheduling API, no auto-publish.

## Pending requests

Source term: *pendências*.

- Purpose: request materials, information, or approvals from a client or collaborator.
- Fields: title, description, company, optional project, responsible user, creator, due date, priority, status, attachments, history.
- Status values: `open, awaiting_client, answered, in_review, completed, cancelled`.
- The assigned recipient can respond, comment, and attach files; response files are linked to the pending request.

## Notes & comments

- Attachable to: company, project, file, content, pending request.
- Support: create, reply, author/timestamp tracking, file attachment, edit/delete per permission, promote a note into a pending request, notify involved users.
- **Distinction:** a *note* is informational; a *pending request* is an actionable item with a responsible party and optional deadline.

## Follow-up topics

Source term: *tópicos de acompanhamento*.

A directed, threaded conversation for accountability, follow-up questions, or requests for explanation — distinct from a pending request (no implied "task"), and distinct from a generic comment (has a single responsible respondent and a lifecycle).

- Created by `agency_admin` or `agency_manager`, targeting one responsible user.
- Fields: title, initial message, creator, responsible user, company, optional linked resource (project/content/campaign/pending request/file), priority, optional due date, status, created/updated timestamps, reply history.
- Status values: `open, awaiting_response, in_review, resolved, cancelled`.
- Replies form a sequential thread; each reply records author and timestamp.
- Creator can mark resolved, or continue the thread requesting clarification.
- Creation and each new reply may trigger a notification, deduplicated per update (no repeat notification for the same unread event).
- A topic **may generate a pending request** once a concrete action becomes clear — this is a manual user action (create pending request, optionally reference the topic), not an automatic conversion.
- Required views: created by me, awaiting my response, awaiting someone else's response, open, resolved, filterable by company/user/priority/period.
- Visible only to authorized users of the related company.

## Notifications (internal + push)

Full spec: [08-notifications-and-push.md](08-notifications-and-push.md). Summary:
- Internal notification center with read/unread state and an unread counter.
- Push notifications (Web Push) in Phase 1, sharing the same event pipeline and preferences as the internal center.
- Never cross company boundaries; every notification is authorized against the recipient's access before creation.

## Dashboards

### Agency dashboard (`agency_admin`, `agency_manager`)
Shows: active companies, recent files, today's content, overdue content, in-production content, pending requests awaiting clients, overdue pending requests, pending publications, campaigns needing attention, recent activity, unread notifications. Filterable by company, responsible user, period, priority, status. Must answer: *"What do I need to do now?"*

### Company dashboard (`client_manager`, `contributor` partial)
Own-company only: planned content, current production, upcoming posts, recent files, pending requests, active projects, publications, authorized campaigns, notifications. Simpler UI than the agency dashboard.

## Campaign management

Full spec: [09-campaign-management.md](09-campaign-management.md). Summary: manual ad-account and campaign registry (Meta Ads, TikTok Ads) with full change history; explicitly no API integration or automatic metrics in Phase 1.

## Admin branding customization

No-code, admin-panel-driven: logo, favicon, application name, name shown in navigation/login, primary colors, login screen image/text. Asset constraints (size, format, optimization, caching) defined in [12-ui-ux-guidelines.md](12-ui-ux-guidelines.md#branding-assets).

## Manual database backup

Full spec: [11-backup-and-recovery.md](11-backup-and-recovery.md). Summary: admin-triggered, background `pg_dump` job, compressed (optionally encrypted), streamed protected temporary download, one in-flight request at a time, fully audited.

## Search & performance

- Search across company, project, file, content, pending request, campaign.
- Filters: status, period, type, network, responsible user, priority.
- Pagination everywhere lists appear; no unbounded queries.
- Indexed PostgreSQL queries (see [14-database-design.md](14-database-design.md#indexing-strategy)).
- Loading and empty states on every list/view; clear, actionable error states.

## Audit trail

Every module above records creation, updates, and status transitions with actor + timestamp, per the audit convention in [14-database-design.md](14-database-design.md#audit-columns-convention). Security-relevant actions additionally write to the dedicated `audit_logs` table — see [16-security-requirements.md](16-security-requirements.md#audited-actions).
