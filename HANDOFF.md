# Mediabuyer OS — Handoff Package

> **Purpose:** Everything GitHub Copilot Agent (or any engineer) needs to continue building from the current state. Read top to bottom before issuing any prompts.

---

## 1. Project summary

**Mediabuyer OS** is an internal operating system for a Meta-focused media buying agency. One agency, multiple clients, one source of truth for ad performance, alerts, tasks, and (later) AI-generated recommendations and client reports.

**Direction (locked):**
- Internal agency tool first, not a public SaaS.
- Meta Ads only for v1. No Google / TikTok / LinkedIn yet.
- Real Postgres-backed app. No mock-only product.
- No billing, no marketplace, no AI auto-actions in v1.
- AI is a layer **on top of** clean data, not the product itself.

**Founders:** Alex Carter (media buyer / GTM) + dev co-founder. Demo data in the seed is built around Alex's portfolio of 6 clients.

A long-form strategy document accompanies this repo at `docs/STRATEGY.md` covering positioning, MVP scope, roles, data model rationale, Meta API plan, AI workflow, dashboard structure, 18-week roadmap, monetization path, and a Copilot system prompt.

---

## 2. Honest status

> Read this section carefully before you assume what works.

### ✅ What is implemented and works
- **Full Prisma schema** (`prisma/schema.prisma`): every entity from the spec — User, Organization, OrganizationMember, Client, ClientAssignee, AdAccountConnection, Campaign, AdSet, Ad, Creative, InsightsDaily, Alert, Task, Recommendation, Report, ReportComment, SyncJob, AiRun, AuditLog. All enums, indexes, and relations are wired.
- **Seed file** (`prisma/seed.ts`): hydrates an org, 2 users (1 OWNER, 1 TEAM), the 6 clients from the screenshots with matching health/pacing/ROAS, 8 campaigns with 30 days of `InsightsDaily`, 8 creatives (4 winners), 7 tasks across all kanban columns, 4 open alerts.
- **Tailwind dark theme** (`tailwind.config.ts` + `src/app/globals.css`): HSL design tokens matching the screenshots, custom `success / warning / info` colors, Recharts overrides, scrollbar styling, dotted grid utility.
- **UI primitives** (`src/components/ui/*`): button, card, badge (with `withDot` and `success | info | warning | destructive` variants), input, label, table, tabs, avatar (gradient fallback), progress, dropdown-menu, select.
- **Sidebar + top bar** (`src/components/layout/*`): pixel-aligned to the screenshots — Mediabuyer/Agency OS brand block, Workspace section (Dashboard / Clients / Ops & Tasks / Alerts), Settings section (Integrations), Alex Carter user card.
- **Dashboard components** (`src/components/dashboard/*`): KPI card with trend delta, Spend & ROAS area chart (Recharts with gradient), Urgent tasks panel with priority dots, Active clients list with pacing bars + health badges. **Components exist but no page renders them yet — see "What's missing" below.**
- **Lib layer** (`src/lib/*`):
  - `db.ts` — Prisma singleton.
  - `utils.ts` — `cn`, `initials`, `pickGradient`.
  - `format.ts` — currency / percent / multiplier / delta formatters.
  - `encryption.ts` — AES-256-GCM for Meta tokens (format `iv:ciphertext:authTag` hex).
  - `auth.ts` — Clerk-backed `getCurrentUser`, `requireUser`, `hasRole`, `getAccessibleClientIds` (role-scoped client filtering). Falls back to first OWNER user when Clerk env vars are unset, so the app boots without auth in dev.
  - `meta/oauth.ts` — `signState`, `verifyState` (HMAC-SHA256), `buildAuthorizeUrl`, `exchangeCodeForToken`, `exchangeForLongLivedToken`. Real Graph API calls, not stubs.
  - `meta/client.ts` — `MetaClient` class with typed `listAdAccounts`, `listCampaigns`, `listAdSets`, `listAds`, `getInsightsDaily`.
  - `meta/sync.ts` — `syncStructural`, `syncInsightsIncremental`, `syncInsightsBackfill` with `SyncJob` row creation and error capture. Real upsert logic. TODO comment for switching to async batch reports at >50 ads.
