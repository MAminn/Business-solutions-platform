# Media Buyer OS — MVP Strategy & Build Plan

**Prepared for:** Two-founder team (media buyer + developer)
**Stage:** Visual prototype exists. Ready to build real MVP.
**Date:** May 2026

---

## Executive Take (read this first)

You are about to make three critical calls. Get them right and the next 6 months are clean:

1. **Start as an internal agency tool, not SaaS.** You have one guaranteed customer (yourselves). Dogfood it for 3–6 months on your real client roster. SaaS is the *extraction*, not the starting point. Building multi-tenancy, billing, support, and onboarding before you've proven the workflow is the #1 reason 2-founder SaaS attempts die.

2. **AI is a feature on top of clean data, not the product.** The dashboard must be useful with zero AI. AI then adds 20–30% on top. If you build the AI layer first, you'll be debugging hallucinations on broken data pipelines.

3. **Meta-only for v1. No Google, no TikTok, no LinkedIn.** Each new ad platform is a 4–6 week integration project with its own auth, rate limits, schema, and quirks. Ship Meta, get it stable, then add the next.

**Call it internally:** *Media Buyer OS* (working title). Avoid "Business Solutions Platform" — too vague, too ambitious, kills focus. You can rename when you productize.

**What you should NOT build in the first 90 days:**
- Multi-tenant SaaS billing
- Other ad platforms (Google, TikTok, LinkedIn)
- Landing page audits
- Templates marketplace / digital products store
- ERP / wider business modules
- Auto-pause / auto-scale (AI taking actions without human approval)
- Mobile app
- White-label

---

## 1. Product Positioning

**At MVP stage, this is:** *An internal operating system for a Meta-focused media buying agency that also gives clients a clean read-only window into their account performance.*

**Three sentences of positioning:**

> "We run a media buying agency. We built our own internal tool because no off-the-shelf dashboard gives us the workflow we actually need — daily decisions, urgent flags, AI-assisted insights, and clean client reports without copy-pasting from Ads Manager. Eventually we may open it to other agencies."

**Why this framing wins:**
- You're not "competing" with Triple Whale, Motion, Northbeam, or AdEspresso at MVP. You're building for yourself.
- It lets you make opinionated decisions instead of catering to a hypothetical SaaS audience.
- The "client portal" naturally upsells your agency retainer (more sticky, more premium).
- When/if you productize, you have 6 months of real workflow proof.

