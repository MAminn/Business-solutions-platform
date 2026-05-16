# Copilot Agent Prompt — Continue Mediabuyer OS

> **How to use this file:**
> Paste the prompt block below into the GitHub Copilot Agent / Opus chat panel after you've cloned this repo and opened it in your IDE. Make sure the agent has read access to **every file in the workspace** including `HANDOFF.md`, `docs/STRATEGY.md`, `prisma/schema.prisma`, and the entire `src/` tree before you submit.
>
> The prompt is split into three sections so you can issue them sequentially. Section 1 is the system context. Section 2 is the immediate task. Section 3 is the acceptance contract.

---

## Section 1 — System context (paste first)

```
You are a senior full-stack engineer continuing work on Mediabuyer OS, an
internal operating system for a Meta-focused media buying agency. Before you
write a single line of code, read the following files in this exact order and
keep them in working memory:

  1. HANDOFF.md                   — current state, what is built, what is missing
  2. docs/STRATEGY.md             — product strategy, scope boundaries, roadmap
  3. prisma/schema.prisma         — the data model is locked, do not modify it
  4. prisma/seed.ts               — demo data shape; match the existing client names
  5. src/lib/auth.ts              — every page must start by calling requireUser()
  6. src/lib/db.ts                — Prisma singleton
  7. src/lib/format.ts            — use these formatters, do not inline number formatting
  8. src/lib/utils.ts             — cn, initials, pickGradient
  9. src/lib/meta/oauth.ts        — buildAuthorizeUrl, signState, verifyState,
                                    exchangeCodeForToken, exchangeForLongLivedToken
 10. src/lib/meta/sync.ts         — the three sync entry points
 11. src/components/ui/*          — primitives (button, card, badge, etc.)
 12. src/components/layout/*      — Sidebar, TopBar
 13. src/components/dashboard/*   — KpiCard, SpendRoasChart, UrgentTasks,
                                    ActiveClients (already built; just import them)
 14. src/middleware.ts            — Clerk with dev-bypass; do not break the bypass
 15. tailwind.config.ts + src/app/globals.css — design tokens

Hard rules:

- TypeScript strict. Never use `any`. Use `unknown` + narrowing when you must.
- Server components by default. Mark `"use client"` only when you need state,
  effects, or browser-only APIs.
- All Prisma queries scoped to the current user's accessible clients via
  `await getAccessibleClientIds(user)` from src/lib/auth.ts. No exceptions.
- All mutations go through src/server/*.ts as Next.js server actions. Each
  action: (1) Zod-validate input, (2) re-check access, (3) write to DB,
  (4) insert an AuditLog row, (5) revalidatePath the affected routes.
- Prisma Decimal columns must be converted with `Number(...)` before any math
  or before passing to components typed for `number`.
- Use the existing UI primitives. Do NOT re-implement buttons, cards, badges,
  tables, etc. Do NOT install or run `shadcn` CLI.
- Use the existing formatters in src/lib/format.ts. Never inline currency or
  percent formatting in JSX.
- Status colors are encoded in the Badge variants:
    ClientHealth.EXCELLENT       → variant="success"   withDot
    ClientHealth.GOOD            → variant="info"      withDot
    ClientHealth.NEEDS_ATTENTION → variant="warning"   withDot
    ClientHealth.AT_RISK         → variant="destructive" withDot
- Avatars use `<Avatar name={x.name} gradientSeed={x.id} />` so gradients are
  stable per ID.
- Creative thumbnails stored as `gradient:from-X to-Y` should render as a
  Tailwind gradient block; real URLs render as <img>. Branch on
  `thumbnailUrl?.startsWith("gradient:")`.
- Meta OAuth scopes are read-only (ads_read, business_management,
  read_insights). Do not add `ads_management` without explicit approval.
- No auto-execution of changes on Meta ad accounts. Recommendations require a
  human approval gate via the Recommendation.status field.
- Match the visual style in the project screenshots:
    - dark theme, HSL tokens already defined in globals.css
    - card backgrounds slightly lighter than page bg
    - tight typography, generous padding, rounded-xl on cards
    - subtle borders (border-border/60)
    - sidebar 240px (w-60), persistent on desktop

If you find yourself wanting to install a new dependency, stop and ask first.
The current dependency list in package.json is intentional.
```

---

## Section 2 — Immediate task (paste after Section 1 is acknowledged)

