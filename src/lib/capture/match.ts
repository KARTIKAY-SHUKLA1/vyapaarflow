import { aliasKey, aliasPhrase } from "./alias";
import { LARGE_WORDS, SMALL_WORDS } from "./lexicon";
import { isSizeToken, normalizeTokens } from "./normalize";
import { conceptsOf, GENERIC_DEFAULTS } from "./synonyms";
import type { CatalogueItem, HistoryItem, MatchedBy, OrderUnit, RetailerAlias } from "./types";

/**
 * Deterministic SKU matcher. Order of evidence (PLAN §3 capture step 2):
 * retailer alias → product words + pack size → retailer's past orders as tie-breaker.
 * Scores are 0–100; the weights below are tuned on the seed catalogue and messages.
 */
const FULL_CONCEPT_MATCH = 85; // every product word understood and present in the SKU
const SIZE_MATCH = 15;
const SIZE_MISMATCH = 20;
const SIZE_WORD_MATCH = 10; // "chhota"/"bada" picked the smallest/largest pack
const GENERIC_DEFAULT_BONUS = 5;
const HISTORY_MAX_BONUS = 8; // enough to break a tie, never enough to beat a size match
const NEAR_TIE = 5;
const CLEAR_MARGIN = 15; // lead over the runner-up below which confidence is reduced
const MARGIN_WEIGHT = 2.5;
const UNKNOWN_WORD_PENALTY = 10;
const MAX_UNKNOWN_PENALISED = 3;
const ALIAS_CONFIDENCE = 95; // a desk-confirmed alias for this retailer

type SkuProfile = { item: CatalogueItem; concepts: Set<string>; size: number | null };

export type MatchContext = {
  profiles: SkuProfile[];
  byId: Map<string, CatalogueItem>;
  byCode: Map<string, CatalogueItem>;
  aliases: Map<string, RetailerAlias>;
  historyBonus: Map<string, number>;
  history: HistoryItem[];
};

export type Candidate = { skuId: string; score: number };

export type MatchResult = {
  /** Best first, scores 0–100. */
  ranked: Candidate[];
  confidence: number;
  matchedBy: MatchedBy;
  /** Unit stored with the matched alias, if any. */
  aliasUnit: OrderUnit | null;
};

/** Pack size in grams or millilitres. g and ml are compared as equal: retailers write "500 gm" for a 500 ml gel. */
function sizeValue(token: string): number {
  const m = /^(\d+(?:\.\d+)?)(g|kg|ml|l)$/.exec(token)!;
  const n = Number(m[1]);
  return m[2] === "kg" || m[2] === "l" ? n * 1000 : n;
}

function profile(item: CatalogueItem): SkuProfile {
  const nameTokens = normalizeTokens(item.name);
  const allTokens = normalizeTokens(`${item.name} ${item.nameHi} ${item.category}`);
  const size = nameTokens.find(isSizeToken);
  return { item, concepts: new Set(allTokens.flatMap(conceptsOf)), size: size ? sizeValue(size) : null };
}

export function buildMatchContext(
  catalogue: CatalogueItem[],
  aliases: RetailerAlias[],
  history: HistoryItem[],
): MatchContext {
  const byId = new Map(catalogue.map((c) => [c.id, c]));
  const maxTimes = Math.max(0, ...history.map((h) => h.timesOrdered));
  return {
    profiles: catalogue.map(profile),
    byId,
    byCode: new Map(catalogue.map((c) => [c.code, c])),
    // Aliases pointing at a SKU no longer in the catalogue, or with no product words, are ignored.
    aliases: new Map(
      aliases
        .map((a) => [aliasPhrase(a.phrase), a] as const)
        .filter(([key, a]) => key !== "" && byId.has(a.skuId)),
    ),
    historyBonus: new Map(
      history
        .filter((h) => maxTimes > 0 && h.timesOrdered > 0 && byId.has(h.skuId))
        .map((h) => [h.skuId, (HISTORY_MAX_BONUS * h.timesOrdered) / maxTimes]),
    ),
    history,
  };
}

