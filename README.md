# VyapaarFlow

Retailer ordering app with AI order capture for an FMCG distributor in Jabalpur (Isocode Labs take-home, Problem 5).

- Retailers see **their own** price, stock and current scheme, and order in a minute.
- WhatsApp-style text orders become **draft** orders that the order desk checks and confirms.
- The order desk handles credit holds and exports to Tally.

See [docs/BRIEF.md](docs/BRIEF.md) for the client brief and [docs/PLAN.md](docs/PLAN.md) for scope, architecture and assumptions.

## Quick start

```bash
npm install
cp .env.example .env.local      # then set SESSION_SECRET (see the file for a one-liner)
npm run db:reset                # create local SQLite DB, migrate, seed sample data
npm run dev                     # http://localhost:3000
```

Demo mode (`DEMO_MODE=true`) lists demo accounts on the sign-in screen and shows the simulated OTP.
Anyone with the link can then sign in as any user, desk staff included, so use demo mode **only with the fictional seed data**: never with real retailers, prices or phone numbers.

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
| `npm run e2e` | Browser smoke tests (needs `npm run build` first and a local Chrome/Edge, or `CHROME_PATH`). Uses its own `data/e2e.db`. |
| `npm test` | Vitest unit and integration tests (in-memory SQLite) |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` / `db:seed` / `db:reset` | Apply migrations / seed / both from scratch |

`db:seed` and `db:reset` wipe every table. Against a remote (Turso) database they refuse to run unless you pass `--allow-remote-wipe` (`npm run db:reset -- --allow-remote-wipe`) or set `ALLOW_REMOTE_WIPE=true`.

In production (`NODE_ENV=production`) the server requires `DATABASE_URL` to be a remote `libsql://` Turso URL and `DATABASE_AUTH_TOKEN` to be set, and fails with a clear error otherwise. `next build` is not affected. To run the production build locally against a SQLite file, set `ALLOW_LOCAL_DATABASE=true`.

## AI order capture

Captured lines are always validated against the catalogue and confirmed by a person; the model never sees or sets prices, stock or schemes.
The model is pluggable (`AI_PROVIDER`): Google Gemini (`GEMINI_API_KEY`; default model `gemini-3.5-flash-lite`, override with `GEMINI_MODEL`), Anthropic (`ANTHROPIC_API_KEY`) or any OpenAI-compatible endpoint (`AI_BASE_URL`, `AI_MODEL`, optional `AI_API_KEY`).
Each capture has a 12-second budget; the AI capture pages set `maxDuration = 30` so the server action is not cut off on Vercel.
With no provider configured, a deterministic rule-based matcher is used and the desk screen says so.

## Stack

Next.js 16 (App Router, server actions) · TypeScript · Drizzle ORM · SQLite locally / Turso in production · Tailwind CSS 4 · Zod · jose · Vitest.
