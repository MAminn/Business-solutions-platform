# Mediabuyer OS

Internal operating system for a Meta-focused media buying agency. Built with Next.js 14 (App Router), TypeScript, Tailwind, Prisma + Postgres, Clerk, and Recharts.

> **Status:** Foundation only. The data model, design system, Meta integration logic, and dashboard components are implemented. Page routes are not yet built — `npm run dev` will 404 on every URL until they are. See **[HANDOFF.md](./HANDOFF.md)** for the complete state, what's missing, and the prompt for GitHub Copilot to continue.

---

## Quickstart

```bash
npm install
cp .env.example .env       # then edit: DATABASE_URL, TOKEN_ENCRYPTION_KEY
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

App runs at `http://localhost:3000`.

**Generate a token encryption key:** `openssl rand -hex 32`

**Auth in development:** if `CLERK_SECRET_KEY` is empty, the middleware bypasses auth and the app uses the seeded OWNER user. Don't deploy without setting it.

---

## Documents in this repo

- **[HANDOFF.md](./HANDOFF.md)** — what's built, what's mocked, what's missing, known risks, and the contract Copilot must follow.
- **[COPILOT_PROMPT.md](./COPILOT_PROMPT.md)** — the exact prompt to give GitHub Copilot Agent to continue building.
- **[docs/STRATEGY.md](./docs/STRATEGY.md)** — long-form product strategy: positioning, MVP scope, roles, Meta API plan, AI workflow, 18-week roadmap, monetization.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | `prisma generate && next build` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Push schema to Postgres (dev, no migration files) |
| `npm run db:migrate` | Create + run a migration (production) |
| `npm run db:seed` | Hydrate the demo dataset |
| `npm run db:studio` | Prisma Studio GUI |
| `npm run db:reset` | Wipe DB and reseed |

---

## Stack

Next.js 14.2 · TypeScript 5.6 strict · Tailwind 3.4 · Prisma 5.22 · Postgres · Clerk 5.7 · Recharts 2.13 · Zod 3.23 · date-fns 4.1 · lucide-react 0.453

## License

Proprietary — internal use only.
