"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProductImage } from "@/components/product-image";
import { Badge, Button, ButtonLink, cx, EmptyState, Notice, PageHeader, Skeleton } from "@/components/ui";
import { fill, type Lang, type Messages } from "@/lib/i18n/messages";
import { formatBp, formatPaise } from "@/lib/money";
import type { PricedCartLine } from "@/server/pricing";
import { useCart } from "../cart-store";
import { sizeLabel } from "../labels";
import { Stepper } from "../stepper";
import { CreditNotice, OrderSummary } from "../summary";
import { usePricing } from "../use-pricing";

type T = Messages["shop"];

export function CartView({ t, common, lang }: { t: T; common: Messages["common"]; lang: Lang }) {
  const cart = useCart();
  const { pricing, loading, error, retry } = usePricing(cart.lines);
  const [removedCount, setRemovedCount] = useState(0);

  // SKUs the server no longer sells to this shop are dropped from the cart, with a notice.
  useEffect(() => {
    if (!pricing?.unavailableSkuIds.length) return;
    pricing.unavailableSkuIds.forEach((id) => cart.remove(id));
    queueMicrotask(() => setRemovedCount((n) => n + pricing.unavailableSkuIds.length));
  }, [pricing, cart]);

  if (cart.lines.length === 0) {
    return (
      <>
        <PageHeader title={t.cartTitle} />
        {removedCount > 0 && (
          <div className="mb-4">
            <Notice tone="warn">{fill(t.unavailable, { n: removedCount })}</Notice>
          </div>
        )}
        <EmptyState title={t.cartEmptyTitle} body={t.cartEmptyBody} action={<ButtonLink href="/shop">{t.browse}</ButtonLink>} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.cartTitle} subtitle={loading ? t.pricing : undefined} />

      {removedCount > 0 && (
        <div className="mb-4">
          <Notice tone="warn">{fill(t.unavailable, { n: removedCount })}</Notice>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Notice tone="danger">
            <span className="flex flex-wrap items-center justify-between gap-2">
              {t.pricingError}
              <Button variant="secondary" onClick={retry}>
                {common.retry}
              </Button>
            </span>
          </Notice>
        </div>
      )}

      {!pricing ? (
        <div className="space-y-3" aria-busy="true">
          {cart.lines.map((l) => (
            <Skeleton key={l.skuId} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <ul className={cx("space-y-3 transition-opacity", loading && "opacity-60")}>
            {pricing.lines.map((line) => (
              <CartRow key={line.skuId} line={line} t={t} lang={lang} common={common} />
            ))}
          </ul>

          <div className="space-y-3 lg:sticky lg:top-20">
            <OrderSummary pricing={pricing} t={t} dim={loading} />
            <CreditNotice pricing={pricing} t={t} />
            {!pricing.orderable && !loading && <Notice tone="danger">{t.notOrderable}</Notice>}
            <div className="hidden sm:block">
              <ButtonLink
                href="/shop/checkout"
                size="lg"
                aria-disabled={!pricing.orderable || loading}
                className={cx((!pricing.orderable || loading) && "pointer-events-none opacity-50")}
              >
                {t.review}
              </ButtonLink>
            </div>
          </div>

          {/* Phone: total + action always in reach, above the bottom nav. */}
          <div
            className="fixed inset-x-0 z-20 border-t border-line bg-surface px-4 py-3 sm:hidden"
            style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="mx-auto flex max-w-md items-center justify-between gap-3">
              <div>
                <p className="text-[12px] text-ink-3">{t.total}</p>
                <p className={cx("num text-[18px] font-semibold", loading && "opacity-60")}>{formatPaise(pricing.totals.totalPaise)}</p>
              </div>
              <ButtonLink
                href="/shop/checkout"
                aria-disabled={!pricing.orderable || loading}
                className={cx("px-6", (!pricing.orderable || loading) && "pointer-events-none opacity-50")}
              >
                {t.review}
              </ButtonLink>
            </div>
          </div>
        </div>
      )}
      <div className="h-20 sm:hidden" aria-hidden />
    </>
  );
}

function CartRow({ line, t, lang, common }: { line: PricedCartLine; t: T; lang: Lang; common: Messages["common"] }) {
  const cart = useCart();
  const name = lang === "hi" ? line.item.nameHi : line.item.name;
  const out = line.issues.includes("OUT_OF_STOCK");
  const exceeds = line.issues.includes("EXCEEDS_STOCK");

  return (
    <li className={cx("rounded-lg border bg-surface p-3 shadow-card", line.orderable ? "border-line" : "border-danger/40")}>
      <div className="flex gap-3">
        <Link href={`/shop/p/${line.item.code}`} className="shrink-0">
          <ProductImage imageKey={line.item.imageKey} label={sizeLabel(line.item.name)} size="sm" alt="" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/shop/p/${line.item.code}`} className="text-[15px] leading-snug font-semibold hover:underline">
              {name}
            </Link>
            <button type="button" onClick={() => cart.remove(line.skuId)} className="-mt-1 -mr-1 h-9 shrink-0 rounded-md px-2 text-[14px] text-ink-3 hover:bg-sunken hover:text-danger">
              {t.remove}
            </button>
          </div>
          <p className="num text-[13px] text-ink-3">
            {formatPaise(line.casePricePaise)} {t.perCase} · {common.exclGst} · {t.gst} {formatBp(line.gstRateBp)}
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Stepper
              value={line.cases}
              max={out ? 0 : line.maxOrderableCases}
              onChange={(n) => cart.setCases(line.skuId, n)}
              labels={{ decrease: t.decrease, increase: t.increase, cases: t.casesLabel }}
            />
            <div className="text-right">
              <p className="num font-semibold">{formatPaise(line.taxablePaise)}</p>
              <p className="text-[12px] text-ink-3">{common.exclGst}</p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {line.freeCases > 0 && <Badge tone="scheme">{fill(t.free, { n: line.freeCases })}</Badge>}
            {line.appliedScheme && <Badge tone="scheme">{fill(t.schemeApplied, { label: line.appliedScheme.label })}</Badge>}
          </div>

          {line.nudge && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-scheme-soft px-3 py-2 text-[14px] text-scheme">
              <span>
                {line.nudge.kind === "FREE_GOODS"
                  ? fill(t.nudgeFree, { add: line.nudge.addCases, free: line.nudge.freeCases })
                  : fill(t.nudgeSlab, { add: line.nudge.addCases, pct: formatBp(line.nudge.percentBp) })}
              </span>
              <button
                type="button"
                onClick={() => cart.setCases(line.skuId, line.cases + line.nudge!.addCases)}
                className="h-9 rounded-md bg-surface px-3 font-medium text-scheme shadow-card hover:bg-sunken"
              >
                {fill(t.addMore, { n: line.nudge.addCases })}
              </button>
            </div>
          )}

          {out && <p className="mt-2 text-[14px] text-danger">{t.issueOutOfStock}</p>}
          {exceeds && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-danger">
              {fill(t.issueExceeds, { max: line.maxOrderableCases })}
              <button type="button" onClick={() => cart.setCases(line.skuId, line.maxOrderableCases)} className="h-9 rounded-md border border-danger/40 px-3 font-medium hover:bg-danger-soft">
                {fill(t.setTo, { n: line.maxOrderableCases })}
              </button>
            </p>
          )}
          {line.issues.includes("FREE_GOODS_SHORT") && <p className="mt-2 text-[14px] text-warn">{t.issueFreeShort}</p>}
          {line.issues.includes("MULTIPLE_SCHEMES") && <p className="mt-2 text-[14px] text-warn">{t.issueMultipleSchemes}</p>}
        </div>
      </div>
    </li>
  );
}
