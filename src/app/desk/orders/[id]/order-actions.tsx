"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Card, Notice } from "@/components/ui";
import type { OrderStatus } from "@/db/schema";
import { fill, type Messages } from "@/lib/i18n/messages";
import { transitionAction } from "../../actions";

type Mode = null | "release" | "cancel";

/** Approve / release a credit hold / cancel. Release and cancel need a reason (kept in the audit log). */
export function OrderActions({ orderId, status, d }: { orderId: string; status: OrderStatus; d: Messages["desk"] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "danger" | "warn"; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (status === "exported" || status === "cancelled") return <p className="text-[14px] text-ink-3">{d.finalState}</p>;

  const run = (input: Record<string, string>) =>
    start(async () => {
      setMessage(null);
      try {
        const res = await transitionAction({ orderId, ...input });
        if (res.ok) {
          setMode(null);
          setReason("");
        } else if (res.error === "CONFLICT") {
          setMessage({ tone: "warn", text: fill(d.conflict, { status: res.current ? d.filters[res.current] : "?" }) });
        } else {
          setMessage({ tone: "danger", text: d.actionError });
        }
      } catch {
        setMessage({ tone: "danger", text: d.actionError });
      }
      router.refresh();
    });

  return (
    <Card className="space-y-3 p-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {mode ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run({ action: mode, reason });
          }}
          className="space-y-3"
        >
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-medium">{d.reasonLabel}</span>
            <textarea
              required
              minLength={3}
              maxLength={300}
              rows={2}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={mode === "release" ? d.reasonRelease : d.reasonCancel}
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant={mode === "cancel" ? "danger" : "primary"} disabled={pending || reason.trim().length < 3}>
              {pending ? d.working : mode === "cancel" ? d.cancelOrder : d.release}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode(null)} disabled={pending}>
              {d.back}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === "placed" && (
            <Button onClick={() => run({ action: "approve" })} disabled={pending}>
              {pending ? d.working : d.approve}
            </Button>
          )}
          {status === "credit_hold" && <Button onClick={() => setMode("release")}>{d.release}</Button>}
          <Button variant="danger" onClick={() => setMode("cancel")} disabled={pending}>
            {d.cancelOrder}
          </Button>
        </div>
      )}
    </Card>
  );
}
