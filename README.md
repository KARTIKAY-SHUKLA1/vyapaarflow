# VyapaarFlow

Retailer ordering app with AI order capture for an FMCG distributor in Jabalpur (Isocode Labs take-home, Problem 5).

- Retailers see **their own** price, stock and current scheme, and order in a minute.
- WhatsApp-style text orders become **draft** orders that the order desk checks and confirms.
- The order desk handles credit holds and exports to Tally.

See [docs/PLAN.md](docs/PLAN.md) for scope, architecture and assumptions.

## Quick start

```bash
npm install
cp .env.example .env.local      # then set SESSION_SECRET (see the file for a one-liner)
npm run db:reset                # create local SQLite DB, migrate, seed sample data
npm run dev                     # http://localhost:3000
```

Demo mode (`DEMO_MODE=true`) lists demo accounts on the sign-in screen and shows the simulated OTP.

| Role | Mobile |
|---|---|
| Retailer (Sharma Kirana Store) | 90000 00001 |
| Retailer near credit limit (Gupta General Stores) | 90000 00002 |
| Order desk | 90000 00100 |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run check` | typecheck + lint + tests |
| `npm test` | Vitest unit and integration tests (in-memory SQLite) |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` / `db:seed` / `db:reset` | Apply migrations / seed / both from scratch |

## Stack

Next.js 16 (App Router, server actions) · TypeScript · Drizzle ORM · SQLite locally / Turso in production · Tailwind CSS 4 · Zod · jose · Vitest.
