import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { Icon } from "@/components/icons";
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
/** Left stripe colour per status, so the list can be scanned without reading badges. */
const STRIPE = { new: "border-l-info", captured: "border-l-warn", converted: "border-l-accent", dismissed: "border-l-line-strong" } as const;

/** "Sharma Kirana Store" → "SK" (shop avatar). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[\p{L}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export default async function Inbox({ searchParams }: PageProps<"/desk/inbox">) {
  const viewer = await requireViewer("desk");
  const { lang, t } = await getMessages();
  const d = t.desk;
  const sp = await searchParams;
  const filter: InboxFilter = INBOX_FILTERS.includes(sp.filter as InboxFilter) ? (sp.filter as InboxFilter) : "todo";
  const [messages, all, shops] = await Promise.all([
    listInbox(db, viewer, filter),
    listInbox(db, viewer, "all"),
    db.select({ id: retailers.id, code: retailers.code, shopName: retailers.shopName, area: retailers.area }).from(retailers).orderBy(asc(retailers.shopName)),
  ]);
  const count = (f: InboxFilter) =>
    f === "all" ? all.length : f === "todo" ? all.filter((m) => m.status === "new" || m.status === "captured").length : all.filter((m) => m.status === f).length;

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
            {d.inboxFilters[f]} <span className={cx("num ml-1", f === filter ? "opacity-90" : "text-ink-3")}>{count(f)}</span>
          </Link>
        ))}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {messages.length === 0 ? (
          <EmptyState icon="inbox" title={d.inboxEmptyTitle} body={d.inboxEmptyBody} action={<ButtonLink href="#paste-body" variant="secondary">{d.pasteOne}</ButtonLink>} />
        ) : (
          <ul className="min-w-0 space-y-3">
            {messages.map((m) => (
              <li key={m.id} className={cx("rounded-lg border border-l-4 border-line bg-surface p-4 shadow-card", STRIPE[m.status])}>
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={cx(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold",
                      m.shopName ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn",
                    )}
                  >
                    {m.shopName ? initials(m.shopName) : <Icon name="user" size={18} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-[15px] font-semibold">{m.shopName ?? d.unknownSender}</p>
                      <Badge tone={STATUS_TONE[m.status]} className="shrink-0">
                        {d.inboxFilters[m.status]}
                      </Badge>
                    </div>
                    <p className="num truncate text-[13px] text-ink-3">
                      {[m.retailerCode ?? formatIndianMobile(m.fromPhone), d.channel[m.channel], formatDateTime(m.receivedAt, lang)].join(" · ")}
                    </p>
                  </div>
                </div>
                {!m.shopName && <p className="mt-2 text-[14px] text-warn">{d.unknownSenderHint}</p>}
                <p className="mt-2.5 rounded-md bg-sunken px-3 py-2 text-[15px] leading-relaxed whitespace-pre-wrap">{m.body}</p>
                <div className="mt-3 flex items-center justify-end gap-2">
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
