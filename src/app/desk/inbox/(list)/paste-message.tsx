"use client";

import { useActionState } from "react";
import { Button, Card } from "@/components/ui";
import type { Messages } from "@/lib/i18n/messages";
import { pasteMessageAction, type PasteState } from "../../actions";

type Shop = { id: string; code: string; shopName: string; area: string };

export function PasteMessage({ d, shops }: { d: Messages["desk"]; shops: Shop[] }) {
  const [state, action, pending] = useActionState<PasteState, FormData>(pasteMessageAction, {});
  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold">{d.pasteTitle}</h2>
      <p className="mt-0.5 text-[13px] text-ink-3">{d.pasteBody}</p>
      <form action={action} className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[14px] font-medium">{d.pasteShop}</span>
          <select name="retailerId" required defaultValue="" className="h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] outline-none focus:border-accent">
            <option value="" disabled>
              {d.pasteShopPick}
            </option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shopName} · {s.code} · {s.area}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[14px] font-medium">{d.pasteText}</span>
          <textarea
            id="paste-body"
            name="body"
            required
            minLength={2}
            maxLength={2000}
            rows={4}
            placeholder={d.pastePlaceholder}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent"
          />
        </label>
        {state.error && (
          <p role="alert" className="text-[14px] text-danger">
            {d.pasteError}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? d.running : d.pasteSubmit}
        </Button>
      </form>
    </Card>
  );
}