- **Middleware** (`src/middleware.ts`): Clerk middleware that **bypasses entirely** when `CLERK_SECRET_KEY` or `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` are missing — so the app boots in dev with no Clerk setup.
- **Root layout** (`src/app/layout.tsx`): Inter font, dark mode, conditional `ClerkProvider`.

### ⚠️ What is mock data only
- **All seed data is fabricated** to match the screenshots. Real numbers will replace it once Meta OAuth + sync run successfully.
- **Creative thumbnails** are stored as the string `gradient:from-X to-Y` rather than real S3/CDN URLs. The intended `CreativeGrid` component (not yet built) should detect this prefix and render a Tailwind gradient block; once the Meta sync is live, real `thumbnailUrl` values will replace it.
- **`AdAccountConnection` rows** in the seed have no encrypted tokens — they're placeholders to make the UI render. Real connections require OAuth.
- **The Meta sync code is implemented but has never been executed against the real Graph API.** It is correct based on the v23.0 docs but will need at least one end-to-end test pass before you trust it.

### ❌ What is NOT built yet (critical — app does not currently render)
**There are zero page files. `npm run dev` will give you a 404 on every route.** The dashboard components exist as React modules but nothing imports them. You need to build:

1. `src/app/page.tsx` → redirect to `/dashboard`
2. `src/app/(app)/layout.tsx` → wraps Sidebar + TopBar around all authenticated routes; calls `requireUser()`
3. `src/app/(app)/dashboard/page.tsx` → KPI cards + spend chart + urgent tasks + active clients (server component, Prisma queries)
4. `src/app/(app)/clients/page.tsx` → Client Hub grid (matches screenshot: 3-column cards with budget / ROAS / pacing / platform badges)
5. `src/app/(app)/clients/new/page.tsx` → "Add client" form
6. `src/app/(app)/clients/[id]/page.tsx` → Client overview (spend, ROAS, CPA, CTR, conversions, recent alerts, recent tasks, notes)
7. `src/app/(app)/clients/[id]/campaigns/page.tsx` → Campaigns table with date + status filters (matches Performance screenshot)
8. `src/app/(app)/clients/[id]/creatives/page.tsx` → Creative library grid (matches Creative & Copy screenshot, with trophy icons for winners and hook rate stats)
9. `src/app/(app)/clients/[id]/tasks/page.tsx` → Per-client kanban
10. `src/app/(app)/ops/page.tsx` → Cross-client kanban (matches Ops & Automation screenshot: To do / In progress / Done columns with priority badges)
11. `src/app/(app)/alerts/page.tsx` → Cross-client alerts feed
12. `src/app/(app)/settings/integrations/page.tsx` → Meta connection UI ("Connect Meta Ads" button → `/api/meta/oauth/start`)
13. `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` + `sign-up/[[...sign-up]]/page.tsx` → Clerk `<SignIn />` / `<SignUp />` components
14. `src/app/api/meta/oauth/start/route.ts` → calls `buildAuthorizeUrl(signState({clientId, nonce, issuedAt: Date.now()}))` and redirects
15. `src/app/api/meta/oauth/callback/route.ts` → verifies state, exchanges code, calls `exchangeForLongLivedToken`, lists ad accounts via `MetaClient`, persists encrypted tokens via `encryptToken()`, creates `AdAccountConnection` rows, redirects to `/settings/integrations?connected=1`
16. `src/components/clients/client-card.tsx` + `src/components/clients/client-form.tsx`
17. `src/components/tasks/kanban-board.tsx` — 3 columns with priority-colored task cards (drag & drop optional in v1; click-to-move is fine)
18. `src/components/creatives/creative-grid.tsx` — gradient thumbnail grid, trophy icon for `isWinner`, ROAS + hook rate stats per card
19. `src/server/clients.ts` and `src/server/tasks.ts` — server actions with Zod validation + audit log writes
20. `README.md` — setup / run instructions
21. Real-time / cron triggers for `syncInsightsIncremental` (later)

