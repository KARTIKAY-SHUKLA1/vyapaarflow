import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { retailers } from "@/db/schema";
import { requireViewer } from "@/lib/auth/dal";
import { fill } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { formatPaise } from "@/lib/money";

export const metadata: Metadata = { title: "Home" };

export default async function ShopHome() {
  const viewer = await requireViewer("shop");
  const { t } = await getMessages();
  // Scoped by the signed-in retailer's own id, never by a URL parameter.
  const [r] = await db.select().from(retailers).where(eq(retailers.id, viewer.retailerId!));
  const available = Math.max(0, r.creditLimitPaise - r.outstandingPaise);

  return (
    <>
      <PageHeader title={fill(t.shop.welcome, { name: r.ownerName })} subtitle={`${r.code} · ${r.area}`} />
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">{t.shop.creditTitle}</h2>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <dt className="text-[13px] text-ink-3">{t.shop.creditLimit}</dt>
            <dd className="num mt-0.5 font-semibold">{formatPaise(r.creditLimitPaise)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-3">{t.shop.outstanding}</dt>
            <dd className="num mt-0.5 font-semibold">{formatPaise(r.outstandingPaise)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-3">{t.shop.available}</dt>
            <dd className="num mt-0.5 font-semibold text-accent">{formatPaise(available)}</dd>
          </div>
        </dl>
      </Card>
      <div className="mt-5">
        <Notice tone="neutral">{t.shop.comingNext}</Notice>
      </div>
    </>
  );
}
