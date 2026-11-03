"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ProductImage } from "@/components/product-image";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, Notice, Skeleton } from "@/components/ui";
import { usePricing } from "@/components/use-pricing";
import { aliasEligible } from "@/lib/capture/alias";
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
import { engineNotice } from "../../engine-notice";
import { Icon } from "@/components/icons";

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

/** Issues that mean "check the product": the line needs a decision until the desk keeps or changes it. */
const PRODUCT_CHECK = ["SIZE_SIBLING", "MODEL_DISAGREES", "MODEL_INVALID_SKU", "LOW_CONFIDENCE"];

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
  const [kept, setKept] = useState<string[]>([]);
  const [noted, setNoted] = useState<string[]>([]);
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
  // A flagged suggestion (same-size sibling, AI disagreement, low confidence) stays unsettled
  // until the desk changes the product or explicitly keeps it.
  const productUnsettled = (l: Line) => {
    const x = decisions[l.id];
    return !!x.skuId && x.skuId === l.skuId && !kept.includes(l.id) && (l.issues ?? []).some((i) => PRODUCT_CHECK.includes(i));
  };
  // The retailer asked for a discount, free goods or a price: normal pricing applies once the desk has noted it.
  const termsUnnoted = (l: Line) => (l.issues ?? []).includes("TERMS_REQUESTED") && !noted.includes(l.id);
  // Review summary: which lines are ready, which need the desk, which are left out.
  const lineState = (l: Line): "ready" | "attention" | "excluded" => {
    const x = decisions[l.id];
    if (!x.include) return "excluded";
    const p = x.skuId ? priced.get(x.skuId) : undefined;
    return !x.skuId || !x.quantity || x.unit !== "case" || flagged.includes(l.id) || (p && !p.orderable) || productUnsettled(l) || termsUnnoted(l) ? "attention" : "ready";
  };
  const states = lines.map((l) => ({ id: l.id, state: lineState(l) }));
  const attentionIds = states.filter((x) => x.state === "attention").map((x) => x.id);
  const showFirstAttention = () => attentionIds[0] && document.getElementById(`review-line-${attentionIds[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  // Phones: the confirm panel sits in the page flow after the lines (so it never covers them). A one-row bar
  // that jumps to it appears only once the summary has scrolled off the top and the panel is still below.
  const [showBar, setShowBar] = useState(false);
  const hasPanel = !!editable && lines.length > 0;
  useEffect(() => {
    if (!hasPanel) return;
    const wide = window.matchMedia("(min-width: 640px)");
    const update = () => {
      const summary = document.getElementById("review-summary")?.getBoundingClientRect();
      const panel = document.getElementById("review-confirm")?.getBoundingClientRect();
      setShowBar(!wide.matches && !!summary && !!panel && summary.bottom < 0 && panel.top > window.innerHeight);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [hasPanel]);
  const goToConfirm = () => {
    document.getElementById("review-confirm")?.scrollIntoView({ behavior: "smooth", block: "end" });
    document.getElementById("review-confirm-check")?.focus({ preventScroll: true });
  };
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
          // The order page reports how many shop words the server actually saved.
          router.push(`/desk/orders/${res.orderId}?created=1${res.aliasesSaved ? `&learned=${res.aliasesSaved}` : ""}`);
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

        {capture &&
          (() => {
            const notice = engineNotice(d, capture);
            return (
              <Notice tone={notice.tone}>
                {notice.text}
                {editable && notice.hint && <span className="mt-1 block">{notice.hint}</span>}
              </Notice>
            );
          })()}

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
          <EmptyState icon="inbox" title={d.noLines} />
        ) : (
          <>
          <div id="review-summary" className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-[14px]" aria-live="polite">
            <span className="font-semibold">{fill(d.sumLines, { n: lines.length })}</span>
            <Badge tone="accent">{fill(d.sumReady, { n: states.filter((x) => x.state === "ready").length })}</Badge>
            {attentionIds.length > 0 && <Badge tone="warn">{fill(d.sumAttention, { n: attentionIds.length })}</Badge>}
            {states.some((x) => x.state === "excluded") && <Badge tone="neutral">{fill(d.sumExcluded, { n: states.filter((x) => x.state === "excluded").length })}</Badge>}
            {attentionIds.length > 0 && (
              <button type="button" onClick={showFirstAttention} className="ml-auto h-9 rounded-md border border-warn/40 px-3 font-medium text-warn hover:bg-warn-soft">
                {d.showLine}
              </button>
            )}
          </div>
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
                editable={!!editable}
                d={d}
                shopT={shopT}
                lang={lang}
                state={lineState(l)}
                onKeep={productUnsettled(l) ? () => setKept((k) => [...k, l.id]) : undefined}
                onNoteTerms={termsUnnoted(l) ? () => setNoted((n) => [...n, l.id]) : undefined}
              />
            ))}
          </ol>
          </>
        )}

        {editable && lines.length > 0 && (
          <Card id="review-confirm" className="space-y-3 p-4 sm:sticky sm:z-10 sm:shadow-pop" style={{ bottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}>
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
                <Row label={shopT.gross} value={formatPaise(pricing.totals.grossPaise)} className="hidden sm:flex" />
                {pricing.totals.discountPaise > 0 && <Row label={shopT.discount} value={`− ${formatPaise(pricing.totals.discountPaise)}`} className="hidden text-scheme sm:flex" />}
                {pricing.totals.freeCases > 0 && <Row label={shopT.freeCases} value={String(pricing.totals.freeCases)} className="text-scheme" />}
                <Row label={shopT.gst} value={`+ ${formatPaise(pricing.totals.gstPaise)}`} className="hidden sm:flex" />
                <Row label={shopT.total} value={formatPaise(pricing.totals.totalPaise)} className="hidden text-[17px] font-semibold sm:flex sm:border-t sm:border-line sm:pt-1.5" />
              </dl>
            )}
            {pricing?.credit.wouldExceed && (
              <Notice tone="warn">
                {d.stats.creditHold}: {fill(shopT.creditWillHold, { amount: formatPaise(pricing.credit.exceedsByPaise) })}
              </Notice>
            )}
            {unresolved.length > 0 && <p className="text-[14px] font-medium text-warn">{d.errUnresolved}</p>}

            <label className="flex items-start gap-3 rounded-md bg-sunken px-3 py-2.5 text-[15px]">
              <input id="review-confirm-check" type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--color-accent)]" />
              <span>{d.confirmCheck}</span>
            </label>
            <Button size="lg" onClick={confirm} disabled={!canConfirm} aria-busy={pending}>
              {pending ? d.creating : pricing ? `${d.createOrder} · ${formatPaise(pricing.totals.totalPaise)}` : d.createOrder}
            </Button>
          </Card>
        )}
        {hasPanel && showBar && (
          <div
            className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-line bg-surface px-4 pt-2 shadow-pop sm:hidden"
            style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <span className="min-w-0 flex-1 text-[14px] leading-tight">
              {pricing ? (
                <>
                  <span className="block text-ink-3">{shopT.total}</span>
                  <span className="num block text-[16px] font-semibold">{formatPaise(pricing.totals.totalPaise)}</span>
                </>
              ) : (
                <span className="text-ink-2">{fill(d.sumLines, { n: lines.length })}</span>
              )}
            </span>
            <Button onClick={goToConfirm}>{d.toConfirm} ↓</Button>
          </div>
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
  editable,
  d,
  shopT,
  lang,
  state,
  onKeep,
  onNoteTerms,
}: {
  line: Line;
  decision: Decision;
  onChange: (patch: Partial<Decision>) => void;
  priced?: PricedCartLine;
  catalogue: Sku[];
  skuById: Map<string, Sku>;
  editable: boolean;
  d: D;
  shopT: Messages["shop"];
  lang: Lang;
  state: "ready" | "attention" | "excluded";
  /** Set while a flagged suggestion is unsettled: keeps the suggested product. */
  onKeep?: () => void;
  /** Set while a TERMS_REQUESTED warning is not yet acknowledged. */
  onNoteTerms?: () => void;
}) {
  const b = band(line.confidence);
  const sku = decision.skuId ? skuById.get(decision.skuId) : undefined;
  // Mirrors the server: a changed product or a unit settled to cases becomes an alias for this shop.
  const corrected = decision.include && !!decision.skuId && (decision.skuId !== line.skuId || (line.unit !== "case" && decision.unit === "case"));
  // Same rule the server uses when it saves aliases: instruction text, requested terms and
  // separated quantities are corrected for this order only.
  const learnable = corrected && aliasEligible(line.originalText, line.issues);
  const suggestions = [line.skuId, line.alt1SkuId, line.alt2SkuId].filter((x): x is string => !!x && skuById.has(x));
  const categories = [...new Set(catalogue.map((c) => c.category))];
  const issues = (line.issues ?? []) as (keyof D["issues"])[];

  return (
    <li
      id={`review-line-${line.id}`}
      className={cx(
        "scroll-mt-32 rounded-lg border border-l-4 bg-surface p-4 shadow-card",
        state === "excluded" ? "border-line border-l-line-strong opacity-70" : state === "attention" ? "border-warn/50 border-l-warn" : "border-line border-l-accent",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-3">{d.words}</p>
          <p className="text-[17px] font-semibold">“{line.originalText}”</p>
        </div>
        <Badge tone={state === "ready" ? "accent" : state === "attention" ? "warn" : "neutral"} className="shrink-0">
          {state === "ready" ? d.lineReady : state === "attention" ? d.needsDecision : d.excluded}
        </Badge>
      </div>

      {/* How sure the AI (or rule matcher) was, and where the match came from. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="flex items-center gap-2">
          <span className="text-ink-3">{d.confidenceLabel}</span>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <span className={cx("block h-full rounded-full", b === "high" ? "bg-accent" : b === "medium" ? "bg-warn" : "bg-danger")} style={{ width: `${line.confidence}%` }} />
          </span>
          <span className={cx("num font-semibold", b === "high" ? "text-accent" : b === "medium" ? "text-warn" : "text-danger")}>
            {d.confidence[b]} · {line.confidence}%
          </span>
        </span>
        <span className="text-ink-3">{fill(d.matchedVia, { how: (d.matchedBy as Record<string, string>)[line.matchedBy] ?? line.matchedBy })}</span>
      </div>

      {issues.length > 0 && (
        <div role="note" className="mt-3 flex gap-2 rounded-md bg-warn-soft px-3 py-2 text-[14px] text-warn">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <ul className="space-y-0.5">
            {issues.map((i) => (
              <li key={i}>{d.issues[i] ?? i}</li>
            ))}
          </ul>
          {editable && decision.include && (onKeep || onNoteTerms) && (
            <div className="ml-auto flex shrink-0 flex-col gap-1.5 self-start">
              {onKeep && (
                <button
                  type="button"
                  onClick={onKeep}
                  className="h-9 rounded-md border border-warn/40 bg-surface px-3 text-[14px] font-medium text-warn hover:bg-warn-soft"
                >
                  {d.keepProduct}
                </button>
              )}
              {onNoteTerms && (
                <button
                  type="button"
                  onClick={onNoteTerms}
                  className="h-9 rounded-md border border-warn/40 bg-surface px-3 text-[14px] font-medium text-warn hover:bg-warn-soft"
                >
                  {d.termsNoted}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {sku && decision.include && <p className="mt-3 text-[15px] leading-snug font-semibold sm:hidden">{sku.name}</p>}
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
        {corrected && <Badge tone="info">{learnable ? d.corrected : d.correctedThisOrder}</Badge>}
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
