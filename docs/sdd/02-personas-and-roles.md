# 02 — Personas and Roles

Four fixed roles in Phase 1. Roles are global per user (a user has exactly one role) combined with **per-company membership** that grants access to a specific tenant, optionally carrying permission overrides for that membership. **Any role may hold more than one active company membership when an `agency_admin` grants it** — this is confirmed, supported behavior for all four roles, not just agency staff; see [06-permissions-and-authorization.md](06-permissions-and-authorization.md#multi-company-membership-is-supported-for-every-role) for the confirmed model and concrete examples (a freelance contributor working for two clients, a client group with multiple registered companies).

Code identifier convention: `snake_case` enum values, defined once in [14-database-design.md](14-database-design.md).

## Agency Administrator — `agency_admin`

**Who:** Agency owner/operator staff with full operational and system control.

**Persona goal:** "I need to see and control everything across every client, manage the team, and keep the system healthy."

Can:
- Access every company without an explicit membership row (implicit all-tenant access).
- Create, edit, and archive companies.
- Create, edit, deactivate users; assign roles; manage company memberships and permission overrides.
- Generate temporary passwords / reset passwords for any user; revoke sessions.
- Approve or reject file/content deletion requests.
- Access all modules in all companies, including campaigns and branding settings.
- Trigger and download manual database backups.
- View the agency-wide dashboard.

Never (by design, not by omission):
- Nothing is withheld from this role within the application; it is still bound by [16-security-requirements.md](16-security-requirements.md) (audit logging, no plaintext password visibility for *other* users, safe deletion workflow).

## Agency Manager — `agency_manager`

**Who:** Internal agency staff (social media managers, editors, traffic managers) assigned to specific client companies.

**Persona goal:** "I run day-to-day production and client communication for the companies I'm assigned to."

Can (scoped to companies where they hold a membership):
- Manage files, content, and calendar entries.
- Create and resolve pending requests; create follow-up topics.
- Comment/add notes.
- Register publications per network.
- Manage campaigns **only** where the `can_manage_campaigns` membership permission is granted (see [06](06-permissions-and-authorization.md)) — this is the "authorized campaigns" rule from the source requirements.
- Delete files per the membership's configured deletion permission (`can_delete_company_files`); otherwise must use the deletion-request workflow like a contributor.

Never:
- Access a company without a membership.
- Create/archive companies, manage other users' roles, change global branding, or trigger backups.

## Client Manager — `client_manager`

Source term: *Cliente contratante*. This is the client-side point of contact — broad visibility into their **own** company only.

**Persona goal:** "I want to see what the agency is doing for my business, provide materials, and approve or flag things — without managing the agency's internals."

Can (scoped to their own company/companies):
- View the company dashboard.
- View the calendar and production status.
- View and download authorized files.
- Upload/submit materials.
- Respond to pending requests; comment.
- View campaigns the agency has made visible to them.

Never:
- See another company's data.
- Delete files they did not upload (must use the deletion-request workflow).
- Manage users, roles, branding, or campaigns' operational fields (budget/status) unless explicitly granted — Phase 1 default is view + respond only.

## Contributor — `contributor`

Source terms: *Contribuidor* / *corretor* (the latter reflecting the original real-estate-agency client base; the role is generic and applies to any collaborator who submits materials — photographer, videographer, salesperson, freelancer, etc.).

**Persona goal:** "I need to upload material for a project I'm working on, quickly and from my phone, and see what's mine and what's shared with me."

Can (scoped to their own company/companies):
- Upload files.
- View **all** folders and files of the companies they belong to (per their membership), even folders they did not create.
- Add content to any folder in their own company.
- Download and comment on files they have access to.
- View the calendar content permitted to them.
- Respond to pending requests; comment.
- Receive notifications (in-app and push).
- Delete **only files they personally uploaded**.
- Request deletion of any other file/content — the request is queued for admin review (see [06-permissions-and-authorization.md](06-permissions-and-authorization.md#deletion-request-workflow)).

Never:
- Access another company.
- Directly delete another user's files.
- Change global or company settings.
- Manage campaigns without an explicit, specific grant.

## Role summary matrix

| Capability | Agency Admin | Agency Manager | Client Manager | Contributor |
|---|:---:|:---:|:---:|:---:|
| Access scope | All companies | Assigned companies | Own company | Assigned companies |
| Manage companies/users/branding | ✅ | ❌ | ❌ | ❌ |
| Approve/reject deletion requests | ✅ | ❌ | ❌ | ❌ |
| Manage campaigns | ✅ | If granted | View only (if visible) | ❌ |
| Delete any file in company | ✅ | If granted | ❌ | ❌ |
| Delete own uploaded file | ✅ | ✅ | ✅ | ✅ |
| Request deletion of others' files | N/A (can delete directly) | If not granted direct delete | ✅ | ✅ |
| Upload files | ✅ | ✅ | ✅ | ✅ |
| View all company folders/files | ✅ (all companies) | ✅ (assigned) | ✅ (own) | ✅ (assigned) |
| Trigger DB backup | ✅ | ❌ | ❌ | ❌ |
| View agency dashboard | ✅ | ✅ (their companies' data) | ❌ | ❌ |
| View company dashboard | ✅ | ✅ | ✅ | Partial (relevant sections) |

Full action-by-resource detail lives in [06-permissions-and-authorization.md](06-permissions-and-authorization.md).
