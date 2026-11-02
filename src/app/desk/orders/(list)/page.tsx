import type { Metadata } from "next";
import Link from "next/link";
import { Button, cx, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/dates";
import { fill } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { formatPaise } from "@/lib/money";
import { listDeskOrders, QUEUE_FILTERS, type QueueFilter } from "@/server/desk";
import { DeskStatusBadge } from "../../labels";

export const metadata: Metadata = { title: "Orders" };

export default async function DeskOrders({ searchParams }: PageProps<"/desk/orders">) {
  const viewer = await requireViewer("desk");
  const { lang, t } = await getMessages();
  const sp = await searchParams;
  const filter: QueueFilter = QUEUE_FILTERS.includes(sp.filter as QueueFilter) ? (sp.filter as QueueFilter) : "open";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60) : "";
  const rows = await listDeskOrders(db, viewer, { filter, q });
  const d = t.desk;

  return (
    <>
      <PageHeader title={d.ordersTitle} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {QUEUE_FILTERS.map((f) => (
            <Link
              key={f}
              href={`/desk/orders?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              aria-current={f === filter ? "page" : undefined}
              className={cx(
                "h-10 shrink-0 rounded-full border px-4 text-[14px] leading-[38px] font-medium",
                f === filter ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken",
              )}
            >
              {d.filters[f]}
            </Link>
          ))}
        </nav>
        <form className="flex gap-2" action="/desk/orders">
          <input type="hidden" name="filter" value={filter} />
          <input
            name="q"
            defaultValue={q}
            placeholder={d.searchOrders}
            aria-label={d.searchOrders}
            className="h-11 w-56 rounded-md border border-line-strong bg-surface px-3 text-[15px] outline-none focus:border-accent"
          />
          <Button type="submit" variant="secondary">
            {d.search}
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={d.noOrdersTitle} body={d.noOrdersBody} />
      ) : (
        <>
        {/* Phones: one card per order, everything readable without sideways scrolling. */}
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card md:hidden">
          {rows.map((o) => (
            <li key={o.id}>
              <Link href={`/desk/orders/${o.id}`} className="block px-4 py-3 hover:bg-sunken">
                <p className="flex items-center justify-between gap-2">
                  <span className="num font-semibold text-accent">{o.number}</span>
                  <DeskStatusBadge d={d} status={o.status} />
                </p>
                <p className="mt-0.5 flex items-center justify-between gap-2 text-[15px]">
                  <span className="min-w-0 truncate font-medium">{o.shopName}</span>
                  <span className="num shrink-0 font-semibold">{formatPaise(o.totalPaise)}</span>
                </p>
                <p className="text-[13px] text-ink-3">
                  {formatDateTime(o.createdAt, lang)} · {fill(t.shop.itemsCases, { items: o.lineCount, cases: o.cases })} · {d.source[o.source]}
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface shadow-card md:block">
          <table className="w-full min-w-[720px] text-left text-[15px]">
            <thead className="border-b border-line text-[13px] text-ink-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">{d.colOrder}</th>
                <th className="px-4 py-2.5 font-medium">{d.colShop}</th>
                <th className="px-4 py-2.5 font-medium">{d.colItems}</th>
                <th className="px-4 py-2.5 font-medium">{d.colSource}</th>
                <th className="px-4 py-2.5 font-medium">{d.colStatus}</th>
                <th className="px-4 py-2.5 text-right font-medium">{d.colTotal}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-sunken">
                  <td className="px-4 py-3">
                    <Link href={`/desk/orders/${o.id}`} className="num font-semibold text-accent hover:underline">
                      {o.number}
                    </Link>
                    <p className="text-[13px] text-ink-3">{formatDateTime(o.createdAt, lang)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{o.shopName}</p>
                    <p className="text-[13px] text-ink-3">
                      {o.retailerCode} · {o.area}
                    </p>
                  </td>
                  <td className="num px-4 py-3 text-ink-2">
                    {o.lineCount} · {o.cases} {t.shop.casesLabel.toLowerCase()}
                  </td>
                  <td className="px-4 py-3 text-ink-2">{d.source[o.source]}</td>
                  <td className="px-4 py-3">
                    <DeskStatusBadge d={d} status={o.status} />
                  </td>
                  <td className="num px-4 py-3 text-right font-semibold">{formatPaise(o.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  );
}