### 🐛 Known risks / incomplete parts
- **Untested in a real Postgres instance.** The schema should `prisma db push` cleanly but has not been verified.
- **Untested against real Meta API.** Sync code is correct per docs but unproven.
- **`noUncheckedIndexedAccess` is `false`** in `tsconfig.json` to keep early iteration fast. Recommend flipping it on later and fixing the resulting strict errors.
- **No tests.** Vitest or Playwright should be added before the agency starts depending on this for billing decisions.
- **No rate limiting** on the Meta sync. Production needs to respect Meta's rate limits (1 call/sec/account is a safe default).
- **The `Decimal` type from Prisma** comes back as a `Decimal` object, not a JS number. Page components must `.toNumber()` or `Number(...)` before doing math. The dashboard components are typed for numbers — Copilot must convert at the page boundary.
- **Token rotation is not implemented.** Long-lived Meta tokens expire after 60 days; you need a refresh job.
- **No `pnpm-lock.yaml` or `package-lock.json`.** Whichever package manager you pick first will own the lockfile.
- **The `(auth)` route group is empty.** Sign-in/sign-up pages don't exist, so without Clerk env vars, the app falls into bypass mode; with Clerk env vars set, hitting `/sign-in` will 404 until those pages are written.

---

## 3. File / folder structure (current — 38 files)

```
mediabuyer-os/
├── .env.example
├── .gitignore
├── HANDOFF.md                          ← this file
├── README.md                           ← you'll add this (Copilot will generate it)
├── COPILOT_PROMPT.md                   ← the prompt to feed Copilot Agent
├── docs/
│   └── STRATEGY.md                     ← long-form product strategy (5k words)
├── next.config.mjs
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── prisma/
│   ├── schema.prisma                   ← 620 lines, complete data model
│   └── seed.ts                         ← 375 lines, matches screenshots
└── src/
    ├── middleware.ts                   ← Clerk + dev-bypass
    ├── app/
    │   ├── globals.css                 ← dark theme, HSL tokens, Recharts overrides
    │   └── layout.tsx                  ← root layout, Inter font, conditional ClerkProvider
    │   ── EVERYTHING BELOW IS MISSING AND MUST BE BUILT ──
    │   ├── page.tsx                                            (missing)
    │   ├── (app)/layout.tsx                                    (missing)
    │   ├── (app)/dashboard/page.tsx                            (missing)
    │   ├── (app)/clients/page.tsx                              (missing)
    │   ├── (app)/clients/new/page.tsx                          (missing)
    │   ├── (app)/clients/[id]/page.tsx                         (missing)
    │   ├── (app)/clients/[id]/campaigns/page.tsx               (missing)
    │   ├── (app)/clients/[id]/creatives/page.tsx               (missing)
    │   ├── (app)/clients/[id]/tasks/page.tsx                   (missing)
    │   ├── (app)/alerts/page.tsx                               (missing)
    │   ├── (app)/ops/page.tsx                                  (missing)
    │   ├── (app)/settings/integrations/page.tsx                (missing)
    │   ├── (auth)/sign-in/[[...sign-in]]/page.tsx              (missing)
    │   ├── (auth)/sign-up/[[...sign-up]]/page.tsx              (missing)
    │   ├── api/meta/oauth/start/route.ts                       (missing)
    │   └── api/meta/oauth/callback/route.ts                    (missing)
    ├── components/
    │   ├── layout/
    │   │   ├── sidebar.tsx             ← matches screenshot
    │   │   └── top-bar.tsx
    │   ├── dashboard/
    │   │   ├── active-clients.tsx
    │   │   ├── kpi-card.tsx
    │   │   ├── spend-roas-chart.tsx
    │   │   └── urgent-tasks.tsx
    │   ├── shared/
    │   │   └── empty-state.tsx
    │   ├── ui/                         ← 11 shadcn-style primitives
    │   │   ├── avatar.tsx
    │   │   ├── badge.tsx
    │   │   ├── button.tsx
    │   │   ├── card.tsx
    │   │   ├── dropdown-menu.tsx
    │   │   ├── input.tsx
    │   │   ├── label.tsx
    │   │   ├── progress.tsx
    │   │   ├── select.tsx
    │   │   ├── table.tsx
    │   │   └── tabs.tsx
    │   ── DIRECTORIES BELOW ARE EMPTY ──
    │   ├── clients/                    (empty — client-card, client-form to build)
    │   ├── tasks/                      (empty — kanban-board to build)
    │   └── creatives/                  (empty — creative-grid to build)
    └── lib/
        ├── auth.ts                     ← Clerk + role helpers
        ├── db.ts
        ├── encryption.ts               ← AES-256-GCM
        ├── format.ts
        ├── utils.ts
        └── meta/
            ├── client.ts               ← typed Graph API wrapper
            ├── oauth.ts                ← state signing + token exchange
            └── sync.ts                 ← structural + insights sync
```

