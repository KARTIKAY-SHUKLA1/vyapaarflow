import { describe, expect, it } from "vitest";
import { bpToPercent, buildTallyCsv, paiseToRupees, tallyFileName, type TallyOrder } from "./index";

const HEADER =
  "Voucher Date,Voucher Type,Voucher Number,Party Code,Party Ledger,Item Code,Item Name,Billed Qty,Free Qty,Unit,Rate,Rate Per,Gross Amount,Discount Amount,Taxable Amount,GST Rate %,GST Amount,Line Total,Scheme,Order Total,Source,Narration";

type Line = TallyOrder["lines"][number];

const biscuit: Line = {
  skuCode: "SKU-BS-075",
  skuName: "Glucose biscuit 75 g, case of 96",
  cases: 10,
  freeCases: 1,
  packSize: 96,
  pricePerPiecePaise: 810,
  grossPaise: 777600,
  discountPaise: 0,
  gstRateBp: 500,
  gstPaise: 38880,
  totalPaise: 816480,
  schemeNote: "Buy 10 cases get 1 free",
};

const detergent: Line = {
  skuCode: "SKU-DT-1KG",
  skuName: "Detergent powder 1 kg",
  cases: 5,
  freeCases: 0,
  packSize: 20,
  pricePerPiecePaise: 10150,
  grossPaise: 1015000,
  discountPaise: 30450,
  gstRateBp: 1800,
  gstPaise: 177219,
  totalPaise: 1161769,
  schemeNote: "3% off 5 or more cases",
};

/** Build an order whose totals are derived from its lines (always consistent). */
function order(overrides: Partial<TallyOrder> = {}, lines: Line[] = [biscuit, detergent]): TallyOrder {
  const sum = (f: (l: Line) => number) => lines.reduce((a, l) => a + f(l), 0);
  const grossPaise = sum((l) => l.grossPaise);
  const discountPaise = sum((l) => l.discountPaise);
  return {
    number: "SO-2611-0004",
    createdAt: new Date("2026-11-02T04:30:00Z"), // 10:00 IST
    retailerCode: "RT-1001",
    shopName: "Sharma Kirana Store",
    note: "Deliver before Friday",
    source: "app",
    lines,
    totals: {
      grossPaise,
      discountPaise,
      taxablePaise: grossPaise - discountPaise,
      gstPaise: sum((l) => l.gstPaise),
      totalPaise: sum((l) => l.totalPaise),
    },
    ...overrides,
  };
}

/** Strip BOM and split into records (dropping the empty string after the final CRLF). */
function records(csv: string): string[] {
  const body = csv.replace(/^﻿/, "");
  const parts = body.split("\r\n");
  expect(parts.at(-1)).toBe("");
  return parts.slice(0, -1);
}

