"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink, Card, cx, EmptyState, Notice, PageHeader, Skeleton } from "@/components/ui";
import { fill, type Lang, type Messages } from "@/lib/i18n/messages";
import { formatPaise } from "@/lib/money";
import { uuid } from "@/lib/uuid";
import { placeOrderAction } from "../actions";
import { useCart } from "../cart-store";
import { CreditNotice, OrderSummary } from "../summary";
import { usePricing } from "@/components/use-pricing";
import { priceCartAction } from "../actions";

type T = Messages["shop"];
type Problem = "priceChanged" | "stockChanged" | "notOrderable" | "placeError" | null;

export function Checkout({ t, common, lang }: { t: T; common: Messages["common"]; lang: Lang }) {
  const router = useRouter();
  const cart = useCart();
  const { pricing, loading, error, retry, accept } = usePricing(cart.lines, priceCartAction, 0);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<Problem>(null);
  const [pending, startTransition] = useTransition();
  // One key per checkout visit: retries after a network error can never create a second order.
  const [idempotencyKey] = useState(uuid);
  const [placed, setPlaced] = useState(false);

  if (cart.lines.length === 0 && !placed) {
    return (
      <>
        <PageHeader title={t.checkoutTitle} />
        <EmptyState title={t.cartEmptyTitle} body={t.cartEmptyBody} action={<ButtonLink href="/shop">{t.browse}</ButtonLink>} />
      </>
    );
  }

  const submit = () => {
    if (!pricing) return;
    setProblem(null);
    startTransition(async () => {
      try {
        const res = await placeOrderAction({
          lines: cart.lines,
          expectedTotalPaise: pricing.totals.totalPaise, // only to detect a change; the server re-prices
          idempotencyKey,
          note: note.trim() || undefined,
        });
        if (res.ok) {
          setPlaced(true);
          router.replace(`/shop/orders/${res.orderId}?placed=1`);
          cart.clear();
          return;
        }
        if ("pricing" in res) accept(res.pricing);
        setProblem(res.error === "PRICE_CHANGED" ? "priceChanged" : res.error === "STOCK_CHANGED" ? "stockChanged" : res.error === "NOT_ORDERABLE" ? "notOrderable" : "placeError");
      } catch {
        setProblem("placeError"); // network failure: same key on retry, so no duplicate order
      }
    });
  };

  const busy = pending || placed;

  return (
    <>
      <PageHeader title={t.checkoutTitle} action={<Link href="/shop/cart" className="text-[15px] font-medium text-accent underline">{t.editCart}</Link>} />

      {problem && (
        <div className="mb-4">
          <Notice tone={problem === "priceChanged" ? "warn" : "danger"}>
            {t[problem]}{" "}
            {(problem === "stockChanged" || problem === "notOrderable") && (
              <Link href="/shop/cart" className="font-semibold underline">
                {t.editCart}
              </Link>
            )}
          </Notice>
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
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <Card className={cx("p-4", loading && "opacity-60")}>
            <h2 className="mb-2 text-[15px] font-semibold">{t.lineItems}</h2>
            <ul className="divide-y divide-line">
              {pricing.lines.map((l) => (
                <li key={l.skuId} className="flex justify-between gap-3 py-2.5 text-[15px]">
                  <div className="min-w-0">
                    <p className="font-medium">{lang === "hi" ? l.item.nameHi : l.item.name}</p>
                    <p className="num text-[13px] text-ink-3">
                      {l.cases} × {formatPaise(l.casePricePaise)} {t.perCase}
                      {l.freeCases > 0 && <span className="text-scheme"> · {fill(t.free, { n: l.freeCases })}</span>}
                      {l.discountPaise > 0 && <span className="text-scheme"> · −{formatPaise(l.discountPaise)}</span>}
                    </p>
                    {!l.orderable && <p className="text-[13px] text-danger">{l.issues.includes("OUT_OF_STOCK") ? t.outOfStock : fill(t.issueExceeds, { max: l.maxOrderableCases })}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="num font-medium">{formatPaise(l.totalPaise)}</p>
                    <p className="text-[12px] text-ink-3">{common.inclGst}</p>
                  </div>
                </li>
              ))}
            </ul>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[15px] font-medium">{t.noteLabel}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 300))}
                maxLength={300}
                rows={2}
                placeholder={t.notePlaceholder}
                className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent"
              />
            </label>
          </Card>

          <div className="space-y-3 lg:sticky lg:top-20">
            <OrderSummary pricing={pricing} t={t} dim={loading} />
            <CreditNotice pricing={pricing} t={t} />
            <Button size="lg" onClick={submit} disabled={busy || loading || !pricing.orderable} aria-busy={busy}>
              {busy ? t.placing : `${t.placeOrder} · ${formatPaise(pricing.totals.totalPaise)}`}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
