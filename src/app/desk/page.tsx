import type { Metadata } from "next";
import { count, eq } from "drizzle-orm";
import { Notice, PageHeader, Stat } from "@/components/ui";
import { db } from "@/db";
import { inboundMessages, retailers, skus, stock } from "@/db/schema";
import { requireViewer } from "@/lib/auth/dal";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Order desk" };

export default async function DeskHome() {
  await requireViewer("desk");
  const { t } = await getMessages();
  const [[msgs], [shops], [active], [oos]] = await Promise.all([
    db.select({ n: count() }).from(inboundMessages).where(eq(inboundMessages.status, "new")),
    db.select({ n: count() }).from(retailers),
    db.select({ n: count() }).from(skus).where(eq(skus.active, true)),
    db.select({ n: count() }).from(stock).where(eq(stock.cases, 0)),
  ]);

  return (
    <>
      <PageHeader title={t.desk.title} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t.desk.newMessages} value={msgs.n} />
        <Stat label={t.desk.retailers} value={shops.n} />
        <Stat label={t.desk.skus} value={active.n} />
        <Stat label={t.desk.outOfStock} value={oos.n} tone={oos.n > 0 ? "warn" : undefined} />
      </div>
      <div className="mt-5">
        <Notice tone="neutral">{t.desk.comingNext}</Notice>
      </div>
    </>
  );
}
