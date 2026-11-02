# VyapaarFlow — Implementation Plan

Isocode Labs take-home, **Problem 5**: FMCG distributor (Jabalpur) — retailer ordering app with AI order capture.
Deadline: **9 Nov 2026, 11:59 pm IST**. Deliverables: TDD (PDF, GitHub URL + live URL on top) and `deployment.md`, zipped.

Source of truth: the original Problem 5 brief. Anything not stated there is an **assumption**, labelled `A#` below and in the TDD.

---

## 1. Core build (must work end to end before any optional feature)

| # | Core workflow | Done when |
|---|---|---|
| C1 | Retailer catalogue with prices, schemes, stock | Retailer signs in with OTP, sees only *their* price, the live scheme, stock status and a GST label on every price |
| C2 | Cart and order | Scheme engine applies free goods / slab discounts; credit limit shown; order placed or put on credit hold |
| C3 | AI capture from a text order | Desk pastes/receives a message → each line shows original words, SKU, confidence, 2 alternatives; unclear unit is asked; nothing becomes an order until a person confirms; desk corrections saved as retailer aliases |
| C4 | Order desk with Tally export | Queue of orders (new / credit hold / approved / exported), approve or release hold, export Tally-importable XML + CSV |

Roles: **retailer** and **order desk** (core). Salesman is optional depth (see §7).

**Acceptance test from the brief** — the raw message
`bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti` must produce:

| Words | Expected result |
|---|---|
| 5 peti biscuit chhota | SKU-BS-075, 5 cases; scheme engine: no free goods yet, nudge "add 5 more cases for 1 free" |
| 2 peti washing powder 1 kilo | SKU-DT-1KG, 2 cases; below slab; nudge "3% off from 5 cases" |
| chai patti 250 wala 1 peti | SKU-TE-250, 1 case; **out of stock (0 cases) → flagged, not orderable** |

## 2. Hard rules (non-negotiable)

1. **AI never decides prices, stock or schemes.** The model only proposes `{sku, quantity, unit, confidence}` per line. Price, GST, stock check, scheme benefit and credit check are computed by deterministic server code from the database.
2. **Every AI output is validated** (Zod) against the real catalogue. Unknown SKU codes are discarded; a missing or ambiguous unit becomes a question, never a guess.
3. **No order from AI without human confirmation.** Captured orders are drafts until a desk user (or the retailer) confirms.
4. **No invented business rules.** Where the brief is silent (GST rates, price basis, credit policy) we pick the most conservative reading, make it configurable data, and label it as an assumption.
5. **Access control on the server**, in the data layer, on every query. Never rely on hidden UI.
6. **No secrets in the repo.** `.env*` ignored; env var names documented only.

## 3. Architecture

- **Next.js 16 (App Router, TypeScript, React Server Components)** — one deployable for UI and backend (server actions + route handlers). Server-rendered pages keep client JS small for slow 3G.
- **Drizzle ORM + libSQL** — SQLite file locally (no install for reviewers), **Turso** in production. Same schema, same driver.
- **Auth** — phone + 6-digit OTP. OTP stored hashed, 5-min expiry, max 5 attempts, resend throttle. SMS is mocked (outbox table; OTP shown in a clearly marked demo banner). Session = signed, httpOnly, SameSite=Lax JWT cookie (`jose`), role re-checked from DB on each request.
- **Tailwind CSS 4** with a small token set (colour, type, spacing, radius). No component library — keeps bundle small and the UI deliberate.
- **Scheme engine** — `src/lib/schemes/`: pure functions, no I/O, integer paisa maths, exhaustive unit tests.
- **AI capture** — `src/lib/capture/`:
  1. normalise Hinglish (peti/case, chhota/small, kilo/kg, wala…)
  2. deterministic candidate retrieval: retailer aliases → retailer's past orders → fuzzy catalogue match
  3. Claude (structured output) chooses among candidates, returns quantity, unit and confidence
  4. validation + merge: unknown SKUs dropped, 2 alternatives attached, unit questions raised
  5. if no API key / API error: deterministic matcher only, labelled "rule-based" in the UI — never silently faked
- **Tally export** — Tally-importable XML (Sales Order vouchers) + CSV; mocked hand-off (file download), logged.
- **PWA** — manifest + service worker so the app is installable.
- **Tests** — Vitest: scheme engine, pricing/GST, capture parsing + validation (model mocked), access control, Tally export, OTP.
- **Deploy** — Vercel (app) + Turso (DB), if their current free tiers fit; otherwise documented alternative.

## 4. Data model

