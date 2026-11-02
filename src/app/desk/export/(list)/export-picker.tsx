"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink, Card, EmptyState, Notice } from "@/components/ui";
import { fill, type Messages } from "@/lib/i18n/messages";
import { formatPaise } from "@/lib/money";
import { exportAction } from "../../actions";

type Row = { id: string; number: string; shopName: string; retailerCode: string; totalPaise: number; createdLabel: string; sourceLabel: string };

export function ExportPicker({ d, orders }: { d: Messages["desk"]; orders: Row[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(orders.map((o) => o.id)));
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ id: string; count: number; fileName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (orders.length === 0 && !done) return <EmptyState icon="export" title={d.exportNoneTitle} body={d.exportNoneBody} action={<ButtonLink href="/desk/orders?filter=placed" variant="secondary">{d.toApprove}</ButtonLink>} />;

  const chosen = orders.filter((o) => selected.has(o.id));
  const total = chosen.reduce((s, o) => s + o.totalPaise, 0);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = () =>
    start(async () => {
      setError(null);
      try {
        const res = await exportAction({ orderIds: chosen.map((o) => o.id) });
        if (res.ok) {
          setDone({ id: res.exportId, count: res.count, fileName: res.fileName });
          // Start the CSV download (a file response, not a page, so no client-side routing).
          const link = document.createElement("a");
          link.href = `/desk/export/${res.exportId}`;
          link.download = res.fileName;
          link.click();
          router.refresh();
        } else {
          setError(fill(d.exportError, { reason: res.error === "NOT_EXPORTABLE" ? d.exportErrNotReady : res.error === "INCONSISTENT" ? d.exportErrData : res.error }));
          router.refresh();
        }
      } catch {
        setError(fill(d.exportError, { reason: "network" }));
      }
    });

  return (
    <div className="space-y-3">
      {done && (
        <Notice tone="accent" title="✓">
          {fill(d.exportDone, { n: done.count })}{" "}
          <a href={`/desk/export/${done.id}`} className="font-semibold underline">
            {done.fileName}
          </a>
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      {orders.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <label className="flex items-center gap-2 text-[15px] font-medium">
              <input
                type="checkbox"
                checked={chosen.length === orders.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(orders.map((o) => o.id)) : new Set())}
                className="h-5 w-5 accent-[var(--color-accent)]"
              />
              {d.selectAll}
            </label>
            <span className="num text-[14px] text-ink-2">{fill(d.selected, { n: chosen.length, total: formatPaise(total) })}</span>
          </div>
          <ul className="divide-y divide-line">
            {orders.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label={o.number}
                  checked={selected.has(o.id)}
                  onChange={() => toggle(o.id)}
                  className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                />
                <div className="min-w-0 flex-1">
                  <Link href={`/desk/orders/${o.id}`} className="num font-semibold text-accent hover:underline">
                    {o.number}
                  </Link>
                  <p className="text-[13px] text-ink-3">
                    {o.shopName} · {o.retailerCode} · {o.createdLabel} · {o.sourceLabel}
                  </p>
                </div>
                <span className="num shrink-0 font-semibold">{formatPaise(o.totalPaise)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-4">
            <Button size="lg" onClick={run} disabled={pending || chosen.length === 0}>
              {pending ? d.exporting : d.exportButton}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
