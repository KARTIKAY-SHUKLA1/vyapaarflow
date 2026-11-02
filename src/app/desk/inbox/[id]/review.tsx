"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { ProductImage } from "@/components/product-image";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, Notice, Skeleton } from "@/components/ui";
import { usePricing } from "@/components/use-pricing";
import type { captureLines, captures, inboundMessages } from "@/db/schema";
import { formatDateTime } from "@/lib/dates";
import { fill, type Lang, type Messages } from "@/lib/i18n/messages";
import { formatBp, formatPaise } from "@/lib/money";
import { describeScheme } from "@/lib/pricing/describe";
import { formatIndianMobile } from "@/lib/phone";
import { uuid } from "@/lib/uuid";
import type { PricedCartLine } from "@/server/pricing";
import { sizeLabel } from "../../../shop/labels";
import { confirmCaptureAction, dismissAction, linkAndRerunAction, priceForDeskAction, runCaptureAction } from "../../actions";

type D = Messages["desk"];
type Line = typeof captureLines.$inferSelect;
type Unit = "case" | "piece" | "unknown";
type Decision = { include: boolean; skuId: string | null; quantity: number | null; unit: Unit };
type Sku = { id: string; code: string; name: string; category: string; packSize: number; imageKey: string };

type Props = {
  lang: Lang;
  d: D;
  shopT: Messages["shop"];
  message: typeof inboundMessages.$inferSelect & { shopName: string | null; retailerCode: string | null; area: string | null };
  capture: typeof captures.$inferSelect | null;
  lines: Line[];
  catalogue: Sku[];
  order: { id: string; number: string } | null;
  shops: { id: string; code: string; shopName: string; area: string }[];
};

function band(confidence: number) {
  return confidence >= 80 ? "high" : confidence >= 50 ? "medium" : "low";
}

