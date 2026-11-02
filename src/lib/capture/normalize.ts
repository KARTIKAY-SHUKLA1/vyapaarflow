import {
  CASE_WORDS,
  DEVANAGARI_WORDS,
  DO_AS_VERB_AFTER,
  FILLER,
  NUMBER_WORDS,
  PIECE_WORDS,
  SIZE_UNITS,
  SPELLING,
} from "./lexicon";

/**
 * Hinglish / Hindi / English normaliser. Turns free text into a list of
 * canonical Latin tokens: digits for numbers, merged size tokens ("250g", "1kg",
 * "500ml") and no greetings or filler.
 */

// Devanagari keys are written however the editor saved them; NFC makes lookups
// independent of how a phone keyboard composed nukta letters (ड़ vs ड + ़).
const DEVANAGARI = new Map(Object.entries(DEVANAGARI_WORDS).map(([k, v]) => [k.normalize("NFC"), v]));

const DEVANAGARI_DIGIT_ZERO = 0x0966;
// Letters, digits, Devanagari (excluding the danda punctuation U+0964/U+0965) and "." inside abbreviations.
const EDGE_PUNCTUATION = /^[^a-z0-9ऀ-ॣ०-ॿ]+|[^a-z0-9ऀ-ॣ०-ॿ]+$/g;
const INTEGER = /^\d+$/;
const NUMBER_WITH_SUFFIX = /^(\d+(?:\.\d+)?)([a-z]+)$/;
const SIZE_TOKEN = /^\d+(?:\.\d+)?(?:g|kg|ml|l)$/;

/** Minimum number read as a pack size in "250 wala"; smaller numbers are quantities. */
const MIN_WALA_SIZE = 50;

function devanagariDigitsToAscii(text: string): string {
  return text.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_DIGIT_ZERO));
}

/** One raw word → canonical form (no context needed). May return "" for pure punctuation. */
export function normalizeWord(raw: string): string {
  const word = devanagariDigitsToAscii(raw.normalize("NFC").toLowerCase()).replace(EDGE_PUNCTUATION, "");
  const latin = DEVANAGARI.get(word) ?? word;
  return SPELLING[latin] ?? latin;
}

export function isUnitWord(word: string): boolean {
  return CASE_WORDS.has(word) || PIECE_WORDS.has(word);
}

export function isSizeToken(word: string): boolean {
  return SIZE_TOKEN.test(word);
}

export function isInteger(word: string): boolean {
  return INTEGER.test(word);
}

/** Canonical size token: grams ≥1000 fold into kg so "1000 gm", "1 kilo" and "1kg" agree. */
export function sizeToken(value: number, unit: "g" | "kg" | "ml" | "l"): string {
  if (unit === "kg" && value < 1) return `${Math.round(value * 1000)}g`;
  if (unit === "l" && value < 1) return `${Math.round(value * 1000)}ml`;
  if (unit === "g" && value >= 1000 && value % 1000 === 0) return `${value / 1000}kg`;
  if (unit === "ml" && value >= 1000 && value % 1000 === 0) return `${value / 1000}l`;
  return `${value}${unit}`;
}

/** Split "5peti" → ["5","peti"], keep "75g" → ["75g"]. */
function splitGluedNumber(word: string): string[] {
  const m = NUMBER_WITH_SUFFIX.exec(word);
  if (!m) return [word];
  const [, num, suffix] = m;
  const unit = SIZE_UNITS[suffix];
  if (unit) return [sizeToken(Number(num), unit)];
  const rest = SPELLING[suffix] ?? suffix;
  return isUnitWord(rest) && INTEGER.test(num) ? [num, rest] : [word];
}

function wordTokens(text: string): string[] {
  return text
    .split(/[\s,;:!?।॥()[\]{}"“”‘’'&/+*=|]+/)
    .map(normalizeWord)
    .filter(Boolean)
    .flatMap(splitGluedNumber);
}

/** Context-aware number reading: "do" is two only when it is not "bhej do" (send). */
export function numberWordValue(word: string, previous: string | undefined): number | null {
  if (!(word in NUMBER_WORDS)) return null;
  if (word === "do" && previous !== undefined && DO_AS_VERB_AFTER.has(previous)) return null;
  return NUMBER_WORDS[word];
}

function convertNumberWords(tokens: string[]): string[] {
  return tokens.map((t, i) => {
    const n = numberWordValue(t, tokens[i - 1]);
    return n === null ? t : String(n);
  });
}

/** "1 kilo" → "1kg", "500 gm" → "500g", "250 wala" → "250g" (brief: "chai patti 250 wala"). */
function mergeSizes(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    const isNumber = /^\d+(?:\.\d+)?$/.test(t);
    if (isNumber && next !== undefined && SIZE_UNITS[next]) {
      out.push(sizeToken(Number(t), SIZE_UNITS[next]));
      i++;
    } else if (isNumber && next === "wala" && Number(t) >= MIN_WALA_SIZE) {
      out.push(sizeToken(Number(t), "g"));
    } else if (SIZE_TOKEN.test(t)) {
      const m = /^(\d+(?:\.\d+)?)(g|kg|ml|l)$/.exec(t)!;
      out.push(sizeToken(Number(m[1]), m[2] as "g" | "kg" | "ml" | "l"));
    } else {
      out.push(t);
    }
  }
  return out;
}

/** Full normalisation of a message fragment into canonical tokens. */
export function normalizeTokens(text: string): string[] {
  const tokens = mergeSizes(convertNumberWords(wordTokens(text)));
  return tokens.filter((t) => !FILLER.has(t));
}

export function normalize(text: string): string {
  return normalizeTokens(text).join(" ");
}
