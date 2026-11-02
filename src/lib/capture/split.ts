import { EDGE_FILLER, FILLER, SIZE_UNITS } from "./lexicon";
import { isInteger, isSizeToken, isUnitWord, normalizeWord, numberWordValue } from "./normalize";

/** A piece of the message that should hold one item, with its exact original words. */
export type Segment = { text: string; start: number; end: number };

// Commas, semicolons, "&", newlines, Hindi danda, sentence-ending "." and the
// joining words "aur" / "and" / "और". A "." inside "2.5kg" or "मि.ली" is not a break.
const SEPARATOR = /[,;&\n\r।॥!?]+|\.(?=\s|$)|(?:^|\s)(?:aur|and|और)(?=\s|$)/giu;

type Token = { raw: string; norm: string; start: number; end: number };

function pieces(message: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let last = 0;
  for (const m of message.matchAll(SEPARATOR)) {
    out.push({ text: message.slice(last, m.index), start: last });
    last = m.index! + m[0].length;
  }
  out.push({ text: message.slice(last), start: last });
  return out;
}

function tokens(piece: { text: string; start: number }): Token[] {
  return [...piece.text.matchAll(/\S+/g)]
    .map((m) => ({ raw: m[0], norm: normalizeWord(m[0]), start: piece.start + m.index!, end: piece.start + m.index! + m[0].length }))
    .filter((t) => t.norm !== "");
}

function numberAt(toks: Token[], i: number): number | null {
  const t = toks[i].norm;
  if (isInteger(t)) return Number(t);
  return numberWordValue(t, toks[i - 1]?.norm);
}

/** True when the number is a pack size ("1 kilo", "250 wala"), not a quantity. */
function isSizeNumber(toks: Token[], i: number, value: number): boolean {
  const next = toks[i + 1]?.norm;
  return next !== undefined && (next in SIZE_UNITS || (next === "wala" && value >= 50));
}

function isProductWord(norm: string): boolean {
  return !isInteger(norm) && !isUnitWord(norm) && !isSizeToken(norm) && !FILLER.has(norm) && !(norm in SIZE_UNITS);
}

/**
 * Split "5 peti biscuit 2 peti surf" into two items when the retailer used no
 * separator: a new quantity after a group that already has quantity and product.
 */
function splitOnQuantities(toks: Token[]): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  let hasQty = false;
  let hasProduct = false;
  toks.forEach((tok, i) => {
    const value = numberAt(toks, i);
    const isQty = value !== null && !isSizeNumber(toks, i, value);
    if (isQty && hasQty && hasProduct) {
      groups.push(current);
      current = [];
      hasProduct = false;
    }
    current.push(tok);
    if (isQty) hasQty = true;
    else if (isProductWord(tok.norm)) hasProduct = true;
  });
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Drop greetings and chatter at the ends ("bhaiya", "please send"), but never a number word like "do". */
function trimEdges(group: Token[]): Token[] {
  const isEdgeFiller = (i: number) => EDGE_FILLER.has(group[i].norm) && numberAt(group, i) === null;
  let a = 0;
  let b = group.length;
  while (a < b && isEdgeFiller(a)) a++;
  while (b > a && isEdgeFiller(b - 1)) b--;
  return group.slice(a, b);
}

function span(message: string, group: Token[]): Segment {
  const start = group[0].start;
  const end = group[group.length - 1].end;
  return { text: message.slice(start, end), start, end };
}

/**
 * Split a message into item segments, keeping each segment's original text span.
 * Pieces made only of greetings ("Namaste bhai") are returned as `ignored`.
 */
export function splitMessage(message: string): { segments: Segment[]; ignored: string[] } {
  const segments: Segment[] = [];
  const ignored: string[] = [];
  for (const group of pieces(message).flatMap((p) => splitOnQuantities(tokens(p)))) {
    const trimmed = trimEdges(group);
    if (trimmed.length > 0) segments.push(span(message, trimmed));
    else if (group.length > 0) ignored.push(span(message, group).text);
  }
  return { segments, ignored };
}
