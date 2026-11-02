"use client";

import { useState } from "react";
import { cx } from "@/components/ui";

/**
 * Case-quantity control: big −/+ targets and a typed field for "20 cases" in one go.
 * `max` (stock) caps the + button; the server re-checks stock anyway.
 */
export function Stepper({
  value,
  onChange,
  max,
  labels,
  size = "md",
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
  labels: { decrease: string; increase: string; cases: string };
  size?: "md" | "lg";
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const h = size === "lg" ? "h-13" : "h-11";
  const commit = (text: string) => {
    setDraft(null);
    const n = Number.parseInt(text, 10);
    if (Number.isFinite(n)) onChange(Math.max(0, Math.min(9999, n)));
  };

  return (
    <div className={cx("inline-flex items-stretch overflow-hidden rounded-md border border-line-strong bg-surface", h)}>
      <button
        type="button"
        aria-label={labels.decrease}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="w-11 text-xl font-medium text-ink-2 hover:bg-sunken active:bg-line"
      >
        −
      </button>
      <input
        aria-label={labels.cases}
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        onFocus={(e) => e.currentTarget.select()}
        className="num w-14 border-x border-line text-center text-lg font-semibold outline-none focus:bg-accent-soft"
      />
      <button
        type="button"
        aria-label={labels.increase}
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(value + 1)}
        className="w-11 text-xl font-medium text-ink-2 hover:bg-sunken active:bg-line disabled:opacity-35"
      >
        +
      </button>
    </div>
  );
}
