"use client";

import Link from "next/link";
import { useState } from "react";
import { usePricing } from "@/components/use-pricing";
import { Button, ButtonLink, Card, cx, Notice } from "@/components/ui";
import { fill, type Messages } from "@/lib/i18n/messages";
import { formatBp, formatPaise } from "@/lib/money";
import type { PricedCartLine } from "@/server/pricing";
import { priceCartAction } from "../../actions";
import { useCart } from "../../cart-store";
import { Stepper } from "../../stepper";

type SchemeInfo = { text: string; percentBp: number | null } | null;

/**
 * Pick cases and see the server-priced line (scheme, free cases, GST) before adding.
 * On phones the quantity, total and "Add to cart" stay pinned above the bottom nav.
 */
export function QuantityPicker({
  skuId,
  stockCases,
  t,
  retryLabel,
  scheme,
}: {
  skuId: string;
  stockCases: number;
  t: Messages["shop"];
  retryLabel: string;
  scheme: SchemeInfo;
}) {
  const cart = useCart();
  const inCart = cart.casesOf(skuId);
  const [cases, setCases] = useState(inCart || 1);
  const [added, setAdded] = useState(false);
  const { pricing, loading, error, retry } = usePricing(stockCases > 0 && cases > 0 ? [{ skuId, cases }] : [], priceCartAction);
  const line = pricing?.lines[0];
  const choose = (n: number) => (setCases(Math.max(1, n)), setAdded(false));

  if (stockCases <= 0) {
    return (
      <div className="space-y-4">
        {scheme && <SchemePanel scheme={scheme} line={undefined} t={t} onAdd={() => {}} />}
        <Notice tone="danger">{t.issueOutOfStock}</Notice>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {scheme && <SchemePanel scheme={scheme} line={line} t={t} onAdd={(n) => choose(cases + n)} dim={loading} />}

      <div>
        <p className="mb-1.5 text-[15px] font-medium">{t.quantity}</p>
        <div className="flex flex-wrap gap-2">
          {[1, 5, 10, 20].filter((n) => n <= stockCases).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={n === cases}
              onClick={() => choose(n)}
              className={cx(
                "num h-11 min-w-12 rounded-md border px-3 text-[15px] font-medium",
                n === cases ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-sunken",
              )}
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
            {line.issues.includes("EXCEEDS_STOCK") && <p className="text-[14px] text-danger">{fill(t.issueExceeds, { max: line.maxOrderableCases })}</p>}
          </dl>
        )}
      </Card>

      {/* Phone: pinned above the bottom nav. Larger screens: inline. */}
      <div
        className="fixed inset-x-0 z-20 border-t border-line bg-surface px-4 pt-2 pb-3 sm:static sm:border-0 sm:bg-transparent sm:p-0"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto max-w-md sm:max-w-none">
          <p className={cx("mb-1.5 flex justify-between text-[14px] sm:hidden", loading && "opacity-60")}>
            <span className="text-ink-2">{t.total}</span>
            <span className="num font-semibold">{line ? formatPaise(line.totalPaise) : "…"}</span>
          </p>
          {added ? (
            <div className="flex items-center gap-3" role="status">
              <span className="text-[15px] font-medium text-accent">✓ {t.added}</span>
              <ButtonLink href="/shop/cart" className="flex-1 sm:flex-none">
                {t.viewCart}
              </ButtonLink>
              <Link href="/shop" className="hidden text-[15px] text-ink-2 underline sm:inline">
                {t.backToCatalogue}
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Stepper value={cases} max={stockCases} onChange={choose} labels={{ decrease: t.decrease, increase: t.increase, cases: t.casesLabel }} />
              <Button
                disabled={!line?.orderable || loading}
                onClick={() => {
                  cart.setCases(skuId, cases);
                  setAdded(true);
                }}
                className="flex-1 sm:flex-none sm:px-8"
              >
                {inCart ? t.updateCart : t.addToCart}
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="h-28 sm:hidden" aria-hidden />
    </div>
  );
}

/**
 * The scheme and how close this quantity is to its benefit. The numbers come from
 * the server's priced line (nudge, free cases, discount) — nothing is recomputed here.
 */
function SchemePanel({ scheme, line, t, onAdd, dim }: { scheme: NonNullable<SchemeInfo>; line: PricedCartLine | undefined; t: Messages["shop"]; onAdd: (n: number) => void; dim?: boolean }) {
  const nudge = line?.nudge ?? null;
  const earnedFree = line?.freeCases ?? 0;
  const earnedSlab = (line?.discountPaise ?? 0) > 0 && scheme.percentBp !== null;
  const need = nudge && line ? line.cases + nudge.addCases : null;
  const pct = need && line ? Math.round((line.cases / need) * 100) : earnedFree > 0 || earnedSlab ? 100 : 0;

  return (
    <div className={cx("rounded-lg border border-scheme/25 bg-scheme-soft p-4 text-scheme transition-opacity", dim && "opacity-70")}>
      <p className="text-[13px] font-semibold tracking-wide uppercase">{t.schemeTitle}</p>
      <p className="mt-0.5 text-[16px] font-semibold">{scheme.text}</p>
      {line && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t.schemeTitle}>
            <div className="h-full rounded-full bg-scheme transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 space-y-1 text-[14px]">
            {earnedFree > 0 && <p className="font-semibold">✓ {fill(t.schemeEarnedFree, { free: earnedFree })}</p>}
            {earnedSlab && <p className="font-semibold">✓ {fill(t.schemeEarnedSlab, { pct: formatBp(scheme.percentBp!) })}</p>}
            {nudge && need && (
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="num">
                  {nudge.kind === "FREE_GOODS"
                    ? fill(t.schemeProgressFree, { have: line.cases, need, free: nudge.freeCases })
                    : fill(t.schemeProgressSlab, { have: line.cases, need, pct: formatBp(nudge.percentBp) })}
                </span>
                <button type="button" onClick={() => onAdd(nudge.addCases)} className="h-9 rounded-md bg-surface px-3 font-medium shadow-card hover:bg-sunken">
                  {fill(t.addMore, { n: nudge.addCases })}
                </button>
              </p>
            )}
          </div>
        </>
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
