import { hasInstructionWords } from "./lexicon";
import { normalizeTokens } from "./normalize";
import { parseSegment } from "./parse";
import type { CaptureIssue } from "./types";

/** De-duplicated, sorted product words: word order and repeats never create a second key. */
export function aliasKey(productWords: string[]): string {
  return [...new Set(productWords)].sort().join(" ");
}

/**
 * Key under which a desk correction is saved as a retailer alias (brief: "desk
 * corrections become aliases for that retailer") and under which it is looked up.
 *
 * Only the product words survive: quantity, unit words and filler are removed, so
 * "5 peti biscuit chhota" and "biscuit chhota 10 cases" share one alias.
 */
export function aliasPhrase(originalSegmentText: string): string {
  return aliasKey(parseSegment(normalizeTokens(originalSegmentText)).productWords);
}

/** Lines whose words must stay flagged on the next capture, so a correction is never learned. */
const NOT_ALIASABLE: ReadonlySet<string> = new Set<CaptureIssue>(["INSTRUCTION_TEXT", "TERMS_REQUESTED", "QTY_SEPARATED"]);

/**
 * Whether a desk correction of this line may be saved as a shop alias. Used by the server
 * when it saves aliases and by the review screen to say whether it will; one rule for both.
 * Allowed: plain item words, including pack descriptions such as "offer wala biscuit".
 * Refused: instruction text, requested terms, a separated quantity, or any phrase with an
 * instruction word or a percentage ("give 50% discount", "set price").
 */
export function aliasEligible(originalSegmentText: string, issues: readonly string[] | null | undefined): boolean {
  if ((issues ?? []).some((i) => NOT_ALIASABLE.has(i))) return false;
  const phrase = aliasPhrase(originalSegmentText);
  return phrase !== "" && !hasInstructionWords(phrase.split(" "));
}
