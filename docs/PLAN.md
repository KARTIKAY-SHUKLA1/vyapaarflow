# VyapaarFlow — Build Plan

Isocode Labs take-home, Problem 5: FMCG distributor (Jabalpur) retailer ordering app with AI order capture.
Deadline: 9 Nov 2026, 11:59 pm IST. Deliverables: TDD (PDF/Word, GitHub URL on top) + `deployment.md`, zipped.

## 1. What the brief actually scores

| Requirement (from brief) | How we meet it |
|---|---|
| Core slice end to end, 6–8 screens | Catalogue → cart → order; AI text capture → review → confirm; order desk → Tally export |
| Roles: retailer, order desk | Two roles with server-side access checks on every query |
| Hard part: scheme engine | Pure, fully unit-tested module (free goods + slab discounts, dates, stock, rounding) |
| AI capture from text, honest when wrong | Real LLM call + deterministic matcher; per line: original words, confidence, 2 alternatives; unit (case/piece) asked, never guessed; human confirms; desk corrections → retailer aliases |
| Frontend, backend, DB, sign-in | Next.js full stack, SQLite/libSQL via Drizzle, OTP login (SMS mocked) |
| No dead buttons, realistic seed data | Seed from brief's 3 SKUs + expanded fictional catalogue, retailers, 60 days of order history, inbox of WhatsApp-style messages |
| Polished UI, phone layout, loading/empty/error states | One design system, mobile-first, every list has all three states |
| Tests, security | Vitest on scheme engine, pricing/GST, AI output validation, access control, Tally export; Zod on all inputs; no secrets committed |
| 3G, first load < 3 s, large tap targets | Server components, minimal client JS, no heavy UI libs, system font stack, lazy images |
| Hindi + English, GST clearly shown | EN/हिं toggle; every price labelled "excl. GST" / "incl. GST" |
| Prices & credit visible only to retailer, their salesman, desk | Enforced in data layer, tested |

## 2. Architecture

- **Next.js (App Router, TypeScript)** — one deployable for UI + API (server actions / route handlers). Server-rendered pages keep JS small for slow 3G.
- **Drizzle ORM + libSQL** — SQLite file locally (zero install for reviewers), Turso in production. Same schema both places.
- **Auth** — phone + 6-digit OTP. OTP hashed, 5-minute expiry, attempt limit. SMS is mocked: OTP written to an outbox and shown in a "demo mode" banner. Session = signed httpOnly cookie (jose).
- **AI** — `lib/ai/`: (1) deterministic candidate retrieval (normalise Hinglish, retailer aliases, past orders, fuzzy match on catalogue); (2) Claude model picks SKU/qty/unit with confidence via structured output; (3) every model output validated with Zod against the real catalogue — unknown SKUs dropped, missing/unclear unit → question. Works without an API key via the deterministic path (clearly labelled), so the app never breaks.
- **Scheme engine** — `lib/schemes/`: pure functions, no DB, 100% unit tested.
- **Tally export** — Tally-importable XML (Sales Order vouchers) + CSV.
- **PWA** — manifest + service worker so it is installable (offline salesman mode = optional depth).
- **Deploy** — Vercel + Turso (env var names only in `deployment.md`).

## 3. Data model (first cut)

`users` (id, phone, name, role: retailer | desk | salesman, retailerId?) ·
`retailers` (shop name, owner, area, salesmanId, creditLimit, outstanding, priceListId, language) ·
`brands` · `skus` (code, name, brandId, packSize, unit, gstRate, imageUrl, active) ·
`price_lists` / `prices` (per retailer tier, dealer price per piece, excl. GST) ·
`stock` (skuId, cases) ·
`schemes` (type: FREE_GOODS | SLAB_PERCENT, skuId, buyQty, freeQty, minQty, percent, validFrom, validTo) ·
`orders` (retailerId, source: app | ai_capture | desk, status: placed | credit_hold | approved | exported | cancelled, totals) ·
`order_lines` (skuId, qtyCases, freeCases, unitPrice, discount, gst, lineTotal) ·
`inbound_messages` (retailerId, channel, raw text, status) ·
`capture_lines` (messageId, originalText, suggestedSkuId, alt1, alt2, qty, unit, confidence, needsUnit, resolved) ·
`retailer_aliases` (retailerId, phrase → skuId, unit) ·
`otp_codes`, `sessions`, `audit_log`, `tally_exports`.

## 4. Screens (core = 8)

Retailer: 1 Login (phone → OTP) · 2 Catalogue (search, stock, price, scheme, GST label, repeat last order) · 3 Cart (schemes applied, free goods, savings, credit limit) · 4 My orders + order detail.
Desk: 5 Order queue (new / credit hold / approved / exported) + detail · 6 Message inbox (WhatsApp-style, mocked) · 7 AI capture review (original words, confidence, 2 alternatives, unit question, confirm) · 8 Tally export.
Optional depth if time: retailers with no order in 14 days, scheme admin, salesman offline mode, photo/voice capture.

## 5. Execution phases (each ends in commits pushed to GitHub)

1. **Foundation** — scaffold, design tokens, DB schema, seed data, OTP auth + roles, app shell.
2. **Scheme engine + pricing** (tests first) — parallel with 3.
3. **AI capture engine** (tests with mocked model) — parallel with 2.
4. **Retailer flows** — catalogue, cart, place order, my orders.
5. **Desk flows** — queue, credit hold, inbox, capture review, aliases, Tally export.
6. **Polish** — Hindi, states, mobile QA, PWA, performance, security pass.
7. **Docs** — README, `deployment.md`, TDD (PDF), demo logins; deploy.

## 6. Assumptions (to label in the TDD)

- A1. Dealer price in the sample data is **per piece, excluding GST**; a case costs price × pack size (e.g. biscuit case = 96 × ₹8.10 = ₹777.60).
- A2. "peti" = case. Quantities are ordered in cases; pieces only if the retailer explicitly says so.
- A3. "Buy 10 cases get 1 free" repeats per multiple (20 → 2 free); free goods need stock too.
- A4. Slab "3% off 5 or more cases" applies to the whole line once the threshold is met.
- A5. One active scheme per SKU at a time; schemes have validity dates.
- A6. GST rates per SKU are configurable placeholders and must be verified by the client's accountant.
- A7. An order that would take the retailer's outstanding above the credit limit goes on **credit hold** for the desk, not rejected.
- A8. Out-of-stock items can be shown and captured but are not orderable; the desk sees them flagged.
- A9. Brands, retailers and people in seed data are fictional.
