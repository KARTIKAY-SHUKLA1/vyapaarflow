import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImage } from "@/components/product-image";
import { Icon } from "@/components/icons";
import { ButtonLink, Card } from "@/components/ui";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/dates";
import { fill, type Messages } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { formatBp, formatPaise } from "@/lib/money";
import { describeScheme } from "@/lib/pricing";
import { getOrderForViewer } from "@/server/orders";
import { sizeLabel, StatusBadge, StatusSteps } from "../../labels";
import { OrderAgainButton } from "./order-again";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: PageProps<"/shop/orders/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const viewer = await requireViewer("shop");
  const { lang, t } = await getMessages();
  const order = await getOrderForViewer(db, viewer, id);
  if (!order) notFound(); // also for other retailers' orders: no existence leak

  const justPlaced = sp.placed === "1";
  const freeTotal = order.lines.reduce((s, l) => s + l.freeCases, 0);
  const casesTotal = order.lines.reduce((s, l) => s + l.cases, 0);

  return (
    <>
      <Link href="/shop/orders" className="mb-3 inline-flex h-11 items-center text-[15px] font-medium text-ink-2 hover:text-ink">
        ← {t.shop.ordersTitle}
      </Link>

      {justPlaced && <PlacedPanel t={t.shop} number={order.number} held={order.status === "credit_hold"} />}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="num flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight">
            {order.number} <StatusBadge t={t.shop} status={order.status} />
          </h1>
          <p className="text-[14px] text-ink-2">
            {fill(t.shop.placedOn, { date: formatDateTime(order.createdAt, lang) })} · {t.shop.source[order.source]}
          </p>
          <div className="mt-3 max-w-md">
            <StatusSteps t={t.shop} status={order.status} />
          </div>
        </div>
        <OrderAgainButton lines={order.lines.map((l) => ({ skuId: l.skuId, cases: l.cases }))} label={t.shop.orderAgain} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Card className="p-4">
          <h2 className="mb-1 text-[15px] font-semibold">{t.shop.lineItems}</h2>
          <ul className="divide-y divide-line">
            {order.lines.map((l) => (
              <li key={l.id} className="flex gap-3 py-3">
                <ProductImage imageKey={l.sku.imageKey} label={sizeLabel(l.sku.name)} size="sm" alt="" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">{lang === "hi" ? l.sku.nameHi : l.sku.name}</p>
                  <p className="num text-[13px] text-ink-3">
                    {l.cases} × {formatPaise(l.pricePerPiecePaise * l.packSize)} {t.shop.perCase} · {t.shop.gst} {formatBp(l.gstRateBp)}
                  </p>
                  {(l.freeCases > 0 || l.discountPaise > 0) && (
                    <p className="text-[13px] text-scheme">
                      {l.scheme ? describeScheme(l.scheme, lang) : l.schemeNote}
                      {l.freeCases > 0 && ` · ${fill(t.shop.free, { n: l.freeCases })}`}
                      {l.discountPaise > 0 && ` · −${formatPaise(l.discountPaise)}`}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="num font-medium">{formatPaise(l.totalPaise)}</p>
                  <p className="text-[13px] text-ink-3">{t.common.inclGst}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-3">
          <Card className="p-4">
            <h2 className="mb-2 text-[15px] font-semibold">{t.shop.summary}</h2>
            <dl className="space-y-1 text-[15px]">
              <Row label={t.shop.totalCases} value={freeTotal ? `${casesTotal} ${fill(t.shop.free, { n: freeTotal })}` : String(casesTotal)} />
              <Row label={t.shop.gross} value={formatPaise(order.grossPaise)} />
              {order.discountPaise > 0 && <Row label={t.shop.discount} value={`− ${formatPaise(order.discountPaise)}`} />}
              <Row label={t.shop.taxable} value={formatPaise(order.taxablePaise)} />
              <Row label={t.shop.gst} value={`+ ${formatPaise(order.gstPaise)}`} />
              <div className="flex justify-between gap-3 border-t border-line pt-2 text-[17px] font-semibold">
                <dt>{t.shop.total}</dt>
                <dd className="num">{formatPaise(order.totalPaise)}</dd>
              </div>
            </dl>
          </Card>
          {order.note && (
            <Card className="p-4">
              <h2 className="text-[15px] font-semibold">{t.shop.noteLabel}</h2>
              <p className="mt-1 text-[15px] text-ink-2">{order.note}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

/** Shown once after placing: confirmation, then plainly what happens next and where to go. */
function PlacedPanel({ t, number, held }: { t: Messages["shop"]; number: string; held: boolean }) {
  const steps = [held ? t.nextHeld : t.nextReceived, t.nextApproved, t.nextBilled];
  return (
    <section role="status" className={`mb-5 rounded-lg border p-5 ${held ? "border-warn/30 bg-warn-soft" : "border-accent/25 bg-accent-soft"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${held ? "bg-warn" : "bg-accent"} text-surface`}>
          <Icon name="check" size={22} />
        </span>
        <div className="min-w-0">
          <h2 className={`text-[19px] font-semibold ${held ? "text-warn" : "text-accent"}`}>{held ? t.orderHeldTitle : t.orderPlacedTitle}</h2>
          <p className="text-[15px] text-ink">{fill(held ? t.orderHeldBody : t.orderPlacedBody, { number })}</p>
        </div>
      </div>
      <h3 className="mt-4 text-[14px] font-semibold text-ink">{t.nextTitle}</h3>
      <ol className="mt-1.5 space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-[15px] text-ink-2">
            <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-[13px] font-semibold text-ink">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href="/shop">{t.continueShopping}</ButtonLink>
        <ButtonLink href="/shop/orders" variant="secondary">
          {t.viewOrders}
        </ButtonLink>
      </div>
    </section>
  );
}
