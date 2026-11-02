// Types for the pricing + scheme engine. Money is integer paise; percentages are
// integer basis points (1% = 100 bp). Dates are ISO "YYYY-MM-DD" in IST.

/** validFrom/validTo are inclusive ISO dates (IST). validTo null = open-ended. */
export type SchemeRule =
  | { id: string; type: "FREE_GOODS"; buyQty: number; freeQty: number; label: string; validFrom: string; validTo: string | null; active: boolean }
  | { id: string; type: "SLAB_PERCENT"; minQty: number; percentBp: number; label: string; validFrom: string; validTo: string | null; active: boolean };

export type PricingLineInput = {
  skuId: string;
  /** What the retailer asked for, in cases (A2). */
  cases: number;
  /** Pieces per case. */
  packSize: number;
  /** Dealer price per piece, EXCLUDING GST (A1). */
  pricePerPiecePaise: number;
  /** e.g. 1800 = 18% (placeholder rate, A6). */
  gstRateBp: number;
  stockCases: number;
  /** ALL scheme rows for this SKU; the engine decides which apply. */
  schemes: SchemeRule[];
};

export type PricingInput = {
  lines: PricingLineInput[];
  /** YYYY-MM-DD, IST. Use isoDateIST() to derive it from a Date. */
  asOf: string;
  credit: { limitPaise: number; outstandingPaise: number };
};

export type LineIssue = "INVALID_QUANTITY" | "OUT_OF_STOCK" | "EXCEEDS_STOCK" | "FREE_GOODS_SHORT" | "MULTIPLE_SCHEMES";

export type Nudge =
  | { kind: "FREE_GOODS"; addCases: number; freeCases: number } // "add 5 more cases to get 1 free"
  | { kind: "SLAB"; addCases: number; percentBp: number }; // "add 3 more cases for 3% off"

export type PricedLine = {
  skuId: string;
  cases: number;
  freeCases: number;
  /** packSize * pricePerPiecePaise */
  casePricePaise: number;
  /** cases * casePricePaise */
  grossPaise: number;
  discountPaise: number;
  /** gross - discount */
  taxablePaise: number;
  gstRateBp: number;
  gstPaise: number;
  /** taxable + gst */
  totalPaise: number;
  appliedScheme: { id: string; type: SchemeRule["type"]; label: string } | null;
  nudge: Nudge | null;
  issues: LineIssue[];
  /** false if INVALID_QUANTITY, OUT_OF_STOCK or EXCEEDS_STOCK */
  orderable: boolean;
  /** = stockCases (floored at 0), so the UI can offer "order 85 instead". */
  maxOrderableCases: number;
};

export type PricingTotals = {
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
  cases: number;
  freeCases: number;
};

export type CreditCheck = {
  limitPaise: number;
  outstandingPaise: number;
  availablePaise: number;
  wouldExceed: boolean;
  exceedsByPaise: number;
};

export type PricingResult = {
  lines: PricedLine[];
  totals: PricingTotals;
  credit: CreditCheck;
  /** At least one line AND every line orderable. */
  orderable: boolean;
};
