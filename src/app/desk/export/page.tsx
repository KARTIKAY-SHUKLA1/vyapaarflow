import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/dates";
import { fill } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { listExportable, listExports } from "@/server/tally";
import { ExportPicker } from "./export-picker";

export const metadata: Metadata = { title: "Tally export" };

export default async function ExportPage() {
  const viewer = await requireViewer("desk");
  const { lang, t } = await getMessages();
  const d = t.desk;
  const [ready, history] = await Promise.all([listExportable(db, viewer), listExports(db, viewer)]);

  return (
    <>
      <PageHeader title={d.exportTitle} subtitle={d.exportBody} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <ExportPicker
          d={d}
          orders={ready.map((o) => ({ ...o, createdLabel: formatDateTime(o.createdAt, lang), sourceLabel: d.source[o.source] }))}
        />
        <Card className="p-4">
          <h2 className="mb-2 text-[15px] font-semibold">{d.historyTitle}</h2>
          {history.length === 0 ? (
            <p className="py-4 text-[15px] text-ink-3">{d.historyNone}</p>
          ) : (
            <ul className="divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{h.fileName}</span>
                    <span className="block text-[13px] text-ink-3">
                      {formatDateTime(h.createdAt, lang)} · {fill(d.ordersCount, { n: h.orderIds.length })} · {h.by}
                    </span>
                  </span>
                  {/* Plain link: the route handler checks the desk role and streams the CSV. */}
                  <a href={`/desk/export/${h.id}`} className="shrink-0 rounded-md border border-line-strong px-3 py-2 text-[14px] font-medium hover:bg-sunken">
                    {d.download}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
