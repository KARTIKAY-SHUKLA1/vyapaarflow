import { Badge } from "@/components/ui";
import type { OrderStatus } from "@/db/schema";
import { fill, type Messages } from "@/lib/i18n/messages";
import type { StockStatus } from "@/server/catalogue";

/** Shared, server- and client-safe display helpers for the shop. */
type T = Messages["shop"];

export function categoryLabel(t: T, category: string) {
  return (t.categories as Record<string, string>)[category] ?? category;
}

export function StockBadge({ t, status, cases }: { t: T; status: StockStatus; cases: number }) {
  if (status === "out") return <Badge tone="danger">{t.outOfStock}</Badge>;
  if (status === "low") return <Badge tone="warn">{fill(t.lowStock, { n: cases })}</Badge>;
  return <Badge tone="accent">{t.inStock}</Badge>;
}

export const STATUS_TONE: Record<OrderStatus, "neutral" | "accent" | "warn" | "danger" | "info"> = {
  placed: "info",
  credit_hold: "warn",
  approved: "accent",
  exported: "neutral",
  cancelled: "danger",
};

export function StatusBadge({ t, status }: { t: T; status: OrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{t.status[status]}</Badge>;
}

export function sizeLabel(name: string): string {
  return name.match(/\d+(\.\d+)?\s?(g|kg|ml|l)\b/i)?.[0] ?? "";
}

/** Received → Approved → Billed. A held order is on step 1 (in amber); a cancelled one shows no steps. */
const STEPS = ["placed", "approved", "exported"] as const;

export function StatusSteps({ t, status }: { t: T; status: OrderStatus }) {
  if (status === "cancelled") return null;
  const at = status === "exported" ? 2 : status === "approved" ? 1 : 0;
  const held = status === "credit_hold";
  return (
    <ol className="grid grid-cols-3 gap-1.5" aria-label={t.stepsLabel}>
      {STEPS.map((step, i) => {
        const done = i <= at;
        const current = i === at;
        return (
          <li key={step} aria-current={current ? "step" : undefined} className="min-w-0">
            <span className={`block h-1.5 rounded-full ${done ? (held && current ? "bg-warn" : "bg-accent") : "bg-line"}`} />
            <span className={`mt-1 block truncate text-[12px] ${current ? "font-semibold text-ink" : done ? "text-ink-2" : "text-ink-3"}`}>
              {held && current ? t.status.credit_hold : t.status[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** "Glucose biscuit 75 g ×10 · Detergent powder 1 kg ×2 · +1 more" */
export function itemsSummary(t: T, items: { name: string; nameHi: string; cases: number }[], lang: "en" | "hi", max = 2): string {
  const shown = items.slice(0, max).map((i) => `${shortName(lang === "hi" ? i.nameHi : i.name)} ×${i.cases}`);
  const rest = items.length - shown.length;
  return [...shown, ...(rest > 0 ? [fill(t.moreItems, { n: rest })] : [])].join(" · ");
}

/** "Glucose biscuit 75 g, case of 96" → "Glucose biscuit 75 g" (and the Hindi "…, 96 का केस"). */
export function shortName(name: string): string {
  return name.replace(/, case of \d+$/, "").replace(/, \d+ का केस$/, "");
}
