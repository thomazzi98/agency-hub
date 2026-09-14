# 15 — API Conventions

## Naming

- **Code, identifiers, database tables/columns, API fields, files, and components: English.** UI copy: pt-BR. See [12-ui-ux-guidelines.md](12-ui-ux-guidelines.md#language).
- `snake_case` for database identifiers, `camelCase` for JSON payload fields and TypeScript identifiers, `PascalCase` for types/classes/components.
- REST resource paths are plural nouns: `/companies`, `/files`, `/pending-requests`.
- Enum values are `snake_case` strings, matching the database enum exactly, so no translation layer is needed between API and DB for status values.

## Response envelope

Success:
```json
{ "data": { }, "meta": { "page": 1, "pageSize": 20, "total": 134 } }
```
`meta` present only on paginated list endpoints.

Error:
```json
{ "error": { "code": "validation_error", "message": "Descrição amigável em pt-BR para exibição, se aplicável", "details": [ { "field": "email", "issue": "invalid_format" } ] } }
```
- `code` is a stable, English machine-readable identifier the frontend can branch on.
- `message` is safe to show a user only when explicitly marked user-facing; otherwise the frontend maps `code` to its own pt-BR copy per [12-ui-ux-guidelines.md](12-ui-ux-guidelines.md). This avoids ever leaking a backend implementation detail into the UI by accident.
- Validation errors always include field-level `details`.

## HTTP status usage

`200/201` success, `204` success with no body, `400` validation error, `401` unauthenticated, `403` authenticated but not authorized (includes cross-tenant attempts — never a `404` used to "hide" existence, except where the resource's existence itself is sensitive, e.g. another tenant's resource ID, where `404` is intentionally used to avoid confirming existence), `409` conflict (e.g., duplicate manual backup request), `422` semantically invalid but well-formed request, `429` rate-limited, `5xx` server error (never exposes internals in the body).

## Pagination, filtering, sorting

- Cursor or offset pagination (`page`/`pageSize` query params, default page size defined per resource, hard max enforced server-side regardless of client request) — see [17-performance-requirements.md](17-performance-requirements.md).
- Filtering via explicit query params per resource (e.g., `?status=open&companyId=...`), never a generic free-form query-builder passthrough.
- Sorting via `?sort=field&order=asc|desc`, restricted to an allow-list of sortable columns per endpoint (never an arbitrary client-supplied column, to avoid unindexed-sort abuse and injection surface).

## Authentication & authorization on every endpoint

- Session cookie required (see [10-authentication-and-sessions.md](10-authentication-and-sessions.md)); no endpoint other than `POST /auth/login` is reachable unauthenticated.
- Every handler resolves tenant scope and checks permission per [06-permissions-and-authorization.md](06-permissions-and-authorization.md) before touching data — implemented as shared middleware/decorators, not re-implemented per route, so the check can't be forgotten on a new endpoint.

## Validation

- Zod schemas define the request shape once; the same schema infers the TypeScript type used by the handler — no separate hand-maintained interface that can drift from the validator.
- Validation happens before any authorization or business logic runs, so malformed input fails fast and cheaply.

## File upload lifecycle (API shape)

See [07-upload-architecture.md](07-upload-architecture.md#backend-endpoint-contract-uppy-compatible-self-hosted-signer) for the full, implementation-ready contract (shaped to match Uppy's `@uppy/aws-s3` self-hosted-signer expectations):
- `POST /uploads` → create session
- `GET /uploads/:id/parts?partNumbers=...` → presigned URL(s) for the requested part number(s)
- `POST /uploads/:id/parts/:partNumber` → register a committed part (ETag, size)
- `GET /uploads/:id` → resume: reconciled (against R2 `ListParts`) committed parts
- `POST /uploads/:id/complete` → finalize
- `POST /uploads/:id/abort` → cancel

## Logging

- Structured JSON logs (see [20-observability-and-error-handling.md](20-observability-and-error-handling.md)) — never log passwords, session tokens, presigned URLs, or full request bodies containing personal data.
- Every log line includes a request ID for tracing a single request across the API and any job it enqueues.

## Environment variables

- All configuration (database URL, R2 credentials, VAPID keys, session secret/pepper, SSH deploy secrets) via environment variables, never hardcoded, never committed. `.env.example` documents every required variable with a placeholder value and a comment on where to obtain it — see [19-deployment-and-cicd.md](19-deployment-and-cicd.md).
- Development and production use separate values for every secret; no secret is ever shared across environments.

## Database access & transactions

- All multi-step writes that must be atomic (e.g., completing an upload session + creating the `File` row; approving a deletion request + soft-deleting the target) run inside a single database transaction.
- Reads that inform an authorization decision and the subsequent write happen inside the same transaction where a race condition would otherwise be exploitable (e.g., single-flight backup check-and-enqueue).

## Background jobs

- One job type per background task (backup generation, abandoned-upload cleanup, notification dispatch, push delivery) — see [13-technical-architecture.md](13-technical-architecture.md#background-jobs).
- Jobs are idempotent where retried automatically (a retried notification-dispatch job must not double-send).
- Job failures are logged with enough context to diagnose without reproducing (input parameters, error, stack), never with sensitive payload contents.

## Comments (code)

No comments explaining *what* the code does — names should already make that clear. A comment is only warranted for a non-obvious *why*: a workaround, a hidden constraint, a subtle invariant. This matches the project-wide convention and applies to every module.