```
Your immediate task is to build the 16 missing files listed in HANDOFF.md
section "What is NOT built yet". Build them in this order. Do not skip ahead.
Do not start work on anything outside this list until every item is complete.

PHASE 1 — App shell (do these first, in order)

  1. src/app/page.tsx
     - Server component
     - `redirect("/dashboard")` from "next/navigation"

  2. src/app/(app)/layout.tsx
     - Server component
     - Call `const user = await requireUser()`
     - Render <div className="flex h-screen overflow-hidden">
         <Sidebar user={{ name: user.name ?? "User", role: roleLabel(user.role) }} />
         <div className="flex flex-1 flex-col overflow-hidden">
           <TopBar />
           <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
         </div>
       </div>
     - Define `roleLabel(role)` locally: OWNER → "Senior Media Buyer",
       TEAM → "Media Buyer", CLIENT → "Client", VIEWER → "Viewer"

  3. src/app/(app)/dashboard/page.tsx
     - Server component
     - Greeting "Good morning, {firstName}" with date-aware morning/afternoon/evening
     - Header row right side: Export + "+ New campaign" buttons (no-op for now)
     - KPI grid: 4 columns on lg, 2 on md, 1 on sm
         · Spend Under Management → sum of last-30d InsightsDaily.spend across
           ACCOUNT-level rows joined to accessible clients. Compute delta vs
           previous-30d window. Icon: DollarSign.
         · Average ROAS → weighted average (sum(conversionValue) / sum(spend)).
           Icon: TrendingUp.
         · Active Clients → count where status=ACTIVE. Delta vs last quarter
           (count - count-90-days-ago). Icon: Users.
         · Winning Creatives → count where isWinner=true. Delta = last-14d new
           wins. Icon: Sparkles.
     - Two-column layout below: <SpendRoasChart /> (col-span-2 on lg) +
       <UrgentTasks /> on the right. Urgent tasks = Task.status=TODO ordered by
       priority DESC, limit 5, across accessible clients.
     - <ActiveClients /> full-width at the bottom. Compute pacing as
       `(month-to-date spend / monthlyBudget) * 100`. Compute ROAS as
       last-30d weighted ROAS per client.
     - All numbers go through @/lib/format helpers. All Decimals → Number().

PHASE 2 — Clients

  4. src/components/clients/client-card.tsx
     - Match the Client Hub screenshot: gradient avatar + name + industry,
       health badge with dot, platform pills (just "Meta" for now since v1 is
       Meta-only), Budget + ROAS row, pacing bar with %.
     - Link the whole card to /clients/[id].

  5. src/components/clients/client-form.tsx
     - "use client", react-hook-form-free (just useState + server action).
     - Fields: name (required), industry, monthlyBudget, targetCpa, targetRoas.
     - Zod schema in src/server/clients.ts.

  6. src/app/(app)/clients/page.tsx
     - "Client Hub" header + "Manage your roster..." description
     - "+ Add client" button → /clients/new
     - Tabs: All clients / Strategies / Ad accounts (only "All clients" wired
       in this phase; the other two render an EmptyState)
     - 3-column grid of ClientCard for clients the user can access.

  7. src/app/(app)/clients/new/page.tsx
     - Renders <ClientForm /> in a card. On submit, calls the createClient
       server action and redirects to /clients/[id] on success.

  8. src/app/(app)/clients/[id]/page.tsx
     - Tabs at top: Overview | Campaigns | Creatives | Tasks (links to the
       sub-routes, not real Tabs primitive — sub-routes own their own page).
     - KPI strip: Spend / ROAS / CPA / CTR / Conversions for last 30 days.
     - Recent alerts (5) + Recent tasks (5) side-by-side.
     - Notes textarea (display-only in phase 2; editing comes in phase 4).

  9. src/app/(app)/clients/[id]/campaigns/page.tsx
     - Match the Performance screenshot's table section.
     - Sortable / filterable table: Campaign | Client | Platform | Status |
       Spend | ROAS | CPA | CTR | Hook Rate. Status as Badge with dot.
     - Filters: status dropdown, date-range "Last 30 days".

 10. src/components/creatives/creative-grid.tsx
     - 4-column grid (lg), 2 (md), 1 (sm).
     - Each card: gradient thumbnail block OR <img>, type pill ("Video" /
       "Image" / "Carousel"), name, client name, status badge, ROAS + hook
       rate stats. Trophy icon (lucide Trophy) when isWinner=true.

 11. src/app/(app)/clients/[id]/creatives/page.tsx
     - Header "Creative & Copy Library" + "Upload creative" button (no-op).
     - Tabs: Ad library | Winning ads | Copy angles | Competitors.
     - Renders <CreativeGrid />, filtering by client in this route.

PHASE 3 — Ops + Alerts + Settings

 12. src/components/tasks/kanban-board.tsx
     - 3 columns: To do / In progress / Done.
     - Each column header shows count badge.
     - Task card: title, client name subtitle, priority badge top-right (High
       → destructive, Med → warning, Low → muted), rule label as small "RULE
       <text>" row at bottom.
     - For phase 3, no drag-and-drop. A "Move" dropdown on each card is fine.

 13. src/app/(app)/clients/[id]/tasks/page.tsx
     - Renders <KanbanBoard tasks={...} /> filtered to this client.

 14. src/app/(app)/ops/page.tsx
     - "Ops & Automation" header, "Daily tasks, AI-driven client reports, and
       landing page audits." description.
     - Tabs: Daily tasks | Client reports | Website audits (only Daily tasks
       wired; the other two render an EmptyState with "Coming soon").
     - Renders <KanbanBoard /> across ALL accessible clients.

 15. src/app/(app)/alerts/page.tsx
     - Cross-client feed grouped by severity, then by client.
     - Each row: severity badge, alert title, client + rule, "Acknowledge" +
       "Resolve" buttons (server actions, stub them).

 16. src/app/(app)/settings/integrations/page.tsx
     - Section "Meta Ads" with a "Connect Meta Ads" button → posts to
       /api/meta/oauth/start. Show currently connected ad accounts in a
       table below: account name, currency, status badge, last synced.

PHASE 4 — Auth + Meta OAuth routes

 17. src/app/(auth)/sign-in/[[...sign-in]]/page.tsx
     - "use client" + Clerk <SignIn /> component, centered.

 18. src/app/(auth)/sign-up/[[...sign-up]]/page.tsx
     - "use client" + Clerk <SignUp />.

 19. src/app/api/meta/oauth/start/route.ts
     - Reads `?clientId=...` from search params.
     - Calls requireUser(); ensures clientId is in accessible set.
     - Builds state via signState({ clientId, nonce: crypto.randomUUID(),
       issuedAt: Date.now() }) and redirects to buildAuthorizeUrl(state).

 20. src/app/api/meta/oauth/callback/route.ts
     - Verifies state via verifyState; rejects if invalid or expired.
     - Calls exchangeCodeForToken, then exchangeForLongLivedToken.
     - Calls `new MetaClient(longLivedToken).listAdAccounts()`.
     - For each ad account, upserts AdAccountConnection with
       encryptToken(longLivedToken) into accessTokenEnc.
     - Writes an AuditLog row: action="connection.create".
     - Redirects to /settings/integrations?connected={count}.

PHASE 5 — Server actions

 21. src/server/audit.ts
     - export async function writeAudit({...}: {...}): Promise<void>

 22. src/server/clients.ts
     - createClient, updateClient, deleteClient — Zod-validated server
       actions. Each calls writeAudit and revalidatePath("/clients").

 23. src/server/tasks.ts
     - createTask, updateTaskStatus, completeTask, deleteTask.

After every phase, run:
  npm run typecheck
  npm run build
and fix any errors before moving to the next phase.
```

