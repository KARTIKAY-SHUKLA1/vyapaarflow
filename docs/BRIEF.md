# Problem 5 — FMCG distributor's retailer ordering app with AI order capture

Original client brief from the Isocode Labs take-home (Software Engineering Intern), reproduced verbatim for reference. Everything not stated here is an assumption, labelled `A#` in [PLAN.md](PLAN.md) and in the TDD.

## Client
Company A, Jabalpur. Distributor for 4 packaged food and home care brands, serving 1,800 kirana shops. 70 staff including 18 salesmen, revenue ₹85–100 crore a year.

## Today
Salesmen write orders in notebooks, or retailers send WhatsApp texts, photos of handwritten lists and Hindi voice notes. Next morning an office team of 6 types them into Tally. Salesmen don't know stock or schemes at the counter, so lines are cut later.

## The problem
Assumptions: 600 orders a day, 300 days, ₹5,000 per order, so ₹90 crore a year. 5% of orders have a wrong item or quantity needing a return or redelivery: 1,80,000 × 5% = 9,000 × ₹350 = ₹31.5 lakh. Order entry staff: 6 × ₹2.6 lakh = ₹15.6 lakh. Stock-outs found after ordering lose 1% of sales at 6% margin: ₹90 lakh × 6% = ₹5.4 lakh. Total ₹52.5 lakh a year.

## Users
Retailers (shop owners on phones), salesmen, and the office order desk. The owner-director signs the deal.

## The ask
My shopkeepers already order on WhatsApp, each in their own way, and my office retypes it all. I want a simple app where a retailer sees stock, his price and the current scheme, and orders in a minute. Salesmen should use it in the shop, even without signal. Messages and voice notes should become orders my desk only has to check.

## Must have
- Installable web app with OTP login, catalogue, retailer prices and schemes, stock status, repeat order and credit limit
- Salesman mode for orders during visits, working offline
- AI order capture from text, a photo of a list, or a Hindi voice note
- Scheme engine for free goods (buy 10 get 1) and slab discounts
- Order desk with credit holds, Tally export and van loading lists
- Dashboard of retailers with no order in 14 days

## Core build
Software Engineering candidates must ship this slice end to end, in about 6 to 8 screens: retailer catalogue with prices and schemes, cart and order, AI capture from a text order, and order desk with Tally export. Roles: retailer and order desk. AI: order capture from messages. Hard part: the scheme engine. Mock payments, messages and outside systems, and seed from the sample data. The rest of MUST HAVE is optional depth.

## Out of scope
- Delivery tracking
- Payments in the app
- GST e-invoicing (stays in Tally)

## AI or automation
AI reads text, photos and voice notes and maps items to SKUs using the retailer's past orders. When it is wrong: each line shows the original words, a confidence level and two alternative SKUs, and unclear units (case or piece) are asked, not guessed. No order is placed until a person confirms it, and desk corrections become aliases for that retailer.

## Constraints
Retailers use low-end phones on slow 3G: first load under 3 seconds, large tap targets. Hindi and English. Prices must show clearly whether GST is included. A retailer's prices and credit are visible only to them, their salesman and the desk.

## Design
The client values good, minimal design: clean layouts, white space, a restrained palette and clear type, with nothing on screen that lacks a purpose. Design counts as much as features. Shopkeepers order between customers: a fast, uncluttered catalogue with large images, clear prices and a quick cart.

## Budget and time
₹7 lakh, 6 weeks. Success: 50% of orders placed in the app or captured by AI in 4 months; orders with errors from 5% to under 1%; order entry team from 6 to 3.

## Sample data

| SKU Code | SKU Name | Dealer Price ₹ | Stock Cases | Scheme |
|---|---|---|---|---|
| SKU-BS-075 | Glucose biscuit 75 g, case of 96 | 8.10 | 340 | Buy 10 cases get 1 free |
| SKU-DT-1KG | Detergent powder 1 kg, case of 20 | 101.50 | 85 | 3% off 5 or more cases |
| SKU-TE-250 | Tea leaf 250 g, case of 40 | 118.00 | 0 | None |

Raw order message: `bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti`

## Submission requirements (from the assignment)
- Main flows work on realistic sample data; no dead buttons.
- Frontend, backend, a database and sign-in; roles where the brief has more than one kind of user.
- The AI or automation part actually works, including what happens when it is wrong or unsure.
- Polished UI: consistent design, phone layout, loading, empty and error states.
- Tests for the most important logic; basic security: no secrets in the repository, validated inputs, access control.
- Deliverables: a Technical Design Document (GitHub URL on top) and `deployment.md`, in one ZIP.
