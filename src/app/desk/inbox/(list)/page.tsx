import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { SubmitButton } from "@/components/submit-button";
import { Badge, ButtonLink, cx, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { retailers } from "@/db/schema";
import { requireViewer } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/dates";
import { getMessages } from "@/lib/i18n/server";
import { formatIndianMobile } from "@/lib/phone";
import { INBOX_FILTERS, listInbox, type InboxFilter } from "@/server/capture";
import { runCaptureAction } from "../../actions";
import { PasteMessage } from "./paste-message";

export const metadata: Metadata = { title: "AI inbox" };

const STATUS_TONE = { new: "info", captured: "warn", converted: "accent", dismissed: "neutral" } as const;

export default async function Inbox({ searchParams }: PageProps<"/desk/inbox">) {
  const viewer = await requireViewer("desk");
  const { lang, t } = await getMessages();
  const d = t.desk;
  const sp = await searchParams;
  const filter: InboxFilter = INBOX_FILTERS.includes(sp.filter as InboxFilter) ? (sp.filter as InboxFilter) : "todo";
  const [messages, shops] = await Promise.all([
    listInbox(db, viewer, filter),
    db.select({ id: retailers.id, code: retailers.code, shopName: retailers.shopName, area: retailers.area }).from(retailers).orderBy(asc(retailers.shopName)),
  ]);

  return (
    <>
      <PageHeader title={d.inboxPageTitle} />
      <nav aria-label="Filter" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1">
        {INBOX_FILTERS.map((f) => (
          <Link
            key={f}
            href={`/desk/inbox?filter=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cx(
              "h-10 shrink-0 rounded-full border px-4 text-[14px] leading-[38px] font-medium",
              f === filter ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken",
            )}
          >
            {d.inboxFilters[f]}
          </Link>
        ))}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {messages.length === 0 ? (
          <EmptyState icon="inbox" title={d.inboxEmptyTitle} body={d.inboxEmptyBody} action={<ButtonLink href="#paste-body" variant="secondary">{d.pasteOne}</ButtonLink>} />
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <li key={m.id} className="rounded-lg border border-line bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-ink">{m.shopName ?? d.unknownSender}</span>
                    {m.retailerCode && <span>{m.retailerCode}</span>}
                    <span className="num">{formatIndianMobile(m.fromPhone)}</span>
                    <Badge tone="neutral">{d.channel[m.channel]}</Badge>
                  </span>
                  <span>{formatDateTime(m.receivedAt, lang)}</span>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-wrap">{m.body}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <Badge tone={STATUS_TONE[m.status]}>{d.inboxFilters[m.status]}</Badge>
                  {m.status === "new" ? (
                    <form action={runCaptureAction}>
                      <input type="hidden" name="messageId" value={m.id} />
                      <SubmitButton pendingLabel={d.running}>{d.runCapture}</SubmitButton>
                    </form>
                  ) : m.status === "converted" && m.orderId ? (
                    <ButtonLink href={`/desk/orders/${m.orderId}`} variant="secondary">
                      {d.open}
                    </ButtonLink>
                  ) : (
                    <ButtonLink href={`/desk/inbox/${m.id}`} variant={m.status === "captured" ? "primary" : "secondary"}>
                      {m.status === "captured" ? d.review : d.open}
                    </ButtonLink>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <PasteMessage d={d} shops={shops} />
      </div>
    </>
  );
}
