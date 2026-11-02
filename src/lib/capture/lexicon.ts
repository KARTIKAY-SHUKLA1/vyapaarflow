/**
 * Word lists used by the normaliser and parser. Kept as plain data so the desk
 * team (or a reviewer) can extend them without touching logic.
 * All entries are lowercase Latin, as produced by the normaliser.
 */

/** Devanagari words retailers commonly type, mapped to the Latin spelling we match on. */
export const DEVANAGARI_WORDS: Record<string, string> = {
  // units
  पेटी: "peti", पेटि: "peti", पेटियां: "peti", केस: "case", डिब्बा: "box", पीस: "piece", नग: "nag", पैकेट: "packet",
  // sizes
  ग्राम: "gram", ग्रा: "g", किलो: "kilo", "कि.ग्रा": "kg", "कि.ग्रा.": "kg", "मि.ली": "ml", "मि.ली.": "ml", एमएल: "ml",
  बड़ा: "bada", बड़ी: "bada", बड़े: "bada", छोटा: "chhota", छोटी: "chhota", छोटे: "chhota",
  वाला: "wala", वाली: "wala", वाले: "wala",
  // products
  बिस्कुट: "biscuit", ग्लूकोज: "glucose", ग्लूकोज़: "glucose", क्रीम: "cream", मैरी: "marie", मिल्क: "milk", रस्क: "rusk",
  आलू: "aloo", भुजिया: "bhujia", नमकीन: "namkeen", खट्टा: "khatta", मीठा: "meetha", मिक्सचर: "mixture",
  मसाला: "masala", नूडल्स: "noodles", मैगी: "maggi", डिटर्जेंट: "detergent", सर्फ: "surf", पाउडर: "powder",
  साबुन: "sabun", टिकिया: "tikki", डिशवॉश: "dishwash", डिशवाश: "dishwash", जेल: "gel", बर्तन: "bartan", नीम: "neem",
  चाय: "chai", पत्ती: "patti", पत्ति: "patti", डस्ट: "dust",
  // numbers (converted to digits later)
  एक: "ek", दो: "do", तीन: "teen", चार: "char", पाँच: "paanch", पांच: "paanch", छह: "chhe", छः: "chhe",
  सात: "saat", आठ: "aath", नौ: "nau", दस: "das",
  // filler
  भैया: "bhaiya", भइया: "bhaiya", भाई: "bhai", नमस्ते: "namaste", नमस्कार: "namaskar", जी: "ji", और: "aur",
  भेज: "bhej", भेजो: "bhejo", देना: "dena", दीजिए: "dijiye", भी: "bhi", कल: "kal", सुबह: "subah", तक: "tak",
  चाहिए: "chahiye", मुझे: "mujhe", हमें: "hamein", का: "ka", की: "ki", के: "ke", वो: "woh", नया: "naya",
};

/** Spelling variants folded onto one form so matching and alias keys stay stable. */
export const SPELLING: Record<string, string> = {
  biskut: "biscuit", biskit: "biscuit", bisket: "biscuit", biscut: "biscuit", buscuit: "biscuit", biscuits: "biscuit",
  chay: "chai", chaay: "chai", chae: "chai", pati: "patti", pathi: "patti",
  saabun: "sabun", bhujiya: "bhujia", bujia: "bhujia", namkin: "namkeen", nudels: "noodles", noodle: "noodles", magi: "maggi",
  chota: "chhota", chhoti: "chhota", choti: "chhota", chhote: "chhota", chote: "chhota",
  bara: "bada", badi: "bada", bari: "bada", bade: "bada", bare: "bada",
  vala: "wala", waala: "wala", wali: "wala", wale: "wala", waale: "wala",
  petti: "peti", petiyan: "peti", bhaiyya: "bhaiya", bhaiyaa: "bhaiya",
};

/** Words that mean "case" (PLAN A2: peti = case). */
export const CASE_WORDS = new Set(["peti", "case", "cases", "carton", "cartons", "ctn", "ctns", "box", "boxes"]);

/**
 * Words that mean a single retail piece. "packet" is the retail pack a shopper buys,
 * i.e. a piece, not a case (assumption A2).
 */
export const PIECE_WORDS = new Set(["piece", "pieces", "pc", "pcs", "nag", "packet", "packets", "pkt", "pkts"]);

/** Pack-size units. "250 gm" is a product variant, never an order unit. */
export const SIZE_UNITS: Record<string, "g" | "kg" | "ml" | "l"> = {
  g: "g", gm: "g", gms: "g", gr: "g", grm: "g", gram: "g", grams: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg",
  ml: "ml", l: "l", ltr: "l", litre: "l", liter: "l",
};

/** Numbers spelled out in Hinglish. Fractions ("aadha") are deliberately not handled. */
export const NUMBER_WORDS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, che: 6,
  saat: 7, aath: 8, nau: 9, das: 10,
};

/** Verbs before "do" that make it "give/send", not the number two ("bhej do"). */
export const DO_AS_VERB_AFTER = new Set(["bhej", "bhejo", "de", "kar", "send"]);

export const SMALL_WORDS = new Set(["chhota", "small", "mini"]);
export const LARGE_WORDS = new Set(["bada", "big", "large", "jumbo"]);

/** Greetings, politeness and delivery chatter: carry no item information. */
export const FILLER = new Set([
  "bhaiya", "bhai", "namaste", "namaskar", "hello", "hi", "hii", "ji", "sir", "please", "pls", "plz", "send",
  "bhej", "bhejo", "bhejna", "dena", "de", "dijiye", "do", "kar", "kal", "aaj", "subah", "shaam", "tak", "jaldi",
  "mujhe", "hamein", "humein", "hume", "chahiye", "chaiye", "maal", "bhi", "aur", "and", "also", "woh", "wo", "naya",
  "type", "wala", "ka", "ki", "ke", "of", "the", "me", "mein", "ok", "thanks", "thank", "you", "dhanyavad", "order",
]);

/**
 * Filler trimmed from the edges of a segment's displayed original words. Keeps the
 * descriptive words so the desk still sees "naya wala shampoo".
 */
const DESCRIPTIVE_FILLER = new Set(["naya", "wala", "type"]);
export const EDGE_FILLER = new Set([...FILLER].filter((w) => !DESCRIPTIVE_FILLER.has(w)));
