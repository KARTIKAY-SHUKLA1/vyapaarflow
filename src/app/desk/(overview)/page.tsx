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
import { deskOverview, listDeskOrders } from "@/server/desk";

export const metadata: Metadata = { title: "Order desk" };

export default async function DeskHome() {
  const viewer = await requireViewer("desk");
  const { lang, t } = await getMessages();
  const d = t.desk;
  const [o, inbox, holds] = await Promise.all([deskOverview(db, viewer), listInbox(db, viewer, "todo"), listDeskOrders(db, viewer, { filter: "credit_hold", limit: 5 })]);
  if (!o) return null;

  const tiles = [
    { href: "/desk/inbox", label: d.stats.inbox, value: o.inbox, tone: o.inbox ? "accent" : undefined },
    { href: "/desk/orders?filter=placed", label: d.stats.placed, value: o.placed },
    { href: "/desk/orders?filter=credit_hold", label: d.stats.creditHold, value: o.creditHold, hint: o.creditHold ? formatPaiseCompact(o.creditHoldValue) : undefined, tone: o.creditHold ? "warn" : undefined },
    { href: "/desk/export", label: d.stats.approved, value: o.approved, hint: o.approved ? formatPaiseCompact(o.approvedValue) : undefined },
    { href: "/desk/orders?filter=all", label: d.stats.today, value: o.todayOrders, hint: formatPaiseCompact(o.todayValue) },
  ] as const;

  return (
    <>
      <PageHeader title={d.title} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((x) => (
          <Link key={x.label} href={x.href} className="rounded-lg border border-line bg-surface p-4 shadow-card hover:border-line-strong">
            <p className="text-[13px] font-medium text-ink-3">{x.label}</p>
            <p className={`num mt-1 text-2xl font-semibold ${"tone" in x && x.tone === "warn" ? "text-warn" : "tone" in x && x.tone === "accent" ? "text-accent" : ""}`}>{x.value}</p>
            {"hint" in x && x.hint && <p className="num mt-0.5 text-[13px] text-ink-2">{x.hint}</p>}
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
              {holds.map((h) => (
                <li key={h.id}>
                  <Link href={`/desk/orders/${h.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-sunken">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium">{h.shopName}</span>
                      <span className="block truncate text-[13px] text-warn">{h.holdReason}</span>
                    </span>
                    <span className="num shrink-0 font-semibold">{formatPaise(h.totalPaise)}</span>
                  </Link>
                </li>
              ))}
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