export function Review({ lang, d, shopT, message, capture, lines, catalogue, order, shops }: Props) {
  const router = useRouter();
  const skuById = useMemo(() => new Map(catalogue.map((s) => [s.id, s])), [catalogue]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, { include: true, skuId: l.skuId, quantity: l.quantity, unit: l.unit }])),
  );
  const [checked, setChecked] = useState(false);
  const [flagged, setFlagged] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [idempotencyKey] = useState(uuid);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");

  const editable = capture?.status === "draft" && message.status !== "dismissed" && message.status !== "converted";
  const retailerId = message.retailerId;

  const cart = useMemo(
    () =>
      lines
        .map((l) => decisions[l.id])
        .filter((x) => x.include && x.skuId && x.quantity)
        .map((x) => ({ skuId: x.skuId!, cases: x.quantity! })),
    [lines, decisions],
  );
  const fetcher = useCallback(
    (l: { skuId: string; cases: number }[]) => (retailerId ? priceForDeskAction(retailerId, l) : Promise.resolve({ ok: false as const })),
    [retailerId],
  );
  const { pricing, loading, error, retry, accept } = usePricing(editable ? cart : [], fetcher, 300, retailerId ?? "");
  const priced = useMemo(() => new Map((pricing?.lines ?? []).map((p) => [p.skuId, p])), [pricing]);

  const unresolved = lines.filter((l) => {
    const x = decisions[l.id];
    return x.include && (!x.skuId || !x.quantity || x.unit !== "case");
  });
  const includedCount = lines.filter((l) => decisions[l.id].include).length;
  const canConfirm = editable && !!retailerId && checked && unresolved.length === 0 && includedCount > 0 && !!pricing?.orderable && !loading && !pending;

  const set = (id: string, patch: Partial<Decision>) => {
    setDecisions((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
    setChecked(false); // any change needs a fresh human check
    setProblem(null);
  };

  const confirm = () =>
    start(async () => {
      if (!capture || !pricing) return;
      setProblem(null);
      try {
        const res = await confirmCaptureAction({
          captureId: capture.id,
          lines: lines.map((l) => ({ lineId: l.id, ...decisions[l.id] })),
          expectedTotalPaise: pricing.totals.totalPaise,
          idempotencyKey,
          confirmed: true,
        });
        if (res.ok) {
          router.push(`/desk/orders/${res.orderId}?created=1`);
          return;
        }
        if ("pricing" in res) accept(res.pricing);
        if (res.error === "UNRESOLVED") setFlagged(res.lineIds);
        setChecked(false);
        setProblem(
          {
            UNRESOLVED: d.errUnresolved,
            NO_LINES: d.errNoLines,
            NO_RETAILER: d.errNoRetailer,
            CLOSED: d.errClosed,
            NOT_ORDERABLE: d.errNotOrderable,
            STOCK_CHANGED: d.errStock,
            PRICE_CHANGED: d.errPrice,
          }[res.error as string] ?? d.errGeneric,
        );
      } catch {
        setProblem(d.errGeneric);
      }
    });

  const dismiss = () =>
    start(async () => {
      const res = await dismissAction({ messageId: message.id, reason });
      if (res.ok) {
        setDismissing(false);
        router.refresh();
      } else setProblem(res.error === "CLOSED" ? d.errClosed : d.errGeneric);
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
      {/* ── Left: the original message, exactly as received ── */}
      <div className="space-y-4 lg:sticky lg:top-32">
        <Card className="p-4">
          <h1 className="text-[18px] font-semibold">{d.reviewTitle}</h1>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[14px]">
            <dt className="text-ink-3">{d.from}</dt>
            <dd>
              <span className="font-medium">{message.shopName ?? d.unknownSender}</span>
              {message.retailerCode && <span className="text-ink-3"> · {message.retailerCode}</span>}
              <span className="num text-ink-3"> · {formatIndianMobile(message.fromPhone)}</span>
            </dd>
            <dt className="text-ink-3">{d.received}</dt>
            <dd>
              {formatDateTime(message.receivedAt, lang)} · {d.channel[message.channel]}
            </dd>
          </dl>
          <h2 className="mt-4 text-[13px] font-medium text-ink-3">{d.originalMessage}</h2>
          <blockquote className="mt-1 rounded-md bg-sunken p-3 text-[16px] leading-relaxed whitespace-pre-wrap">{message.body}</blockquote>
        </Card>

        {capture && (
          <Notice tone={capture.engine === "llm" ? "info" : "warn"}>
            {capture.engine === "llm"
              ? fill(d.engineLlm, { model: capture.model ?? "AI" })
              : fill(d.engineRules, { reason: (d.fallback as Record<string, string>)[capture.fallbackReason ?? ""] ?? capture.fallbackReason ?? "" })}
          </Notice>
        )}

        {!retailerId && message.status !== "dismissed" && message.status !== "converted" && (
          <Card className="p-4">
            <h2 className="text-[15px] font-semibold">{d.linkTitle}</h2>
            <p className="mt-0.5 text-[13px] text-ink-2">{d.linkBody}</p>
            <form action={linkAndRerunAction} className="mt-3 space-y-2">
              <input type="hidden" name="messageId" value={message.id} />
              <select name="retailerId" required defaultValue="" className="h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]">
                <option value="" disabled>
                  {d.pasteShopPick}
                </option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.shopName} · {s.code} · {s.area}
                  </option>
                ))}
              </select>
              <SubmitButton pendingLabel={d.running} className="w-full">
                {d.linkAndRerun}
              </SubmitButton>
            </form>
          </Card>
        )}

        {editable && (
          <div className="flex flex-wrap gap-2">
            <form action={runCaptureAction}>
              <input type="hidden" name="messageId" value={message.id} />
              <input type="hidden" name="force" value="1" />
              <SubmitButton variant="secondary" pendingLabel={d.running}>
                {d.rerun}
              </SubmitButton>
            </form>
            {!dismissing && (
              <Button variant="ghost" onClick={() => setDismissing(true)}>
                {d.dismiss}
              </Button>
            )}
          </div>
        )}
        {dismissing && (
          <Card className="space-y-2 p-4">
            <label className="block">
              <span className="mb-1 block text-[14px] font-medium">{d.dismissReason}</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus className="h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]" />
            </label>
            <div className="flex gap-2">
              <Button variant="danger" onClick={dismiss} disabled={pending || reason.trim().length < 3}>
                {pending ? d.working : d.dismiss}
              </Button>
              <Button variant="ghost" onClick={() => setDismissing(false)}>
                {d.back}
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* ── Right: what the AI proposed, and the desk's decisions ── */}
      <div className="space-y-3">
        {message.status === "converted" && order && (
          <Notice tone="accent" title="✓">
            {fill(d.converted, { number: order.number })}{" "}
            <Link href={`/desk/orders/${order.id}`} className="font-semibold underline">
              {d.open}
            </Link>
          </Notice>
        )}
        {message.status === "dismissed" && <Notice tone="neutral">{d.dismissed}</Notice>}

        {!capture ? (
          message.status === "dismissed" ? null : (
            <EmptyState
              title={d.notCaptured}
              action={
                <form action={runCaptureAction}>
                  <input type="hidden" name="messageId" value={message.id} />
                  <SubmitButton pendingLabel={d.running}>{d.runCapture}</SubmitButton>
                </form>
              }
            />
          )
        ) : lines.length === 0 ? (
          <EmptyState title={d.noLines} />
        ) : (
          <ol className="space-y-3">
            {lines.map((l) => (
              <ReviewLine
                key={l.id}
                line={l}
                decision={decisions[l.id]}
                onChange={(patch) => set(l.id, patch)}
                priced={decisions[l.id].skuId ? priced.get(decisions[l.id].skuId!) : undefined}
                catalogue={catalogue}
                skuById={skuById}
                flagged={flagged.includes(l.id)}
                editable={!!editable}
                d={d}
                shopT={shopT}
                lang={lang}
              />
            ))}
          </ol>
        )}

        {editable && lines.length > 0 && (
          <Card className="space-y-3 p-4">
            {problem && <Notice tone="danger">{problem}</Notice>}
            {error && (
              <Notice tone="danger">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  {shopT.pricingError}
                  <Button variant="secondary" onClick={retry}>
                    ↻
                  </Button>
                </span>
              </Notice>
            )}
            {!retailerId ? (
              <Notice tone="warn">{d.errNoRetailer}</Notice>
            ) : !pricing ? (
              cart.length > 0 && <Skeleton className="h-32 w-full" />
            ) : (
              <dl className={cx("space-y-1 text-[15px] transition-opacity", loading && "opacity-60")} aria-busy={loading}>
                <Row label={shopT.gross} value={formatPaise(pricing.totals.grossPaise)} />
                {pricing.totals.discountPaise > 0 && <Row label={shopT.discount} value={`− ${formatPaise(pricing.totals.discountPaise)}`} className="text-scheme" />}
                {pricing.totals.freeCases > 0 && <Row label={shopT.freeCases} value={String(pricing.totals.freeCases)} className="text-scheme" />}
                <Row label={shopT.gst} value={`+ ${formatPaise(pricing.totals.gstPaise)}`} />
                <Row label={shopT.total} value={formatPaise(pricing.totals.totalPaise)} className="border-t border-line pt-1.5 text-[17px] font-semibold" />
              </dl>
            )}
            {pricing?.credit.wouldExceed && (
              <Notice tone="warn">
                {d.stats.creditHold}: {fill(shopT.creditWillHold, { amount: formatPaise(pricing.credit.exceedsByPaise) })}
              </Notice>
            )}
            {unresolved.length > 0 && <p className="text-[14px] font-medium text-warn">{d.errUnresolved}</p>}

            <label className="flex items-start gap-3 rounded-md bg-sunken p-3 text-[15px]">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--color-accent)]" />
              <span>{d.confirmCheck}</span>
            </label>
            <Button size="lg" onClick={confirm} disabled={!canConfirm} aria-busy={pending}>
              {pending ? d.creating : pricing ? `${d.createOrder} · ${formatPaise(pricing.totals.totalPaise)}` : d.createOrder}
            </Button>
          </Card>
        )}
        {message.status === "converted" && !order && <ButtonLink href="/desk/orders">{d.ordersTitle}</ButtonLink>}
      </div>
    </div>
  );
}