Total: 3,101 lines of TypeScript / Prisma / CSS.

---

## 4. Tech stack used

| Concern | Choice | Pinned version |
|---|---|---|
| Framework | Next.js (App Router) | 14.2.18 |
| Language | TypeScript (strict) | 5.6.3 |
| UI | Tailwind CSS + shadcn-style primitives | Tailwind 3.4.14 |
| Charts | Recharts | 2.13.3 |
| Icons | lucide-react | 0.453.0 |
| ORM | Prisma | 5.22.0 |
| Database | PostgreSQL | 14+ recommended |
| Auth | Clerk (with dev bypass) | @clerk/nextjs 5.7.5 |
| Validation | Zod | 3.23.8 |
| Dates | date-fns | 4.1.0 |
| Class merging | clsx + tailwind-merge | clsx 2.1.1, twm 2.5.4 |
| Variant API | class-variance-authority | 0.7.0 |
| Radix primitives | dialog, dropdown-menu, label, select, slot, tabs, toast | latest as of pin |
| Token encryption | Node `crypto` (AES-256-GCM) | built-in |
| TS executor (seed) | tsx | 4.19.2 |

Full dependency list is in `package.json`.

---

## 5. Environment variables required

Copy `.env.example` to `.env` and fill in:

| Variable | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | Everything | Postgres connection string |
| `TOKEN_ENCRYPTION_KEY` | Meta OAuth | 64-char hex (32 bytes). Generate: `openssl rand -hex 32` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Auth | Leave empty for dev bypass |
| `CLERK_SECRET_KEY` | Auth | Leave empty for dev bypass |
| `META_APP_ID` | Meta OAuth | From developers.facebook.com |
| `META_APP_SECRET` | Meta OAuth | Treat as a secret |
| `META_API_VERSION` | Meta calls | Defaults to `v23.0` |
| `META_OAUTH_REDIRECT_URL` | Meta OAuth | `http://localhost:3000/api/meta/oauth/callback` in dev |
| `NEXT_PUBLIC_APP_URL` | Misc | `http://localhost:3000` in dev |

---

## 6. Setup commands

```bash
# 1. Install dependencies (use npm, pnpm, or bun — pick one and commit the lockfile)
npm install

# 2. Copy env and fill in DATABASE_URL + TOKEN_ENCRYPTION_KEY at minimum
cp .env.example .env

# 3. Generate Prisma client + push schema to Postgres
npx prisma generate
npx prisma db push

# 4. Seed demo data (matches the screenshots)
npm run db:seed

# 5. Run dev server
npm run dev
# → http://localhost:3000
# NOTE: with no pages built, this currently shows a Next.js 404. That is expected.
# After Copilot adds src/app/page.tsx + src/app/(app)/dashboard/page.tsx, the dashboard renders.
```

Useful scripts already wired in `package.json`:
- `npm run dev` — Next dev server
- `npm run build` — `prisma generate && next build`
- `npm run db:push` — push schema without migrations (dev only)
- `npm run db:migrate` — create + run a migration (production)
- `npm run db:seed` — run `prisma/seed.ts`
- `npm run db:studio` — Prisma Studio GUI
- `npm run db:reset` — wipe + reseed
- `npm run typecheck` — `tsc --noEmit`

---

## 7. How the foundation is intended to be used (so Copilot doesn't re-invent it)

This matters. Copilot should **consume** these primitives, not rebuild them:

- **Server components** query Prisma directly via `import { db } from "@/lib/db"`.
- **Page entry points** start with `const user = await requireUser();` from `@/lib/auth`. Then `await getAccessibleClientIds(user)` returns the IDs this user can read — every Prisma query that touches client data must filter by this set.
- **Mutations** live in `src/server/*.ts` files as Next.js server actions. Each action: (1) Zod-validates input, (2) re-checks access via `getAccessibleClientIds`, (3) performs the DB write, (4) writes an `AuditLog` row, (5) `revalidatePath` the affected routes.
- **Formatting** never inlined. Use `formatCurrencyCompact`, `formatCurrency`, `formatPercent`, `formatMultiplier`, `formatDelta` from `@/lib/format`.
- **Decimal handling.** Prisma returns `Decimal` objects for money / rate columns. Page components must convert: `Number(client.monthlyBudget ?? 0)`.
- **Status colors** are encoded in the `Badge` variants. Map `ClientHealth.EXCELLENT → success`, `GOOD → info`, `NEEDS_ATTENTION → warning`, `AT_RISK → destructive`. Always pass `withDot`.
- **Avatars** for clients/users use `<Avatar name={x.name} gradientSeed={x.id} />` so the gradient is stable per ID.
- **Creative thumbnails** stored as `gradient:from-X to-Y` should be detected by `<CreativeGrid />` (to be built) — if `thumbnailUrl?.startsWith("gradient:")`, render `<div className={`bg-gradient-to-br ${url.slice(9)}`} />`; else render `<img src={url} />`.
- **The sidebar's active route logic** uses `pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))`. Don't break this.

---

## 8. Roadmap pointer (from `docs/STRATEGY.md`)

**Weeks 1–2 (you are here):** finish the 16 missing page/route files; verify schema in real Postgres; verify Meta OAuth round-trip.

**Weeks 3–4:** Cron jobs (`vercel.json` schedule or a `pg_cron`+Inngest setup) for `syncInsightsIncremental` every 4h and `syncStructural` once daily; rule engine that creates `Alert` rows from `InsightsDaily` deltas.

**Weeks 5–6:** Alert → Task promotion; weekly client PDF report (use `@react-pdf/renderer` or Puppeteer).

**Weeks 7–8:** Closed-beta with 2 friend agencies; collect feedback; only then consider a public landing page.

**Weeks 9–14:** AI recommendation layer (Anthropic Claude API, structured outputs, `AiRun` table for cost tracking). Human-approval gate is non-negotiable.

**Weeks 15–18:** Client read-only portal (`UserRole.CLIENT` + `portalUserId` on `Client` already wired in the schema).

---

## 9. The single most important constraint

**Do not auto-execute changes on Meta ad accounts.** Every recommendation must be reviewed and approved by a human before any state change on Meta's side. The `Recommendation` model has a `status: PENDING → APPROVED → ACTED_ON` flow specifically to enforce this. The `META_SCOPES` array in `lib/meta/oauth.ts` currently requests **only `ads_read`, `business_management`, `read_insights`** — no write scope. Keep it that way until a deliberate decision is made to add `ads_management`, and only then add it behind a per-client feature flag.

---

End of handoff. Next step → see `COPILOT_PROMPT.md`.


## Strategy / Objective layer � known deviations from original spec

- StrategyObjective uses a CampaignObjectiveType enum (SALES, LEADS, TRAFFIC, ENGAGEMENT, AWARENESS, APP_PROMOTION, OTHER), NOT the raw Meta canonical objective strings (e.g. `OUTCOME_SALES`). Campaigns still store the raw Meta string in `Campaign.objective`; the join happens via `src/lib/meta/objectives.ts` → `normalizeMetaObjective()`. Maintenance implication: every time Meta releases a new objective value, the normalizer must be updated or it falls into OTHER.
- `Strategy.status` is an enum (DRAFT, ACTIVE, ARCHIVED). The `active` strategy is selected via `status === ACTIVE` + most recent `createdAt`.
- Strategy has `minCpa` / `maxCpa` / `minRoas` columns at the strategy level. These OVERRIDE the Client-level KPI bounds when set. Precedence: strategy value if non-null, else fall back to client. Currently no UI surfaces the override explicitly � the strategy page reads from strategy first.
- StrategyObjective has NO per-objective KPI overrides. If you need that later, add three new columns: `minCpa`, `maxCpa`, `minRoas`, all nullable Decimal.
- Strategy and StrategyObjective have NO `createdById` relation. Audit log captures who created each via `writeAudit` metadata only.
- Strategy and Ad Account pages inline their rendering (no separate `strategy-overview`, `objective-card`, `ad-account-card` components). Refactor if/when a second consumer needs the same shape.
- StrategyObjective has NO `label` field. Human labels come from `OBJECTIVE_LABEL` in `src/lib/meta/objectives.ts`.
