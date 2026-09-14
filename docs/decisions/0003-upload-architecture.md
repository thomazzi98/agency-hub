# ADR-0003: Direct-to-R2 Resumable Multipart Upload

**Status:** Accepted

## Context

Files up to 30 GB must upload from mobile devices over unreliable networks, without ever fully buffering in the browser, backend, or VPS. This is called out in the source requirements as the single most critical subsystem.

## Decision

The backend acts purely as a **control plane**: it authenticates, authorizes, creates an R2 multipart upload session, mints short-lived presigned part URLs in small batches, validates completion, and persists metadata. The browser is the **data plane**: it streams file chunks directly to Cloudflare R2 (S3-compatible API) via presigned URLs, never routing file bytes through the backend.

## Consequences

- Satisfies "no full file in backend/VPS memory" by construction, not by careful memory management that could regress.
- Backend load for a 30 GB upload is trivial (a handful of small API calls for session/parts/completion), regardless of file size — the VPS never becomes a bottleneck for upload throughput.
- Resumability, retry, pause/cancel all become client-orchestrated behaviors over a small, well-defined control-plane API, which the backend can authorize at every step.
- Requires an abandoned-upload cleanup job, since incomplete multipart uploads consume storage on R2 until explicitly aborted — this is treated as a hard Phase 1 requirement, not an optimization.

## Alternatives considered

- **Proxying uploads through the backend:** simpler client logic, but violates the explicit "no full file in backend" requirement and would make the VPS a throughput and memory bottleneck for exactly the files (largest) where that matters most.
- **A managed resumable-upload service:** would add an external paid dependency for a capability R2's native S3-compatible multipart API already provides for free.
