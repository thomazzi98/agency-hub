# ADR-0009: Concrete Security Parameters (Password Hashing, Session Duration, Login Abuse Protection)

**Status:** Accepted

## Context

[10-authentication-and-sessions.md](../sdd/10-authentication-and-sessions.md) originally specified the *mechanisms* (Argon2id, sliding sessions, rate limiting) without committing to concrete numbers, leaving them as "illustrative defaults." A security/architecture review pass asked for these to be measurable and testable, which requires actual numbers, not just named mechanisms.

## Decision

Ship the following as final Phase 1 defaults, each read from configuration (not hardcoded) so they can be tuned post-launch without a code change:

- **Argon2id parameters:** memory cost 19 MiB, iterations 2, parallelism 1 (OWASP-recommended minimum).
- **Session duration:** 7-day sliding expiry (renewed on activity), 30-day hard cap since original login.
- **Login lockout:** 5 consecutive failed attempts trigger exponential backoff (30s, 1m, 2m, 4m, ... capped at 15 minutes), resetting on success.
- **Per-IP login rate limit:** 20 attempts/hour, independent of which account(s) are targeted.
- **Manual backup file retention:** temporary backup files deleted 2 hours after completion, regardless of download.

## Consequences

- Every one of these now has a concrete, testable acceptance criterion ([22-acceptance-criteria.md](../sdd/22-acceptance-criteria.md)) instead of a vague "reasonable default" that different implementers might read differently.
- The Argon2id parameters are deliberately conservative (OWASP minimum, not maximum) because Phase 1 runs the hashing work on the same single VPS as the rest of the application. **Validated against the confirmed initial sizing ([ADR-0011](0011-infrastructure-sizing.md)):** on a 2 vCPU / 8 GB VPS, even a 20-concurrent-login burst uses well under 400 MiB at these settings — comfortable, no change needed at this VPS size.
- Because every value is configuration rather than a hardcoded constant, none of these require a new deploy to adjust if real-world usage shows a number is too strict (locking out legitimate users) or too loose (not slowing down abuse meaningfully).
- **Extended on review ([ADR-0010](0010-reauthentication-for-sensitive-operations.md)):** a related but distinct control, step-up reauthentication, was added for the single most consequential Phase 1 action (manual database backup generation) — a session-validity check alone was judged insufficient for that specific action, independent of these password-hashing/session/lockout parameters.

## Alternatives considered

- **Leaving these as "illustrative" indefinitely, tuned only at implementation time:** rejected — it left security-relevant behavior untested and unverifiable until an implementer made an arbitrary call, which is exactly the kind of silent architectural decision this spec's process is meant to avoid.
- **bcrypt instead of Argon2id:** acceptable fallback if a runtime lacks a good Argon2 library, but Argon2id is the stronger default and Node has mature bindings (`argon2` npm package), so there's no reason to start with the weaker option.