function ReviewLine({
  line,
  decision,
  onChange,
  priced,
  catalogue,
  skuById,
  flagged,
  editable,
  d,
  shopT,
  lang,
}: {
  line: Line;
  decision: Decision;
  onChange: (patch: Partial<Decision>) => void;
  priced?: PricedCartLine;
  catalogue: Sku[];
  skuById: Map<string, Sku>;
  flagged: boolean;
  editable: boolean;
  d: D;
  shopT: Messages["shop"];
  lang: Lang;
}) {
  const b = band(line.confidence);
  const sku = decision.skuId ? skuById.get(decision.skuId) : undefined;
  // Mirrors the server: a changed product or a unit settled to cases becomes an alias for this shop.
  const corrected = decision.include && !!decision.skuId && (decision.skuId !== line.skuId || (line.unit !== "case" && decision.unit === "case"));
  const needs = decision.include && (!decision.skuId || !decision.quantity || decision.unit !== "case");
  const suggestions = [line.skuId, line.alt1SkuId, line.alt2SkuId].filter((x): x is string => !!x && skuById.has(x));
  const categories = [...new Set(catalogue.map((c) => c.category))];
  const issues = (line.issues ?? []) as (keyof D["issues"])[];

  return (
    <li
      className={cx(
        "rounded-lg border bg-surface p-4 shadow-card",
        !decision.include ? "border-line opacity-70" : flagged || needs ? "border-warn/60" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-3">{d.words}</p>
          <p className="text-[17px] font-semibold">“{line.originalText}”</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={b === "high" ? "accent" : b === "medium" ? "warn" : "danger"}>
            {d.confidence[b]} · {line.confidence}%
          </Badge>
          <Badge tone="neutral">{(d.matchedBy as Record<string, string>)[line.matchedBy] ?? line.matchedBy}</Badge>
        </div>
      </div>

      {issues.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {issues.map((i) => (
            <li key={i} className="text-[14px] text-warn">
              • {d.issues[i] ?? i}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-3">
        {sku && <ProductImage imageKey={sku.imageKey} label={sizeLabel(sku.name)} size="sm" alt="" />}
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <label className="block min-w-0">
            <span className="mb-1 block text-[13px] font-medium text-ink-3">{d.product}</span>
            <select
              value={decision.skuId ?? ""}
              disabled={!editable || !decision.include}
              onChange={(e) => onChange({ skuId: e.target.value || null })}
              className="h-11 w-full rounded-md border border-line-strong bg-surface px-2 text-[15px] disabled:opacity-60"
            >
              <option value="">{d.choose}</option>
              {suggestions.length > 0 && (
                <optgroup label={`${d.aiPick} / ${d.alternative}`}>
                  {suggestions.map((id, i) => (
                    <option key={id} value={id}>
                      {i === 0 && id === line.skuId ? "★ " : "• "}
                      {skuById.get(id)!.name} ({skuById.get(id)!.code})
                    </option>
                  ))}
                </optgroup>
              )}
              {categories.map((cat) => (
                <optgroup key={cat} label={`${d.allProducts} · ${cat}`}>
                  {catalogue
                    .filter((c) => c.category === cat && !suggestions.includes(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink-3">{d.qty}</span>
            <input
              inputMode="numeric"
              value={decision.quantity ?? ""}
              disabled={!editable || !decision.include}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value.replace(/\D/g, "").slice(0, 4), 10);
                onChange({ quantity: Number.isFinite(n) && n > 0 ? n : null });
              }}
              className="num h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[16px] font-semibold disabled:opacity-60"
            />
          </label>
        </div>
      </div>

      {/* Brief: each line shows two alternative SKUs — visible, one tap to switch. */}
      {suggestions.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium text-ink-3">{d.alternative}:</span>
          {suggestions
            .filter((id) => id !== decision.skuId)
            .slice(0, 3)
            .map((id) => (
              <button
                key={id}
                type="button"
                disabled={!editable || !decision.include}
                onClick={() => onChange({ skuId: id })}
                className="rounded-full border border-line-strong bg-surface px-3 py-1 text-[13px] text-ink-2 hover:border-accent hover:text-accent disabled:opacity-60"
              >
                {id === line.skuId ? "★ " : ""}
                {skuById.get(id)!.name.replace(/, case of \d+$/, "")}
              </button>
            ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label={d.unit} className="inline-flex overflow-hidden rounded-md border border-line-strong">
          {(["case", "piece", "unknown"] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={decision.unit === u}
              disabled={!editable || !decision.include}
              onClick={() => onChange({ unit: u })}
              className={cx(
                "h-10 px-3 text-[14px] font-medium disabled:opacity-60",
                decision.unit === u ? (u === "case" ? "bg-accent text-accent-ink" : "bg-warn-soft text-warn") : "bg-surface text-ink-2 hover:bg-sunken",
              )}
            >
              {d.units[u]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[15px]">
          <input
            type="checkbox"
            checked={decision.include}
            disabled={!editable}
            onChange={(e) => onChange({ include: e.target.checked })}
            className="h-5 w-5 accent-[var(--color-accent)]"
          />
          {d.include}
        </label>
      </div>

      {decision.include && decision.unit === "piece" && <p className="mt-2 text-[14px] text-warn">{d.pieceBlocked}</p>}

      {decision.include && priced && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-sunken px-3 py-2 text-[14px]">
          <span className="num text-ink-2">
            {fill(d.linePricing, { price: formatPaise(priced.casePricePaise) })} · GST {formatBp(priced.gstRateBp)}
            {priced.appliedScheme && <span className="text-scheme"> · {priced.item.scheme ? describeScheme(priced.item.scheme, lang) : priced.appliedScheme.label}</span>}
            {priced.freeCases > 0 && <span className="text-scheme"> · +{priced.freeCases}</span>}
          </span>
          <span className="num font-semibold">{formatPaise(priced.totalPaise)}</span>
          {priced.nudge && (
            <span className="w-full text-scheme">
              {priced.nudge.kind === "FREE_GOODS"
                ? fill(shopT.nudgeFree, { add: priced.nudge.addCases, free: priced.nudge.freeCases })
                : fill(shopT.nudgeSlab, { add: priced.nudge.addCases, pct: formatBp(priced.nudge.percentBp) })}
            </span>
          )}
          {priced.issues.includes("OUT_OF_STOCK") && <span className="w-full font-medium text-danger">{d.stockOut}</span>}
          {priced.issues.includes("EXCEEDS_STOCK") && <span className="w-full font-medium text-danger">{fill(d.stockShort, { n: priced.maxOrderableCases })}</span>}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {!decision.include && <Badge tone="neutral">{d.excluded}</Badge>}
        {needs && <Badge tone="warn">{d.needsDecision}</Badge>}
        {corrected && <Badge tone="info">{d.corrected}</Badge>}
      </div>
    </li>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cx("flex justify-between gap-3", className)}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
