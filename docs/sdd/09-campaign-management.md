# 09 — Campaign Management

Phase 1 scope is **strictly manual and operational** — a system of record for what the agency's team already tracks in spreadsheets today, with history. No ad-platform API calls, no OAuth, no automatic metrics. That is Phase 3 ([01-product-scope.md](01-product-scope.md)). **Reconfirmed unchanged in the 2026-09-14 review round: registration, notes, status, and history only — no external advertising API integration in Phase 1.**

## Why this is in Phase 1 despite being "just a manual log"

The source requirements moved this into Phase 1 in the updated decisions section specifically because the agency needs a shared, auditable record of campaign status *today*, independent of any future ad-platform integration — replacing an ad-hoc spreadsheet with a permission-aware, multi-tenant record is itself the Phase 1 value, not a stepping stone that can wait.

## Ad accounts

Fields: platform (`meta` | `tiktok`, extensible), name, external account ID (as text — not validated against the platform, since there's no API call), company, status, notes.

## Campaigns

Fields: name, company, ad account, platform (denormalized from the account for convenience), objective, status, daily budget, total budget, reported spend, reported balance, last checked (manual entry of "as of" date), last change timestamp, responsible user, notes.

Status values: `active, paused, ended, with_problem, awaiting_approval, needs_attention`.

**Every spend/balance figure must be visibly labeled as manually reported** in the UI (per source requirement) — this is a display requirement, not just a data requirement, so users never mistake a manually-typed number for a live metric.

## Change history

Every field-level change to a `Campaign` writes a `CampaignHistory` row: user, timestamp, field name, previous value, new value, optional note. This is append-only and shown as a timeline on the campaign detail view — it is the main reason this module exists (accountability for who changed what and why, replacing "someone edited the spreadsheet and we don't know who or when").

## Permissions

- View: `agency_admin` always; `agency_manager` for their assigned companies; `client_manager` only for campaigns the agency has chosen to make visible to that client (a visibility flag per campaign, defaulting to visible — exact default is confirmed in [23-open-questions.md](23-open-questions.md) if the agency wants campaigns hidden from clients by default).
- Create/edit: `agency_admin` always; `agency_manager` only where their `CompanyMembership.can_manage_campaigns` override is `true` — this is the "gerenciar campanhas autorizadas" (manage authorized campaigns) rule from [06-permissions-and-authorization.md](06-permissions-and-authorization.md).
- `client_manager` and `contributor` never create/edit campaigns in Phase 1.

## Explicitly not in Phase 1

- No Meta Ads / TikTok Ads API connection or OAuth.
- No automatic spend/balance/performance sync.
- No scheduling or automated status changes.
- No alerts derived from live metrics (a `needs_attention` status is set manually by a human, not computed).

These become Phase 3 ([01-product-scope.md](01-product-scope.md)) once the manual workflow has validated what data actually matters to the agency.
