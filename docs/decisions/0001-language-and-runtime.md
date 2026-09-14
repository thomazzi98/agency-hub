# ADR-0001: Language, Runtime, and Web Framework

**Status:** Accepted

## Context

The source requirements mandate Node.js + TypeScript for the backend and a "responsive web application" for the frontend, but don't specify a web framework on either side. The project explicitly prioritizes simplicity, low infrastructure cost, and maintainability by a small team.

## Decision

- **Language:** TypeScript everywhere (backend and frontend), for shared type safety across the API boundary.
- **Backend framework:** Fastify — chosen over Express (too unopinionated, would require assembling schema validation/plugin patterns by hand) and NestJS (heavier DI/module ceremony than a small team needs for a modular-monolith of this size).
- **Frontend:** React + Vite as a client-rendered SPA — chosen over Next.js because this is an authenticated internal/agency tool with no SEO or public-marketing surface to justify SSR, and a static-built SPA is simpler and cheaper to host on the same low-cost VPS.

## Consequences

- Request validation and route schemas are defined once (Zod) and reused for both runtime validation and TypeScript inference.
- The frontend ships as static assets, decoupling its deploy/hosting from the backend's — either can be updated or scaled independently later.
- Losing SSR means no server-rendered first paint; acceptable because this app sits behind a login wall for every real screen.

## Alternatives considered

- **Express:** more familiar to more developers, but requires bolting on schema validation and structure that Fastify provides natively.
- **NestJS:** better suited to large teams needing strict architectural enforcement; overhead not justified here.
- **Next.js:** attractive for its conventions, but its server-rendering/API-route model would blur the line with the separate backend this spec already requires, and adds hosting complexity not needed for an authenticated tool.
