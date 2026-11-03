# VyapaarFlow: deployment guide

| | |
|---|---|
| Repository | https://github.com/KARTIKAY-SHUKLA1/vyapaarflow |
| Live application | https://vyapaarflow-henna.vercel.app |
| Hosting | Vercel (functions in Singapore, `sin1`) + Turso (libSQL, AWS Singapore) |
| Author | Kartikay Shukla, Indian Institute of Information Technology, Kota (IIIT Kota) |

This guide covers running VyapaarFlow on your own machine, initialising a Turso database and deploying to Vercel. Commands are shown for **Windows PowerShell** (the environment the project was built on) and, where different, for **bash** (macOS, Linux, Git Bash). Every `npm run …` command below exists in `package.json`.

> **Safety first.** `npm run db:seed` and `npm run db:reset` **delete every table** before inserting the fictional demo data. They refuse to run against a remote database unless you opt in explicitly. Read [section 12](#12-production-database-safety) before pointing any command at Turso.

---

## 1. Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js | 20.9 or later (`engines` in `package.json`; built and tested on 22.13) | Everything |
| npm | Comes with Node.js | Dependencies and scripts |
| Git | Any recent version | Cloning |
| Google Chrome or Microsoft Edge | Installed locally | End-to-end tests only (`npm run e2e`); another path can be given with `CHROME_PATH` |
| Turso account | Free tier is enough | Production database |
| Vercel account | Free (Hobby) tier is enough | Hosting |
| Google AI Studio API key | Optional | Live AI capture with Gemini. Without any AI key the app uses its rule-based matcher and says so on screen. |

## 2. Clone and install

```powershell
git clone https://github.com/KARTIKAY-SHUKLA1/vyapaarflow.git
cd vyapaarflow
npm ci
```

`npm ci` installs exactly what `package-lock.json` records, including the native libSQL and build-tool packages for Windows, macOS and Linux.

## 3. Local environment

Copy the example file and edit the copy. `.env*` files (except `.env.example`) are ignored by git, so they are never committed.

```powershell
Copy-Item .env.example .env.local
```

```bash
cp .env.example .env.local
```

Generate a session secret and paste it into `SESSION_SECRET` in `.env.local`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

For local development the defaults in `.env.example` are enough: `DATABASE_URL=file:./data/local.db` and `DEMO_MODE=true`. Leave `DATABASE_AUTH_TOKEN` empty. To try live AI capture locally, set `AI_PROVIDER=gemini` and `GEMINI_API_KEY`; send only the fictional demo messages.

> Keep `.env.local` pointed at the **local** database. Next.js reads `.env.local` in `npm run dev`, so a Turso URL left there would make your development server read and write the production database. Keep Turso credentials in a separate, temporary file (see [section 8](#8-turso-setup)).

## 4. Local database

```powershell
npm run db:reset
```

This creates `data/local.db`, applies the migrations in `drizzle/` and loads the fictional seed data. Expected output:

```
Reset file:./data/local.db: 20 SKUs, 12 retailers, 148 historical orders (548 lines)
```

Run it again at any time to start over. It deletes and recreates all local data.

## 5. Migrations and seeding

| Command | What it does | Deletes data? |
|---|---|---|
| `npm run db:migrate` | Applies any migrations from `drizzle/` that have not run yet (tracked in `__drizzle_migrations`). Safe to repeat. | No |
| `npm run db:seed` | Deletes all rows in all 18 tables, then inserts the fictional seed data. Needs migrated tables. | **Yes, everything** |
| `npm run db:reset` | `db:migrate` followed by `db:seed`. | **Yes, everything** |
| `npm run db:generate` | Generates a new migration from `src/db/schema.ts` (developers only; not needed to run the app). | No |

The scripts run with `tsx` and **do not read `.env.local`**. They use `DATABASE_URL` and `DATABASE_AUTH_TOKEN` from the shell environment, or `file:./data/local.db` if `DATABASE_URL` is not set. Each script prints the database it used (without credentials), for example `Migrated file:./data/local.db`.

The seed contains: 4 brands; 20 SKUs (the brief's three exactly as given, plus 17 fictional ones), each with a price and a stock row; 6 schemes, including one expired and one starting on 15 November 2026; 12 shops; 16 users (12 retailers, 2 order-desk users, 2 salesmen); 6 WhatsApp-style messages, including the brief's raw message; 148 historical orders with 548 lines, dated relative to the moment you seed. Every name and phone number is fictional.

## 6. Local development

```powershell
npm run dev
```

Open http://localhost:3000 and sign in with a [demo account](#11-demo-accounts-and-simulated-otp).

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Production build (`next build`) |
| `npm run start` | Serves the production build (`next start`) |
| `npm run typecheck` | Generates route types, then runs the TypeScript compiler |
| `npm run lint` | ESLint |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run check` | Typecheck + lint + unit tests |
| `npm run e2e` | Browser end-to-end tests (see [section 13](#13-testing)) |
| `npm run e2e:landing` | The public landing page end-to-end suite only |

## 7. Production build on your own machine

The production server (`NODE_ENV=production`) refuses a local database file unless you say this is a local run:

```powershell
npm run build
$env:ALLOW_LOCAL_DATABASE = "true"
npm run start
Remove-Item Env:ALLOW_LOCAL_DATABASE
```

```bash
npm run build
ALLOW_LOCAL_DATABASE=true npm run start
```

`next build` itself never checks the database settings, so the app can be built without production credentials.

## 8. Turso setup

1. In the Turso dashboard (or with the Turso CLI), create a database. The live deployment uses a database named `vyapaarflow-prod` in **AWS Singapore (`aws-ap-southeast-1`)**. Pick the region that matches your Vercel function region.
2. Copy the database URL (`libsql://<database>-<organisation>.<region>.turso.io`) and create a **read and write** auth token. Treat the token like a password.
3. Create a temporary file `.env.turso` in the project folder (ignored by git) with exactly two lines:

   ```
   DATABASE_URL=libsql://<database>-<organisation>.<region>.turso.io
   DATABASE_AUTH_TOKEN=<token>
   ```

4. Check that nothing else will override it. All three commands must print `False`, because a variable already set in the shell takes precedence over `--env-file`:

   ```powershell
   git check-ignore -v .env.turso
   Test-Path Env:DATABASE_URL; Test-Path Env:DATABASE_AUTH_TOKEN; Test-Path Env:ALLOW_REMOTE_WIPE
   ```

5. **Apply the migrations** (deletes nothing):

   ```powershell
   $env:NODE_ENV = "production"   # makes the script refuse anything but a libsql:// URL with a token
   npx tsx --env-file=.env.turso scripts/migrate.ts
   ```

   Expected: `Migrated libsql://<database>-….turso.io`. If it says `file:` or shows an error, stop and check `.env.turso`.

   This is the same script as `npm run db:migrate`, run with `--env-file` so it reads the Turso settings.

6. **Seed the fictional demo data, once, on the empty database.** Seeding a remote database needs an explicit opt-in, which you remove straight afterwards:

   ```powershell
   $env:ALLOW_REMOTE_WIPE = "true"
   npx tsx --env-file=.env.turso scripts/seed.ts
   Remove-Item Env:ALLOW_REMOTE_WIPE
   ```

   Expected: `Seeded libsql://<database>-…: 20 SKUs, 12 retailers, 148 historical orders (548 lines)`.

   Use `ALLOW_REMOTE_WIPE` rather than `npm run db:seed -- --allow-remote-wipe` on Windows PowerShell 5.1, which can drop the `--` when calling npm; the guard then refuses and nothing is changed, but nothing is seeded either. In bash, `npm run db:seed -- --allow-remote-wipe` works.

7. **Verify** in the Turso dashboard's SQL console:

   ```sql
   SELECT count(*) FROM __drizzle_migrations;   -- 4 (0000–0003)
   SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM retailers) retailers,
          (SELECT count(*) FROM skus) skus, (SELECT count(*) FROM schemes) schemes,
          (SELECT count(*) FROM stock) stock, (SELECT count(*) FROM inbound_messages) messages,
          (SELECT count(*) FROM orders) orders, (SELECT count(*) FROM order_lines) lines;
   -- 16 · 12 · 20 · 6 · 20 · 6 · 148 · 548
   ```

8. **Clean up:**

   ```powershell
   Remove-Item Env:NODE_ENV
   Remove-Item .env.turso
   ```

In bash, steps 5 and 6 are `NODE_ENV=production npx tsx --env-file=.env.turso scripts/migrate.ts` and `NODE_ENV=production ALLOW_REMOTE_WIPE=true npx tsx --env-file=.env.turso scripts/seed.ts`.

## 9. Vercel deployment

1. In Vercel, **import** the GitHub repository. The framework preset is detected as Next.js; keep the defaults (install `npm install`, build `next build`, no output directory override). There is no `vercel.json` in the repository.
2. Add the **environment variables** from [section 10](#10-environment-variables) for the Production environment. Never commit them.
3. **Set the function region to Singapore** (next step) before relying on the deployment.
4. Deploy. Later pushes to `main` deploy automatically.
5. Smoke test: open the site, sign in as the order desk (90000 00100), open the AI inbox and review a message; sign in as a retailer (90000 00001) and place an order.

Migrations are **not** run by the Vercel build. Apply new migrations to Turso yourself (section 8, step 5) before deploying code that needs them.

### Function region: Singapore (`sin1`)

Every page makes several database queries, one after another. With functions in Vercel's default US East region and the database in Singapore, each query crosses the Pacific; with both in Singapore, a query takes a few milliseconds.

The region is configured **manually in the Vercel dashboard**, not in the repository: **Project → Settings → Functions → Function Region → Singapore (`sin1`)**, then redeploy. A new Vercel project starts in the default region, so repeat this for any new project.

Check it from any terminal, without signing in (only the response headers are read):

```powershell
curl.exe -s -o NUL -D - https://vyapaarflow-henna.vercel.app/login | Select-String "x-vercel-id"
```

The value should contain `::sin1::`, for example `bom1::sin1::…` (the first part is the edge location nearest to you).

The AI capture pages (`/desk/inbox` and `/desk/inbox/[id]`) set `maxDuration = 30` seconds so that a capture using its full 12-second model budget is not cut off; the build output lists both routes with 30 s.

## 10. Environment variables

Names and purpose only. Never put real values in the repository, in screenshots or in chat.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Production: yes | Database URL. Locally `file:./data/local.db` (the default). In production it **must** be a remote `libsql://` (or `https://` / `wss://`) URL, or the server stops with a clear error. |
| `DATABASE_AUTH_TOKEN` | Production: yes | Turso read and write token. Required in production. |
| `SESSION_SECRET` | Yes | Random string of at least 32 characters used to sign session cookies and hash OTP codes. The app refuses to run without it. Changing it signs everyone out. |
| `DEMO_MODE` | No | `true` lists the demo accounts on the sign-in screen and shows the simulated OTP. **Anyone can then sign in as any user, including the order desk; use it only with fictional data.** |
| `AI_PROVIDER` | No | `gemini`, `anthropic`, `openai-compatible` or `none`. When unset, the first configured key is used (Anthropic, then Gemini, then an OpenAI-compatible endpoint); with none, the rule-based matcher. |
| `GEMINI_API_KEY` | For Gemini | Google AI Studio key. Sent in a request header, never in the URL. |
| `GEMINI_MODEL` | No | Overrides the default model `gemini-3.5-flash-lite`. |
| `GEMINI_THINKING_LEVEL` | No | `minimal`, `low` (default), `medium` or `high`. Not every model accepts `minimal`. |
| `ANTHROPIC_API_KEY` | For Anthropic | Anthropic API key. |
| `ANTHROPIC_MODEL` | No | Overrides the default Anthropic model. |
| `AI_BASE_URL`, `AI_MODEL` | For OpenAI-compatible | Base URL of any Chat Completions endpoint (including a local server) and the model name. |
| `AI_API_KEY` | No | Key for that endpoint, if it needs one. |
| `AI_JSON_MODE` | No | `json_schema` (default) or `json_object` for endpoints without JSON-schema support. |
| `ALLOW_LOCAL_DATABASE` | Local only | `true` lets the production server use a local SQLite file (section 7; the e2e runner sets it). Do not set it on Vercel. |
| `ALLOW_REMOTE_WIPE` | One-off | `true` lets `db:seed` / `db:reset` wipe a remote database (section 8). Never leave it set. |
| `OTP_RATE_WINDOW_SEC`, `OTP_IP_SEND_LIMIT`, `OTP_IP_VERIFY_LIMIT`, `OTP_GLOBAL_SEND_LIMIT`, `OTP_GLOBAL_VERIFY_LIMIT` | No | Override the OTP rate limits (defaults: a 600-second window; per IP 20 sends and 40 verifies; globally 300 sends and 1,000 verifies). Needs migration `0003_rate_limits`; without the table the per-IP and global checks are skipped and logged, and the per-number limits still apply. |
| `VERCEL` | Set by Vercel | When `1`, the client IP is read from Vercel's `x-real-ip` header for the per-IP limits; elsewhere no IP is trusted and only the global and per-number limits apply. Do not set it yourself. |
| `CHROME_PATH` | Tests only | Browser for `npm run e2e` if Chrome or Edge is not in a standard location. |
| `E2E_BASE_URL`, `E2E_ONLY`, `E2E_SCREENSHOTS` | Tests only | Point the e2e runner at an already running server, pick suites, or save screenshots. |

`NODE_ENV` is set by Next.js; Vercel sets it to `production`.

Recommended Vercel production set: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `SESSION_SECRET`, `DEMO_MODE=true` (assessment demo only), `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and optionally `GEMINI_MODEL`.

## 11. Demo accounts and simulated OTP

With `DEMO_MODE=true`, enter a number and press **Send OTP**. No SMS is sent: the message is written to the `sms_outbox` table and the code is shown on the screen as "Demo OTP (simulated SMS)". Enter it and press **Verify and continue**.

| Role | Mobile | Notes |
|---|---|---|
| Retailer, Sharma Kirana Store (RT-1001) | 90000 00001 | Has order history and "usual items" |
| Retailer, Gupta General Stores (RT-1002) | 90000 00002 | Close to its credit limit: orders go to credit hold |
| Other retailers (RT-1003 … RT-1012) | 90000 00003 … 90000 00012 | |
| Order desk, Neha Soni | 90000 00100 | |
| Order desk, Arvind Kushwaha | 90000 00101 | |

Salesman records exist (90000 00200, 90000 00201) but salesmen **cannot sign in** in this build.

OTP rules apply in demo mode too: a code is valid for 5 minutes and 5 attempts and can be used once; a new code can be requested after 30 seconds, at most 5 per hour per number. Per-IP and global limits also apply (section 10), so many sign-ins from one network in a few minutes may be refused with a "try again later" message.

The live demo is shared: reviewers may approve, cancel or export orders and change what others see. All data is fictional. To return it to a fresh state, re-seed it deliberately (section 8, step 6). The seeded brief schemes are valid until 31 December 2026.

## 12. Production database safety

- `db:seed` and `db:reset` **delete every row in every table** before seeding. Against a remote URL they refuse unless `ALLOW_REMOTE_WIPE=true` or `--allow-remote-wipe` is given. Only use the opt-in deliberately, on a database whose data you are prepared to lose, and remove it straight away.
- **Never run `npm run db:reset` with Turso settings in your shell.** To initialise Turso, run migrate and seed separately as in section 8.
- Use `db:migrate` for schema changes on an existing database: it never deletes data.
- Keep Turso credentials out of `.env.local`, so `npm run dev` cannot touch production. Delete `.env.turso` after use.
- Do not print your environment (`Get-ChildItem env:`, `printenv`) or `Get-Content` the env files while sharing your screen or logs.
- With `NODE_ENV=production`, the server refuses a missing, local or non-remote `DATABASE_URL` and a missing `DATABASE_AUTH_TOKEN`; it never silently falls back to a local file.
- `DEMO_MODE=true` is for the fictional assessment data only. Before using real retailer data: set it to `false`, connect a real SMS provider, and use a paid AI tier whose terms do not allow training on your data.

## 13. Testing

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
```

- `npm test` runs the Vitest unit and integration tests. Database tests use fresh temporary SQLite files; real network calls are blocked and no AI provider is called.
- `npm run e2e` needs a production build (`npm run build` first) and a local Chrome or Edge. It resets its own `data/e2e.db`, starts the app on port 3100 with demo mode and AI turned off, runs the landing, retailer, desk and security suites, and stops the server. `npm run e2e:landing` runs only the landing suite; `npm run e2e -- landing,security` picks suites by name. It never touches `.env.local`'s database or Turso.

Latest verified run (3 November 2026, deployed commit `e3e92f8` plus the one-line CSS inlining change in `next.config.ts`): typecheck, lint and production build passed; **607 unit and integration tests in 28 files passed; 149 end-to-end checks passed** (landing 49, retailer 34, desk 48, security 18).

The AI capture evaluation (`eval/capture/`, not part of `npm test`) runs 47 synthetic messages through the real server path on an in-memory database: `npx tsx eval/capture/run.ts --engine rules` and `--engine fallback`. A live Gemini run (`npx tsx --env-file=.env.local eval/capture/run.ts --engine gemini --key-rotated`) makes real API calls with the fictional messages only.

## 14. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `SESSION_SECRET must be set to a random string of at least 32 characters` | Set `SESSION_SECRET` (section 3; on Vercel, in Environment Variables) and redeploy. |
| `DATABASE_URL is not set. In production it must be the remote libSQL/Turso URL…` | The production server has no database URL. Add `DATABASE_URL` in Vercel and redeploy. |
| `DATABASE_URL must be a remote libSQL/Turso URL … not a "file:" URL` | Production is pointing at a local file. On Vercel, use the `libsql://` URL. Locally, set `ALLOW_LOCAL_DATABASE=true` to run the production build against a file (section 7). |
| `DATABASE_AUTH_TOKEN is not set` | Add the Turso token in Vercel and redeploy. |
| `Refusing to wipe and re-seed a remote database (…)` | The wipe guard. Intended for remote databases; see section 8, step 6, and section 12. |
| `npm run db:migrate` printed `Migrated file:./data/local.db` when you meant Turso | The npm scripts don't read `.env.local` or `.env.turso`. Use `npx tsx --env-file=.env.turso scripts/migrate.ts` (section 8). |
| `no such table: …` while seeding | Migrations have not run on that database. Run migrate first. |
| `SERVER_ERROR: … HTTP status 401` from libSQL | Wrong or expired Turso token, or a read-only token. Create a read and write token. |
| Every page feels slow on Vercel | Functions are not in Singapore. Check `x-vercel-id` (section 9) and set the region to `sin1`. |
| AI review says "Rule-based matching only — AI not used (no API key configured)" | No provider configured. Set `AI_PROVIDER` and the provider's key, and redeploy. |
| AI review says "AI did not answer within 12 seconds" or "AI is paused for about 2 minutes…" | The provider was slow or unavailable, so the labelled rule-based result was used. Check every line; press **Re-read with AI** to try again (it bypasses the pause). |
| Sign-in says to wait before resending | OTP rate limit: 30 seconds between codes, 5 per hour per number. |
| `npm run e2e`: `No production build found` | Run `npm run build` first. |
| `npm run e2e`: browser not found | Install Chrome or Edge, or set `CHROME_PATH`. |
| `npm run e2e`: port 3100 in use | Stop the other process on port 3100. |
| Build or `npm ci` fails on a missing native package | Use `npm ci` with the committed `package-lock.json`; do not regenerate the lock file on one operating system for another. |
