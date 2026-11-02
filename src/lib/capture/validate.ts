import { z } from "zod";
import { finalizeLine, pickAlternatives, resolveUnit, rulesLine, type AnalysedSegment } from "./line";
import { ModelOutputError, type ModelRequest } from "./llm";
import type { MatchContext } from "./match";
import { MAX_QUANTITY } from "./parse";
import type { CaptureIssue, CaptureLine, MatchedBy } from "./types";

/**
 * The honesty layer (PLAN §2.2): model output is untrusted. Zod checks its shape
 * (unknown keys such as a "price" are stripped), then deterministic guards make
 * sure every SKU is real, every quantity was written by the retailer and no unit
 * is guessed.
 */

/** Confidence cap when the model and the rules disagree: the desk must look. */
const DISAGREEMENT_CAP = 70;

const ModelLineSchema = z.object({
  index: z.number().int(),
  sku_code: z.string().nullable(),
  alternative_codes: z.array(z.string()).default([]),
  quantity: z.number().nullable(),
  unit: z.enum(["case", "piece", "unknown"]),
  confidence: z.number().min(0).max(1),
  note: z.string().optional(),
});

const ModelOutputSchema = z.object({ lines: z.array(ModelLineSchema) });

export type ModelLine = z.infer<typeof ModelLineSchema>;

export function parseModelOutput(raw: unknown): ModelLine[] {
  const result = ModelOutputSchema.safeParse(raw);
  if (!result.success) throw new ModelOutputError(`model output failed validation: ${result.error.issues.length} issue(s)`);
  return result.data.lines;
}

/** A quantity counts only if it is a sane integer the retailer actually wrote; else the parsed one. */
function checkedQuantity(modelQty: number | null, seg: AnalysedSegment): number | null {
  const valid =
    modelQty !== null &&
    Number.isInteger(modelQty) &&
    modelQty >= 1 &&
    modelQty <= MAX_QUANTITY &&
    seg.parsed.numbers.includes(modelQty);
  return valid ? modelQty : seg.parsed.quantity;
}

function mergeLine(seg: AnalysedSegment, ml: ModelLine, offered: Set<string>, ctx: MatchContext): CaptureLine {
  const issues: CaptureIssue[] = [];
  const rulesTop = seg.match.ranked[0]?.skuId ?? null;
  const modelConfidence = ml.confidence * 100;
  // A code counts only if it is in the catalogue AND was offered for this segment.
  const idOf = (code: string) => (offered.has(code) ? ctx.byCode.get(code)?.id : undefined);
  const modelSku = ml.sku_code === null ? null : idOf(ml.sku_code);

  let skuId: string | null;
  let matchedBy: MatchedBy;
  let confidence: number;
  if (modelSku === undefined) {
    // Invented, unknown or not-offered code: discard it and keep the rules pick.
    issues.push("MODEL_INVALID_SKU");
    [skuId, matchedBy, confidence] = [rulesTop, seg.match.matchedBy, seg.match.confidence];
  } else if (seg.match.matchedBy === "alias") {
    // A desk-confirmed alias for this retailer outranks the model; disagreement is still shown.
    if (modelSku !== rulesTop) issues.push("MODEL_DISAGREES");
    [skuId, matchedBy, confidence] = [rulesTop, "alias", seg.match.confidence];
  } else if (modelSku === rulesTop) {
    [skuId, matchedBy, confidence] = [modelSku, "llm", (seg.match.confidence + modelConfidence) / 2];
  } else {
    issues.push("MODEL_DISAGREES");
    [skuId, matchedBy, confidence] = [modelSku, "llm", Math.min(modelConfidence, DISAGREEMENT_CAP)];
  }

  const altIds: string[] = [];
  for (const code of ml.alternative_codes) {
    const id = idOf(code);
    if (id) altIds.push(id);
    else issues.push("MODEL_INVALID_SKU"); // de-duplicated in finalizeLine
  }

  return finalizeLine({
    position: seg.position,
    originalText: seg.originalText,
    skuId,
    alternatives: pickAlternatives(skuId, altIds, seg.match, ctx),
    quantity: checkedQuantity(ml.quantity, seg),
    // The model's unit is never trusted: only words in the text or a saved alias decide it.
    unit: resolveUnit(seg.parsed, seg.match.aliasUnit),
    confidence,
    matchedBy,
    issues,
  });
}

/**
 * Merge validated model output with the deterministic analysis. Exactly one
 * line per segment: the model cannot add items, and a segment it skipped keeps
 * its rules line.
 */
export function mergeModelOutput(
  raw: unknown,
  segments: AnalysedSegment[],
  request: ModelRequest,
  ctx: MatchContext,
): CaptureLine[] {
  const byIndex = new Map<number, ModelLine>();
  for (const line of parseModelOutput(raw)) if (!byIndex.has(line.index)) byIndex.set(line.index, line);
  const pastCodes = request.pastSkus.map((p) => p.code);
  return segments.map((seg) => {
    const ml = byIndex.get(seg.position);
    if (!ml) return rulesLine(seg, ctx);
    const sent = request.segments.find((s) => s.index === seg.position)?.candidates ?? [];
    return mergeLine(seg, ml, new Set([...sent.map((c) => c.code), ...pastCodes]), ctx);
  });
}
