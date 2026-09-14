# 20 — Observability and Error Handling

Phase 1 observability is intentionally lightweight — enough to diagnose problems and catch data-protection failures early, without standing up a full metrics/tracing stack the team doesn't yet need.

## Logging

- Structured JSON logs (e.g., via `pino`) from both the API and background workers.
- Every log line carries a request ID (propagated into any job enqueued from that request) so a single user action can be traced end-to-end.
- **Never logged:** passwords (plaintext or hash), session tokens, presigned URLs, full request bodies containing personal data, backup file contents/paths beyond what's needed to operate on them.
- Log level conventions: `error` for failures needing attention, `warn` for recoverable/unexpected conditions, `info` for significant lifecycle events (login, upload completed, backup completed), `debug` for local development only.

## Error handling

- Consistent error envelope and status codes across every endpoint — [15-api-conventions.md](15-api-conventions.md#response-envelope).
- User-facing error messages are always friendly pt-BR copy mapped from a stable error `code`, never a raw exception message or stack trace ([12-ui-ux-guidelines.md](12-ui-ux-guidelines.md)).
- Every unhandled exception is caught at the top level, logged with full context server-side, and returns a generic `5xx` response to the client — never a partial/inconsistent response.

## Health checks

- A lightweight `/health` endpoint (or equivalent) that verifies the API process is up and can reach PostgreSQL — used by the CI/CD pipeline's post-deploy check ([19-deployment-and-cicd.md](19-deployment-and-cicd.md)) and optionally by an external uptime check.

## Error tracking (optional, Phase 1)

- A hosted error tracker (e.g., Sentry's free tier) is recommended but not mandatory for Phase 1 — it meaningfully speeds up diagnosing production issues without adding operational burden, but the system must be fully functional and debuggable via logs alone if this is deferred. See [13-technical-architecture.md](13-technical-architecture.md#technology-decisions) and [23-open-questions.md](23-open-questions.md).

## Audit trail vs. logs

These are deliberately separate concerns:
- **Logs** are for operators diagnosing technical failures; they can be rotated/discarded after a retention window and are not a compliance record.
- **`audit_logs`** ([14-database-design.md](14-database-design.md), [16-security-requirements.md](16-security-requirements.md#audited-actions)) is a permanent, queryable, security-relevant record of *who did what to which resource, when* — never rotated away, viewable by `agency_admin` in the product itself.
- A security-relevant action is never recorded *only* in application logs — it always also produces an `audit_logs` row.

## Monitoring hooks reserved for Phase 2

Full infrastructure monitoring (disk space, DB volume growth, backup age/failure alerting, restore-test results) is specified in [11-backup-and-recovery.md](11-backup-and-recovery.md#monitoring) as part of the Phase 2 automatic-backup strategy. Phase 1 does not need this because it doesn't yet have a scheduled backup process to monitor — the manual backup's own success/failure is already visible in-product per [11-backup-and-recovery.md](11-backup-and-recovery.md).