describe("buildTallyCsv", () => {
  it("writes the exact header line", () => {
    expect(records(buildTallyCsv([order()]))[0]).toBe(HEADER);
  });

  it("exports a realistic two-line order with exact rows", () => {
    const rows = records(buildTallyCsv([order()]));
    expect(rows).toEqual([
      HEADER,
      '02-11-2026,Sales Order,SO-2611-0004,RT-1001,Sharma Kirana Store,SKU-BS-075,"Glucose biscuit 75 g, case of 96",10,1,Case,777.60,Case,7776.00,0.00,7776.00,5,388.80,8164.80,Buy 10 cases get 1 free,19782.49,app,Deliver before Friday | Source: app',
      "02-11-2026,Sales Order,SO-2611-0004,RT-1001,Sharma Kirana Store,SKU-DT-1KG,Detergent powder 1 kg,5,0,Case,2030.00,Case,10150.00,304.50,9845.50,18,1772.19,11617.69,3% off 5 or more cases,19782.49,app,Deliver before Friday | Source: app",
    ]);
  });

  it("keeps rows contiguous per order, in the given order", () => {
    const a = order({ number: "SO-2611-0001" });
    const b = order({ number: "SO-2611-0002" }, [detergent]);
    const numbers = records(buildTallyCsv([b, a]))
      .slice(1)
      .map((r) => r.split(",")[2]);
    expect(numbers).toEqual(["SO-2611-0002", "SO-2611-0001", "SO-2611-0001"]);
  });

  it("converts the voucher date to IST across midnight", () => {
    const rows = records(buildTallyCsv([order({ createdAt: new Date("2026-11-01T19:00:00Z") })]));
    expect(rows[1].startsWith("02-11-2026,")).toBe(true);
  });

  it("quotes commas and quotes, and flattens newlines in the note", () => {
    const csv = buildTallyCsv([
      order({ shopName: 'Patel "Provision", Adhartal', note: "Ring bell\nback gate" }, [biscuit]),
    ]);
    const row = records(csv)[1];
    expect(row).toContain(',"Patel ""Provision"", Adhartal",');
    expect(row.endsWith(",Ring bell back gate | Source: app")).toBe(true);
  });

  it("quotes any embedded newline in other text fields (RFC 4180)", () => {
    const csv = buildTallyCsv([order({}, [{ ...biscuit, schemeNote: "Line1\nLine2" }])]);
    expect(csv).toContain(',"Line1\nLine2",');
  });

  it("neutralises spreadsheet formula injection in text fields", () => {
    const row = records(buildTallyCsv([order({ shopName: '=HYPERLINK("x")', note: "+91 call" }, [biscuit])]))[1];
    expect(row).toContain(',"\'=HYPERLINK(""x"")",');
    expect(row.endsWith(",'+91 call | Source: app")).toBe(true);
    // Empty note: narration starts with a space, not a formula character.
    const plain = records(buildTallyCsv([order({ note: null }, [biscuit])]))[1];
    expect(plain.endsWith(", | Source: app")).toBe(true);
  });

  it("formats large and tiny amounts without float error", () => {
    expect(paiseToRupees(123456789012)).toBe("1234567890.12");
    expect(paiseToRupees(5)).toBe("0.05");
    expect(paiseToRupees(0)).toBe("0.00");
    expect(paiseToRupees(116176900)).toBe("1161769.00");
    const big: Line = {
      ...biscuit,
      grossPaise: 123456789012,
      discountPaise: 0,
      gstPaise: 5,
      totalPaise: 123456789017,
    };
    const row = records(buildTallyCsv([order({}, [big])]))[1];
    expect(row).toContain(",1234567890.12,0.00,1234567890.12,5,0.05,1234567890.17,");
  });

  it("formats GST basis points as percent", () => {
    expect(bpToPercent(500)).toBe("5");
    expect(bpToPercent(1800)).toBe("18");
    expect(bpToPercent(250)).toBe("2.5");
    expect(bpToPercent(0)).toBe("0");
  });

  it("throws when order totals disagree with the lines", () => {
    const o = order();
    expect(() => buildTallyCsv([{ ...o, totals: { ...o.totals, totalPaise: o.totals.totalPaise + 1 } }])).toThrow(
      /total mismatch/,
    );
    expect(() => buildTallyCsv([{ ...o, totals: { ...o.totals, grossPaise: o.totals.grossPaise - 1 } }])).toThrow(
      /mismatch/,
    );
  });

  it("throws when a line does not add up", () => {
    expect(() => buildTallyCsv([order({}, [{ ...biscuit, gstPaise: 38881 }])])).toThrow(/line total/);
  });

  it("throws on an empty export or an order with no lines", () => {
    expect(() => buildTallyCsv([])).toThrow(/no orders/);
    expect(() => buildTallyCsv([order({}, [])])).toThrow(/no lines/);
  });

  it("throws on negative or non-integer amounts", () => {
    expect(() => buildTallyCsv([order({}, [{ ...biscuit, discountPaise: -10, totalPaise: 816490 }])])).toThrow(
      /non-negative integer/,
    );
    expect(() => buildTallyCsv([order({}, [{ ...biscuit, gstPaise: 38880.5, totalPaise: 816480.5 }])])).toThrow(
      /non-negative integer/,
    );
    expect(() => paiseToRupees(-1)).toThrow();
  });

  it("starts with a UTF-8 BOM, uses CRLF only, and has no footer", () => {
    const csv = buildTallyCsv([order()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    // header + exactly one row per line, nothing after
    expect(records(csv)).toHaveLength(3);
  });
});

describe("tallyFileName", () => {
  it("names the file with the IST export time and order count", () => {
    expect(tallyFileName(new Date("2026-11-02T10:00:00Z"), 3)).toBe("tally-sales-orders-2026-11-02-1530-3orders.csv");
    // 19:00 UTC is already the next day in IST
    expect(tallyFileName(new Date("2026-11-01T19:05:00Z"), 1)).toBe("tally-sales-orders-2026-11-02-0035-1orders.csv");
  });
});
