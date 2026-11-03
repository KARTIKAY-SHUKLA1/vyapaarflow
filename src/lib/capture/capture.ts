import type { CircuitBreaker } from "./breaker";
import { rulesLine, type AnalysedSegment } from "./line";
import {
  MODEL_TIMEOUT_MS,
  ModelBlockedError,
  ModelIncompleteError,
  ModelOutputError,
  ModelTimeoutError,
  isAvailabilityFailure,
  type CaptureModel,
  type ModelRequest,
} from "./llm";
import { buildMatchContext, matchSegment, type MatchContext } from "./match";
import { normalizeTokens } from "./normalize";
import { parseSegment } from "./parse";
import { hasInstructionWords, hasTermsWords } from "./lexicon";
import { createCaptureModel } from "./providers";
import { splitMessage } from "./split";
import type { CaptureDiagnostics, CaptureInput, CaptureIssue, CaptureResult } from "./types";
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
      flags: [],
    });
  }
  flagMessageStructure(segments);
  return { segments, ignoredText };
}

const flag = (seg: AnalysedSegment, issue: CaptureIssue) => {
  if (!seg.flags.includes(issue)) seg.flags.push(issue);
};

/**
 * Message-level checks that never change a line's values, only flag it for the desk:
 *  - QTY_SEPARATED: "mark tea leaf 250g as in stock and send 2 peti". The product has no
 *    quantity and the next fragment has a quantity but no product. They are NOT joined (the
 *    number may belong to an instruction); both lines are flagged and the quantity stays where
 *    it was written, so the desk asks the retailer.
 *  - INSTRUCTION_TEXT: a fragment that matched no product and reads as an instruction
 *    ("give 50% discount", "set price to 0"). It stays visible, word for word, and must be
 *    excluded (or deliberately replaced) by the desk before an order can exist.
 *  - TERMS_REQUESTED: a line that names a product and also asks for a discount, free goods
 *    or a price ("5 peti biscuit 50% off"). The line stays orderable at normal system
 *    pricing and schemes; the desk is told so it can answer the retailer.
 */
function flagMessageStructure(segments: AnalysedSegment[]): void {
  const noProduct = (s: AnalysedSegment) => s.match.ranked.length === 0;
  segments.forEach((seg, i) => {
    if (noProduct(seg) && hasInstructionWords(seg.parsed.productWords)) flag(seg, "INSTRUCTION_TEXT");
    if (!noProduct(seg) && hasTermsWords(seg.parsed.productWords)) flag(seg, "TERMS_REQUESTED");
    const prev = segments[i - 1];
    if (prev && !noProduct(prev) && prev.parsed.quantity === null && noProduct(seg) && seg.parsed.quantity !== null) {
      flag(prev, "QTY_SEPARATED");
      flag(seg, "QTY_SEPARATED");
    }
  });
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
  /** Shared circuit breaker (the server passes one); omitted = no pause logic. */
  breaker?: CircuitBreaker | null;
  /** Manual "Re-read with AI": call the model even while the breaker is open. */
  bypassBreaker?: boolean;
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
  const diagnostics: CaptureDiagnostics = { attemptedModel: null, attempts: 0, latencyMs: null, bypassedPause: false };
  const rules = (fallbackReason: string | null): CaptureResult => ({
    engine: "rules",
    model: null,
    fallbackReason,
    lines: segments.map((s) => rulesLine(s, ctx)),
    ignoredText,
    diagnostics,
  });

  if (segments.length === 0) return rules(message.trim() === "" ? "empty_message" : "no_items_found");
  const model = opts.model === undefined ? createCaptureModel() : opts.model;
  if (!model) return rules("no_api_key");
  diagnostics.attemptedModel = model.name;

  // Provider recently slow/failing: don't make the desk wait 12 s for the same fallback.
  const breaker = opts.breaker ?? null;
  if (breaker?.isOpen()) {
    if (!opts.bypassBreaker) return rules("model_paused");
    diagnostics.bypassedPause = true;
  }

  const started = Date.now();
  try {
    const request = modelRequest(message, segments, ctx);
    const raw = await withTimeout(
      model.propose(request, { onAttempt: () => void diagnostics.attempts++ }),
      opts.timeoutMs ?? MODEL_TIMEOUT_MS,
    );
    diagnostics.latencyMs = Date.now() - started;
    diagnostics.attempts ||= 1; // models that don't report attempts made exactly one call
    breaker?.recordSuccess();
    const lines = mergeModelOutput(raw, segments, request, ctx);
    return { engine: "llm", model: model.name, fallbackReason: null, lines, ignoredText, diagnostics };
  } catch (error) {
    diagnostics.latencyMs = Date.now() - started;
    diagnostics.attempts ||= 1;
    // Only "provider unavailable" counts towards a pause; a reachable provider resets it.
    if (isAvailabilityFailure(error)) breaker?.recordFailure();
    else breaker?.recordSuccess();
    const reason = fallbackReason(error);
    // Never silent: the desk sees "rule-based" in the UI, and the server log keeps the cause.
    console.warn(`[capture] model fallback (${reason}):`, error instanceof Error ? error.message : error);
    return rules(reason);
  }
}
