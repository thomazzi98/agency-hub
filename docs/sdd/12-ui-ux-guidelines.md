# 12 — UI/UX Guidelines

## Language

- **All user-facing UI text is Brazilian Portuguese** (pt-BR): labels, buttons, messages, emails/notifications, validation errors, empty states.
- Code stays in English regardless of UI language — see [15-api-conventions.md](15-api-conventions.md#naming).
- User-facing copy lives in a single translation/strings layer (even with only one locale in Phase 1) so pt-BR text is never hardcoded inline across components — this costs little now and avoids a painful extraction later if a second locale is ever needed.

## Mobile-first

- Every screen is designed for a phone viewport first; tablet/desktop are progressive enhancements of the same layout, not separate designs.
- The upload flow in particular must be fully usable one-handed on a phone, including pause/resume/cancel controls — see [07-upload-architecture.md](07-upload-architecture.md#mobile-considerations).
- Responsive breakpoints follow a mobile-first CSS approach (base styles for small screens, `min-width` media queries layer up).

## Required states on every screen that loads or mutates data

- **Loading state** — visible, never a blank screen.
- **Empty state** — useful, not just "no data" (e.g., explain what an empty pending-requests list means and what action creates the first one).
- **Error state** — friendly language, no raw stack traces or backend error codes in the UI copy, and a retry action where retrying is meaningful.
- **Success feedback** — explicit confirmation after a mutation (toast/inline message), not just a silent UI update.
- **Duplicate-submission prevention** — disable/guard the submit action while a request is in flight; a double-tap on a slow mobile connection must not create two records or two uploads.
- **Destructive-action confirmation** — any delete or irreversible status change requires an explicit confirm step, with copy that states what will happen.
- **Preserve input on failure** — a failed submission must not clear the form the user already filled in.

## Status indicators

- Every status enum in the system (file status, content production status, publication status, pending-request status, campaign status, topic status, upload state, backup status) has one consistent visual treatment (color + label pattern) reused everywhere it appears — not redefined per screen.
- Manually-reported values (campaign spend/balance — see [09-campaign-management.md](09-campaign-management.md)) are visually labeled as manual, not presented like a live metric.

## Performance-related UX rules

- Pagination on every list; infinite scroll or "load more" rather than full result sets.
- Lazy-load images and any non-critical content below the fold.
- **Videos never autoplay and are never pre-fetched** — playback starts only on explicit user interaction.
- Image previews are generated/fetched on demand, not eagerly for an entire file list.

## Accessibility

- Sufficient color contrast for text and status indicators (minimum WCAG AA contrast ratio), including for admin-customized brand colors — see below.
- Keyboard-navigable forms and dialogs; visible focus states.
- Meaningful alt text on non-decorative images.
- Form errors are associated with their fields programmatically, not conveyed by color alone.

## Branding assets

Admin-configurable, no code change required:
- Logo, favicon, application name, name shown in navigation and on the login screen, primary/secondary colors, login screen image or text.
- Asset constraints: maximum file size per asset type (e.g., logo/favicon), allowed formats (SVG/PNG for logo, ICO/PNG for favicon), automatic optimization on upload, and cache headers so brand assets don't get re-fetched on every page load.
- The system enforces a minimum contrast ratio when an admin sets custom colors, falling back to a safe default rather than allowing an inaccessible combination to be saved silently.

## Component approach

A shared, reusable component library (not per-screen bespoke components) so the required states above (loading/empty/error/success/confirm) are implemented once and applied consistently — see [13-technical-architecture.md](13-technical-architecture.md#code-organization) for where this lives in the codebase.
