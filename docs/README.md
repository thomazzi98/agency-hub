# Agency Hub — Documentation

This directory is the single source of truth for how Agency Hub is designed and built. It exists because `documentation.md` (root) states *what the agency needs*; the documents here define *how the platform will deliver it* before any application code is written.

## Structure

```text
docs/
├── sdd/            Spec-Driven Development set — product, domain, architecture, and process specs
├── decisions/       Architecture Decision Records (ADRs) — why we chose what we chose
└── README.md        This file
```

## Reading order

If you are new to the project, read in this order:

1. [sdd/00-overview.md](sdd/00-overview.md) — how the spec set is organized and the guiding principle
2. [sdd/01-product-scope.md](sdd/01-product-scope.md) — what the platform is, phase boundaries
3. [sdd/02-personas-and-roles.md](sdd/02-personas-and-roles.md) — who uses it
4. [sdd/13-technical-architecture.md](sdd/13-technical-architecture.md) — how it is built
5. [sdd/21-mvp-roadmap.md](sdd/21-mvp-roadmap.md) — the order of implementation
6. [sdd/23-open-questions.md](sdd/23-open-questions.md) — what is still unresolved

For a specific topic, go directly to the matching file in [sdd/](sdd/) — the full index is in [sdd/00-overview.md](sdd/00-overview.md).

For "why did we choose X over Y," check [decisions/README.md](decisions/README.md).

## Status

**Stage:** Specification only. No application code has been implemented yet. This entire set is subject to review before implementation begins — see [sdd/23-open-questions.md](sdd/23-open-questions.md) for items that need a decision or confirmation first.

## Source of truth

The original product requirements live in [`documentation.md`](../documentation.md) at the repository root, written in Brazilian Portuguese by the product owner. It remains authoritative for *intent*; this `docs/` set is the authoritative *specification* derived from it, including the resolution of a few internal contradictions found in the source (tracked in [sdd/23-open-questions.md](sdd/23-open-questions.md)).
