"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, ButtonLink, Card, cx, Notice } from "@/components/ui";
import { fill, type Messages } from "@/lib/i18n/messages";
import { formatBp, formatPaise } from "@/lib/money";
import { useCart } from "../../cart-store";
import { Stepper } from "../../stepper";
import { usePricing } from "@/components/use-pricing";
import { priceCartAction } from "../../actions";

/** Pick cases and see the server-priced line (scheme, free cases, GST) before adding. */
export function QuantityPicker({ skuId, stockCases, t, retryLabel }: { skuId: string; stockCases: number; t: Messages["shop"]; retryLabel: string }) {
  const cart = useCart();
  const inCart = cart.casesOf(skuId);
  const [cases, setCases] = useState(inCart || 1);
  const [added, setAdded] = useState(false);
  const { pricing, loading, error, retry } = usePricing(stockCases > 0 && cases > 0 ? [{ skuId, cases }] : [], priceCartAction);
  const line = pricing?.lines[0];

  if (stockCases <= 0) return <Notice tone="danger">{t.issueOutOfStock}</Notice>;

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[15px] font-medium">{t.quantity}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Stepper
            size="lg"
            value={cases}
            max={stockCases}
            onChange={(n) => (setCases(Math.max(1, n)), setAdded(false))}
            labels={{ decrease: t.decrease, increase: t.increase, cases: t.casesLabel }}
          />
          {[5, 10, 20].filter((n) => n <= stockCases && n !== cases).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => (setCases(n), setAdded(false))}
              className="num h-11 rounded-md border border-line px-3 text-[15px] text-ink-2 hover:bg-sunken"
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <Card className={cx("p-4 transition-opacity", loading && "opacity-60")} aria-live="polite" aria-busy={loading}>
        {error ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] text-danger">{t.pricingError}</p>
            <Button variant="secondary" onClick={retry}>
              {retryLabel}
            </Button>
          </div>
        ) : !line ? (
          <p className="text-[15px] text-ink-3">{t.pricing}</p>
        ) : (
          <dl className="space-y-1 text-[15px]">
            <Row label={t.gross} value={formatPaise(line.grossPaise)} />
            {line.discountPaise > 0 && <Row label={t.discount} value={`− ${formatPaise(line.discountPaise)}`} tone="scheme" />}
            {line.freeCases > 0 && <Row label={t.freeCases} value={fill(t.free, { n: line.freeCases })} tone="scheme" />}
            <Row label={`${t.gst} ${formatBp(line.gstRateBp)}`} value={formatPaise(line.gstPaise)} />
            <Row label={t.total} value={formatPaise(line.totalPaise)} strong />
            {line.nudge && (
              <p className="pt-1 text-[14px] text-scheme">
                {line.nudge.kind === "FREE_GOODS"
                  ? fill(t.nudgeFree, { add: line.nudge.addCases, free: line.nudge.freeCases })
                  : fill(t.nudgeSlab, { add: line.nudge.addCases, pct: formatBp(line.nudge.percentBp) })}
              </p>
            )}
            {line.issues.includes("EXCEEDS_STOCK") && <p className="text-[14px] text-danger">{fill(t.issueExceeds, { max: line.maxOrderableCases })}</p>}
          </dl>
        )}
      </Card>

      {added ? (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <span className="text-[15px] font-medium text-accent">✓ {t.added}</span>
          <ButtonLink href="/shop/cart">{t.viewCart}</ButtonLink>
          <Link href="/shop" className="text-[15px] text-ink-2 underline">
            {t.backToCatalogue}
          </Link>
        </div>
      ) : (
        <Button
          size="lg"
          disabled={!line?.orderable}
          onClick={() => {
            cart.setCases(skuId, cases);
            setAdded(true);
          }}
        >
          {inCart ? t.updateCart : t.addToCart}
        </Button>
      )}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "scheme" }) {
  return (
    <div className={cx("flex justify-between gap-3", strong && "border-t border-line pt-1.5 font-semibold", tone === "scheme" && "text-scheme")}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
