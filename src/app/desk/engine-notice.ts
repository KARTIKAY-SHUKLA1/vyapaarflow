import { fill, type Messages } from "@/lib/i18n/messages";

/** Fallbacks the desk can usefully retry now ("Re-read with AI"); config/content issues are not. */
const RETRYABLE = new Set(["model_timeout", "model_paused", "model_error", "model_incomplete"]);

/**
 * What the review screen says about how a message was read. Always explicit:
 * either the AI model that read it, or that rule-based matching was used and why.
 */
export function engineNotice(
  d: Messages["desk"],
  capture: { engine: "llm" | "rules"; model: string | null; fallbackReason: string | null },
): { tone: "info" | "warn"; text: string; hint: string | null } {
  if (capture.engine === "llm") return { tone: "info", text: fill(d.engineLlm, { model: capture.model ?? "AI" }), hint: null };
  const reason = capture.fallbackReason ?? "";
  const text = fill(d.engineRules, { reason: (d.fallback as Record<string, string>)[reason] ?? reason });
  return { tone: "warn", text, hint: RETRYABLE.has(reason) ? d.fallbackHint : null };
}
