import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { auditLog, captureLines, captures, inboundMessages, orders, retailerAliases, retailers, skus, stock, users } from "@/db/schema";
import type { Viewer } from "@/lib/auth/policy";
import type { CaptureModel } from "@/lib/capture";
import { testDb } from "@/test/db";
import { addManualMessage, confirmCapture, dismissMessage, getReview, linkMessageToRetailer, listInbox, priceForDesk, runCapture } from "./capture";
import { deskOverview, dormantRetailers, listDeskOrders, transitionOrder } from "./desk";
import { getOrderForViewer } from "./orders";

const NOW = new Date("2026-11-02T10:00:00+05:30");
const AS_OF = "2026-11-02";
const BRIEF = "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti";

let db: DB;
let sku: Record<string, string>;
let desk: Viewer;
let sharma: Viewer;

async function viewerFor(phone: string): Promise<Viewer> {
  const [u] = await db.select().from(users).where(eq(users.phone, phone));
  return { id: u.id, name: u.name, role: u.role, retailerId: u.retailerId, language: u.language };
}
const stockOf = async (code: string) => (await db.select().from(stock).where(eq(stock.skuId, sku[code])))[0].cases;
const messageWith = async (body: string) => (await db.select().from(inboundMessages).where(eq(inboundMessages.body, body)))[0];

type Decision = { include?: boolean; skuCode?: string; quantity?: number; unit?: "case" | "piece" | "unknown" };

/** Build a confirmation the way the review screen does: AI suggestion + desk decisions, priced on the server. */
async function confirmation(captureId: string, decide: (words: string) => Decision = () => ({})) {
  const lines = await db.select().from(captureLines).where(eq(captureLines.captureId, captureId));
  const [cap] = await db.select().from(captures).where(eq(captures.id, captureId));
  const [msg] = await db.select().from(inboundMessages).where(eq(inboundMessages.id, cap.messageId));
  const decided = lines.map((l) => {
    const d = decide(l.originalText);
    return {
      lineId: l.id,
      include: d.include ?? true,
      skuId: d.skuCode ? sku[d.skuCode] : l.skuId,
      quantity: d.quantity ?? l.quantity,
      unit: d.unit ?? l.unit,
    };
  });
  const cart = decided.filter((l) => l.include && l.skuId && l.quantity).map((l) => ({ skuId: l.skuId!, cases: l.quantity! }));
  const pricing = msg.retailerId ? await priceForDesk(db, desk, msg.retailerId, cart, AS_OF) : null;
  return { captureId, lines: decided, expectedTotalPaise: pricing?.totals.totalPaise ?? 0, idempotencyKey: crypto.randomUUID(), confirmed: true as const };
}

beforeEach(async () => {
  ({ db } = await testDb(NOW));
  sku = Object.fromEntries((await db.select({ id: skus.id, code: skus.code }).from(skus)).map((r) => [r.code, r.id]));
  desk = await viewerFor("919000000100");
  sharma = await viewerFor("919000000001");
});

describe("desk authorisation (server-side, not UI)", () => {
  it("refuses every desk operation to retailers and salesmen", async () => {
    const salesman = await viewerFor("919000000200");
    const msg = await messageWith(BRIEF);
    for (const v of [sharma, salesman]) {
      expect(await deskOverview(db, v, NOW)).toBeNull();
      expect(await listDeskOrders(db, v)).toEqual([]);
      expect(await listInbox(db, v)).toEqual([]);
      expect(await getReview(db, v, msg.id)).toBeNull();
      expect(await dormantRetailers(db, v, NOW)).toEqual([]);
      expect(await runCapture(db, v, msg.id, { model: null })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await addManualMessage(db, v, { retailerId: sharma.retailerId, body: "5 peti chai" })).toMatchObject({ error: "FORBIDDEN" });
      expect(await dismissMessage(db, v, msg.id, "spam")).toMatchObject({ error: "FORBIDDEN" });
      expect(await linkMessageToRetailer(db, v, msg.id, sharma.retailerId!)).toMatchObject({ error: "FORBIDDEN" });
      expect(await priceForDesk(db, v, sharma.retailerId!, [], AS_OF)).toBeNull();
      expect(await transitionOrder(db, v, { action: "approve", orderId: "x" })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await confirmCapture(db, v, {})).toEqual({ ok: false, error: "FORBIDDEN" });
    }
  });
});

