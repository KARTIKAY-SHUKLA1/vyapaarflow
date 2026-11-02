import { and, eq, inArray, sum } from "drizzle-orm";
import type { DB } from "@/db";
import { brands, orders, prices, retailers, schemes, skus, stock } from "@/db/schema";
import { applicableSchemes, type SchemeRule } from "@/lib/pricing";

/** Statuses whose value is committed but not yet invoiced in Tally (assumption A11). */
export const OPEN_ORDER_STATUSES = ["placed", "approved", "credit_hold"] as const;

/** Display-only threshold for "only N left". Not a business rule. */
export const LOW_STOCK_CASES = 10;

export type StockStatus = "in" | "low" | "out";

export type CatalogueItem = {
  id: string;
  code: string;
  name: string;
  nameHi: string;
  brand: string;
  category: string;
  packSize: number;
  imageKey: string;
  gstRateBp: number;
  pricePerPiecePaise: number; // excl. GST (A1), this retailer's tier
  casePricePaise: number; // excl. GST
  stockCases: number;
  stockStatus: StockStatus;
  /** The one scheme in force today, or null (none, or a misconfigured overlap). Full rule, so text can be bilingual. */
  scheme: SchemeRule | null;
  schemes: SchemeRule[]; // all rows, for the pricing engine
};

export function stockStatus(cases: number): StockStatus {
  return cases <= 0 ? "out" : cases <= LOW_STOCK_CASES ? "low" : "in";
}

function toRule(row: typeof schemes.$inferSelect): SchemeRule {
  return row.type === "FREE_GOODS"
    ? { id: row.id, type: "FREE_GOODS", buyQty: row.buyQty ?? 0, freeQty: row.freeQty ?? 0, label: row.label, validFrom: row.validFrom, validTo: row.validTo, active: row.active }
    : { id: row.id, type: "SLAB_PERCENT", minQty: row.minQty ?? 0, percentBp: row.percentBp ?? 0, label: row.label, validFrom: row.validFrom, validTo: row.validTo, active: row.active };
}

/**
 * Active SKUs with THIS retailer's price tier. A SKU without a price for the tier
 * is not sold to this retailer and is left out (never shown at another tier's price).
 */
export async function loadCatalogue(db: DB, priceTier: string, asOf: string, skuIds?: string[]): Promise<CatalogueItem[]> {
  const where = and(eq(skus.active, true), skuIds ? inArray(skus.id, skuIds) : undefined);
  const rows = await db
    .select({
      sku: skus,
      brand: brands.name,
      price: prices.pricePerPiecePaise,
      stock: stock.cases,
    })
    .from(skus)
    .innerJoin(brands, eq(brands.id, skus.brandId))
    .innerJoin(prices, and(eq(prices.skuId, skus.id), eq(prices.priceTier, priceTier)))
    .leftJoin(stock, eq(stock.skuId, skus.id))
    .where(where)
    .orderBy(skus.category, skus.name);

  const ids = rows.map((r) => r.sku.id);
  const schemeRows = ids.length ? await db.select().from(schemes).where(inArray(schemes.skuId, ids)) : [];
  const bySku = new Map<string, SchemeRule[]>();
  for (const s of schemeRows) bySku.set(s.skuId, [...(bySku.get(s.skuId) ?? []), toRule(s)]);

  return rows.map(({ sku, brand, price, stock: cases }) => {
    const rules = bySku.get(sku.id) ?? [];
    const inForce = applicableSchemes(rules, asOf);
    const stockCases = cases ?? 0;
    return {
      id: sku.id,
      code: sku.code,
      name: sku.name,
      nameHi: sku.nameHi,
      brand,
      category: sku.category,
      packSize: sku.packSize,
      imageKey: sku.imageKey,
      gstRateBp: sku.gstRateBp,
      pricePerPiecePaise: price,
      casePricePaise: price * sku.packSize,
      stockCases,
      stockStatus: stockStatus(stockCases),
      scheme: inForce.length === 1 ? inForce[0] : null,
      schemes: rules,
    };
  });
}

export type CreditPosition = {
  limitPaise: number;
  outstandingPaise: number; // invoiced, unpaid (from Tally; seeded here)
  openOrdersPaise: number; // placed / approved / on hold, not yet invoiced (A11)
  exposurePaise: number; // outstanding + open orders
  availablePaise: number;
};

/** Accepts a transaction too, so order creation can re-read exposure under the write lock. */
export async function loadCredit(db: Pick<DB, "select">, retailerId: string): Promise<CreditPosition | null> {
  const [r] = await db
    .select({ limit: retailers.creditLimitPaise, outstanding: retailers.outstandingPaise })
    .from(retailers)
    .where(eq(retailers.id, retailerId));
  if (!r) return null;
  const [open] = await db
    .select({ total: sum(orders.totalPaise) })
    .from(orders)
    .where(and(eq(orders.retailerId, retailerId), inArray(orders.status, [...OPEN_ORDER_STATUSES])));
  const openOrdersPaise = Number(open?.total ?? 0);
  const exposurePaise = r.outstanding + openOrdersPaise;
  return {
    limitPaise: r.limit,
    outstandingPaise: r.outstanding,
    openOrdersPaise,
    exposurePaise,
    availablePaise: Math.max(0, r.limit - exposurePaise),
  };
}

export async function loadRetailer(db: DB, retailerId: string) {
  const [r] = await db.select().from(retailers).where(eq(retailers.id, retailerId));
  return r ?? null;
}
