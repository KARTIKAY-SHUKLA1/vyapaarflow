import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { testDb } from "@/test/db";
import { inboundMessages, prices, schemes, skus, stock, users } from "./schema";

describe("seed data reproduces the brief", async () => {
  const { db } = await testDb();

  it.each([
    ["SKU-BS-075", "Glucose biscuit 75 g, case of 96", 810, 340],
    ["SKU-DT-1KG", "Detergent powder 1 kg, case of 20", 10150, 85],
    ["SKU-TE-250", "Tea leaf 250 g, case of 40", 11800, 0],
  ])("%s has the brief's name, dealer price and stock", async (code, name, pricePaise, cases) => {
    const [row] = await db
      .select({ name: skus.name, price: prices.pricePerPiecePaise, cases: stock.cases })
      .from(skus)
      .innerJoin(prices, eq(prices.skuId, skus.id))
      .innerJoin(stock, eq(stock.skuId, skus.id))
      .where(eq(skus.code, code));
    expect(row).toEqual({ name, price: pricePaise, cases });
  });

  it("has the brief's two schemes", async () => {
    const rows = await db
      .select({ code: skus.code, label: schemes.label, type: schemes.type, buy: schemes.buyQty, free: schemes.freeQty, min: schemes.minQty, bp: schemes.percentBp })
      .from(schemes)
      .innerJoin(skus, eq(skus.id, schemes.skuId));
    expect(rows).toContainEqual({ code: "SKU-BS-075", label: "Buy 10 cases get 1 free", type: "FREE_GOODS", buy: 10, free: 1, min: null, bp: null });
    expect(rows).toContainEqual({ code: "SKU-DT-1KG", label: "3% off 5 or more cases", type: "SLAB_PERCENT", buy: null, free: null, min: 5, bp: 300 });
    expect(rows.find((r) => r.code === "SKU-TE-250")).toBeUndefined();
  });

  it("includes the brief's raw order message verbatim", async () => {
    const rows = await db.select({ body: inboundMessages.body }).from(inboundMessages);
    expect(rows.map((r) => r.body)).toContain(
      "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti",
    );
  });

  it("links every retailer user to a shop", async () => {
    const retailerUsers = await db.select().from(users).where(eq(users.role, "retailer"));
    expect(retailerUsers.length).toBeGreaterThan(0);
    expect(retailerUsers.every((u) => u.retailerId)).toBe(true);
  });
});
