/**
 * Public contract of the order-capture engine.
 *
 * Hard rule (PLAN §2.1): the engine never sees or emits prices, stock, schemes,
 * discounts or totals. It only proposes {sku, quantity, unit, confidence} per line;
 * a person confirms before anything becomes an order (PLAN §2.3).
 */

export type Unit = "case" | "piece" | "unknown";
export type OrderUnit = Exclude<Unit, "unknown">;

export type CatalogueItem = { id: string; code: string; name: string; nameHi: string; category: string; packSize: number };
export type RetailerAlias = { phrase: string; skuId: string; unit: OrderUnit | null };
export type HistoryItem = { skuId: string; timesOrdered: number; lastCases: number };
export type CaptureInput = { message: string; catalogue: CatalogueItem[]; aliases: RetailerAlias[]; history: HistoryItem[] };

export type CaptureIssue =
  | "NO_MATCH"
  | "UNIT_UNCLEAR"
  | "QTY_MISSING"
  | "LOW_CONFIDENCE"
  | "MODEL_DISAGREES"
  | "MODEL_INVALID_SKU"
  /** Another SKU with the same category and pack size fits the words as well (e.g. "biscuit chhota"). */
  | "SIZE_SIBLING"
  /** A product with no quantity is followed by a quantity with no product: never joined; the desk asks. */
  | "QTY_SEPARATED"
  /** A fragment with no product that reads as an instruction (discount, price, stock): exclude it. */
  | "INSTRUCTION_TEXT"
  /** A line with a product that also asks for a discount, free goods or a price: normal pricing applies. */
  | "TERMS_REQUESTED";

export type MatchedBy = "alias" | "history" | "llm" | "fuzzy" | "none";
export type ConfidenceBand = "high" | "medium" | "low";

export type CaptureLine = {
  position: number;
  /** Exact words from the message, so the desk can see what the retailer wrote. */
  originalText: string;
  skuId: string | null;
  /** Up to 2 skuIds, never includes skuId. */
  alternatives: string[];
  quantity: number | null;
  unit: Unit;
  /** 0–100 integer. */
  confidence: number;
  /** ≥80 high / 50–79 medium / <50 low. */
  confidenceBand: ConfidenceBand;
  matchedBy: MatchedBy;
  issues: CaptureIssue[];
  /** True if any issue, band is not high, or the unit is pieces (orders are in cases). */
  needsReview: boolean;
};

export type CaptureResult = {
  engine: "llm" | "rules";
  model: string | null;
  fallbackReason: string | null;
  lines: CaptureLine[];
  /** Message fragments that carried no item (greetings, delivery notes). */
  ignoredText: string[];
  /** Metadata only (no prompt, answer or key), for the audit log and incident diagnosis. */
  diagnostics: CaptureDiagnostics;
};

export type CaptureDiagnostics = {
  /** Model that was (or would have been) called; null when none is configured. */
  attemptedModel: string | null;
  /** HTTP attempts made (0 when the model was not called). */
  attempts: number;
  /** Wall time spent on the model call, ms; null when it was not called. */
  latencyMs: number | null;
  /** The automatic pause was skipped because the desk asked for a manual re-read. */
  bypassedPause: boolean;
};
