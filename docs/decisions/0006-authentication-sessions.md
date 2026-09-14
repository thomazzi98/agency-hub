# ADR-0006: Server-Side Sessions Over Stateless JWT

**Status:** Accepted

## Context

Sessions must last approximately 7 days with sliding renewal, and — critically — must be **individually revocable from the admin panel**, including a "log out everywhere" action.

## Decision

Use **server-side sessions**: a `sessions` table in PostgreSQL, an opaque session identifier in an httpOnly/`Secure`/`SameSite=Lax` cookie, and the token stored server-side only as a hash.

## Consequences

- Revocation is a single row update (`revoked_at`), checked on every request — trivially correct and immediate.
- Requires a database read on every authenticated request; acceptable given PostgreSQL is already in the request path for nearly everything this API does, and the sessions table is small and well-indexed.
- No client-side token parsing/refresh logic needed — the cookie is opaque and httpOnly, reducing XSS-based token theft surface compared to a JWT held in `localStorage`.

## Alternatives considered

- **Stateless JWT:** avoids a database read per request, but true revocation requires either short-lived tokens with refresh (adding its own complexity) or a server-side blocklist — at which point the system already maintains server-side session state, just in a more roundabout way than a real sessions table. Rejected as strictly more complex for no benefit given this project's revocation requirement.
- **JWT + Redis-backed blocklist:** would work, but reintroduces the Redis dependency this project deliberately avoids ([ADR-0004](0004-background-jobs.md)) for a problem plain server-side sessions already solve.
