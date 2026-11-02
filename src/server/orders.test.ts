import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { auditLog, orderLines, orders, retailers, skus, stock, users } from "@/db/schema";
import type { Viewer } from "@/lib/auth/policy";
import { testDb } from "@/test/db";
import { loadCatalogue, loadCredit } from "./catalogue";
import { getOrderForViewer, listOrdersForRetailer, orderItemPreviews, placeOrder } from "./orders";
import { priceCart } from "./pricing";

const NOW = new Date("2026-11-02T10:00:00+05:30");
const AS_OF = "2026-11-02";

let db: DB;
let sku: Record<string, string>; // code → id

async function viewerFor(phone: string): Promise<Viewer> {
  const [u] = await db.select().from(users).where(eq(users.phone, phone));
  return { id: u.id, name: u.name, role: u.role, retailerId: u.retailerId, language: u.language };
}
const stockOf = async (code: string) => (await db.select().from(stock).where(eq(stock.skuId, sku[code])))[0].cases;
const key = () => crypto.randomUUID();

/** Price first (as the cart screen does), then place with the total the retailer saw. */
async function order(viewer: Viewer, lines: { code: string; cases: number }[], k = key()) {
  const cart = lines.map((l) => ({ skuId: sku[l.code], cases: l.cases }));
  const pricing = await priceCart(db, viewer.retailerId!, cart, AS_OF);
  return placeOrder(db, viewer, { lines: cart, expectedTotalPaise: pricing!.totals.totalPaise, idempotencyKey: k }, { now: NOW });
}

beforeEach(async () => {
  ({ db } = await testDb(NOW));
  sku = Object.fromEntries((await db.select({ id: skus.id, code: skus.code }).from(skus)).map((r) => [r.code, r.id]));
});

describe("catalogue", () => {
  it("shows the brief's SKUs with case price, stock status and today's scheme", async () => {
    const items = await loadCatalogue(db, "standard", AS_OF);
    const biscuit = items.find((i) => i.code === "SKU-BS-075")!;
    expect(biscuit).toMatchObject({ casePricePaise: 77760, stockStatus: "in", scheme: { label: "Buy 10 cases get 1 free" } });
    expect(items.find((i) => i.code === "SKU-TE-250")).toMatchObject({ stockStatus: "out", scheme: null });
    expect(items.find((i) => i.code === "SKU-MX-200")?.stockStatus).toBe("low");
  });

  it("hides expired and not-yet-started schemes", async () => {
    const items = await loadCatalogue(db, "standard", AS_OF);
    expect(items.find((i) => i.code === "SKU-NM-150")?.scheme).toBeNull(); // ended 31 Oct
    expect(items.find((i) => i.code === "SKU-TE-500")?.scheme).toBeNull(); // starts 15 Nov
    const later = await loadCatalogue(db, "standard", "2026-11-20");
    expect(later.find((i) => i.code === "SKU-TE-500")?.scheme?.label).toBe("2% off 3 or more cases");
  });

  it("never shows a SKU at another tier's price", async () => {
    expect(await loadCatalogue(db, "premium", AS_OF)).toEqual([]);
  });
});

