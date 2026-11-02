import type { SchemeRule } from "./types";

type Describable =
  | Pick<Extract<SchemeRule, { type: "FREE_GOODS" }>, "type" | "buyQty" | "freeQty">
  | Pick<Extract<SchemeRule, { type: "SLAB_PERCENT" }>, "type" | "minQty" | "percentBp">;

const pct = (bp: number) => `${Number((bp / 100).toFixed(2))}%`;

/**
 * Human text for a scheme, generated from its rule so the words can never
 * disagree with the maths. English matches the labels stored for Tally
 * ("Buy 10 cases get 1 free", "3% off 5 or more cases").
 */
export function describeScheme(rule: Describable, lang: "en" | "hi"): string {
  if (rule.type === "FREE_GOODS") {
    if (lang === "hi") return `${rule.buyQty} केस पर ${rule.freeQty} केस मुफ़्त`;
    return `Buy ${rule.buyQty} ${rule.buyQty === 1 ? "case" : "cases"} get ${rule.freeQty} free`;
  }
  if (lang === "hi") return `${rule.minQty} या ज़्यादा केस पर ${pct(rule.percentBp)} छूट`;
  return `${pct(rule.percentBp)} off ${rule.minQty} or more cases`;
}
