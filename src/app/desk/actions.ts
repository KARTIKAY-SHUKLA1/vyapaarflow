"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { isoDateIST } from "@/lib/pricing";
import {
  addManualMessage,
  confirmCapture,
  dismissMessage,
  linkMessageToRetailer,
  priceForDesk,
  runCapture,
  type ConfirmResult,
} from "@/server/capture";
import { transitionOrder, type TransitionResult } from "@/server/desk";
import { createExport, type ExportResult } from "@/server/tally";
import type { CartPricing } from "@/server/pricing";

// Every action re-checks the desk role on the server (requireViewer), and the
// service functions check it again: neither the UI nor the proxy is the control.

export async function transitionAction(input: unknown): Promise<TransitionResult> {
  const viewer = await requireViewer("desk");
  const res = await transitionOrder(db, viewer, input);
  revalidatePath("/desk", "layout");
  return res;
}

export async function runCaptureAction(formData: FormData) {
  const viewer = await requireViewer("desk");
  const messageId = String(formData.get("messageId") ?? "");
  const res = await runCapture(db, viewer, messageId, { force: formData.get("force") === "1" });
  revalidatePath("/desk", "layout");
  if (!res.ok && res.error === "NOT_FOUND") redirect("/desk/inbox");
  redirect(`/desk/inbox/${messageId}`);
}

export async function linkAndRerunAction(formData: FormData) {
  const viewer = await requireViewer("desk");
  const messageId = String(formData.get("messageId") ?? "");
  const retailerId = String(formData.get("retailerId") ?? "");
  const linked = await linkMessageToRetailer(db, viewer, messageId, retailerId);
  if (linked.ok) await runCapture(db, viewer, messageId, { force: true });
  revalidatePath("/desk", "layout");
  redirect(`/desk/inbox/${messageId}`);
}

export type PasteState = { error?: boolean };

export async function pasteMessageAction(_prev: PasteState, formData: FormData): Promise<PasteState> {
  const viewer = await requireViewer("desk");
  const res = await addManualMessage(db, viewer, { retailerId: formData.get("retailerId"), body: formData.get("body") });
  if (!res.ok) return { error: true };
  await runCapture(db, viewer, res.messageId);
  revalidatePath("/desk", "layout");
  redirect(`/desk/inbox/${res.messageId}`);
}

export async function dismissAction(input: { messageId: string; reason: string }) {
  const viewer = await requireViewer("desk");
  const res = await dismissMessage(db, viewer, String(input.messageId), String(input.reason ?? ""));
  revalidatePath("/desk", "layout");
  return res;
}

export async function priceForDeskAction(retailerId: string, lines: unknown): Promise<{ ok: true; pricing: CartPricing } | { ok: false }> {
  const viewer = await requireViewer("desk");
  const pricing = await priceForDesk(db, viewer, String(retailerId), lines, isoDateIST(new Date()));
  return pricing ? { ok: true, pricing } : { ok: false };
}

export async function confirmCaptureAction(input: unknown): Promise<ConfirmResult> {
  const viewer = await requireViewer("desk");
  const res = await confirmCapture(db, viewer, input);
  if (res.ok) revalidatePath("/desk", "layout");
  return res;
}

export async function exportAction(input: unknown): Promise<ExportResult> {
  const viewer = await requireViewer("desk");
  const res = await createExport(db, viewer, input);
  if (res.ok) revalidatePath("/desk", "layout");
  return res;
}
