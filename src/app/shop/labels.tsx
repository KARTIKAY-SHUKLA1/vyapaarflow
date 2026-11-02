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

const STATUS_TONE: Record<OrderStatus, "neutral" | "accent" | "warn" | "danger" | "info"> = {
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
