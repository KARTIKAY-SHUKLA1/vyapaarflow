import { rulesLine, type AnalysedSegment } from "./line";
import {
  MODEL_TIMEOUT_MS,
  ModelBlockedError,
  ModelIncompleteError,
  ModelOutputError,
  ModelTimeoutError,
  type CaptureModel,
  type ModelRequest,
} from "./llm";
import { buildMatchContext, matchSegment, type MatchContext } from "./match";
import { normalizeTokens } from "./normalize";
import { parseSegment } from "./parse";
import { createCaptureModel } from "./providers";
import { splitMessage } from "./split";
import type { CaptureInput, CaptureResult } from "./types";
import { mergeModelOutput } from "./validate";

/** WhatsApp orders are short; capping input bounds cost and latency. */
export const MAX_MESSAGE_CHARS = 2000;
const MODEL_CANDIDATES_PER_SEGMENT = 6;
const MODEL_PAST_SKUS = 10;

function analyse(message: string, ctx: MatchContext): { segments: AnalysedSegment[]; ignoredText: string[] } {
  const { segments: raw, ignored } = splitMessage(message);
  const ignoredText = [...ignored];
  const segments: AnalysedSegment[] = [];
  for (const seg of raw) {
    const parsed = parseSegment(normalizeTokens(seg.text));
    // Delivery notes and chatter ("kal subah tak bhej dena") carry no item.
    if (parsed.productWords.length === 0 && parsed.quantity === null) {
      ignoredText.push(seg.text);
      continue;
    }
    segments.push({
      position: segments.length,
      originalText: seg.text,
      parsed,
      match: matchSegment(parsed.productWords, ctx),
    });
  }
  return { segments, ignoredText };
}

function modelRequest(message: string, segments: AnalysedSegment[], ctx: MatchContext): ModelRequest {
  const describe = (id: string) => {
    const item = ctx.byId.get(id)!;
    return { code: item.code, name: item.name };
  };
  return {
    message,
    segments: segments.map((s) => ({
      index: s.position,
      originalText: s.originalText,
      quantity: s.parsed.quantity,
      unit: s.parsed.unit,
      candidates: s.match.ranked.slice(0, MODEL_CANDIDATES_PER_SEGMENT).map((c) => describe(c.skuId)),
    })),
    pastSkus: [...ctx.history]
      .filter((h) => ctx.byId.has(h.skuId))
      .sort((a, b) => b.timesOrdered - a.timesOrdered)
      .slice(0, MODEL_PAST_SKUS)
      .map((h) => ({ ...describe(h.skuId), timesOrdered: h.timesOrdered })),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ModelTimeoutError(`no model answer in ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function fallbackReason(error: unknown): string {
  if (error instanceof ModelTimeoutError) return "model_timeout";
  // Subclasses first: a block or a cut-off answer is shown to the desk as such.
  if (error instanceof ModelBlockedError) return "model_blocked";
  if (error instanceof ModelIncompleteError) return "model_incomplete";
  if (error instanceof ModelOutputError) return "model_invalid_output";
  return "model_error";
}

export type CaptureOptions = {
  /** Omitted: use the provider configured in env (see providers.ts). null: rules only. */
  model?: CaptureModel | null;
  timeoutMs?: number;
};

/**
 * Turn a retailer's text message into DRAFT order lines for the desk to check.
 * Nothing here places an order (PLAN §2.3), and no price, stock or scheme is read
 * or produced (§2.1). If the model is missing or fails, the whole message falls
 * back to the deterministic rules engine and says so (§3: "never silently faked").
 */
export async function captureOrder(input: CaptureInput, opts: CaptureOptions = {}): Promise<CaptureResult> {
  const message = input.message.slice(0, MAX_MESSAGE_CHARS);
  const ctx = buildMatchContext(input.catalogue, input.aliases, input.history);
  const { segments, ignoredText } = analyse(message, ctx);
  const rules = (fallbackReason: string | null): CaptureResult => ({
    engine: "rules",
    model: null,
    fallbackReason,
    lines: segments.map((s) => rulesLine(s, ctx)),
    ignoredText,
  });

  if (segments.length === 0) return rules(message.trim() === "" ? "empty_message" : "no_items_found");
  const model = opts.model === undefined ? createCaptureModel() : opts.model;
  if (!model) return rules("no_api_key");

  try {
    const request = modelRequest(message, segments, ctx);
    const raw = await withTimeout(model.propose(request), opts.timeoutMs ?? MODEL_TIMEOUT_MS);
    const lines = mergeModelOutput(raw, segments, request, ctx);
    return { engine: "llm", model: model.name, fallbackReason: null, lines, ignoredText };
  } catch (error) {
    const reason = fallbackReason(error);
    // Never silent: the desk sees "rule-based" in the UI, and the server log keeps the cause.
    console.warn(`[capture] model fallback (${reason}):`, error instanceof Error ? error.message : error);
    return rules(reason);
  }
}