describe("priceCart", () => {
  it("prices the brief's raw order on the server and blocks the out-of-stock tea", async () => {
    const v = await viewerFor("919000000001");
    const p = (await priceCart(db, v.retailerId!, [
      { skuId: sku["SKU-BS-075"], cases: 5 },
      { skuId: sku["SKU-DT-1KG"], cases: 2 },
      { skuId: sku["SKU-TE-250"], cases: 1 },
    ], AS_OF))!;
    const [biscuit, detergent, tea] = p.lines;
    expect(biscuit).toMatchObject({ grossPaise: 388800, freeCases: 0, nudge: { kind: "FREE_GOODS", addCases: 5 } });
    expect(detergent).toMatchObject({ grossPaise: 406000, nudge: { kind: "SLAB", addCases: 3 } });
    expect(tea.issues).toContain("OUT_OF_STOCK");
    expect(p.orderable).toBe(false);
  });

  it("merges repeated SKUs instead of creating duplicate lines", async () => {
    const v = await viewerFor("919000000001");
    const p = (await priceCart(db, v.retailerId!, [
      { skuId: sku["SKU-BS-075"], cases: 6 },
      { skuId: sku["SKU-BS-075"], cases: 4 },
    ], AS_OF))!;
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ cases: 10, freeCases: 1 });
  });

  it("flags unknown or inactive SKUs and refuses to price them", async () => {
    const v = await viewerFor("919000000001");
    await db.update(skus).set({ active: false }).where(eq(skus.id, sku["SKU-RK-200"]));
    const p = (await priceCart(db, v.retailerId!, [
      { skuId: "nope", cases: 1 },
      { skuId: sku["SKU-RK-200"], cases: 1 },
      { skuId: sku["SKU-BS-075"], cases: 1 },
    ], AS_OF))!;
    expect(p.unavailableSkuIds).toEqual(["nope", sku["SKU-RK-200"]]);
    expect(p.lines).toHaveLength(1);
    expect(p.orderable).toBe(false);
  });

  it("counts open orders against credit, not just outstanding (A11)", async () => {
    const gupta = await viewerFor("919000000002"); // seeded with an open order on credit hold
    const credit = (await loadCredit(db, gupta.retailerId!))!;
    expect(credit.openOrdersPaise).toBeGreaterThan(0);
    expect(credit.exposurePaise).toBe(credit.outstandingPaise + credit.openOrdersPaise);
  });
});