---

## Section 3 — Acceptance contract (paste with Section 2 or as a follow-up)

```
A phase is complete only when ALL of the following are true:

1. `npm run typecheck` is clean. Zero `any`. Zero `@ts-ignore` (use `@ts-expect-error` with a comment if you must, and only as a last resort).
2. `npm run build` succeeds end-to-end.
3. The route renders without runtime errors against the seeded database. You can verify by running `npm run db:reset && npm run dev` and opening the page.
4. No new dependencies were installed without my explicit approval. If you think you need one, pause and ask in chat.
5. Every Prisma query that returns client-scoped data was filtered through `getAccessibleClientIds(user)`. I will grep for this.
6. Every mutation wrote an AuditLog row.
7. The Decimal → Number conversion happens at the page boundary, not inside the components. Components stay typed for `number`.
8. The visual output matches the screenshots in HANDOFF.md and docs/STRATEGY.md. Specifically:
   - dark theme only, no light mode
   - sidebar is fixed-width 240px, persistent on desktop
   - cards use rounded-xl, border-border/60, bg-card
   - status badges always use `withDot`
   - KPI deltas use ArrowUpRight / ArrowDownRight with success/destructive bg pills
9. The Meta OAuth round-trip works end-to-end: clicking "Connect Meta Ads" → Facebook login → returned to /settings/integrations?connected=N with N ad account rows in the DB, encrypted.
10. README.md is updated to reflect any new env vars or setup steps you added.

If any of these fail, the work is not done.

Output format for each phase:
  - List of files created/modified
  - Any decisions you made that weren't fully specified in HANDOFF.md
  - Any places where you had to deviate from this prompt and why
  - Commands you ran to verify
  - Anything you noticed as a follow-up risk

Ask before you make architectural decisions. Don't ask about formatting,
naming inside the conventions already used, or other tactical choices.

Start with Phase 1, file 1. Do not skip ahead.
```

---

## Optional: shorter version if your Copilot context window is tight

If pasting all three sections is too long for one prompt, condense to:

```
Continue Mediabuyer OS. Read HANDOFF.md fully, then prisma/schema.prisma,
src/lib/auth.ts, src/lib/format.ts, all of src/components/ui, and
src/components/dashboard. Build the 16 missing files listed in HANDOFF.md
"What is NOT built yet" in the order specified. Hard rules: TypeScript strict
no any; server components by default; every page calls requireUser() and
filters by getAccessibleClientIds; every mutation goes through src/server/*
with Zod + AuditLog; use existing UI primitives and formatters; do not modify
prisma/schema.prisma; do not add dependencies without asking; match the
screenshots' dark theme. Start with src/app/page.tsx (redirect to /dashboard)
and src/app/(app)/layout.tsx (sidebar shell). After each file, run
`npm run typecheck`.
```
