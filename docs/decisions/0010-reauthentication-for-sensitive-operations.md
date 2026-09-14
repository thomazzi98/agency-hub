# ADR-0010: Step-Up Reauthentication for Sensitive Operations

**Status:** Accepted

## Context

The permission model ([06-permissions-and-authorization.md](../sdd/06-permissions-and-authorization.md)) gates every action on role and company membership, checked against the current session. For most actions, "the session is valid and the role/membership check passes" is the right and sufficient bar. A 2026-09-14 review round asked specifically whether the most consequential Phase 1 action — generating a full database backup — should require something more than that, given an unattended, already-authenticated browser session is a realistic threat scenario (a shared office computer, a device left unlocked) that a role check alone doesn't defend against.

## Decision

Introduce **step-up reauthentication**: for a small, explicitly named set of operations (Phase 1: triggering a manual database backup), the endpoint additionally requires that the actor verified their password within the last **15 minutes** — either via their original login or a previous step-up — prompting for a fresh password entry if that window has lapsed, before the operation proceeds. This is a narrow, per-request check layered on top of the existing session, not a new session and not a change to the session's own sliding-expiry behavior ([10-authentication-and-sessions.md](../sdd/10-authentication-and-sessions.md#reauthentication-for-sensitive-operations-approved-2026-09-14)).

## Consequences

- A stolen or unattended session cannot trigger a full database dump without the attacker also knowing the account's current password — meaningfully raising the bar for the single most damaging action available in Phase 1 (a complete data export).
- Adds one specific, well-scoped piece of friction to one rare, deliberate admin action — negligible cost against the security benefit, and consistent with "reduce disorganization, don't create more work" ([00-overview.md](../sdd/00-overview.md)) precisely because it's scoped to a rare action, not applied broadly.
- Sets a precedent and a reusable mechanism for any future sensitive action that warrants the same treatment (e.g., mass role changes, revoking all of a user's sessions) — left as an open question in [23-open-questions.md](../sdd/23-open-questions.md) for which other actions should adopt it, rather than pre-emptively applying it everywhere.
- Requires the session to track a "last password verification" timestamp distinct from `last_active_at` — a small, additive schema change to `sessions` ([14-database-design.md](../sdd/14-database-design.md)), not a new subsystem.

## Alternatives considered

- **A separate short-lived step-up token** (e.g., a signed token issued on reauthentication, passed explicitly on the sensitive request): more conventional in some API designs, but adds a second credential type to design, transmit, and invalidate for a single Phase 1 use case — the timestamp-on-session approach achieves the same guarantee with less new surface area, and can be upgraded to a token-based design later if more sensitive operations are added and the pattern needs to generalize.
- **No step-up requirement, rely on role + rate limiting alone:** rejected for this specific action — a role check defends against the wrong actor, not against the right actor's session being misused, which is exactly the scenario step-up reauthentication is for.
- **Require reauthentication on every backup-related call (trigger and download):** considered unnecessary — the download URL is already short-lived, single-purpose, and independently permission-checked ([11-backup-and-recovery.md](../sdd/11-backup-and-recovery.md)); gating the far more consequential *generation* step is where the real risk is concentrated.
