# GitHub Copilot Instructions — `business-solutions-platform`

> Repo-level context and guardrails for GitHub Copilot Agent. Read before editing anything.

## Repo purpose
Internal **Meta-Ads operating system** for a media buying agency (Loopa Growth / Media Buyer
OS). It connects real client Meta Ad accounts, syncs structural + insights data into Postgres,
gates data behind an audit-PASS check, and exports per-client digests and creative bundles for
triage and creative analysis. **Internal tool, not SaaS. Meta-only. Production is live.**

This is a real-data product. There is no AI inside the platform yet — AI stays in a manual
export-and-paste loop.

## Stack
Next.js 14 (App Router) · TypeScript (strict) · Prisma + PostgreSQL · Clerk auth · Tailwind +
shadcn/ui-style primitives · Recharts. Deployment target: Coolify / Hostinger.

> Older docs in this repo (`docs/STRATEGY.md`, `HANDOFF.md`, `COPILOT_PROMPT.md`, `README.md`)
> contain stale planning (Vercel, Inngest, Supabase, demo personas). They are NOT current
> truth. This file and the maintainer's prompt win.

## Product modules
- **Meta App Profiles** — multiple, encrypted secrets, per-connection OAuth.
- **Connections** — real client ad accounts.
- **Structural sync** — campaigns / ad sets / ads / creatives; reconciles stale rows.
- **Insights backfill** — 30 days; `insightsBackfilledAt` is the trust signal.
- **Audit script** — read-only; must return PASS before data is trusted / account onboarded.
- **Digest export** — per-client Markdown, audited-PASS gated.
- **Creative bundle export** — per-connection ZIP (Markdown manifest + images).
- **Internal pages** — dashboard, clients, client ad-account page, creatives, campaigns,
  tasks, settings/integrations.

## Development rules (hard)
1. **Do exactly one tightly-scoped change per task.** If a task needs files beyond those named
   in the prompt, **STOP and report** instead of expanding scope.
2. **Never edit files the prompt did not name.** No redesigns, no refactors, no "improvements"
   while you're in a file.
3. **No new dependencies** unless the prompt explicitly permits one.
4. **No OAuth / App Profile logic changes** unless the task is explicitly about that.
5. **Typecheck/build must pass** before the change is considered done.
6. Every change has a stated success criterion and a verification step. Report results
   honestly, including failures.

## Meta API sync safety rules
- Scopes are **`ads_read` and `business_management` only**. Do not add others (a stray
  `read_insights` was already removed).
- Respect rate limits: error code 17 (subcode 2446079). Keep the existing **150ms inter-call
  delay**, the typed `MetaRateLimitError`, the `RATE_LIMIT:` persisted-error prefix, and the
  clean user-facing surfaced string. Do not remove these.
- **Never conflate timestamps:** `structuralSyncedAt` (structure done) vs `insightsBackfilledAt`
  (insights done) are separate and load-bearing. A successful structural sync must never mark
  insights as complete.
- **No silent failures.** Insight loops must keep explicit counters + logging. Never a bare
  `continue` that makes total failure look like success.
- **Never return NaN** from insight parsing. Use the `actionTotal` / `finiteOrNull` helpers;
  view-through-only attribution and missing values must resolve to 0 or null, never NaN.
- Meta image/creative **CDN URLs expire** — never embed an expiring Meta URL where it will be
  rendered later. Fetch bytes at export/ingest time.
- **Known unfixed bug:** the `persistInsight` *update* branch does not refresh
  `ctr` / `frequency` / `clicks` on re-pulls. Do not rely on those being fresh on re-synced
  days. Do not "fix" this opportunistically — it is fixed only in a dedicated, scoped task.

## Prisma / database safety rules
- **Additive schema changes only.** No destructive or non-additive migrations without an
  explicit, dedicated task.
- **Preserve production data.** Mach Supplements (`act_2106505896497404`) data is inviolable.
- For clean testing use the existing `db:clean` script (`prisma/clean.ts`) — it wipes data but
  preserves schema + auth and creates one OWNER user + org for dev-bypass. Never point a wipe
  at production.
- Polymorphic `InsightsDaily` cleanup must accompany structural reconciliation (deleting a
  campaign/ad must clean its insight rows).

## Client data isolation
- Every data-access path must authorize via `requireUser()` + the accessible-client check
  (`getAccessibleClientIds()` pattern, as in `src/server/digest.ts`).
- Return 403 on unauthorized access, 404 when an entity does not exist for the caller.
- Roles: OWNER (Senior Media Buyer), TEAM (Media Buyer), CLIENT, VIEWER. Client-facing views
  are read-only.
- Never leak one client's data into another client's view or export.

## Creative library / preview rules
- Exports and creative views are **hard-blocked when `insightsBackfilledAt` is null** (409 with
  a plain-text reason).
- Creative bundle = ZIP: `creatives.md` manifest + `images/` downloaded server-side at export
  time (timeout per fetch, skip oversized files, infer extension from content-type).
- On image download failure, continue and record an "image unavailable — Meta CDN URL likely
  expired; run Sync Now and re-export" note for that creative. Do not fail the whole export.
- **Video files are NOT included.** For VIDEO creatives, emit the explicit line that analysis
  basis is thumbnail + copy + retention funnel only (hook rate, p25/p50/p75/p100).
- No re-calls to the Meta Graph API inside an export route. No storage layer (S3/R2) yet — it
  is the correct long-term fix but is deferred.

## UI / code style expectations
- Match the existing dark theme and shadcn/ui-style primitives; reuse existing components.
- Server components by default; `"use client"` only where interaction requires it.
- All `Decimal` values → `Number()` before formatting; route numbers through the existing
  `@/lib/format` helpers.
- No HTML `<form>` reliance where the codebase uses server actions + `useState`.
- Keep diffs minimal and readable; match surrounding patterns rather than introducing new ones.

## Common risk areas (be careful here)
- **Timestamp conflation** (`structuralSyncedAt` vs `insightsBackfilledAt`) — a past source of
  false PASS signals.
- **Stale ctr/frequency/clicks** on re-pulls (the `persistInsight` update-branch bug).
- **Expiring Meta CDN URLs** for creative media.
- **Silent error swallowing** in insight loops.
- **NaN** from view-through-only / missing attribution values.
- **Seed contamination** — fake `cmp_xxx`-style IDs cause Meta 400s on insights sync.
- **OAuth redirect base URL** behind ngrok/proxy — must use `getPublicBaseUrl`
  (`X-Forwarded-Host` / `X-Forwarded-Proto`).
- **Rate limiting** from repeated sync attempts during testing.
- **Token expiry** — Meta tokens die at 60 days; rotation not yet built.

## Verification checklist (run for every change)
1. Typecheck / build passes.
2. If sync/insights touched: Sync Now on the test account, confirm the intended effect, then
   **regression-check Mach** — re-run the audit script, expect PASS, same row counts/date span,
   unchanged spend/ROAS on the overview.
3. New account onboarding is gated by the audit script (PASS required) before it is trusted.
