import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/dates";
import { fill } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { formatPaise } from "@/lib/money";
import { listOrdersForRetailer } from "@/server/orders";
import { StatusBadge } from "../../labels";

export const metadata: Metadata = { title: "My orders" };

export default async function OrdersPage() {
  const viewer = await requireViewer("shop");
  const { lang, t } = await getMessages();
  const list = await listOrdersForRetailer(db, viewer.retailerId!);

  return (
    <>
      <PageHeader title={t.shop.ordersTitle} />
      {list.length === 0 ? (
        <EmptyState title={t.shop.ordersEmptyTitle} body={t.shop.ordersEmptyBody} action={<ButtonLink href="/shop">{t.shop.browse}</ButtonLink>} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {list.map((o) => (
            <li key={o.id}>
              <Link href={`/shop/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-sunken">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="num font-semibold">{o.number}</span>
                    <StatusBadge t={t.shop} status={o.status} />
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink-3">
                    {formatDateTime(o.createdAt, lang)} · {fill(t.shop.itemsCases, { items: o.lineCount, cases: o.cases })} · {t.shop.source[o.source]}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num font-semibold">{formatPaise(o.totalPaise)}</p>
                  <p className="text-[13px] text-ink-3">{t.common.inclGst}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
