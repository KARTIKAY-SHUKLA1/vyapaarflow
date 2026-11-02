import type { Metadata } from "next";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { db } from "@/db";
import { orderLines, orders } from "@/db/schema";
import { requireViewer } from "@/lib/auth/dal";
import { getMessages } from "@/lib/i18n/server";
import { describeScheme, isoDateIST } from "@/lib/pricing";
import { loadCatalogue, loadCredit, loadRetailer } from "@/server/catalogue";
import { Catalogue, type CatalogueCard } from "./catalogue";
import { sizeLabel } from "../labels";

export const metadata: Metadata = { title: "Catalogue" };

const USUAL_DAYS = 90;
const USUAL_MAX = 6;

/**
 * The shop's usual items: SKUs it ordered at least twice in the last 90 days,
 * most frequent first, each with the case quantity it orders most often
 * (ties → the most recent). Read-only, from this retailer's own orders.
 */
async function usualItems(retailerId: string): Promise<{ skuId: string; cases: number }[]> {
  const since = new Date(Date.now() - USUAL_DAYS * 86_400_000);
  const rows = await db
    .select({ skuId: orderLines.skuId, cases: orderLines.cases })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orders.retailerId, retailerId), ne(orders.status, "cancelled"), gte(orders.createdAt, since)))
    .orderBy(desc(orders.createdAt));
  const bySku = new Map<string, number[]>();
  for (const r of rows) bySku.set(r.skuId, [...(bySku.get(r.skuId) ?? []), r.cases]);
  return [...bySku]
    .filter(([, qty]) => qty.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, USUAL_MAX)
    .map(([skuId, qty]) => {
      const counts = new Map<number, number>();
      for (const q of qty) counts.set(q, (counts.get(q) ?? 0) + 1);
      const best = Math.max(...counts.values());
      return { skuId, cases: qty.find((q) => counts.get(q) === best)! }; // qty is newest-first
    });
}

export default async function CataloguePage() {
  const viewer = await requireViewer("shop");
  const { lang, t } = await getMessages();
  const retailerId = viewer.retailerId!; // always the signed-in retailer, never a URL value
  const retailer = (await loadRetailer(db, retailerId))!;

  const [items, credit, usual, [last]] = await Promise.all([
    loadCatalogue(db, retailer.priceTier, isoDateIST(new Date())),
    loadCredit(db, retailerId),
    usualItems(retailerId),
    db
      .select({ id: orders.id, number: orders.number })
      .from(orders)
      .where(and(eq(orders.retailerId, retailerId), ne(orders.status, "cancelled")))
      .orderBy(desc(orders.createdAt))
      .limit(1),
  ]);
  const lastLines = last
    ? await db.select({ skuId: orderLines.skuId, cases: orderLines.cases }).from(orderLines).where(eq(orderLines.orderId, last.id))
    : [];

  // Only what the card needs goes to the client (no scheme internals).
  const cards: CatalogueCard[] = items.map((i) => ({
    id: i.id,
    code: i.code,
    name: lang === "hi" ? i.nameHi : i.name,
    searchText: `${i.name} ${i.nameHi} ${i.brand} ${i.category} ${i.code}`.toLowerCase(),
    category: i.category,
    packSize: i.packSize,
    imageKey: i.imageKey,
    sizeLabel: sizeLabel(i.name),
    casePricePaise: i.casePricePaise,
    pricePerPiecePaise: i.pricePerPiecePaise,
    stockCases: i.stockCases,
    stockStatus: i.stockStatus,
    scheme: i.scheme ? describeScheme(i.scheme, lang) : null,
  }));

  return (
    <Catalogue
      items={cards}
      t={t.shop}
      common={t.common}
      ownerName={retailer.ownerName}
      availablePaise={credit?.availablePaise ?? 0}
      lastOrder={last && lastLines.length ? { number: last.number, lines: lastLines } : null}
      usual={usual.filter((u) => cards.some((c) => c.id === u.skuId))}
    />
  );
}
