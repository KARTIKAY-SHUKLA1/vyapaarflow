import { CASE_WORDS, PIECE_WORDS } from "./lexicon";
import { isInteger, isUnitWord } from "./normalize";
import type { Unit } from "./types";

export const MAX_QUANTITY = 9999;

export type ParsedSegment = {
  quantity: number | null;
  /** Every integer written in the segment; the validator only accepts a quantity from this list. */
  numbers: number[];
  /** "case"/"piece" only when the retailer actually wrote a unit word. */
  unit: Unit;
  /** Everything except the quantity and unit words: product words, size tokens, size words. */
  productWords: string[];
};

function pickQuantityIndex(tokens: string[]): number {
  // Prefer the number attached to a unit word ("5 peti", "peti 5"), else the first number.
  const beforeUnit = tokens.findIndex((t, i) => isInteger(t) && isUnitWord(tokens[i + 1] ?? ""));
  if (beforeUnit >= 0) return beforeUnit;
  const afterUnit = tokens.findIndex((t, i) => isInteger(t) && i > 0 && isUnitWord(tokens[i - 1]));
  if (afterUnit >= 0) return afterUnit;
  return tokens.findIndex(isInteger);
}

function readUnit(tokens: string[]): Unit {
  const saysCase = tokens.some((t) => CASE_WORDS.has(t));
  const saysPiece = tokens.some((t) => PIECE_WORDS.has(t));
  // Both or neither written: ask the desk, never guess (brief: "unclear units are asked").
  if (saysCase === saysPiece) return "unknown";
  return saysCase ? "case" : "piece";
}

/**
 * Parse one normalised segment. The unit is NEVER defaulted (PLAN A2); a missing
 * quantity stays null. The QTY_MISSING / UNIT_UNCLEAR issues are derived from
 * these values when the line is finalised (line.ts).
 */
export function parseSegment(tokens: string[]): ParsedSegment {
  const qtyIndex = pickQuantityIndex(tokens);
  const raw = qtyIndex >= 0 ? Number(tokens[qtyIndex]) : null;
  const quantity = raw !== null && raw >= 1 && raw <= MAX_QUANTITY ? raw : null;
  const unit = readUnit(tokens);
  return {
    quantity,
    numbers: tokens.filter(isInteger).map(Number),
    unit,
    productWords: tokens.filter((t) => !isInteger(t) && !isUnitWord(t)),
  };
}