**Avoid the trap of:**
- Building a "platform" before you've built a *tool*
- Calling it "AI-powered" as the lead positioning (everyone says this; it's noise)
- Trying to be a BI tool. You're a *decision-making* tool. Different category.

---

## 2. MVP Scope

### Must-have (Phase 1, weeks 1–8)
- Google/Email auth for internal team
- Multi-client management (you manage your agency's client roster)
- Meta ad account OAuth connection (per client)
- Daily sync of campaign / ad set / ad / creative / insights data
- Account-level dashboard: spend, ROAS, CPA, CTR, conversions, by date range
- Drill-down: Account → Campaign → Ad Set → Ad → Creative
- Threshold-based alerts (CPA up X%, ROAS below Y, spend pacing off, etc.) — *rule-based first, no AI needed*
- Manual task creation (per client, per ad object)
- Notes per client / per campaign
- Date range comparison (last 7d vs prior 7d)
- Search and filter across all clients' campaigns

### Should-have (Phase 2, weeks 9–14)
- Claude-generated daily insights (structured, human-approved before sending)
- Recommendation queue (AI suggests → human approves → becomes task)
- Auto-generated weekly client reports (PDF or web link)
- Creative library (thumbnails, video previews, performance grouped by creative)
- Hook rate, thumbstop, 3s view metrics (Meta video metrics)
- Kanban for ops tasks

### Nice-to-have (Phase 3+, weeks 15+)
- Client read-only portal (their data, their reports, comments)
- Scheduled email reports
- Slack / WhatsApp digest notifications
- Period-over-period AI commentary
- Custom KPI definitions per client
- Goal tracking (monthly spend targets, CPA targets)

### Deliberately delay (post-Phase 3)
- Multi-tenancy / SaaS billing
- Other ad platforms
- Auto-actions (pause/scale via API without human approval)
- Landing page audits
- A/B test designer
- Attribution modeling beyond Meta's own
- Mobile native app
- Templates / digital product marketplace

### Build order (concrete)
1. **Auth + DB schema + Meta OAuth** (week 1–2)
2. **Meta data sync pipeline** (week 2–4) — *the hardest part, don't skip ahead*
3. **Account/Campaign/AdSet/Ad/Creative views with real data** (week 4–6)
4. **Threshold alerts + manual tasks** (week 6–7)
5. **Polish + use it on 3 real clients for 2 weeks** (week 7–8) ← *Phase 1 done*
6. AI recommendation layer (week 9–11)
7. Weekly report generation (week 12–14) ← *Phase 2 done*
8. Client portal (week 15–18) ← *Phase 3 done*

---

## 3. User Roles & Permissions

For MVP, keep this simple. Four roles total:

| Role | Can do |
|---|---|
| **Owner** (founder) | Everything. Billing, integrations, team management, all clients. |
| **Team Member** (media buyer) | View/edit assigned clients. Create tasks. Generate reports. Cannot delete clients or manage billing. |
| **Client** (read-only) | View only their own account's data and reports. Cannot see other clients. Cannot modify anything. Can leave comments on reports. |
| **Viewer** (future, optional) | Read-only internal user (junior buyer, intern). View assigned clients. No edits. |

**Permission model:** Client-scoped, not row-level-secure complex. Each user has a list of `client_ids` they can access. Owner role bypasses the check. Keep it boringly simple at MVP — fancy RBAC can come later.

**Authentication:** Use Clerk or NextAuth. Don't roll your own. Magic link + Google OAuth is enough.

---

## 4. Data Model

Below is a realistic schema. Treat field names as Prisma/Postgres style. Adapt to your ORM.

### Core entities

**`users`**
- id, email, name, role (`owner` / `team` / `client` / `viewer`), avatar_url, last_login_at, created_at

**`organizations`** *(your agency — even for internal use, you want this layer for future SaaS)*
- id, name, slug, plan (default `internal`), created_at

**`organization_members`**
- id, org_id, user_id, role, created_at

**`clients`** *(your agency's clients)*
- id, org_id, name, logo_url, industry, status (`active`/`paused`/`churned`), monthly_retainer, monthly_ad_spend_target, target_cpa, target_roas, notes, created_at

**`client_assignees`** *(which team members handle which client)*
- id, client_id, user_id

**`ad_account_connections`** *(one client may have multiple — e.g. Meta + Google later)*
- id, client_id, platform (`meta` for now), platform_account_id, account_name, currency, timezone, access_token (encrypted), refresh_token (encrypted), token_expires_at, status (`active`/`expired`/`revoked`), last_synced_at, last_sync_error, created_at

**`campaigns`** *(mirrored from Meta)*
- id, ad_account_connection_id, platform_id (Meta's campaign_id), name, objective, status (Meta status), effective_status, daily_budget, lifetime_budget, start_time, stop_time, buying_type, special_ad_categories (jsonb), updated_at, raw (jsonb — full Meta payload for forward compat)

**`ad_sets`**
- id, campaign_id, platform_id, name, status, effective_status, daily_budget, lifetime_budget, optimization_goal, billing_event, bid_strategy, targeting (jsonb), start_time, end_time, raw

**`ads`**
- id, ad_set_id, platform_id, name, status, effective_status, creative_id, updated_at, raw

**`creatives`**
- id, ad_account_connection_id, platform_id, name, type (`image`/`video`/`carousel`/`dpa`), thumbnail_url, image_url, video_url, body_text, headline, link_url, call_to_action, raw

**`insights_daily`** *(the heart of the system — partitioned/indexed heavily)*
- id, entity_type (`account`/`campaign`/`ad_set`/`ad`), entity_id, date, impressions, reach, clicks, spend, ctr, cpc, cpm, conversions, conversion_value, purchases, leads, roas, cpa, hook_rate (video_play_3s/impressions), thumbstop_rate, video_views_25/50/75/100, video_avg_time_watched, frequency, raw (jsonb)
- **Indexes:** (entity_type, entity_id, date), (date), partition by month if it gets large.

**`alerts`** *(rule-triggered, before AI)*
- id, client_id, entity_type, entity_id, type (`cpa_spike`/`roas_drop`/`spend_pacing_off`/`fatigue`/etc.), severity (`info`/`warning`/`critical`), title, message, triggered_at, acknowledged_at, acknowledged_by, resolved_at, status

**`tasks`**
- id, client_id, entity_type, entity_id (nullable), title, description, status (`todo`/`in_progress`/`done`/`dismissed`), priority (`low`/`med`/`high`/`urgent`), assignee_id, due_date, source (`manual`/`alert`/`ai_recommendation`), source_ref_id, created_by, created_at, completed_at

**`recommendations`** *(AI outputs — distinct from tasks)*
- id, client_id, entity_type, entity_id, recommendation_type (`pause`/`scale`/`test`/`investigate`/`copy_winner`), confidence (0–1), reasoning, supporting_data (jsonb), status (`pending`/`approved`/`dismissed`/`acted_on`), reviewed_by, reviewed_at, created_at
- *Recommendations can be promoted to tasks.*

**`reports`**
- id, client_id, type (`weekly`/`monthly`/`adhoc`), period_start, period_end, status (`draft`/`sent`/`viewed`), summary, metrics (jsonb snapshot), pdf_url, share_link_token, generated_by, generated_at, sent_at, viewed_at

**`report_comments`** *(client can comment on reports)*
- id, report_id, user_id, body, created_at

**`integrations`** *(non-ad-account: Slack, email, etc.)*
- id, org_id, type (`slack`/`google_workspace`/`zapier`), config (jsonb), enabled, created_at

**`sync_jobs`** *(observability for data pipeline)*
- id, ad_account_connection_id, started_at, completed_at, status, records_synced, error_message, type (`full`/`incremental`/`backfill`)

**`audit_log`**
- id, org_id, user_id, action, entity_type, entity_id, metadata (jsonb), ip_address, created_at

**`ai_runs`** *(track every Claude call for debugging + cost)*
- id, type (`daily_insights`/`weekly_report`/`recommendation_batch`), input_hash, prompt_version, model, input_tokens, output_tokens, cost_usd, latency_ms, status, output (jsonb), created_at

### Relationships (visual)

```
organizations 1—* clients 1—* ad_account_connections 1—* campaigns 1—* ad_sets 1—* ads
                                                            ad_account_connections 1—* creatives
                                                            (insights_daily polymorphic across all 4)

clients 1—* tasks
clients 1—* alerts
clients 1—* recommendations
clients 1—* reports
```

### What's intentionally not here (yet)
- `landing_pages` / `website_audits` — defer to Phase 4+
- `templates` / `digital_products` — separate product, separate schema, don't pollute
- `billing` / `subscriptions` — only when you go SaaS

---

## 5. Meta Ads API Implementation Plan

This is the technically risky part. Take it seriously.

### App setup (do this week 1)
1. Create a **Meta Developer App** under Business type
2. Add **Marketing API** product
3. Request these permissions for App Review:
   - `ads_read` (always required)
   - `ads_management` (only if you want to pause/edit — needed for action layer in Phase 2+)
   - `business_management` (to enumerate ad accounts under a Business Manager)
   - `read_insights`
4. Submit for **App Review** EARLY. This takes 2–6 weeks. Start day 1.
5. Until approved, your app works only for users with dev/tester roles on the app — which is fine for internal MVP testing.
6. Complete **Business Verification** in Meta Business Manager. Required for production.

### Data to pull (in order of importance)

| Object | Fields you actually need | Endpoint |
|---|---|---|
| Ad Account | id, name, currency, timezone, account_status, business | `/act_{id}` |
| Campaign | id, name, objective, status, effective_status, buying_type, daily_budget, lifetime_budget, start_time, stop_time | `/act_{id}/campaigns` |
| Ad Set | id, name, status, effective_status, optimization_goal, billing_event, bid_strategy, daily_budget, targeting, start_time, end_time | `/{campaign_id}/adsets` |
| Ad | id, name, status, effective_status, creative{id}, adset_id | `/{adset_id}/ads` |
| Ad Creative | id, name, object_story_spec, image_url, thumbnail_url, video_id, body, title, call_to_action_type | `/{creative_id}` |
| **Insights (daily)** | impressions, reach, clicks, spend, ctr, cpc, cpm, frequency, actions, action_values, video_play_actions, video_p25/p50/p75/p100_watched_actions, video_avg_time_watched, cost_per_action_type, purchase_roas | `/{object_id}/insights` with `time_increment=1` |

### Syncing strategy

**Three sync types:**

1. **Structural sync (every 4 hours):** Refresh campaigns/adsets/ads/creatives entities and their status/budget. Cheap, fast.
2. **Insights incremental sync (every 1–3 hours):** Pull last 2 days of insights (today + yesterday). Today's data is provisional and updates retroactively for ~28h, so always re-pull.
3. **Insights backfill (on demand / nightly):** Pull last 7 days nightly to catch attribution updates. Pull 30/90 days on initial connect.

**Always re-fetch today + yesterday on every sync.** Meta updates attribution data retroactively, especially for conversions.

### Permissions UX
- Use Facebook Login with Business Login flow.
- Show clear scope explanation in your OAuth consent screen.
- Store tokens encrypted at rest (use a KMS key or library like `pgcrypto`).
- Refresh tokens are *long-lived* (60 days) but not infinite. Detect expiry → email the client to reconnect.
- A client can have multiple ad accounts under one Business Manager. Let user pick which ones to import.

### Rate limits — read this carefully
- Meta uses a **per-app + per-user bucket** system. You get points; calls cost points.
- Insights calls are expensive (multiply by `time_increment` × objects).
- For accounts with >50 active ads pulling daily insights → use **async batch reports** (`POST /act_{id}/insights` returns a job id, poll for completion). Don't try synchronous pagination through thousands of rows.
- Implement **exponential backoff** on `code: 17` (user request limit) and `code: 80004` (too many calls).
- Build a **token bucket queue** server-side so one client's heavy sync doesn't starve another.

### Problems to expect
- **Attribution windows shift.** Meta defaults change. Always specify `action_attribution_windows` explicitly (e.g., `['7d_click', '1d_view']`).
- **Currency mismatches.** An ad account has its own currency. Convert to a common reporting currency client-by-client.
- **Timezones.** Each ad account has its own. All date math should be in the *account's* timezone, not server time. Store this on the connection.
- **Status vs effective_status.** `status=ACTIVE` doesn't mean the ad is delivering. `effective_status` tells the truth (could be `CAMPAIGN_PAUSED`, `WITH_ISSUES`, `IN_PROCESS`, etc.).
- **Creative thumbnails expire.** Meta's CDN URLs expire (sometimes hours, sometimes longer). Re-fetch on display, or download to your own storage (S3/R2) once.
- **Carousel and DPA creatives** have a different `object_story_spec` shape. Handle gracefully or skip in v1.
- **Account spending limits and disabled accounts** silently break syncs. Surface these in your UI.
- **API version deprecation.** Meta deprecates API versions every ~year. Pin a version (e.g., `v23.0`) in env config and have a quarterly upgrade chore.

### Recommended libraries
- Node/TS: `facebook-nodejs-business-sdk` (official) — works but verbose. Or just `fetch` with typed wrappers.
- Python: `facebook-business` SDK (official).
- Don't use unofficial wrappers; Meta breaks them.

---

## 6. AI Workflow (Claude integration)

The goal: **AI suggests, humans approve.** Never auto-act.

### Architecture

```
[insights_daily] ──► [aggregator] ──► [structured JSON payload]
                                              │
                                              ▼
                                       [Claude API call]
                                              │
                                              ▼
                              [structured JSON output (recommendations)]
                                              │
                                              ▼
                                     [recommendations table]
                                              │
                                              ▼
                              [human review UI] ──► promoted to task
```

### What to send to Claude

**DON'T** send raw rows. You'll waste tokens and get noisy results.

**DO** send a pre-aggregated, structured payload per client per analysis window:

```json
{
  "client": { "name": "Client X", "target_cpa": 25, "target_roas": 3.0 },
  "period": { "start": "2026-05-09", "end": "2026-05-15", "comparison_start": "2026-05-02", "comparison_end": "2026-05-08" },
  "account_summary": {
    "spend": 12450, "spend_prev": 11200,
    "purchases": 320, "purchases_prev": 290,
    "roas": 2.8, "roas_prev": 3.1,
    "cpa": 38.9, "cpa_prev": 38.6
  },
  "campaigns": [
    { "id": "...", "name": "...", "spend": 4200, "roas": 1.9, "cpa": 52, "trend_3d": "declining", "status": "ACTIVE" },
    ...
  ],
  "top_ads": [...],
  "fatigued_ads": [...],  // pre-flagged by rules: frequency > 3, ctr declining
  "winners_unscaled": [...] // low spend, strong ROAS
}
```

The platform does the analytical heavy lifting via rules. Claude does the *interpretation, prioritization, and writing*.

### Prompt structure (sketch)

System prompt:
> You are an expert Meta Ads media buyer reviewing a client's last 7 days of performance. Your job is to produce a prioritized list of 3–7 specific, actionable recommendations. Each recommendation must reference a specific entity (campaign/adset/ad) by ID. You must only recommend actions supported by the data provided. Do not invent metrics. If data is insufficient, say so. Output JSON conforming to the schema provided.

User message: the structured payload above.

Output schema (enforced via Claude's tool use / structured output):
```json
{
  "recommendations": [
    {
      "entity_type": "ad_set",
      "entity_id": "...",
      "entity_name": "...",
      "action": "pause | scale | test | investigate | copy_winner",
      "priority": "high | medium | low",
      "confidence": 0.85,
      "reasoning": "CPA increased from $32 to $58 over the last 3 days while spend held steady. Frequency now at 4.2 indicating audience fatigue.",
      "supporting_metrics": { "cpa_now": 58, "cpa_prev": 32, "frequency": 4.2 }
    }
  ],
  "overall_summary": "Account spend held steady but ROAS dropped from 3.1 to 2.8 driven primarily by Campaign X fatiguing..."
}
```

### Avoiding hallucinations
- **Constrain via structured output** (JSON schema or Claude's tool use). Don't accept free-text recommendations.
- **Validate output server-side:** every entity_id must exist in your DB. Reject and retry once if not.
- **Never let Claude invent metric values.** Provide them; ask it to interpret them.
- **Run a "sanity check" pass:** if confidence < 0.6 → mark as "needs review" not "actionable."
- **Log every prompt version + output** in `ai_runs`. When something is wrong, you can diff.
- **A/B prompt versions** silently for 2 weeks before fully rolling out a change.
- **Cap recommendation count** at 7 per run. More than that = noise, humans ignore.

### When to run
- Daily batch at 9 AM client timezone → "morning briefing" for the media buyer
- On-demand via "Re-analyze" button on each client
- Weekly batch for report generation

### Cost control
- Per-client daily AI cost should be < $0.50.
- Use **Claude Haiku** for routine daily runs, **Sonnet** for weekly deep analysis. Don't always reach for Opus.
- Cache responses by input hash for 1 hour to avoid duplicate runs.
- Track cost in `ai_runs.cost_usd` and surface on a "Usage" admin page.

---

## 7. Dashboard Structure (page-by-page)

### Internal app (you + your team)

| Page | Purpose | Key components |
|---|---|---|
| `/dashboard` | Multi-client overview ("which clients need attention today?") | Cards per client with spend, ROAS, alerts count, tasks count |
| `/clients` | Client roster | Table, search, status filter, "+ Add client" |
| `/clients/[id]` | Single client home | KPI strip, alert feed, recent tasks, period comparison |
| `/clients/[id]/campaigns` | Campaign table | Sortable, status toggles, drill-down |
| `/clients/[id]/campaigns/[cid]` | Campaign detail | Ad sets table, time-series chart |
| `/clients/[id]/campaigns/[cid]/adsets/[asid]` | Ad set detail | Ads table, targeting summary |
| `/clients/[id]/ads/[aid]` | Ad detail | Creative preview, full metrics, performance chart |
| `/clients/[id]/creatives` | Creative library (per client) | Grid of thumbnails, performance overlay |
| `/clients/[id]/recommendations` | AI + rule-based recs queue | Approve/dismiss UI, promote to task |
| `/clients/[id]/tasks` | Ops kanban | Todo / In Progress / Done lanes |
| `/clients/[id]/reports` | Generated reports | List + "Generate weekly report" CTA |
| `/clients/[id]/settings` | Per-client config | Targets (CPA/ROAS), integrations, team assignment |
| `/creatives` | Cross-client creative library | Find winning creatives across portfolio |
| `/ops` | Cross-client task kanban | All team tasks |
| `/alerts` | Cross-client alert feed | Triage view |
| `/settings/team` | Team management | Invite, role assignment |
| `/settings/integrations` | App-level integrations | Meta app config, Slack, etc. |
| `/settings/billing` | Future SaaS | Hidden in MVP |
| `/settings/ai` | AI prompt versions, cost dashboard | Internal debug tool |

### Client portal (Phase 3)

| Page | Purpose |
|---|---|
| `/c/[clientId]` | Their dashboard — KPIs, top campaigns, current period vs last |
| `/c/[clientId]/reports` | List of past reports + view |
| `/c/[clientId]/reports/[rid]` | Single report (web view, also downloadable PDF) |
| `/c/[clientId]/notes` | Comments / questions for the agency |

Keep client portal *minimal*. They don't need 30 pages. They need: "are we doing okay" + "what did you do this week" + "here's the report."

---

## 8. Development Roadmap

### Phase 0 — Foundation (week 1–2)
- Repo setup (Next.js 14 app router, TypeScript, Tailwind, shadcn/ui — likely already in prototype)
- Postgres (Supabase or Neon)
- Prisma ORM + initial schema (subset: users, orgs, clients, ad_account_connections)
- Auth (Clerk or NextAuth + email magic link)
- Meta Developer App created, App Review submitted
- CI/CD on Vercel or Railway
- Error tracking (Sentry), basic logging

### Phase 1 — Working internal MVP (week 3–8)
- Meta OAuth flow + account connection UI
- Data sync pipeline (cron / background workers)
- All entity tables populated
- Dashboard, client pages, campaign/adset/ad drill-down with real data
- Manual task creation, simple notes per client
- Threshold-based alerts (rules engine, no AI)
- **Use it on 3 real clients for 2 weeks.** Fix everything that breaks.

### Phase 2 — AI + reports (week 9–14)
- Claude integration (recommendations engine)
- Recommendation queue UI (approve/dismiss/promote)
- Weekly report generator (HTML + PDF export)
- Email delivery of reports
- Creative library improvements (video thumbnails, hook rate)
- Cross-client overview dashboard polish

### Phase 3 — Client portal (week 15–18)
- Client invite flow + read-only auth
- Client dashboard
- Report viewing with comments
- Notifications (email digest)
- Permissions hardening

### Phase 4 — SaaS productization (week 19+, only if Phases 1–3 prove ROI)
- Multi-tenancy isolation testing
- Stripe billing (per-seat or per-ad-account pricing)
- Self-serve onboarding flow (Meta OAuth for non-technical users)
- Marketing site
- Documentation, help center
- Support tooling

### Phase 5+ — Platform expansion
- Google Ads, TikTok Ads
- Landing page audit module
- Templates / digital products store
- Wider business modules

**A realistic timeline:** internal MVP usable in **8 weeks**, AI + reports by **14 weeks**, client portal by **18 weeks**, SaaS-ready by **month 6–9** *if* the internal tool generates clear ROI.

---

## 9. Monetization Recommendations

**Year 1 — Internal tool only.** The "revenue" is:
- Time saved by your media buyer (3–10 hours/week → reinvested into more clients)
- Higher retention from better reporting
- Ability to take on 30–50% more clients with same headcount
- Justification for raising retainers ("our reporting is differentiated")

Track these as KPIs internally.

**Year 1 mid — Client portal as retainer upsell.**
- Bundle "premium reporting access" into a higher-tier retainer ($500–1,500/month above base)
- "Done with you" tier with weekly portal + Loom walkthroughs

**Year 2 — Productize as SaaS for other agencies.** Realistic pricing benchmarks for the agency dashboard category:

| Tier | Target | Price | Limits |
|---|---|---|---|
| Solo | Freelance media buyer | $79–99/mo | 3 ad accounts, 1 user |
| Agency | Small agency (3–10 clients) | $199–299/mo | 15 ad accounts, 5 users |
| Scale | Established agency | $499–799/mo | 50 ad accounts, 15 users, white-label |
| Enterprise | 50+ clients | Custom | Custom, SSO, API |

**Setup fee:** $500–2,000 makes sense IF you offer onboarding (data audit, KPI setup, prompt customization). Pure self-serve = skip the setup fee.

**Templates / digital products** (Phase 5+):
- Reporting templates: $29–49 each
- Creative brief templates: $19–29
- Ad strategy frameworks: $99–199
- These are a distinct product line. Don't bundle until you have 100+ SaaS customers.

**The order matters:** internal tool → client portal upsell → SaaS → digital products. Skipping steps almost always fails because you don't yet know what's actually valuable.

---

## 10. Copilot / Coding Agent Prompt

Copy-paste this into Copilot Workspace or your coding agent of choice to start the real build from your existing prototype:

---

> **PROJECT: Media Buyer OS — Real MVP build**
>
> ## Context
> We have an existing visual prototype (Next.js + Tailwind + shadcn/ui, dark SaaS aesthetic) with mock data for a media buyer / ad agency dashboard. The prototype includes: main dashboard, client hub, creative library, performance analytics, ops kanban. We are now turning this into a real MVP with actual Meta Ads API integration and Postgres-backed data.
>
> ## Stack
> - **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, Recharts
> - **Backend:** Next.js API routes + Server Actions, tRPC optional
> - **DB:** Postgres (Supabase or Neon), Prisma ORM
> - **Auth:** Clerk (preferred) or NextAuth with email magic link + Google OAuth
> - **Background jobs:** Inngest or Trigger.dev (cron + queues + retries built in)
> - **AI:** Anthropic SDK (Claude — Haiku for daily, Sonnet for weekly)
> - **Storage:** Cloudflare R2 or S3 for creative thumbnails, PDF reports
> - **Email:** Resend
> - **Hosting:** Vercel (app) + Railway/Supabase (DB) + Inngest cloud (jobs)
> - **Monitoring:** Sentry, Axiom or Logtail
>
> ## Deliverables — Phase 1 (build in order)
>
> ### 1. Project scaffold
> - Migrate prototype components into a `src/app` Next.js 14 structure
> - Set up Prisma with the schema below
> - Set up Clerk auth with three roles: `owner`, `team`, `client`
> - Set up environment config (`.env.local`, `.env.example`)
> - Configure Sentry, basic structured logging
>
> ### 2. Database schema (initial migration)
> Implement these Prisma models with appropriate indexes:
> - `Organization`, `OrganizationMember`, `User`
> - `Client`, `ClientAssignee`
> - `AdAccountConnection` (encrypted tokens via `pgcrypto`)
> - `Campaign`, `AdSet`, `Ad`, `Creative`
> - `InsightsDaily` (polymorphic entity_type + entity_id, partitioned by month if possible, heavy indexing on entity + date)
> - `Alert`, `Task`, `Recommendation`, `Report`, `ReportComment`
> - `Integration`, `SyncJob`, `AuditLog`, `AiRun`
>
> Encrypt `access_token` and `refresh_token` columns. Provide a helper `getDecryptedToken(connectionId)` in the data layer.
>
> ### 3. Meta Ads integration
> - OAuth flow: `/api/meta/oauth/start` → redirect to Facebook Login Business → callback at `/api/meta/oauth/callback`
> - Required scopes: `ads_read`, `business_management`, `read_insights`
> - After auth: fetch user's ad accounts, let them pick which to import (UI page: `/onboarding/connect-meta`)
> - Persist tokens encrypted, store `ad_account_connection` row per imported account
> - Sync service in `/src/server/meta/sync.ts` exposing:
>   - `syncStructural(connectionId)` — campaigns, adsets, ads, creatives
>   - `syncInsightsIncremental(connectionId)` — last 2 days of insights, daily granularity, for all entities
>   - `syncInsightsBackfill(connectionId, days)` — initial import
> - Inngest cron jobs:
>   - Every 4h: `syncStructural` for all active connections
>   - Every 1h: `syncInsightsIncremental` for all active connections
>   - Daily at 03:00 UTC: 7-day backfill to catch attribution updates
> - Use Meta SDK or typed `fetch` wrappers. Pin API version `v23.0` in env.
> - For accounts with >50 active ads, use async batch report endpoints.
> - Handle rate limits with exponential backoff (X-Business-Use-Case-Usage header).
> - Store full Meta payload in `raw` jsonb field on each entity for forward compatibility.
>
> ### 4. Internal dashboard pages (real data)
> Replace mock data in existing prototype components with real queries:
> - `/dashboard` — multi-client overview cards
> - `/clients` — client list
> - `/clients/[id]` — client home with KPI strip + recent activity
> - `/clients/[id]/campaigns` — campaign table with sortable columns
> - `/clients/[id]/campaigns/[cid]` — drill-down
> - `/clients/[id]/ads/[aid]` — single ad detail with creative preview
> - `/clients/[id]/creatives` — creative library grid
> - `/clients/[id]/tasks` — kanban (todo/in-progress/done)
> - `/clients/[id]/recommendations` — recommendation queue
> - `/clients/[id]/reports` — list + generate
> - Cross-client: `/creatives`, `/ops`, `/alerts`
> - Settings: `/settings/team`, `/settings/integrations`
>
> Use TanStack Query for data fetching with sensible cache times (30s for active views, 5min for slower data).
>
> ### 5. Rules-based alerts engine
> A nightly Inngest job that evaluates these rules per client and writes to `alerts` table:
> - CPA increased >25% week-over-week on a campaign with spend > $X
> - ROAS dropped below client's target_roas for 3 consecutive days
> - Spend pacing: month-to-date projection > 110% or < 90% of monthly target
> - Ad fatigue: frequency > 3 AND CTR declining for 5+ days
> - Budget exhausted: ad set spent <80% of daily budget for 3+ days (under-delivering)
> - Account disabled / spending limit reached (from Meta status)
>
> Each alert has severity (`info`/`warning`/`critical`), is deduplicated (don't re-create same alert daily for same entity), and can be acknowledged.
>
> ### 6. Manual tasks
> Simple CRUD for tasks. Each task is scoped to a client and optionally an entity (campaign/adset/ad). Kanban UI. Tasks can be created manually, from an alert, or from an approved recommendation.
>
> ### 7. Onboarding flow
> - New user signup → create organization → invite team → connect first Meta account → "Add your first client" wizard
> - Empty states everywhere should guide the next action
>
> ## Deliverables — Phase 2 (after Phase 1 is stable)
>
> ### 8. AI recommendation engine
> - Aggregator service: builds structured JSON payload per client per period (last 7d vs prior 7d)
> - Anthropic SDK call with structured output (tool use schema) producing recommendations
> - Validate output: every `entity_id` must exist in DB; reject and retry once if not
> - Persist to `recommendations` table with `status='pending'`
> - UI: review queue at `/clients/[id]/recommendations` with approve / dismiss / promote-to-task actions
> - Log every run to `ai_runs` with token counts and cost
> - Use Haiku for daily runs, Sonnet for weekly
>
> ### 9. Weekly report generator
> - Generate HTML report + render to PDF (use Puppeteer via `@sparticuz/chromium` on serverless, or use a PDF service like react-pdf for simpler reports)
> - Template includes: hero KPIs, period comparison, top/bottom campaigns, creative winners, narrative summary (Claude-generated), upcoming actions
> - Email delivery via Resend with shareable link
> - Track views via `share_link_token`
>
> ## Deliverables — Phase 3 (client portal)
>
> ### 10. Client read-only portal
> - Separate route group `/c/[clientId]` with role-gated middleware
> - Pages: dashboard, reports list, report viewer, notes/comments
> - Clients log in via email magic link; their user is linked to a single client
> - Comments on reports
>
> ## Engineering conventions
> - **No `any`.** TypeScript strict mode.
> - **Server Actions** for mutations where possible; API routes only when external systems need to call us.
> - **Zod** for all input validation (forms, API payloads, AI outputs).
> - **Drizzle or Prisma** — pick one and stick with it. (Prisma recommended for this stack.)
> - **Feature flags** via env or a simple `feature_flags` table for risky new features.
> - **Encryption at rest** for tokens, PII.
> - **Audit log** every mutation (write to `audit_log`).
> - **Tests:** Vitest for unit tests on sync logic and rules engine. Playwright for critical user flows (auth, OAuth, report generation).
> - **Migrations:** every schema change is a Prisma migration committed to repo.
>
> ## What NOT to build in this phase
> - Multi-tenant SaaS billing (no Stripe yet)
> - Google Ads / TikTok / LinkedIn (Meta only)
> - Auto-pause / auto-scale (AI never takes actions, only suggests)
> - Mobile app
> - White-label / custom domains
> - Templates marketplace
> - ERP / wider business modules
>
> ## First task
> Set up the project scaffold (item 1), migrate existing prototype components into the App Router structure, set up Prisma with the schema in item 2, and implement Clerk auth with the three roles. Output a plan with concrete file paths before generating code.

---

## Closing thoughts

A few honest reminders:

- **The first 8 weeks will feel slow because you're building the data pipeline, not features.** Resist the urge to skip the sync layer and "just add AI." A solid sync is what makes everything else work.
- **Use it on yourselves for at least 4 weeks before showing anyone else.** Real workflow > pitch deck.
- **The media-buyer founder should track every time they almost open Ads Manager instead of your tool.** That's your roadmap.
- **Resist scope creep ruthlessly.** "Should we also add X?" → "Yes, in Phase 4."
- **Pick boring tech.** Next.js + Postgres + Prisma + Clerk + Inngest is a stack a single developer can ship and maintain. Anything fancier costs you weeks.

Good luck. Ship it.
