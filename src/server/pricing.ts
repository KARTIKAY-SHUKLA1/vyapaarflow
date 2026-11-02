import { z } from "zod";
import type { DB } from "@/db";
import { priceOrder, type PricedLine, type PricingResult } from "@/lib/pricing";
import { loadCatalogue, loadCredit, loadRetailer, type CatalogueItem, type CreditPosition } from "./catalogue";

/** What the client may send: SKU ids and case counts. Never prices or totals. */
export const cartLineSchema = z.object({
  skuId: z.string().min(1).max(64),
  cases: z.number().int().min(1).max(9999),
});
export const cartSchema = z.array(cartLineSchema).max(100);
export type CartLine = z.infer<typeof cartLineSchema>;

export type CartItemInfo = Pick<
  CatalogueItem,
  "id" | "code" | "name" | "nameHi" | "brand" | "category" | "packSize" | "imageKey" | "pricePerPiecePaise" | "stockStatus" | "scheme"
>;

export type PricedCartLine = PricedLine & { item: CartItemInfo };

export type CartPricing = {
  asOf: string;
  lines: PricedCartLine[];
  totals: PricingResult["totals"];
  credit: PricingResult["credit"] & { position: CreditPosition };
  orderable: boolean;
  /** SKUs in the cart that are unknown, inactive or not sold at this retailer's tier. */
  unavailableSkuIds: string[];
};

/** Combine repeated SKUs into one line (a double tap must not create two lines). */
export function mergeLines(lines: CartLine[]): CartLine[] {
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.skuId, (merged.get(l.skuId) ?? 0) + l.cases);
  return [...merged].map(([skuId, cases]) => ({ skuId, cases }));
}

/**
 * Authoritative server-side pricing for one retailer's cart. Prices, stock,
 * schemes and credit all come from the database; the client sends only ids and
 * quantities. Credit is checked against outstanding + open orders (A11).
 */
export async function priceCart(db: DB, retailerId: string, input: CartLine[], asOf: string): Promise<CartPricing | null> {
  const retailer = await loadRetailer(db, retailerId);
  const credit = await loadCredit(db, retailerId);
  if (!retailer || !credit) return null;

  const lines = mergeLines(input);
  const catalogue = lines.length ? await loadCatalogue(db, retailer.priceTier, asOf, lines.map((l) => l.skuId)) : [];
  const byId = new Map(catalogue.map((c) => [c.id, c]));
  const known = lines.filter((l) => byId.has(l.skuId));

  const result = priceOrder({
    asOf,
    credit: { limitPaise: credit.limitPaise, outstandingPaise: credit.exposurePaise },
    lines: known.map((l) => {
      const item = byId.get(l.skuId)!;
      return {
        skuId: item.id,
        cases: l.cases,
        packSize: item.packSize,
        pricePerPiecePaise: item.pricePerPiecePaise,
        gstRateBp: item.gstRateBp,
        stockCases: item.stockCases,
        schemes: item.schemes,
      };
    }),
  });

  const unavailableSkuIds = lines.filter((l) => !byId.has(l.skuId)).map((l) => l.skuId);
  return {
    asOf,
    lines: result.lines.map((pl) => {
      const c = byId.get(pl.skuId)!;
      const item: CartItemInfo = {
        id: c.id,
        code: c.code,
        name: c.name,
        nameHi: c.nameHi,
        brand: c.brand,
        category: c.category,
        packSize: c.packSize,
        imageKey: c.imageKey,
        pricePerPiecePaise: c.pricePerPiecePaise,
        stockStatus: c.stockStatus,
        scheme: c.scheme,
      };
      return { ...pl, item };
    }),
    totals: result.totals,
    credit: { ...result.credit, position: credit },
    orderable: result.orderable && unavailableSkuIds.length === 0,
    unavailableSkuIds,
  };
}
