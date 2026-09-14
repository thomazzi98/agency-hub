# ADR-0008: Upload Client Library — Uppy (Self-Hosted Signing)

**Status:** Accepted

## Context

[ADR-0003](0003-upload-architecture.md) already commits to direct-to-R2 presigned multipart upload with the backend as a pure control plane. That decision doesn't by itself pick how the *browser side* implements chunking, retry, pause/resume, concurrency, and progress tracking — hand-rolled, or a maintained library. Given the source requirements treat upload reliability as the single most critical subsystem, minimizing custom, safety-critical upload code is a real reliability lever, not just a convenience.

## Decision

Use **Uppy** (`@uppy/core` + `@uppy/aws-s3`) on the browser, headless (no `@uppy/dashboard` prebuilt UI — our own components per [12-ui-ux-guidelines.md](../sdd/12-ui-ux-guidelines.md) drive it), in **self-hosted-signing mode**. Our backend implements the small signer contract `@uppy/aws-s3` expects ([07-upload-architecture.md](../sdd/07-upload-architecture.md#backend-endpoint-contract-uppy-compatible-self-hosted-signer)); we do **not** use Uppy's optional "Companion" relay server.

## Consequences

- Chunking, exponential-backoff retry, pause/resume, per-file and aggregate progress, and concurrency limiting are all handled by a widely-used, actively-maintained library instead of custom code we'd have to validate for every edge case ourselves.
- The architecture from ADR-0003 is unchanged: bytes still go browser → R2 directly. Explicitly rejecting Companion preserves this — Companion would relay bytes through a Node server, which we do not run in that role.
- Adds one client-side dependency (Uppy) and a specific, documented backend contract to implement and keep stable, rather than a bespoke protocol we fully control the shape of — considered a good trade given the reliability requirement.
- Concrete tuning defaults (chunk size, concurrency, retry backoff, TTLs) are configured through Uppy's options rather than reimplemented — see [07-upload-architecture.md](../sdd/07-upload-architecture.md#multipart-constraints-and-chunk-sizing-initial-configuration-values).

## Alternatives considered

- **Hand-rolled orchestration** (plain `fetch`/XHR + custom chunking/retry/resume state machine): full control, zero extra dependency, but re-implements a well-trodden problem (resumable chunked upload against presigned S3-style URLs) that's easy to get subtly wrong under real network failure conditions — exactly the failure modes this subsystem is most scrutinized for.
- **`tus` protocol** (`tus-js-client` + a `tus` server): mature resumable-upload protocol, but a `tus` server relays the request body itself into storage — even streamed, bytes pass through the VPS, conflicting with the direct-to-R2 requirement in ADR-0003. Rejected for this reason alone; see [07-upload-architecture.md](../sdd/07-upload-architecture.md#why-not-tus).
- **`evaporate.js`**: purpose-built for exactly this pattern historically, but far less actively maintained than Uppy today.
