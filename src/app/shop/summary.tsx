import { Card, cx, Notice } from "@/components/ui";
import { fill, type Messages } from "@/lib/i18n/messages";
import { formatPaise } from "@/lib/money";
import type { CartPricing } from "@/server/pricing";

type T = Messages["shop"];

/** Totals block. Every figure states whether GST is in or out (brief constraint). */
export function OrderSummary({ pricing, t, dim }: { pricing: CartPricing; t: T; dim?: boolean }) {
  const s = pricing.totals;
  return (
    <Card className={cx("p-4 transition-opacity", dim && "opacity-60")} aria-busy={dim}>
      <h2 className="mb-2 text-[15px] font-semibold">{t.summary}</h2>
      <dl className="space-y-1 text-[15px]">
        <Row label={t.totalCases} value={s.freeCases ? `${s.cases} ${fill(t.free, { n: s.freeCases })}` : String(s.cases)} />
        <Row label={t.gross} value={formatPaise(s.grossPaise)} />
        {s.discountPaise > 0 && <Row label={t.discount} value={`− ${formatPaise(s.discountPaise)}`} className="text-scheme" />}
        <Row label={t.taxable} value={formatPaise(s.taxablePaise)} />
        <Row label={t.gst} value={`+ ${formatPaise(s.gstPaise)}`} />
        <Row label={t.total} value={formatPaise(s.totalPaise)} className="border-t border-line pt-2 text-[17px] font-semibold" />
      </dl>
      <p className="mt-3 text-[13px] text-ink-3">{t.gstNote}</p>
    </Card>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cx("flex justify-between gap-3", className)}>
      <dt>{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}

/** Credit is never a hard block: over the limit means the desk reviews it (A7). */
export function CreditNotice({ pricing, t }: { pricing: CartPricing; t: T }) {
  const c = pricing.credit;
  if (c.wouldExceed) {
    return <Notice tone="warn">{fill(t.creditWillHold, { amount: formatPaise(c.exceedsByPaise) })}</Notice>;
  }
  return <p className="text-[14px] text-ink-2">{fill(t.creditOk, { amount: formatPaise(c.position.availablePaise) })}</p>;
}
