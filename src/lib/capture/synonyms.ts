/**
 * Product vocabulary: each concept lists the words (after normalisation) that
 * mean it. Catalogue SKUs and retailer words are both mapped onto these concepts,
 * so "washing powder", "surf" and "डिटर्जेंट पाउडर" all land on detergent + powder.
 * A word may belong to more than one concept ("chaipatti" = tea + leaf).
 */
export const CONCEPTS: Record<string, string[]> = {
  biscuit: ["biscuit", "biscuits", "cookie", "cookies"],
  glucose: ["glucose", "glucoz", "gluco"],
  cream: ["cream", "creame", "krim"],
  marie: ["marie", "mari", "mary"],
  rusk: ["rusk", "rask", "toast"],
  milk: ["milk", "doodh"],
  bhujia: ["bhujia", "sev"],
  aloo: ["aloo", "alu", "potato"],
  namkeen: ["namkeen", "snack", "snacks"],
  mixture: ["mixture", "mixchar", "khatta", "meetha", "mitha", "chiwda"],
  noodles: ["noodles", "maggi"],
  masala: ["masala"],
  detergent: ["detergent", "detergant", "surf", "sarf", "washing"],
  powder: ["powder", "pauder", "powdar"],
  bar: ["bar", "tikki", "tikiya", "bati"],
  dishwash: ["dishwash", "dishwasher", "dish", "bartan", "vim", "utensil"],
  gel: ["gel", "jel", "liquid"],
  soap: ["soap", "sabun", "bath", "bathing", "nahane"],
  neem: ["neem"],
  tea: ["tea", "chai", "chaipatti"],
  leaf: ["patti", "leaf", "leaves", "patta", "chaipatti"],
  dust: ["dust"],
};

/**
 * When a retailer writes only the generic word, the everyday variant is meant:
 * plain "biscuit" in kirana speech is the glucose biscuit, plain "chai" is tea
 * leaf, "surf" is powder. This is a small nudge, not a decision: the other
 * variants stay as alternatives and the line still goes to the desk if close.
 */
export const GENERIC_DEFAULTS: { generic: string; variants: string[]; preferred: string }[] = [
  { generic: "biscuit", variants: ["glucose", "cream", "marie", "rusk"], preferred: "glucose" },
  { generic: "tea", variants: ["leaf", "dust"], preferred: "leaf" },
  { generic: "detergent", variants: ["powder", "bar"], preferred: "powder" },
  { generic: "namkeen", variants: ["bhujia", "mixture", "noodles"], preferred: "bhujia" },
];

const WORD_TO_CONCEPTS = new Map<string, string[]>();
for (const [concept, words] of Object.entries(CONCEPTS)) {
  for (const word of words) WORD_TO_CONCEPTS.set(word, [...(WORD_TO_CONCEPTS.get(word) ?? []), concept]);
}

export function conceptsOf(word: string): string[] {
  return WORD_TO_CONCEPTS.get(word) ?? [];
}
