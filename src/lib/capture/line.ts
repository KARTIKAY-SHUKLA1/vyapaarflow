import { SIZE_SIBLING_CAP, type MatchContext, type MatchResult } from "./match";
import type { ParsedSegment } from "./parse";
import type { CaptureIssue, CaptureLine, ConfidenceBand, OrderUnit, Unit } from "./types";

/** One message segment after parsing and deterministic matching. */
export type AnalysedSegment = {
  position: number;
  originalText: string;
  parsed: ParsedSegment;
  match: MatchResult;
  /** Message-level issues found when the segment was analysed (QTY_SEPARATED, INSTRUCTION_TEXT, TERMS_REQUESTED). */
  flags: CaptureIssue[];
};

const MAX_ALTERNATIVES = 2;
const ISSUE_ORDER: CaptureIssue[] = [
  "NO_MATCH",
  "INSTRUCTION_TEXT",
  "MODEL_INVALID_SKU",
  "MODEL_DISAGREES",
  "SIZE_SIBLING",
  "TERMS_REQUESTED",
  "QTY_SEPARATED",
  "QTY_MISSING",
  "UNIT_UNCLEAR",
  "LOW_CONFIDENCE",
];

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 80) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

/**
 * A unit is "case"/"piece" only when the retailer wrote a unit word, or the
 * desk saved one on the alias. Otherwise it is asked, never guessed (brief, PLAN A2).
 */
export function resolveUnit(parsed: ParsedSegment, aliasUnit: OrderUnit | null): Unit {
  if (parsed.unit !== "unknown") return parsed.unit;
  return aliasUnit ?? "unknown";
}

/**
 * Up to two distinct alternatives (brief: "two alternative SKUs"), never the
 * chosen SKU: preferred ids first, then the deterministic ranking, then other
 * SKUs from the chosen SKU's category so the desk always has a near neighbour.
 */
export function pickAlternatives(
  chosen: string | null,
  preferred: string[],
  match: MatchResult,
  ctx: MatchContext,
): string[] {
  const category = chosen ? ctx.byId.get(chosen)?.category : undefined;
  const sameCategory = category
    ? ctx.profiles.filter((p) => p.item.category === category).map((p) => p.item.id)
    : [];
  const pool = [...preferred, ...match.ranked.map((c) => c.skuId), ...sameCategory];
  return [...new Set(pool)].filter((id) => id !== chosen && ctx.byId.has(id)).slice(0, MAX_ALTERNATIVES);
}

type LineDraft = Omit<CaptureLine, "confidenceBand" | "needsReview">;

/**
 * Derive value-based issues, the band and the review flag; keep model issues passed in.
 * A same-size sibling caps confidence below "high"; pieces always need review because
 * orders are taken in cases.
 */
export function finalizeLine(draft: LineDraft): CaptureLine {
  const capped = draft.issues.includes("SIZE_SIBLING") ? Math.min(draft.confidence, SIZE_SIBLING_CAP) : draft.confidence;
  const confidence = draft.skuId === null ? 0 : Math.round(Math.min(100, Math.max(0, capped)));
  const band = confidenceBand(confidence);
  const issues = new Set(draft.issues);
  if (draft.skuId === null) issues.add("NO_MATCH");
  if (draft.quantity === null) issues.add("QTY_MISSING");
  if (draft.unit === "unknown") issues.add("UNIT_UNCLEAR");
  if (band === "low") issues.add("LOW_CONFIDENCE");
  const ordered = ISSUE_ORDER.filter((i) => issues.has(i));
  return {
    ...draft,
    confidence,
    confidenceBand: band,
    matchedBy: draft.skuId === null ? "none" : draft.matchedBy,
    issues: ordered,
    needsReview: ordered.length > 0 || band !== "high" || draft.unit === "piece",
  };
}

/** SIZE_SIBLING when the chosen SKU is one of the equally-worded same-size siblings. */
export function siblingIssues(skuId: string | null, match: MatchResult): CaptureIssue[] {
  return skuId !== null && match.sizeSiblings.includes(skuId) ? ["SIZE_SIBLING"] : [];
}

/** The deterministic (rule-based) line for a segment. */
export function rulesLine(seg: AnalysedSegment, ctx: MatchContext): CaptureLine {
  const skuId = seg.match.ranked[0]?.skuId ?? null;
  return finalizeLine({
    position: seg.position,
    originalText: seg.originalText,
    skuId,
    alternatives: pickAlternatives(skuId, [], seg.match, ctx),
    quantity: seg.parsed.quantity,
    unit: resolveUnit(seg.parsed, seg.match.aliasUnit),
    confidence: seg.match.confidence,
    matchedBy: seg.match.matchedBy,
    issues: [...seg.flags, ...siblingIssues(skuId, seg.match)],
  });
}
