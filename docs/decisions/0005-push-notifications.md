# ADR-0005: Web Push (VAPID) Over a Native Push Provider

**Status:** Accepted

## Context

Push notifications are required in Phase 1, must respect tenant/permission scoping, and must not require rewriting the notification pipeline later. The product is a responsive web application, not a native mobile app, per [01-product-scope.md](../sdd/01-product-scope.md).

## Decision

Implement push via the standard **Web Push protocol with VAPID** keys, using the browser's native Push API and a service worker — no Firebase Cloud Messaging (FCM) or Apple Push Notification service (APNs) SDK/account in Phase 1.

## Consequences

- No vendor account, SDK, or per-message cost — Web Push is a browser/W3C standard.
- Works uniformly for the web app across desktop and Android browsers; iOS Safari's Web Push support is more recent and more limited, tracked as a known platform limitation (see [23-open-questions.md](../sdd/23-open-questions.md#open-questions-requiring-product-or-technical-confirmation)), not a Phase 1 blocker — the in-app notification center remains the system of record regardless of push delivery success.
- The Notification Service is architected with push as one delivery channel among others (in-app now, email in Phase 2) specifically so adding FCM/APNs later — if native apps are ever built — is a new channel adapter, not a rewrite.

## Alternatives considered

- **Firebase Cloud Messaging for web push:** would work, but adds a Google account/project dependency and vendor lock-in for a capability the open Web Push standard already provides without one.
- **Deferring push to Phase 2:** rejected — the source requirements and this task explicitly place push in Phase 1.
