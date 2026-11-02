import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/dates";
import { getMessages } from "@/lib/i18n/server";
import { formatPaise } from "@/lib/money";
import { listOrdersForRetailer, orderItemPreviews } from "@/server/orders";
import { itemsSummary, StatusBadge, StatusSteps } from "../../labels";
import { OrderAgainButton } from "../[id]/order-again";

export const metadata: Metadata = { title: "My orders" };

export default async function OrdersPage() {
  const viewer = await requireViewer("shop");
  const { lang, t } = await getMessages();
  const list = await listOrdersForRetailer(db, viewer.retailerId!);
  const items = await orderItemPreviews(db, viewer.retailerId!, list.map((o) => o.id));

  return (
    <>
      <PageHeader title={t.shop.ordersTitle} />
      {list.length === 0 ? (
        <EmptyState icon="orders" title={t.shop.ordersEmptyTitle} body={t.shop.ordersEmptyBody} action={<ButtonLink href="/shop">{t.shop.browse}</ButtonLink>} />
      ) : (
        <ul className="space-y-3">
          {list.map((o) => {
            const lines = items.get(o.id) ?? [];
            return (
              <li key={o.id} className="rounded-lg border border-line bg-surface shadow-card">
                {/* What the shopkeeper recognises first: when, what, how much, and where it is. */}
                <Link href={`/shop/orders/${o.id}`} className="block space-y-2.5 px-4 pt-3.5 pb-3 hover:bg-sunken/60">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{formatDateTime(o.createdAt, lang)}</span>
                        <StatusBadge t={t.shop} status={o.status} />
                      </span>
                      <span className="mt-1 block text-[15px] leading-snug text-ink-2">{itemsSummary(t.shop, lines, lang)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block font-semibold">{formatPaise(o.totalPaise)}</span>
                      <span className="block text-[13px] text-ink-3">{t.common.inclGst}</span>
                    </span>
                  </span>
                  <StatusSteps t={t.shop} status={o.status} />
                </Link>
                <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
                  <span className="num text-[13px] text-ink-3">
                    {o.number} · {t.shop.source[o.source]}
                  </span>
                  {lines.length > 0 && <OrderAgainButton lines={lines.map((l) => ({ skuId: l.skuId, cases: l.cases }))} label={t.shop.orderAgain} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
