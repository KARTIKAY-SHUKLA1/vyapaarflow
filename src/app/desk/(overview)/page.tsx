import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/dates";
import { fill } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { formatPaise, formatPaiseCompact } from "@/lib/money";
import { formatIndianMobile } from "@/lib/phone";
import { listInbox } from "@/server/capture";
import { eq } from "drizzle-orm";
import { Icon } from "@/components/icons";
import { retailers } from "@/db/schema";
import { loadCredit } from "@/server/catalogue";
import { deskOverview, listDeskOrders } from "@/server/desk";

export const metadata: Metadata = { title: "Order desk" };

export default async function DeskHome() {
  const viewer = await requireViewer("desk");
  const { lang, t } = await getMessages();
  const d = t.desk;
  const [o, inbox, holds] = await Promise.all([deskOverview(db, viewer), listInbox(db, viewer, "todo"), listDeskOrders(db, viewer, { filter: "credit_hold", limit: 5 })]);
  if (!o) return null;
  // Credit position for each held shop (display only; same calculation the order page uses).
  const holdCredit = new Map(
    await Promise.all(
      holds.map(async (h) => {
        const [r] = await db.select({ id: retailers.id }).from(retailers).where(eq(retailers.code, h.retailerCode));
        return [h.id, r ? await loadCredit(db, r.id) : null] as const;
      }),
    ),
  );
  const attention = [
    { key: "inbox", href: "/desk/inbox", label: d.stats.inbox, n: o.inbox, icon: "inbox", tone: "accent" },
    { key: "placed", href: "/desk/orders?filter=placed", label: d.stats.placed, n: o.placed, icon: "orders", tone: "accent" },
    { key: "hold", href: "/desk/orders?filter=credit_hold", label: d.stats.creditHold, n: o.creditHold, icon: "alert", tone: "warn" },
  ] as const;
  const waiting = attention.filter((a) => a.n > 0);

  const quiet = [
    { href: "/desk/export", label: d.stats.approved, value: o.approved, hint: o.approved ? formatPaiseCompact(o.approvedValue) : null },
    { href: "/desk/orders?filter=all", label: d.stats.today, value: o.todayOrders, hint: o.todayOrders ? formatPaiseCompact(o.todayValue) : null },
  ];

  return (
    <>
      <PageHeader title={d.title} />
      {/* What needs a person now, most urgent first; quieter numbers follow. */}
      <section aria-labelledby="attention-title" className="rounded-lg border border-line bg-surface p-4 shadow-card">
        <h2 id="attention-title" className="text-[15px] font-semibold">{d.attentionTitle}</h2>
        {waiting.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 text-[15px] text-ink-2">
            <Icon name="check" size={18} className="text-accent" /> {d.attentionNone}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {waiting.map((a) => (
              <li key={a.key}>
                <Link
                  href={a.href}
                  className={`flex items-center gap-3 rounded-md border px-3 py-3 hover:shadow-card ${a.tone === "warn" ? "border-warn/30 bg-warn-soft" : "border-accent/20 bg-accent-soft"}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface ${a.tone === "warn" ? "text-warn" : "text-accent"}`}>
                    <Icon name={a.icon} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`num block text-[24px] leading-none font-semibold ${a.tone === "warn" ? "text-warn" : "text-accent"}`}>{a.n}</span>
                    <span className="mt-1 block text-[14px] text-ink">{a.label}</span>
                  </span>
                  <span aria-hidden className="text-ink-3">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {quiet.map((x) => (
          <Link key={x.label} href={x.href} className="rounded-lg border border-line bg-surface px-4 py-3 hover:border-line-strong">
            <p className="text-[13px] font-medium text-ink-3">{x.label}</p>
            <p className={`num mt-0.5 text-[20px] font-semibold ${x.value ? "" : "text-ink-3"}`}>
              {x.value}
              {x.hint && <span className="ml-2 text-[14px] font-normal text-ink-2">{x.hint}</span>}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Panel title={d.inboxTitle} href="/desk/inbox" seeAll={d.seeAll}>
          {inbox.length === 0 ? (
            <p className="px-4 py-6 text-[15px] text-ink-3">{d.inboxNone}</p>
          ) : (
            <ul className="divide-y divide-line">
              {inbox.slice(0, 5).map((m) => (
                <li key={m.id}>
                  <Link href={`/desk/inbox/${m.id}`} className="block px-4 py-3 hover:bg-sunken">
                    <p className="flex justify-between gap-2 text-[13px] text-ink-3">
                      <span className="font-medium text-ink-2">{m.shopName ?? `${d.unknownSender} · ${formatIndianMobile(m.fromPhone)}`}</span>
                      <span>{formatDateTime(m.receivedAt, lang)}</span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[15px]">{m.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={d.holdsTitle} href="/desk/orders?filter=credit_hold" seeAll={d.seeAll}>
          {holds.length === 0 ? (
            <p className="px-4 py-6 text-[15px] text-ink-3">{d.holdsNone}</p>
          ) : (
            <ul className="divide-y divide-line">
              {holds.map((h) => {
                const c = holdCredit.get(h.id);
                const used = c ? Math.min(100, Math.round((c.exposurePaise / Math.max(1, c.limitPaise)) * 100)) : 0;
                const over = c ? Math.max(0, c.exposurePaise - c.limitPaise) : 0;
                return (
                  <li key={h.id}>
                    <Link href={`/desk/orders/${h.id}`} className="block space-y-2 px-4 py-3 hover:bg-sunken">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-[15px] font-medium">{h.shopName}</span>
                          <span className="num block text-[13px] text-ink-3">
                            {h.number} · {h.retailerCode}
                          </span>
                        </span>
                        <span className="num shrink-0 font-semibold">{formatPaise(h.totalPaise)}</span>
                      </span>
                      {c && (
                        <span className="block">
                          <span className="block h-2 overflow-hidden rounded-full bg-sunken">
                            <span className="block h-full rounded-full bg-warn" style={{ width: `${used}%` }} />
                          </span>
                          <span className="num mt-1 flex justify-between gap-2 text-[13px]">
                            <span className="text-ink-2">{fill(d.creditUsed, { used: formatPaiseCompact(c.exposurePaise), limit: formatPaiseCompact(c.limitPaise) })}</span>
                            {over > 0 && <span className="font-semibold text-warn">{fill(d.overBy, { amount: formatPaise(over) })}</span>}
                          </span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="lg:col-span-2">
          <Panel title={`${d.dormantTitle} · ${o.dormant.length}`}>
            <p className="px-4 pb-2 text-[13px] text-ink-3">{d.dormantBody}</p>
            {o.dormant.length === 0 ? (
              <p className="px-4 py-6 text-[15px] text-ink-3">{d.dormantNone}</p>
            ) : (
              <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
                {o.dormant.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:border-t sm:border-line">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium">{r.shopName}</span>
                      <span className="block text-[13px] text-ink-3">
                        {r.code} · {r.area} · <span className="num">{formatIndianMobile(r.phone)}</span>
                      </span>
                    </span>
                    <span className="num shrink-0 text-[14px] font-medium text-warn">{r.daysSince === null ? d.neverOrdered : fill(d.daysAgo, { n: r.daysSince })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Panel({ title, href, seeAll, children }: { title: string; href?: string; seeAll?: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {href && (
          <Link href={href} className="text-[14px] font-medium text-accent hover:underline">
            {seeAll}
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}