describe("AI capture → human review → order (the brief's raw message)", () => {
  it("captures the brief message into draft lines without creating an order", async () => {
    const msg = await messageWith(BRIEF);
    const before = (await db.select().from(orders)).length;
    const run = await runCapture(db, desk, msg.id, { model: null, now: NOW });
    expect(run).toMatchObject({ ok: true, reused: false });
    if (!run.ok) return;

    const review = (await getReview(db, desk, msg.id))!;
    expect(review.capture).toMatchObject({ engine: "rules", fallbackReason: "no_api_key", status: "draft" });
    const codeOf = (id: string | null) => Object.entries(sku).find(([, v]) => v === id)?.[0];
    expect(review.lines.map((l) => [codeOf(l.skuId), l.quantity, l.unit])).toEqual([
      ["SKU-BS-075", 5, "case"],
      ["SKU-DT-1KG", 2, "case"],
      ["SKU-TE-250", 1, "case"],
    ]);
    expect(review.lines.every((l) => l.alt1SkuId && l.alt2SkuId)).toBe(true);
    expect((await db.select().from(orders)).length).toBe(before); // nothing ordered yet
    expect((await messageWith(BRIEF)).status).toBe("captured");
  });

  it("does not accept the out-of-stock tea line; desk excludes it and confirms the rest", async () => {
    const msg = await messageWith(BRIEF);
    const run = await runCapture(db, desk, msg.id, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");

    const blocked = await confirmCapture(db, desk, await confirmation(run.captureId), NOW);
    expect(blocked).toMatchObject({ ok: false, error: "NOT_ORDERABLE" });

    const biscuitBefore = await stockOf("SKU-BS-075");
    const res = await confirmCapture(db, desk, await confirmation(run.captureId, (w) => (w.includes("chai") ? { include: false } : {})), NOW);
    expect(res).toMatchObject({ ok: true, status: "placed", duplicate: false });
    if (!res.ok) return;

    const order = (await getOrderForViewer(db, desk, res.orderId))!;
    expect(order).toMatchObject({ source: "capture", captureId: run.captureId, retailerId: sharma.retailerId, createdById: desk.id });
    expect(order.lines.map((l) => [l.sku.code, l.cases]).sort()).toEqual([["SKU-BS-075", 5], ["SKU-DT-1KG", 2]]);
    expect(await stockOf("SKU-BS-075")).toBe(biscuitBefore - 5);

    expect((await messageWith(BRIEF)).status).toBe("converted");
    const [cap] = await db.select().from(captures).where(eq(captures.id, run.captureId));
    expect(cap).toMatchObject({ status: "confirmed", confirmedById: desk.id, orderId: res.orderId });
    const tea = (await db.select().from(captureLines).where(eq(captureLines.captureId, run.captureId))).find((l) => l.originalText.includes("chai"))!;
    expect(tea.excluded).toBe(true);

    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.action, "capture.confirmed"), eq(auditLog.entityId, res.orderId)));
    expect((audit.data as { corrections: unknown[] }).corrections).toHaveLength(1);

    // The retailer sees the desk-created order as theirs.
    expect(await getOrderForViewer(db, sharma, res.orderId)).not.toBeNull();
  });

  it("returns the same order when confirmation is repeated, even with a new key or concurrently", async () => {
    const msg = await messageWith(BRIEF);
    const run = await runCapture(db, desk, msg.id, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    const exclTea = (w: string) => (w.includes("chai") ? { include: false } : {});

    const [a, b] = await Promise.all([
      confirmCapture(db, desk, await confirmation(run.captureId, exclTea), NOW),
      confirmCapture(db, desk, await confirmation(run.captureId, exclTea), NOW),
    ]);
    const third = await confirmCapture(db, desk, await confirmation(run.captureId, exclTea), NOW);
    const ids = new Set([a, b, third].map((r) => (r.ok ? r.orderId : r.error)));
    expect(ids.size).toBe(1);
    expect((await db.select().from(orders).where(eq(orders.captureId, run.captureId))).length).toBe(1);
    expect(await stockOf("SKU-DT-1KG")).toBe(85 - 2);
  });

  it("refuses to confirm without explicit confirmation or a decision for every line", async () => {
    const msg = await messageWith(BRIEF);
    const run = await runCapture(db, desk, msg.id, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    const c = await confirmation(run.captureId, (w) => (w.includes("chai") ? { include: false } : {}));

    expect(await confirmCapture(db, desk, { ...c, confirmed: false }, NOW)).toEqual({ ok: false, error: "INVALID_INPUT" });
    const missing = await confirmCapture(db, desk, { ...c, lines: c.lines.slice(1) }, NOW);
    expect(missing).toMatchObject({ ok: false, error: "UNRESOLVED" });
    expect(await confirmCapture(db, desk, { ...c, lines: c.lines.map((l) => ({ ...l, include: false })) }, NOW)).toEqual({ ok: false, error: "NO_LINES" });
  });

  it("refuses to create an order while a unit is unknown or in pieces (asked, not guessed)", async () => {
    const body = "भैया 10 पेटी ग्लूकोज बिस्कुट, 3 पेटी भुजिया बड़ा वाला, 5 चाय पत्ती 500 ग्राम";
    const msg = await messageWith(body);
    const run = await runCapture(db, desk, msg.id, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    const lines = await db.select().from(captureLines).where(eq(captureLines.captureId, run.captureId));
    const tea = lines.find((l) => l.unit === "unknown")!;
    expect(tea).toBeDefined();

    const asIs = await confirmCapture(db, desk, await confirmation(run.captureId), NOW);
    expect(asIs).toEqual({ ok: false, error: "UNRESOLVED", lineIds: [tea.id] });
    const pieces = await confirmCapture(db, desk, await confirmation(run.captureId, (w) => (w === tea.originalText ? { unit: "piece" } : {})), NOW);
    expect(pieces).toMatchObject({ error: "UNRESOLVED" });

    const settled = await confirmCapture(db, desk, await confirmation(run.captureId, (w) => (w === tea.originalText ? { unit: "case" } : {})), NOW);
    expect(settled).toMatchObject({ ok: true });
  });

  it("turns a desk correction into an alias that the next capture for that shop uses", async () => {
    const msg = await messageWith(BRIEF);
    const run = await runCapture(db, desk, msg.id, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    // Desk: "biscuit chhota" at this shop actually means the cream biscuit; tea excluded.
    const res = await confirmCapture(
      db,
      desk,
      await confirmation(run.captureId, (w) => (w.includes("biscuit") ? { skuCode: "SKU-BC-075" } : w.includes("chai") ? { include: false } : {})),
      NOW,
    );
    expect(res.ok).toBe(true);

    const aliases = await db.select().from(retailerAliases).where(eq(retailerAliases.retailerId, sharma.retailerId!));
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({ skuId: sku["SKU-BC-075"], unit: "case", createdById: desk.id });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "alias.saved"))).toHaveLength(1);

    // Next message from the same shop with the same words → alias match.
    const add = await addManualMessage(db, desk, { retailerId: sharma.retailerId, body: "3 peti biscuit chhota" }, NOW);
    if (!add.ok) throw new Error("add failed");
    const again = await runCapture(db, desk, add.messageId, { model: null, now: NOW });
    if (!again.ok) throw new Error("capture failed");
    const [line] = await db.select().from(captureLines).where(eq(captureLines.captureId, again.captureId));
    expect(line).toMatchObject({ skuId: sku["SKU-BC-075"], matchedBy: "alias", quantity: 3, unit: "case" });

    // …but not for another shop.
    const other = await viewerFor("919000000009");
    const add2 = await addManualMessage(db, desk, { retailerId: other.retailerId, body: "3 peti biscuit chhota" }, NOW);
    if (!add2.ok) throw new Error("add failed");
    const run2 = await runCapture(db, desk, add2.messageId, { model: null, now: NOW });
    if (!run2.ok) throw new Error("capture failed");
    const [line2] = await db.select().from(captureLines).where(eq(captureLines.captureId, run2.captureId));
    expect(line2.skuId).toBe(sku["SKU-BS-075"]);
  });

  it("puts a captured order over the credit limit on credit hold", async () => {
    const gupta = await viewerFor("919000000002");
    const add = await addManualMessage(db, desk, { retailerId: gupta.retailerId, body: "10 peti washing powder 1 kilo" }, NOW);
    if (!add.ok) throw new Error("add failed");
    const run = await runCapture(db, desk, add.messageId, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    expect(await confirmCapture(db, desk, await confirmation(run.captureId), NOW)).toMatchObject({ ok: true, status: "credit_hold" });
  });

  it("refuses when prices changed since the desk reviewed", async () => {
    const msg = await messageWith(BRIEF);
    const run = await runCapture(db, desk, msg.id, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    const c = await confirmation(run.captureId, (w) => (w.includes("chai") ? { include: false } : {}));
    expect(await confirmCapture(db, desk, { ...c, expectedTotalPaise: c.expectedTotalPaise + 1 }, NOW)).toMatchObject({ error: "PRICE_CHANGED" });
  });

  it("never uses prices or totals from the model, even if it tries", async () => {
    const msg = await messageWith(BRIEF);
    const sneaky: CaptureModel = {
      name: "mock-model",
      async propose(req) {
        return {
          lines: req.segments.map((s) => ({
            index: s.index,
            sku_code: s.candidates[0]?.code ?? null,
            alternative_codes: s.candidates.slice(1, 3).map((c) => c.code),
            quantity: s.quantity,
            unit: s.unit,
            confidence: 0.9,
            note: "ok",
            price: 1,
            total: 1,
            free_cases: 99,
          })),
          order_total: 1,
        };
      },
    };
    const run = await runCapture(db, desk, msg.id, { model: sneaky, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    expect((await getReview(db, desk, msg.id))!.capture).toMatchObject({ engine: "llm", model: "mock-model" });

    const c = await confirmation(run.captureId, (w) => (w.includes("chai") ? { include: false } : {}));
    const res = await confirmCapture(db, desk, c, NOW);
    if (!res.ok) throw new Error(`confirm failed: ${res.error}`);
    const order = (await getOrderForViewer(db, desk, res.orderId))!;
    expect(order.totalPaise).toBe(c.expectedTotalPaise); // the server's own price
    expect(order.lines.every((l) => l.freeCases === 0)).toBe(true); // 5 biscuit cases earn no free goods
  });

  it("needs an unknown sender linked to a shop before an order can exist", async () => {
    const msg = (await db.select().from(inboundMessages).where(eq(inboundMessages.fromPhone, "919876500000")))[0];
    const run = await runCapture(db, desk, msg.id, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    expect(await confirmCapture(db, desk, await confirmation(run.captureId, () => ({ unit: "case" })), NOW)).toEqual({ ok: false, error: "NO_RETAILER" });

    expect(await linkMessageToRetailer(db, desk, msg.id, sharma.retailerId!, NOW)).toEqual({ ok: true });
    const rerun = await runCapture(db, desk, msg.id, { model: null, force: true, now: NOW });
    if (!rerun.ok) throw new Error("re-run failed");
    expect(rerun.captureId).not.toBe(run.captureId);
    expect((await db.select().from(captures).where(eq(captures.id, run.captureId)))[0].status).toBe("discarded");
    // Sharma usually buys tea 250 g, so history now decides "chai" for this shop.
    const [line] = await db.select().from(captureLines).where(eq(captureLines.captureId, rerun.captureId));
    expect(line.skuId).toBe(sku["SKU-TE-250"]);
  });

  it("dismisses a message with a reason and then refuses to capture it", async () => {
    const msg = await messageWith(BRIEF);
    expect(await dismissMessage(db, desk, msg.id, "x")).toMatchObject({ error: "INVALID_INPUT" });
    expect(await dismissMessage(db, desk, msg.id, "Duplicate of phone order", NOW)).toEqual({ ok: true });
    expect(await runCapture(db, desk, msg.id, { model: null })).toEqual({ ok: false, error: "CLOSED" });
  });
});

describe("order transitions", () => {
  async function placedOrderId() {
    const [o] = await db.select().from(orders).where(eq(orders.status, "placed"));
    return o.id;
  }

  it("approves once; a second approval conflicts", async () => {
    const id = await placedOrderId();
    expect(await transitionOrder(db, desk, { action: "approve", orderId: id }, NOW)).toEqual({ ok: true, status: "approved" });
    expect(await transitionOrder(db, desk, { action: "approve", orderId: id }, NOW)).toEqual({ ok: false, error: "CONFLICT", current: "approved" });
  });

  it("releases a credit hold only with a reason, and audits it", async () => {
    const [held] = await db.select().from(orders).where(eq(orders.status, "credit_hold"));
    expect(await transitionOrder(db, desk, { action: "release", orderId: held.id }, NOW)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await transitionOrder(db, desk, { action: "release", orderId: held.id, reason: "Owner paid ₹50,000 cash today" }, NOW)).toEqual({ ok: true, status: "approved" });
    const [a] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, held.id), eq(auditLog.action, "order.credit_released")));
    expect(a.data).toMatchObject({ reason: "Owner paid ₹50,000 cash today", from: "credit_hold" });
  });

  it("cancels with a reason and returns reserved stock including free cases", async () => {
    const msg = await messageWith(BRIEF);
    const run = await runCapture(db, desk, msg.id, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    const before = await stockOf("SKU-BS-075");
    const res = await confirmCapture(db, desk, await confirmation(run.captureId, (w) => (w.includes("biscuit") ? { quantity: 10 } : w.includes("chai") ? { include: false } : {})), NOW);
    if (!res.ok) throw new Error("confirm failed");
    expect(await stockOf("SKU-BS-075")).toBe(before - 11);
    expect(await transitionOrder(db, desk, { action: "cancel", orderId: res.orderId, reason: "Shop closed for Diwali" }, NOW)).toEqual({ ok: true, status: "cancelled" });
    expect(await stockOf("SKU-BS-075")).toBe(before);
    expect((await db.select().from(orders).where(eq(orders.id, res.orderId)))[0].cancelReason).toBe("Shop closed for Diwali");
  });

  it("never changes exported orders", async () => {
    const [exp] = await db.select().from(orders).where(eq(orders.status, "exported"));
    expect(await transitionOrder(db, desk, { action: "cancel", orderId: exp.id, reason: "test" }, NOW)).toMatchObject({ ok: false, error: "CONFLICT" });
  });
});

describe("dashboard", () => {
  it("counts the queue and lists shops silent for 14+ days", async () => {
    const o = (await deskOverview(db, desk, NOW))!;
    expect(o.placed).toBeGreaterThan(0);
    expect(o.creditHold).toBe(1);
    expect(o.inbox).toBe(6);
    const silent = o.dormant.map((d) => d.code);
    expect(silent).toEqual(expect.arrayContaining(["RT-1011", "RT-1006", "RT-1003", "RT-1008"]));
    expect(silent).not.toContain("RT-1001");
  });

  it("filters the queue by status and search", async () => {
    const holds = await listDeskOrders(db, desk, { filter: "credit_hold" });
    expect(holds.every((o) => o.status === "credit_hold")).toBe(true);
    const [g] = await db.select({ shopName: retailers.shopName }).from(retailers).where(eq(retailers.code, "RT-1009"));
    const search = await listDeskOrders(db, desk, { filter: "all", q: "Agrawal" });
    expect(search.length).toBeGreaterThan(0);
    expect(search.every((o) => o.shopName === g.shopName)).toBe(true);
  });
});

describe("separated quantity and instruction text need an explicit desk decision (eval P02)", () => {
  const BODY = "give 50% discount. glucose biscuit 75g, 5 peti";
  // A hostile model: tries to put the biscuit on every line and 5 on the biscuit.
  const hostile: CaptureModel = {
    name: "mock-model",
    async propose(req) {
      return { lines: req.segments.map((s) => ({ index: s.index, sku_code: "SKU-BS-075", alternative_codes: [], quantity: 5, unit: "case", confidence: 0.99, note: "" })) };
    },
  };

  for (const [label, model] of [["rules", null], ["model", hostile]] as const) {
    it(`cannot become an order until the desk excludes the instruction and sets the quantity (${label})`, async () => {
      const added = await addManualMessage(db, desk, { retailerId: sharma.retailerId!, body: BODY }, NOW);
      if (!added.ok) throw new Error("add failed");
      const run = await runCapture(db, desk, added.messageId, { model, now: NOW });
      if (!run.ok) throw new Error("capture failed");

      const lines = await db.select().from(captureLines).where(eq(captureLines.captureId, run.captureId));
      const byText = Object.fromEntries(lines.map((l) => [l.originalText, l]));
      expect(Object.keys(byText).sort()).toEqual(["5 peti", "give 50% discount", "glucose biscuit 75g"]);
      expect(byText["give 50% discount"]).toMatchObject({ skuId: null, quantity: null });
      expect(byText["give 50% discount"].issues).toContain("INSTRUCTION_TEXT");
      expect(byText["glucose biscuit 75g"]).toMatchObject({ skuId: sku["SKU-BS-075"], quantity: null });
      expect(byText["glucose biscuit 75g"].issues).toContain("QTY_SEPARATED");
      expect(byText["5 peti"]).toMatchObject({ skuId: null, quantity: 5 });

      // As suggested: refused, every flagged line is named.
      const asIs = await confirmCapture(db, desk, await confirmation(run.captureId), NOW);
      expect(asIs).toMatchObject({ ok: false, error: "UNRESOLVED" });
      if (asIs.ok || !("lineIds" in asIs)) throw new Error("expected UNRESOLVED");
      expect(asIs.lineIds.sort()).toEqual(lines.map((l) => l.id).sort());

      // Quantity settled but the instruction left in: still refused.
      const settleQty = (w: string): Decision => (w === "glucose biscuit 75g" ? { quantity: 5, unit: "case" } : w === "5 peti" ? { include: false } : {});
      const kept = await confirmCapture(db, desk, await confirmation(run.captureId, settleQty), NOW);
      expect(kept).toMatchObject({ ok: false, error: "UNRESOLVED", lineIds: [byText["give 50% discount"].id] });

      // Explicit decisions: exclude the instruction and the loose quantity, enter 5 on the biscuit.
      const biscuitBefore = await stockOf("SKU-BS-075");
      const c = await confirmation(run.captureId, (w) => (w === "give 50% discount" ? { include: false } : settleQty(w)));
      const res = await confirmCapture(db, desk, c, NOW);
      if (!res.ok) throw new Error(`confirm failed: ${res.error}`);
      const order = (await getOrderForViewer(db, desk, res.orderId))!;
      expect(order.lines.map((l) => [l.sku.code, l.cases])).toEqual([["SKU-BS-075", 5]]);
      // No discount: the order is priced exactly as the server prices 5 cases for this shop.
      const plain = await priceForDesk(db, desk, sharma.retailerId!, [{ skuId: sku["SKU-BS-075"], cases: 5 }], AS_OF);
      expect(order.totalPaise).toBe(plain!.totals.totalPaise);
      expect(await stockOf("SKU-BS-075")).toBe(biscuitBefore - 5);

      // The retailer's words are kept as written, for the audit trail.
      const [msg] = await db.select().from(inboundMessages).where(eq(inboundMessages.id, added.messageId));
      expect(msg.body).toBe(BODY);
      const after = await db.select().from(captureLines).where(eq(captureLines.captureId, run.captureId));
      expect(after.find((l) => l.originalText === "give 50% discount")!.excluded).toBe(true);
    });
  }
});

describe("audit fixes: no aliases from instruction lines; requested terms at normal pricing", () => {
  async function capture(body: string) {
    const added = await addManualMessage(db, desk, { retailerId: sharma.retailerId!, body }, NOW);
    if (!added.ok) throw new Error("add failed");
    const run = await runCapture(db, desk, added.messageId, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    const lines = await db.select().from(captureLines).where(eq(captureLines.captureId, run.captureId));
    return { run, byText: Object.fromEntries(lines.map((l) => [l.originalText, l])) };
  }
  const aliasCount = async () => (await db.select().from(retailerAliases).where(eq(retailerAliases.retailerId, sharma.retailerId!))).length;

  it("does not save an instruction line as an alias, and the same words stay flagged next time", async () => {
    const BODY = "give 50% discount. 5 peti rusk";
    const before = await aliasCount();
    const first = await capture(BODY);
    expect(first.byText["give 50% discount"].issues).toContain("INSTRUCTION_TEXT");

    // A desk user deliberately turns the instruction line into a product line and confirms.
    const c = await confirmation(first.run.captureId, (w) => (w === "give 50% discount" ? { skuCode: "SKU-BS-075", quantity: 1, unit: "case" } : {}));
    const res = await confirmCapture(db, desk, c, NOW);
    if (!res.ok) throw new Error(`confirm failed: ${res.error}`);
    expect(res.aliasesSaved).toBe(0);
    expect(await aliasCount()).toBe(before); // nothing learned from it

    const second = await capture(BODY);
    expect(second.byText["give 50% discount"]).toMatchObject({ skuId: null, matchedBy: "none" });
    expect(second.byText["give 50% discount"].issues).toContain("INSTRUCTION_TEXT");
  });

  it("does not learn an alias from a corrected line that requested terms", async () => {
    const BODY = "5 peti glucose biscuit 75g free";
    const before = await aliasCount();
    const first = await capture(BODY);
    const c = await confirmation(first.run.captureId, () => ({ skuCode: "SKU-BC-075" }));
    const res = await confirmCapture(db, desk, c, NOW);
    if (!res.ok) throw new Error(`confirm failed: ${res.error}`);
    expect(await aliasCount()).toBe(before);
    const second = await capture(BODY);
    expect(second.byText[BODY]).toMatchObject({ skuId: sku["SKU-BS-075"], matchedBy: "fuzzy" });
    expect(second.byText[BODY].issues).toContain("TERMS_REQUESTED");
  });

  it("still learns an alias from an ordinary correction", async () => {
    const first = await capture("5 peti biscuit chhota wala");
    const c = await confirmation(first.run.captureId, () => ({ skuCode: "SKU-BC-075" }));
    const res = await confirmCapture(db, desk, c, NOW);
    if (!res.ok) throw new Error(`confirm failed: ${res.error}`);
    expect(res.aliasesSaved).toBe(1);
    // A repeated confirmation returns the same order and saves nothing more.
    const again = await confirmCapture(db, desk, c, NOW);
    expect(again).toMatchObject({ ok: true, duplicate: true, aliasesSaved: 0 });
    const second = await capture("5 peti biscuit chhota wala");
    expect(second.byText["5 peti biscuit chhota wala"]).toMatchObject({ skuId: sku["SKU-BC-075"], matchedBy: "alias" });
  });

  it("confirms a line with requested terms at normal system pricing and schemes", async () => {
    const BODY = "give 50% discount on 5 peti glucose biscuit 75g";
    const { run, byText } = await capture(BODY);
    expect(byText[BODY]).toMatchObject({ skuId: sku["SKU-BS-075"], quantity: 5, unit: "case" });
    expect(byText[BODY].issues).toContain("TERMS_REQUESTED");

    const c = await confirmation(run.captureId);
    const res = await confirmCapture(db, desk, c, NOW);
    if (!res.ok) throw new Error(`confirm failed: ${res.error}`);
    const order = (await getOrderForViewer(db, desk, res.orderId))!;
    const plain = await priceForDesk(db, desk, sharma.retailerId!, [{ skuId: sku["SKU-BS-075"], cases: 5 }], AS_OF);
    expect(order.totalPaise).toBe(plain!.totals.totalPaise);
    expect(order.lines.map((l) => [l.sku.code, l.cases, l.freeCases])).toEqual(
      plain!.lines.map((l) => [l.item.code, l.cases, l.freeCases]),
    );
  });
});

describe("final review fixes", () => {
  async function capture(body: string) {
    const added = await addManualMessage(db, desk, { retailerId: sharma.retailerId!, body }, NOW);
    if (!added.ok) throw new Error("add failed");
    const run = await runCapture(db, desk, added.messageId, { model: null, now: NOW });
    if (!run.ok) throw new Error("capture failed");
    const lines = await db.select().from(captureLines).where(eq(captureLines.captureId, run.captureId));
    return { run, byText: Object.fromEntries(lines.map((l) => [l.originalText, l])) };
  }

  it("cannot confirm 'free do maggi' until the desk enters the maggi quantity", async () => {
    const { run, byText } = await capture("5 peti rusk free do maggi");
    expect(byText["5 peti rusk free"]).toMatchObject({ skuId: sku["SKU-RK-200"], quantity: 5 });
    expect(byText["maggi"]).toMatchObject({ skuId: sku["SKU-ND-070"], quantity: null });

    const asIs = await confirmCapture(db, desk, await confirmation(run.captureId), NOW);
    expect(asIs).toMatchObject({ ok: false, error: "UNRESOLVED", lineIds: [byText["maggi"].id] });

    const decide = (w: string): Decision => (w === "maggi" ? { quantity: 3, unit: "case" } : {});
    const c = await confirmation(run.captureId, decide);
    const res = await confirmCapture(db, desk, c, NOW);
    if (!res.ok) throw new Error(`confirm failed: ${res.error}`);
    const order = (await getOrderForViewer(db, desk, res.orderId))!;
    expect(order.lines.map((l) => [l.sku.code, l.cases]).sort()).toEqual([["SKU-ND-070", 3], ["SKU-RK-200", 5]]);
    expect(order.totalPaise).toBe(c.expectedTotalPaise); // normal server pricing
  });

  it("learns and reuses a legitimate 'offer wala biscuit' alias", async () => {
    const first = await capture("offer wala biscuit 5 peti");
    expect(first.byText["offer wala biscuit 5 peti"].issues).not.toContain("TERMS_REQUESTED");
    const res = await confirmCapture(db, desk, await confirmation(first.run.captureId, () => ({ skuCode: "SKU-BC-075" })), NOW);
    if (!res.ok) throw new Error(`confirm failed: ${res.error}`);
    expect(res.aliasesSaved).toBe(1);
    const [saved] = await db.select().from(retailerAliases).where(and(eq(retailerAliases.retailerId, sharma.retailerId!), eq(retailerAliases.skuId, sku["SKU-BC-075"])));
    expect(saved.phrase).toBe("biscuit offerwala");

    const second = await capture("offer wala biscuit 2 peti");
    expect(second.byText["offer wala biscuit 2 peti"]).toMatchObject({ skuId: sku["SKU-BC-075"], matchedBy: "alias" });
  });
});
