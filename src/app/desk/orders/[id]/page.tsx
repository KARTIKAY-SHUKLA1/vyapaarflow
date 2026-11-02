import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImage } from "@/components/product-image";
import { Card, Notice } from "@/components/ui";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/dates";
import { fill } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { formatBp, formatPaise } from "@/lib/money";
import { describeScheme } from "@/lib/pricing";
import { loadCredit } from "@/server/catalogue";
import { orderAudit } from "@/server/desk";
import { getOrderForViewer } from "@/server/orders";
import { sizeLabel } from "../../../shop/labels";
import { DeskStatusBadge } from "../../labels";
import { OrderActions } from "./order-actions";

export const metadata: Metadata = { title: "Order" };


export default async function DeskOrder({ params, searchParams }: PageProps<"/desk/orders/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const viewer = await requireViewer("desk");
  const { lang, t } = await getMessages();
  const d = t.desk;
  const order = await getOrderForViewer(db, viewer, id);
  if (!order) notFound();
  const [credit, audit] = await Promise.all([loadCredit(db, order.retailerId), orderAudit(db, viewer, id)]);

  return (
    <>
      <Link href="/desk/orders" className="mb-3 inline-flex h-11 items-center text-[15px] font-medium text-ink-2 hover:text-ink">
        ← {d.ordersTitle}
      </Link>
      {sp.created === "1" && (
        <div className="mb-4">
          <Notice tone="accent" title="✓">
            {fill(d.createdOk, { number: order.number })}
          </Notice>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="num flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight">
            {order.number} <DeskStatusBadge d={d} status={order.status} />
          </h1>
          <p className="text-[14px] text-ink-2">
            {order.retailer.shopName} · {order.retailer.code} · {formatDateTime(order.createdAt, lang)} · {d.source[order.source]}
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="space-y-5">
          <Card className="p-4">
            <ul className="divide-y divide-line">
              {order.lines.map((l) => (
                <li key={l.id} className="flex gap-3 py-3">
                  <ProductImage imageKey={l.sku.imageKey} label={sizeLabel(l.sku.name)} size="sm" alt="" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{l.sku.name}</p>
                    <p className="num text-[13px] text-ink-3">
                      {l.sku.code} · {l.cases} × {formatPaise(l.pricePerPiecePaise * l.packSize)} · GST {formatBp(l.gstRateBp)}
                    </p>
                    {(l.freeCases > 0 || l.discountPaise > 0) && (
                      <p className="text-[13px] text-scheme">
                        {l.scheme ? describeScheme(l.scheme, lang) : l.schemeNote}
                        {l.freeCases > 0 && ` · ${fill(t.shop.free, { n: l.freeCases })}`}
                        {l.discountPaise > 0 && ` · −${formatPaise(l.discountPaise)}`}
                      </p>
                    )}
                  </div>
                  <p className="num shrink-0 font-medium">{formatPaise(l.totalPaise)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-2 space-y-1 border-t border-line pt-3 text-[15px]">
              <Row label={t.shop.gross} value={formatPaise(order.grossPaise)} />
              {order.discountPaise > 0 && <Row label={t.shop.discount} value={`− ${formatPaise(order.discountPaise)}`} />}
              <Row label={t.shop.gst} value={`+ ${formatPaise(order.gstPaise)}`} />
              <Row label={t.shop.total} value={formatPaise(order.totalPaise)} strong />
            </dl>
          </Card>

          {order.note && (
            <Card className="p-4">
              <h2 className="text-[15px] font-semibold">{t.shop.noteLabel}</h2>
              <p className="mt-1 text-[15px] text-ink-2">{order.note}</p>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="mb-2 text-[15px] font-semibold">{d.history}</h2>
            <ol className="space-y-2">
              {audit.map((a) => (
                <li key={a.id} className="text-[14px]">
                  <p>
                    <span className="font-medium">{(d.audit as Record<string, string>)[a.action] ?? a.action}</span>
                    <span className="text-ink-3"> · {a.actor ?? "—"} · {formatDateTime(a.at, lang)}</span>
                  </p>
                  {a.data && typeof a.data.reason === "string" && <p className="text-ink-2">“{a.data.reason}”</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-32">
          {credit && (
            <Card className="p-4">
              <h2 className="mb-2 text-[15px] font-semibold">{d.creditPosition}</h2>
              <dl className="space-y-1 text-[15px]">
                <Row label={d.creditLimit} value={formatPaise(credit.limitPaise)} />
                <Row label={d.outstanding} value={formatPaise(credit.outstandingPaise)} />
                <Row label={d.openOrders} value={formatPaise(credit.openOrdersPaise)} />
                <Row label={d.available} value={formatPaise(credit.availablePaise)} strong />
              </dl>
            </Card>
          )}
          {order.holdReason && order.status === "credit_hold" && <Notice tone="warn" title={d.holdReason}>{order.holdReason}</Notice>}
          {order.cancelReason && <Notice tone="danger" title={d.cancelReason}>{order.cancelReason}</Notice>}
          <OrderActions orderId={order.id} status={order.status} d={d} />
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-line pt-1.5 font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
