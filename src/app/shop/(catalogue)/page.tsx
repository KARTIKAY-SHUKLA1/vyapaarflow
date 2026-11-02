import type { Metadata } from "next";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { orderLines, orders } from "@/db/schema";
import { requireViewer } from "@/lib/auth/dal";
import { getMessages } from "@/lib/i18n/server";
import { describeScheme, isoDateIST } from "@/lib/pricing";
import { loadCatalogue, loadCredit, loadRetailer } from "@/server/catalogue";
import { Catalogue, type CatalogueCard } from "./catalogue";
import { sizeLabel } from "../labels";

export const metadata: Metadata = { title: "Catalogue" };

export default async function CataloguePage() {
  const viewer = await requireViewer("shop");
  const { lang, t } = await getMessages();
  const retailerId = viewer.retailerId!; // always the signed-in retailer, never a URL value
  const retailer = (await loadRetailer(db, retailerId))!;

  const [items, credit, [last]] = await Promise.all([
    loadCatalogue(db, retailer.priceTier, isoDateIST(new Date())),
    loadCredit(db, retailerId),
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
    />
  );
}
