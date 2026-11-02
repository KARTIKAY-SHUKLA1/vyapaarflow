/**
 * Tally CSV export for confirmed sales orders.
 *
 * Pure module: takes plain order objects (integer paise, GST in basis points)
 * and returns the CSV text the order desk downloads and imports into Tally.
 *
 * Layout: one row per order line, in the column layout used by common Tally
 * Excel/CSV voucher-import utilities. ASSUMPTION A13: the exact column mapping
 * must be confirmed against the client's own Tally import template before
 * go-live; only TALLY_HEADERS and orderRows() below should need to change.
 *
 * Guarantees:
 * - Money is formatted from integer paise with integer arithmetic only.
 * - Inconsistent money (line or order totals that do not add up) throws;
 *   we never silently export numbers that disagree with each other.
 * - RFC 4180 quoting, CRLF line endings, UTF-8 BOM, no footer row.
 * - Text fields are neutralised against spreadsheet formula injection.
 */

export type TallyOrder = {
  number: string; // SO-2611-0004 → Voucher Number
  createdAt: Date; // → Voucher Date in IST, DD-MM-YYYY
  retailerCode: string; // RT-1001
  shopName: string; // Party ledger name, e.g. "Sharma Kirana Store"
  note: string | null;
  source: "app" | "capture" | "desk";
  lines: {
    skuCode: string;
    skuName: string;
    cases: number;
    freeCases: number;
    packSize: number;
    pricePerPiecePaise: number;
    grossPaise: number;
    discountPaise: number;
    gstRateBp: number;
    gstPaise: number;
    totalPaise: number;
    schemeNote: string | null;
  }[];
  totals: { grossPaise: number; discountPaise: number; taxablePaise: number; gstPaise: number; totalPaise: number };
};

export const TALLY_HEADERS = [
  "Voucher Date",
  "Voucher Type",
  "Voucher Number",
  "Party Code",
  "Party Ledger",
  "Item Code",
  "Item Name",
  "Billed Qty",
  "Free Qty",
  "Unit",
  "Rate",
  "Rate Per",
  "Gross Amount",
  "Discount Amount",
  "Taxable Amount",
  "GST Rate %",
  "GST Amount",
  "Line Total",
  "Scheme",
  "Order Total",
  "Source",
  "Narration",
] as const;

const BOM = "﻿";
const CRLF = "\r\n";
/** IST is a fixed UTC+05:30 offset (India has no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// ---------------------------------------------------------------------------
// Number formatting (integer-only)
// ---------------------------------------------------------------------------

/** Throws unless `n` is a non-negative safe integer; `what` names it in the error. */
function assertNonNegInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`Tally export: ${what} must be a non-negative integer, got ${n}`);
  }
}

/** 77760 → "777.60", 5 → "0.05", 123456789012 → "1234567890.12". No float maths. */
export function paiseToRupees(paise: number, what = "amount"): string {
  assertNonNegInt(paise, what);
  const rupees = Math.floor(paise / 100); // exact for safe integers
  const rest = paise % 100;
  return `${rupees}.${String(rest).padStart(2, "0")}`;
}