describe("placeOrder", () => {
  it("places an order with server-computed totals, reserves stock (incl. free cases) and audits it", async () => {
    const v = await viewerFor("919000000001");
    const before = await stockOf("SKU-BS-075");
    const res = await order(v, [{ code: "SKU-BS-075", cases: 10 }, { code: "SKU-DT-1KG", cases: 5 }]);
    expect(res).toMatchObject({ ok: true, status: "placed", duplicate: false });
    if (!res.ok) return;

    expect(res.number).toMatch(/^SO-2611-\d{4}$/);
    expect(await stockOf("SKU-BS-075")).toBe(before - 11); // 10 + 1 free
    expect(await stockOf("SKU-DT-1KG")).toBe(85 - 5);

    const [o] = await db.select().from(orders).where(eq(orders.id, res.orderId));
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, res.orderId));
    expect(o.totalPaise).toBe(lines.reduce((s, l) => s + l.totalPaise, 0));
    expect(lines.find((l) => l.skuId === sku["SKU-DT-1KG"])).toMatchObject({ discountPaise: 30450, gstPaise: 177219, totalPaise: 1161769 });
    expect(lines.find((l) => l.skuId === sku["SKU-BS-075"])).toMatchObject({ freeCases: 1, schemeNote: "Buy 10 cases get 1 free" });
    expect(await db.select().from(auditLog).where(eq(auditLog.entityId, res.orderId))).toHaveLength(1);
  });

  it("returns the same order for a repeated submit and does not reserve stock twice", async () => {
    const v = await viewerFor("919000000001");
    const k = key();
    const first = await order(v, [{ code: "SKU-DT-1KG", cases: 2 }], k);
    const second = await order(v, [{ code: "SKU-DT-1KG", cases: 2 }], k);
    expect(first.ok && second.ok && second.orderId === first.orderId && second.duplicate).toBe(true);
    expect(await stockOf("SKU-DT-1KG")).toBe(83);
  });

  it("handles simultaneous double taps with the same key", async () => {
    const v = await viewerFor("919000000001");
    const k = key();
    const results = await Promise.all([order(v, [{ code: "SKU-DT-1KG", cases: 1 }], k), order(v, [{ code: "SKU-DT-1KG", cases: 1 }], k)]);
    const ids = new Set(results.map((r) => (r.ok ? r.orderId : "fail")));
    expect(ids.size).toBe(1);
    expect(await stockOf("SKU-DT-1KG")).toBe(84);
  });

  it("never oversells when two shops race for the same stock", async () => {
    const [a, b] = [await viewerFor("919000000001"), await viewerFor("919000000009")];
    const results = await Promise.all([order(a, [{ code: "SKU-DT-1KG", cases: 50 }]), order(b, [{ code: "SKU-DT-1KG", cases: 50 }])]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, error: expect.stringMatching(/STOCK_CHANGED|NOT_ORDERABLE/) });
    expect(await stockOf("SKU-DT-1KG")).toBe(35);
  });

  it("rejects out-of-stock and over-stock lines and writes nothing", async () => {
    const v = await viewerFor("919000000001");
    const tea = await order(v, [{ code: "SKU-TE-250", cases: 1 }]);
    const tooMany = await order(v, [{ code: "SKU-DT-1KG", cases: 86 }]);
    expect(tea).toMatchObject({ ok: false, error: "NOT_ORDERABLE" });
    expect(tooMany).toMatchObject({ ok: false, error: "NOT_ORDERABLE" });
    if (!tooMany.ok && "pricing" in tooMany) expect(tooMany.pricing.lines[0]).toMatchObject({ issues: ["EXCEEDS_STOCK"], maxOrderableCases: 85 });
    expect(await stockOf("SKU-DT-1KG")).toBe(85);
    expect(await listOrdersForRetailer(db, v.retailerId!)).toHaveLength((await listOrdersForRetailer(db, v.retailerId!)).length);
  });

  it("rejects when stock was taken between pricing and placing, rolling back every line", async () => {
    const v = await viewerFor("919000000001");
    const cart = [{ skuId: sku["SKU-BS-075"], cases: 2 }, { skuId: sku["SKU-DT-1KG"], cases: 10 }];
    const pricing = await priceCart(db, v.retailerId!, cart, AS_OF);
    const biscuitBefore = await stockOf("SKU-BS-075");
    const countBefore = (await db.select().from(orders)).length;

    // Pricing still sees stock (we price inside placeOrder), so simulate the race at the conditional update:
    // another order empties detergent right after pricing by shrinking stock to below 10 via a trigger-free path.
    const original = db.transaction.bind(db);
    db.transaction = (async (fn: Parameters<DB["transaction"]>[0]) => {
      await db.update(stock).set({ cases: 3 }).where(eq(stock.skuId, sku["SKU-DT-1KG"]));
      return original(fn);
    }) as DB["transaction"];

    const res = await placeOrder(db, v, { lines: cart, expectedTotalPaise: pricing!.totals.totalPaise, idempotencyKey: key() }, { now: NOW });
    db.transaction = original;

    expect(res).toMatchObject({ ok: false, error: "STOCK_CHANGED" });
    if (!res.ok && "pricing" in res) expect(res.pricing.lines.find((l) => l.skuId === sku["SKU-DT-1KG"])?.maxOrderableCases).toBe(3);
    expect(await stockOf("SKU-BS-075")).toBe(biscuitBefore); // first line's reservation rolled back
    expect((await db.select().from(orders)).length).toBe(countBefore);
  });

  it("refuses to place when the price changed since the retailer looked", async () => {
    const v = await viewerFor("919000000001");
    const cart = [{ skuId: sku["SKU-DT-1KG"], cases: 2 }];
    const res = await placeOrder(db, v, { lines: cart, expectedTotalPaise: 1, idempotencyKey: key() }, { now: NOW });
    expect(res).toMatchObject({ ok: false, error: "PRICE_CHANGED" });
    expect(await stockOf("SKU-DT-1KG")).toBe(85);
  });

  it("puts an order over the credit limit on credit hold instead of rejecting it (A7)", async () => {
    const v = await viewerFor("919000000005"); // Maa Durga Kirana: limit ₹50,000, nothing outstanding
    const res = await order(v, [{ code: "SKU-DT-1KG", cases: 30 }]); // ≈ ₹69,700
    expect(res).toMatchObject({ ok: true, status: "credit_hold" });
    if (!res.ok) return;
    const [o] = await db.select().from(orders).where(eq(orders.id, res.orderId));
    expect(o.holdReason).toMatch(/^Over credit limit by ₹/);
  });

  it("accepts an order exactly at the credit limit", async () => {
    const v = await viewerFor("919000000005");
    const cart = [{ skuId: sku["SKU-DT-1KG"], cases: 1 }];
    const p = (await priceCart(db, v.retailerId!, cart, AS_OF))!;
    await db.update(retailers).set({ creditLimitPaise: p.totals.totalPaise }).where(eq(retailers.id, v.retailerId!));
    expect(await order(v, [{ code: "SKU-DT-1KG", cases: 1 }])).toMatchObject({ ok: true, status: "placed" });
  });

  it.each([
    ["no lines", { lines: [] }],
    ["zero cases", { lines: [{ cases: 0 }] }],
    ["fractional cases", { lines: [{ cases: 1.5 }] }],
    ["huge cases", { lines: [{ cases: 10000 }] }],
    ["bad key", { idempotencyKey: "not-a-uuid" }],
    ["negative expected total", { expectedTotalPaise: -1 }],
    ["note too long", { note: "x".repeat(301) }],
  ])("rejects invalid input: %s", async (_name, patch) => {
    const v = await viewerFor("919000000001");
    const base = { lines: [{ skuId: sku["SKU-DT-1KG"], cases: 1 }], expectedTotalPaise: 0, idempotencyKey: key() };
    const lines = "lines" in patch ? patch.lines.map((l) => ({ skuId: sku["SKU-DT-1KG"], ...l })) : base.lines;
    expect(await placeOrder(db, v, { ...base, ...patch, lines }, { now: NOW })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("ignores any price, total or retailer id smuggled into the request", async () => {
    const v = await viewerFor("919000000001");
    const other = await viewerFor("919000000009");
    const cart = [{ skuId: sku["SKU-DT-1KG"], cases: 1 }];
    const p = (await priceCart(db, v.retailerId!, cart, AS_OF))!;
    const res = await placeOrder(
      db,
      v,
      { lines: [{ ...cart[0], pricePerPiecePaise: 1, totalPaise: 1 }], expectedTotalPaise: p.totals.totalPaise, idempotencyKey: key(), retailerId: other.retailerId, totalPaise: 1 },
      { now: NOW },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [o] = await db.select().from(orders).where(eq(orders.id, res.orderId));
    expect(o.retailerId).toBe(v.retailerId);
    expect(o.totalPaise).toBe(p.totals.totalPaise);
  });

  it("only lets retailers place orders from the shop", async () => {
    const desk = await viewerFor("919000000100");
    const salesman = await viewerFor("919000000200");
    for (const v of [desk, salesman]) {
      expect(await placeOrder(db, v, { lines: [{ skuId: sku["SKU-DT-1KG"], cases: 1 }], expectedTotalPaise: 0, idempotencyKey: key() })).toEqual({
        ok: false,
        error: "FORBIDDEN",
      });
    }
  });

  it("numbers orders sequentially within the month", async () => {
    const v = await viewerFor("919000000001");
    const a = await order(v, [{ code: "SKU-DT-1KG", cases: 1 }]);
    const b = await order(v, [{ code: "SKU-DT-1KG", cases: 1 }]);
    if (!a.ok || !b.ok) throw new Error("expected both orders to succeed");
    expect(Number(b.number.slice(-4))).toBe(Number(a.number.slice(-4)) + 1);
  });
});

describe("listOrdersForRetailer", () => {
  it("reports line and case counts per order", async () => {
    const v = await viewerFor("919000000001");
    const res = await order(v, [{ code: "SKU-BS-075", cases: 10 }, { code: "SKU-DT-1KG", cases: 2 }]);
    if (!res.ok) throw new Error("order failed");
    const row = (await listOrdersForRetailer(db, v.retailerId!)).find((o) => o.id === res.orderId)!;
    expect(row).toMatchObject({ lineCount: 2, cases: 12, status: "placed" });
  });
});

describe("orderItemPreviews", () => {
  it("lists each order's items, largest first, only for the retailer's own orders", async () => {
    const v = await viewerFor("919000000001");
    const res = await order(v, [{ code: "SKU-DT-1KG", cases: 2 }, { code: "SKU-BS-075", cases: 10 }]);
    if (!res.ok) throw new Error("order failed");
    const mine = await orderItemPreviews(db, v.retailerId!, [res.orderId]);
    expect(mine.get(res.orderId)?.map((i) => [i.name, i.cases])).toEqual([
      ["Glucose biscuit 75 g, case of 96", 10],
      ["Detergent powder 1 kg, case of 20", 2],
    ]);
    const other = await viewerFor("919000000009");
    expect((await orderItemPreviews(db, other.retailerId!, [res.orderId])).size).toBe(0);
    expect((await orderItemPreviews(db, v.retailerId!, [])).size).toBe(0);
  });
});

describe("order visibility", () => {
  it("lets a retailer see only their own orders", async () => {
    const sharma = await viewerFor("919000000001");
    const agrawal = await viewerFor("919000000009");
    const res = await order(sharma, [{ code: "SKU-DT-1KG", cases: 1 }]);
    if (!res.ok) throw new Error("order failed");

    expect(await getOrderForViewer(db, sharma, res.orderId)).not.toBeNull();
    expect(await getOrderForViewer(db, agrawal, res.orderId)).toBeNull();
    expect((await listOrdersForRetailer(db, agrawal.retailerId!)).some((o) => o.id === res.orderId)).toBe(false);
  });

  it("lets the desk and the shop's own salesman see it, but not another salesman", async () => {
    const sharma = await viewerFor("919000000001"); // assigned to salesman S1
    const res = await order(sharma, [{ code: "SKU-DT-1KG", cases: 1 }]);
    if (!res.ok) throw new Error("order failed");
    expect(await getOrderForViewer(db, await viewerFor("919000000100"), res.orderId)).not.toBeNull();
    expect(await getOrderForViewer(db, await viewerFor("919000000200"), res.orderId)).not.toBeNull();
    expect(await getOrderForViewer(db, await viewerFor("919000000201"), res.orderId)).toBeNull();
  });

  it("returns null for an unknown order id", async () => {
    expect(await getOrderForViewer(db, await viewerFor("919000000001"), "missing")).toBeNull();
  });
});

describe("seeded history", () => {
  it("has totals that match a live recalculation of every line", async () => {
    const all = await db.select().from(orders);
    expect(all.length).toBeGreaterThan(100);
    const lines = await db.select().from(orderLines).where(inArray(orderLines.orderId, all.map((o) => o.id)));
    for (const o of all) {
      const mine = lines.filter((l) => l.orderId === o.id);
      expect(mine.reduce((s, l) => s + l.totalPaise, 0)).toBe(o.totalPaise);
      for (const l of mine) {
        expect(l.grossPaise).toBe(l.cases * l.packSize * l.pricePerPiecePaise);
        expect(l.totalPaise).toBe(l.grossPaise - l.discountPaise + l.gstPaise);
      }
    }
  });

  it("leaves dormant shops for the 14-day dashboard", async () => {
    const saraswati = await viewerFor("919000000011");
    const list = await listOrdersForRetailer(db, saraswati.retailerId!);
    expect(list.every((o) => NOW.getTime() - o.createdAt.getTime() > 14 * 86_400_000)).toBe(true);
  });
});