function defaultBonus(segConcepts: Set<string>, skuConcepts: Set<string>): number {
  let bonus = 0;
  for (const rule of GENERIC_DEFAULTS) {
    const genericOnly = segConcepts.has(rule.generic) && !rule.variants.some((v) => segConcepts.has(v));
    if (genericOnly && skuConcepts.has(rule.preferred)) bonus += GENERIC_DEFAULT_BONUS;
  }
  return bonus;
}

type Scored = { profile: SkuProfile; share: number; score: number };

function byScoreThenCode(a: Scored, b: Scored): number {
  return b.score - a.score || a.profile.item.code.localeCompare(b.profile.item.code);
}

function scoreCatalogue(productWords: string[], ctx: MatchContext): Scored[] {
  const segConcepts = new Set(productWords.flatMap(conceptsOf));
  if (segConcepts.size === 0) return [];
  const segSizes = productWords.filter(isSizeToken).map(sizeValue);

  const scored: Scored[] = [];
  for (const p of ctx.profiles) {
    const matched = [...segConcepts].filter((c) => p.concepts.has(c)).length;
    if (matched === 0) continue;
    const share = matched / segConcepts.size;
    let score = FULL_CONCEPT_MATCH * share + defaultBonus(segConcepts, p.concepts);
    if (segSizes.length > 0 && p.size !== null) score += segSizes.includes(p.size) ? SIZE_MATCH : -SIZE_MISMATCH;
    scored.push({ profile: p, share, score });
  }

  // "chhota"/"bada": smallest/largest pack of the best-matching product family.
  const small = productWords.some((w) => SMALL_WORDS.has(w));
  const large = productWords.some((w) => LARGE_WORDS.has(w));
  if (small !== large && segSizes.length === 0) {
    const bestShare = Math.max(...scored.map((s) => s.share));
    const family = scored.filter((s) => s.share === bestShare && s.profile.size !== null);
    const sizes = family.map((s) => s.profile.size!);
    const target = small ? Math.min(...sizes) : Math.max(...sizes);
    for (const s of family) if (s.profile.size === target) s.score += SIZE_WORD_MATCH;
  }
  return scored.sort(byScoreThenCode);
}

function unknownWordCount(productWords: string[]): number {
  return productWords.filter(
    (w) => conceptsOf(w).length === 0 && !isSizeToken(w) && !SMALL_WORDS.has(w) && !LARGE_WORDS.has(w),
  ).length;
}

function toCandidates(scored: Scored[]): Candidate[] {
  return scored.map((s) => ({ skuId: s.profile.item.id, score: Math.round(Math.min(100, Math.max(0, s.score))) }));
}

/** Rank catalogue SKUs for one segment's product words. */
export function matchSegment(productWords: string[], ctx: MatchContext): MatchResult {
  const scored = scoreCatalogue(productWords, ctx);

  const alias = ctx.aliases.get(aliasKey(productWords));
  if (alias) {
    const rest = toCandidates(scored).filter((c) => c.skuId !== alias.skuId);
    return {
      ranked: [{ skuId: alias.skuId, score: 100 }, ...rest],
      confidence: ALIAS_CONFIDENCE,
      matchedBy: "alias",
      aliasUnit: alias.unit,
    };
  }
  if (scored.length === 0) return { ranked: [], confidence: 0, matchedBy: "none", aliasUnit: null };

  const preTop = scored[0];
  const preMargin = preTop.score - (scored[1]?.score ?? 0);
  for (const s of scored) s.score += ctx.historyBonus.get(s.profile.item.id) ?? 0;
  scored.sort(byScoreThenCode);
  const top = scored[0];

  const decidedByHistory =
    top !== preTop || (preMargin < NEAR_TIE && (ctx.historyBonus.get(top.profile.item.id) ?? 0) > 0);

  const margin = top.score - (scored[1]?.score ?? 0);
  const unknownPenalty = UNKNOWN_WORD_PENALTY * Math.min(MAX_UNKNOWN_PENALISED, unknownWordCount(productWords));
  const confidence = Math.min(100, top.score) - Math.max(0, CLEAR_MARGIN - margin) * MARGIN_WEIGHT - unknownPenalty;

  return {
    ranked: toCandidates(scored),
    confidence: Math.round(Math.min(100, Math.max(0, confidence))),
    matchedBy: decidedByHistory ? "history" : "fuzzy",
    aliasUnit: null,
  };
}