/** Basis points → percent without trailing zeros: 500 → "5", 250 → "2.5", 1234 → "12.34". */
export function bpToPercent(bp: number): string {
  assertNonNegInt(bp, "GST rate (bp)");
  const whole = Math.floor(bp / 100);
  const frac = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// ---------------------------------------------------------------------------
// Dates (IST)
// ---------------------------------------------------------------------------

/** Wall-clock parts of `d` in IST (shift the instant, then read UTC fields). */
function istParts(d: Date) {
  if (Number.isNaN(d.getTime())) throw new Error("Tally export: invalid date");
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return {
    yyyy: String(ist.getUTCFullYear()),
    mm: p2(ist.getUTCMonth() + 1),
    dd: p2(ist.getUTCDate()),
    hh: p2(ist.getUTCHours()),
    mi: p2(ist.getUTCMinutes()),
  };
}

/** Voucher date as Tally expects it: DD-MM-YYYY in IST. */
function voucherDate(d: Date): string {
  const { dd, mm, yyyy } = istParts(d);
  return `${dd}-${mm}-${yyyy}`;
}

/** e.g. tally-sales-orders-2026-11-02-1530-3orders.csv (export time in IST). */
export function tallyFileName(exportedAt: Date, count: number): string {
  const { yyyy, mm, dd, hh, mi } = istParts(exportedAt);
  return `tally-sales-orders-${yyyy}-${mm}-${dd}-${hh}${mi}-${count}orders.csv`;
}

// ---------------------------------------------------------------------------
// CSV cells
// ---------------------------------------------------------------------------

/** A cell is either free text (user/master data) or a number we generated. */
type Cell = { text: string } | { num: string };

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** RFC 4180-encode one cell; text cells are also defused against formula injection. */
function encodeCell(cell: Cell): string {
  let v: string;
  if ("num" in cell) {
    v = cell.num; // generated by us, never negative
  } else {
    v = cell.text;
    if (FORMULA_START.test(v)) v = `'${v}`;
  }
  return NEEDS_QUOTES.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ---------------------------------------------------------------------------
// Integrity checks
// ---------------------------------------------------------------------------

/** Throws if any amount is invalid or any line/order total disagrees with its parts. */
function assertConsistent(order: TallyOrder): void {
  const ctx = `order ${order.number}`;
  if (order.lines.length === 0) throw new Error(`Tally export: ${ctx} has no lines`);

  const sum = { gross: 0, discount: 0, gst: 0, total: 0 };
  order.lines.forEach((l, i) => {
    const lctx = `${ctx} line ${i + 1} (${l.skuCode})`;
    const ints = {
      cases: l.cases,
      freeCases: l.freeCases,
      packSize: l.packSize,
      pricePerPiecePaise: l.pricePerPiecePaise,
      grossPaise: l.grossPaise,
      discountPaise: l.discountPaise,
      gstRateBp: l.gstRateBp,
      gstPaise: l.gstPaise,
      totalPaise: l.totalPaise,
    };
    for (const [k, v] of Object.entries(ints)) assertNonNegInt(v, `${lctx} ${k}`);
    if (l.discountPaise > l.grossPaise) {
      throw new Error(`Tally export: ${lctx} discount exceeds gross`);
    }
    if (l.grossPaise - l.discountPaise + l.gstPaise !== l.totalPaise) {
      throw new Error(`Tally export: ${lctx} gross - discount + GST does not equal line total`);
    }
    sum.gross += l.grossPaise;
    sum.discount += l.discountPaise;
    sum.gst += l.gstPaise;
    sum.total += l.totalPaise;
  });

  const t = order.totals;
  for (const [k, v] of Object.entries(t)) assertNonNegInt(v, `${ctx} totals.${k}`);
  const checks: [name: string, expected: number, actual: number][] = [
    ["gross", sum.gross, t.grossPaise],
    ["discount", sum.discount, t.discountPaise],
    ["GST", sum.gst, t.gstPaise],
    ["total", sum.total, t.totalPaise],
    ["taxable", t.grossPaise - t.discountPaise, t.taxablePaise],
  ];
  for (const [name, expected, actual] of checks) {
    if (expected !== actual) {
      throw new Error(`Tally export: ${ctx} ${name} mismatch (expected ${expected}, totals say ${actual})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Narration: "<note> | Source: <source>" on one line; just "Source: <source>" when there is no note. */
function narration(order: TallyOrder): string {
  const note = (order.note ?? "").replace(/\r\n|\r|\n/g, " ").trim();
  return note ? `${note} | Source: ${order.source}` : `Source: ${order.source}`;
}

function orderRows(order: TallyOrder): Cell[][] {
  const t = (text: string): Cell => ({ text });
  const n = (num: string): Cell => ({ num });
  const date = voucherDate(order.createdAt);
  const orderTotal = paiseToRupees(order.totals.totalPaise, "order total");

  return order.lines.map((l) => [
    t(date),
    t("Sales Order"),
    t(order.number),
    t(order.retailerCode),
    t(order.shopName),
    t(l.skuCode),
    t(l.skuName),
    n(String(l.cases)),
    n(String(l.freeCases)),
    t("Case"),
    n(paiseToRupees(l.packSize * l.pricePerPiecePaise, "case rate")),
    t("Case"),
    n(paiseToRupees(l.grossPaise)),
    n(paiseToRupees(l.discountPaise)),
    n(paiseToRupees(l.grossPaise - l.discountPaise)),
    n(bpToPercent(l.gstRateBp)),
    n(paiseToRupees(l.gstPaise)),
    n(paiseToRupees(l.totalPaise)),
    t(l.schemeNote ?? ""),
    n(orderTotal),
    t(order.source),
    t(narration(order)),
  ]);
}

/**
 * Build the Tally import CSV for the given orders (rows contiguous per order,
 * orders in the given sequence). Throws on an empty list, an order without
 * lines, negative/non-integer amounts, or totals that do not add up.
 *
 * `opts.generatedAt` is validated but deliberately NOT written into the file:
 * any extra header/footer row would break Tally imports. Use it with
 * `tallyFileName` to name the download instead.
 */
export function buildTallyCsv(orders: TallyOrder[], opts?: { generatedAt?: Date }): string {
  if (opts?.generatedAt && Number.isNaN(opts.generatedAt.getTime())) {
    throw new Error("Tally export: invalid generatedAt");
  }
  if (orders.length === 0) throw new Error("Tally export: no orders to export");
  orders.forEach(assertConsistent);

  const header = TALLY_HEADERS.map((h) => encodeCell({ text: h })).join(",");
  const rows = orders.flatMap(orderRows).map((cells) => cells.map(encodeCell).join(","));
  // Every record, including the last, ends in CRLF (permitted by RFC 4180).
  return BOM + [header, ...rows].map((r) => r + CRLF).join("");
}
