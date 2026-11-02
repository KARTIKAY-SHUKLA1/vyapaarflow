import { normalizeTokens } from "./normalize";
import { parseSegment } from "./parse";

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