| Table | Key fields |
|---|---|
| `users` | id, phone (unique), name, role `retailer \| desk \| salesman`, retailerId?, active |
| `retailers` | id, code, shopName, ownerName, area, phone, salesmanId?, creditLimitPaise, outstandingPaise, priceTier, language `en \| hi` |
| `brands` | id, name |
| `skus` | id, code, name, nameHi, brandId, category, packSize (pieces/case), gstRatePct, imageKey, active |
| `prices` | skuId, priceTier, dealerPricePaise (per piece, excl. GST) |
| `stock` | skuId, cases, updatedAt |
| `schemes` | id, skuId, type `FREE_GOODS \| SLAB_PERCENT`, buyQty, freeQty, minQty, percentBp, validFrom, validTo, active |
| `orders` | id, number, retailerId, source `app \| capture \| desk`, status `placed \| credit_hold \| approved \| exported \| cancelled`, subtotal/discount/gst/total paise, createdBy, notes |
| `order_lines` | orderId, skuId, cases, freeCases, unitPricePaise, discountPaise, gstPaise, lineTotalPaise, schemeId?, schemeNote |
| `inbound_messages` | id, retailerId?, channel `whatsapp \| sms \| manual`, body, receivedAt, status `new \| captured \| converted \| dismissed` |
| `captures` / `capture_lines` | messageId, engine `llm \| rules`, model; line: originalText, skuId?, alt1, alt2, quantity, unit `case \| piece \| unknown`, confidence, issues[], resolvedBy |
| `retailer_aliases` | retailerId, phrase (normalised), skuId, unit?, createdBy |
| `otp_codes`, `sms_outbox` | hashed code, expiry, attempts; mocked SMS log |
| `audit_log` | actorId, action, entity, entityId, before/after JSON, at |
| `tally_exports` | id, orderIds, format, createdBy, at |

Money is stored as **integer paise**; no floats in price maths.

## 5. Screens

Retailer (mobile-first): **1** Login (phone → OTP) · **2** Catalogue (search, brand filter, stock, price, scheme, GST label, repeat last order) · **3** Cart (scheme applied, free goods, nudges, credit limit, place order) · **4** My orders + order detail.

Order desk (desktop-first, works on phone): **5** Order queue + detail (approve, credit hold release, cancel) · **6** Message inbox (mocked WhatsApp) + paste a new message · **7** AI capture review (original words, confidence, alternatives, unit question, confirm → order) · **8** Tally export.

One layout pattern everywhere: top bar, page title + one primary action, a single content column/table, consistent loading / empty / error states.

## 6. Phases (each ends with checks green → commit → push)

| Phase | Work | Owner |
|---|---|---|
| 1 Foundation | Scaffold, tokens, schema, migrations, seed, OTP auth, roles, app shells, test harness | Main agent |
| 2 Scheme engine + pricing | Pure module, tests first | Subagent (parallel with 3) |
| 3 AI capture engine | Normaliser, matcher, LLM adapter, validation, tests with mocked model | Subagent (parallel with 2) |
| 4 Retailer flows | C1, C2 | Main agent |
| 5 Desk flows | C3 UI, C4 | Main agent |
| 6 Polish | Hindi, states, mobile QA, PWA, performance, security | Main agent |
| 7 Review | Independent code + security review, fixes | Fresh subagent |
| 8 Docs + deploy | README, `deployment.md`, TDD PDF, Vercel + Turso | Main agent |

Checks before every commit: `typecheck`, `lint`, `test`, `build`.

## 7. Optional depth (only after C1–C4 are done)

In priority order: retailers with no order in 14 days · repeat order · van loading list · audit log view · salesman role (sees only own retailers) · offline salesman mode · photo / voice capture.

## 8. Assumptions (also in the TDD)

- **A1** Sample "Dealer Price ₹" is **per piece, excluding GST**; a case costs price × pack size (biscuit case = 96 × ₹8.10 = ₹777.60). *Reason: ₹8.10 is implausible for a case of 96.* Confirm with client.
- **A2** Orders are in **cases**. "peti" = case. Pieces only when the message explicitly says so; otherwise the unit is asked.
- **A3** "Buy 10 cases get 1 free" repeats per full multiple (20 → 2 free). Free cases also need stock; if stock is short, free cases are capped and the line is flagged.
- **A4** "3% off 5 or more cases" applies to the whole line value once the threshold is met.
- **A5** At most one active scheme per SKU at a time; schemes carry validity dates.
- **A6** GST: rates are **per-SKU configurable placeholders**, not tax advice; the UI always states whether a figure is excl. or incl. GST. Discount applied before GST. To be verified by the client's accountant.
- **A7** Credit: if outstanding + new order total exceeds the credit limit, the order goes to **credit hold** for the desk to release or cancel. It is never auto-rejected and never auto-released.
- **A8** Out-of-stock SKUs are visible but cannot be added; captured lines for them are flagged.
- **A9** All brands, retailers, people and phone numbers in seed data are fictional.
- **A10** SMS/WhatsApp, payment and Tally are mocked (outbox table, file export).
- **A11** Credit exposure = outstanding (invoiced, from Tally) **+ open orders** (placed, approved, on hold). Without the second term a shop could place several orders each just under its limit.
- **A12** Stock is reserved when an order is created (incl. free cases) and returned if the desk cancels it. Exported orders are final in this app; later changes happen in Tally.
- **A13** Tally CSV column layout follows common Tally voucher-import templates (one row per line, Sales Order vouchers, amounts in rupees, UTF-8 BOM). The exact mapping must be confirmed against the client's import template.
- **A14** Orders are placed in cases. A captured line in pieces or with no unit cannot become an order until the desk agrees the case quantity with the retailer (brief: "unclear units are asked, not guessed").
- **A15** A desk correction that changes the product, or settles the unit, is saved as that shop's alias for those words. Changed quantities are not learned (they vary per order).
