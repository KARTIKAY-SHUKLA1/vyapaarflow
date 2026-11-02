// Pricing + scheme engine. Pure and deterministic: no I/O, no clock. The caller
// passes `asOf` (derive it with isoDateIST). All money is integer paise and all
// percentages are integer basis points, so there is no floating-point money.

import type {
  CreditCheck,
  LineIssue,
  Nudge,
  PricedLine,
  PricingInput,
  PricingLineInput,
  PricingResult,
  PricingTotals,
  SchemeRule,
} from "./types";

const MIN_CASES = 1;
const MAX_CASES = 9999;
const IST_OFFSET_MS = 330 * 60 * 1000; // UTC+5:30, no DST

/** `bp` basis points of `amountPaise`, rounded half-up to the nearest paisa (non-negative inputs). */
export function bpOf(amountPaise: number, bp: number): number {
  return Math.floor((amountPaise * bp + 5000) / 10000);
}

/** The calendar date (YYYY-MM-DD) in Asia/Kolkata for an instant. The only Date-taking function. */
export function isoDateIST(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Schemes in force on `asOf`: active and within their inclusive validity dates. */
export function applicableSchemes(schemes: SchemeRule[], asOf: string): SchemeRule[] {
  return schemes.filter(
    (s) => s.active && s.validFrom <= asOf && (s.validTo === null || asOf <= s.validTo),
  );
}

function isValidQuantity(cases: number): boolean {
  return Number.isInteger(cases) && cases >= MIN_CASES && cases <= MAX_CASES;
}

type SchemeOutcome = {
  freeCases: number;
  discountPaise: number;
  applied: boolean;
  nudge: Nudge | null;
  freeShort: boolean;
};

const NO_BENEFIT: SchemeOutcome = { freeCases: 0, discountPaise: 0, applied: false, nudge: null, freeShort: false };

/** Total free cases earned at a quantity: repeats per full multiple (A3). */
function freeAt(cases: number, buyQty: number, freeQty: number): number {
  return Math.floor(cases / buyQty) * freeQty;
}

function applyFreeGoods(
  scheme: Extract<SchemeRule, { type: "FREE_GOODS" }>,
  cases: number,
  stockCases: number,
  orderable: boolean,
): SchemeOutcome {
  const { buyQty, freeQty } = scheme;
  // Guard against a malformed scheme row (e.g. buyQty 0) rather than dividing by zero.
  if (!Number.isInteger(buyQty) || buyQty < 1 || !Number.isInteger(freeQty) || freeQty < 1) return NO_BENEFIT;

  // A3: free cases need stock too; cap at what is left and flag the line.
  const earned = freeAt(cases, buyQty, freeQty);
  const freeCases = Math.min(earned, Math.max(0, stockCases - cases));
  const freeShort = freeCases < earned;

  let nudge: Nudge | null = null;
  const remainder = cases % buyQty;
  if (orderable && remainder !== 0) {
    const addCases = buyQty - remainder;
    const next = cases + addCases;
    // Only nudge if the bigger order and all its free cases can be fulfilled.
    if (next + freeAt(next, buyQty, freeQty) <= stockCases) {
      nudge = { kind: "FREE_GOODS", addCases, freeCases: freeQty };
    }
  }

  // appliedScheme only when it produced a benefit; otherwise the nudge carries it.
  return { freeCases, discountPaise: 0, applied: freeCases > 0, nudge, freeShort };
}

function applySlab(
  scheme: Extract<SchemeRule, { type: "SLAB_PERCENT" }>,
  cases: number,
  grossPaise: number,
  stockCases: number,
  orderable: boolean,
): SchemeOutcome {
  // A4: once the threshold is met the discount applies to the whole line value.
  if (cases >= scheme.minQty) {
    return { ...NO_BENEFIT, discountPaise: bpOf(grossPaise, scheme.percentBp), applied: true };
  }
  const nudge: Nudge | null =
    orderable && scheme.minQty <= stockCases
      ? { kind: "SLAB", addCases: scheme.minQty - cases, percentBp: scheme.percentBp }
      : null;
  return { ...NO_BENEFIT, nudge };
}

function priceLine(line: PricingLineInput, asOf: string): PricedLine {
  const issues: LineIssue[] = [];
  const casePricePaise = line.packSize * line.pricePerPiecePaise; // A1: price is per piece, excl. GST
  const maxOrderableCases = Math.max(0, line.stockCases);
  const outOfStock = line.stockCases <= 0;

  if (!isValidQuantity(line.cases)) {
    issues.push("INVALID_QUANTITY");
    if (outOfStock) issues.push("OUT_OF_STOCK");
    return {
      skuId: line.skuId,
      cases: Number.isFinite(line.cases) ? line.cases : 0, // for display only
      freeCases: 0,
      casePricePaise,
      grossPaise: 0,
      discountPaise: 0,
      taxablePaise: 0,
      gstRateBp: line.gstRateBp,
      gstPaise: 0,
      totalPaise: 0,
      appliedScheme: null,
      nudge: null,
      issues,
      orderable: false,
      maxOrderableCases,
    };
  }

  // Stock problems block ordering but never silently cut the quantity (A8).
  if (outOfStock) issues.push("OUT_OF_STOCK");
  else if (line.cases > line.stockCases) issues.push("EXCEEDS_STOCK");
  const orderable = issues.length === 0;

  const grossPaise = line.cases * casePricePaise;

  // A5: at most one scheme per SKU at a time. More than one in force is a desk
  // configuration problem: apply none and flag it; the line stays orderable.
  const schemes = applicableSchemes(line.schemes, asOf);
  let outcome = NO_BENEFIT;
  let scheme: SchemeRule | null = null;
  if (schemes.length > 1) {
    issues.push("MULTIPLE_SCHEMES");
  } else if (schemes.length === 1) {
    scheme = schemes[0];
    outcome =
      scheme.type === "FREE_GOODS"
        ? applyFreeGoods(scheme, line.cases, line.stockCases, orderable)
        : applySlab(scheme, line.cases, grossPaise, line.stockCases, orderable);
    if (outcome.freeShort) issues.push("FREE_GOODS_SHORT");
  }

  // A6: discount before GST; GST per line on the taxable value. Free cases are
  // zero-value and carry no GST here (A3) -- tax treatment of free goods is an
  // assumption to be confirmed by the client's accountant.
  const discountPaise = outcome.discountPaise;
  const taxablePaise = grossPaise - discountPaise;
  const gstPaise = bpOf(taxablePaise, line.gstRateBp);

  return {
    skuId: line.skuId,
    cases: line.cases,
    freeCases: outcome.freeCases,
    casePricePaise,
    grossPaise,
    discountPaise,
    taxablePaise,
    gstRateBp: line.gstRateBp,
    gstPaise,
    totalPaise: taxablePaise + gstPaise,
    appliedScheme: scheme && outcome.applied ? { id: scheme.id, type: scheme.type, label: scheme.label } : null,
    nudge: outcome.nudge,
    issues,
    orderable,
    maxOrderableCases,
  };
}

function sumTotals(lines: PricedLine[]): PricingTotals {
  const totals: PricingTotals = { grossPaise: 0, discountPaise: 0, taxablePaise: 0, gstPaise: 0, totalPaise: 0, cases: 0, freeCases: 0 };
  for (const l of lines) {
    totals.grossPaise += l.grossPaise;
    totals.discountPaise += l.discountPaise;
    totals.taxablePaise += l.taxablePaise;
    totals.gstPaise += l.gstPaise;
    totals.totalPaise += l.totalPaise;
    // Invalid-quantity lines are priced as zero everywhere, so they add no cases.
    if (!l.issues.includes("INVALID_QUANTITY")) totals.cases += l.cases;
    totals.freeCases += l.freeCases;
  }
  return totals;
}

/** A7: report only. The engine never rejects for credit; exceeding it means credit hold elsewhere. */
function checkCredit(credit: PricingInput["credit"], orderTotalPaise: number): CreditCheck {
  const { limitPaise, outstandingPaise } = credit;
  const after = outstandingPaise + orderTotalPaise;
  return {
    limitPaise,
    outstandingPaise,
    availablePaise: Math.max(0, limitPaise - outstandingPaise),
    wouldExceed: after > limitPaise,
    exceedsByPaise: Math.max(0, after - limitPaise),
  };
}

/** Price an order: stock checks, at most one scheme per line, GST, totals and a credit report. */
export function priceOrder(input: PricingInput): PricingResult {
  // Totals cover all lines, including non-orderable ones; `orderable` blocks placement.
  const lines = input.lines.map((line) => priceLine(line, input.asOf));
  const totals = sumTotals(lines);
  return {
    lines,
    totals,
    credit: checkCredit(input.credit, totals.totalPaise),
    orderable: lines.length > 0 && lines.every((l) => l.orderable),
  };
}
