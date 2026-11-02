import { describe, expect, it } from "vitest";
import { applicableSchemes, bpOf, isoDateIST, priceOrder } from "./index";
import type { PricingInput, PricingLineInput, SchemeRule } from "./index";

// ---- Fixtures from the brief -------------------------------------------------

const AS_OF = "2026-11-02";
const NO_CREDIT_LIMIT = { limitPaise: 1_000_000_000, outstandingPaise: 0 };

const biscuitScheme: SchemeRule = {
  id: "sch-bs",
  type: "FREE_GOODS",
  buyQty: 10,
  freeQty: 1,
  label: "Buy 10 cases get 1 free",
  validFrom: "2026-10-01",
  validTo: "2026-12-31",
  active: true,
};

const detergentScheme: SchemeRule = {
  id: "sch-dt",
  type: "SLAB_PERCENT",
  minQty: 5,
  percentBp: 300,
  label: "3% off 5 or more cases",
  validFrom: "2026-10-01",
  validTo: "2026-12-31",
  active: true,
};

function biscuit(cases: number, over: Partial<PricingLineInput> = {}): PricingLineInput {
  return { skuId: "SKU-BS-075", cases, packSize: 96, pricePerPiecePaise: 810, gstRateBp: 500, stockCases: 340, schemes: [biscuitScheme], ...over };
}
function detergent(cases: number, over: Partial<PricingLineInput> = {}): PricingLineInput {
  return { skuId: "SKU-DT-1KG", cases, packSize: 20, pricePerPiecePaise: 10150, gstRateBp: 1800, stockCases: 85, schemes: [detergentScheme], ...over };
}
function tea(cases: number, over: Partial<PricingLineInput> = {}): PricingLineInput {
  return { skuId: "SKU-TE-250", cases, packSize: 40, pricePerPiecePaise: 11800, gstRateBp: 500, stockCases: 0, schemes: [], ...over };
}

function order(lines: PricingLineInput[], over: Partial<PricingInput> = {}): PricingInput {
  return { lines, asOf: AS_OF, credit: NO_CREDIT_LIMIT, ...over };
}
function one(line: PricingLineInput, asOf = AS_OF) {
  return priceOrder(order([line], { asOf })).lines[0];
}

// ---- The brief's raw order ---------------------------------------------------

describe("brief order: 5 biscuit, 2 detergent, 1 tea", () => {
  const result = priceOrder(order([biscuit(5), detergent(2), tea(1)]));
  const [bs, dt, te] = result.lines;

  it("prices biscuit per piece x pack size and nudges toward the free case", () => {
    expect(bs.casePricePaise).toBe(77_760);
    expect(bs.grossPaise).toBe(388_800);
    expect(bs.freeCases).toBe(0);
    expect(bs.discountPaise).toBe(0);
    expect(bs.gstPaise).toBe(19_440);
    expect(bs.totalPaise).toBe(408_240);
    expect(bs.appliedScheme).toBeNull();
    expect(bs.nudge).toEqual({ kind: "FREE_GOODS", addCases: 5, freeCases: 1 });
    expect(bs.issues).toEqual([]);
    expect(bs.orderable).toBe(true);
  });

  it("prices detergent with no discount below the slab and nudges toward it", () => {
    expect(dt.casePricePaise).toBe(203_000);
    expect(dt.grossPaise).toBe(406_000);
    expect(dt.discountPaise).toBe(0);
    expect(dt.gstPaise).toBe(73_080);
    expect(dt.totalPaise).toBe(479_080);
    expect(dt.appliedScheme).toBeNull();
    expect(dt.nudge).toEqual({ kind: "SLAB", addCases: 3, percentBp: 300 });
    expect(dt.orderable).toBe(true);
  });

  it("flags tea as out of stock but still prices it", () => {
    expect(te.issues).toEqual(["OUT_OF_STOCK"]);
    expect(te.orderable).toBe(false);
    expect(te.maxOrderableCases).toBe(0);
    expect(te.grossPaise).toBe(472_000);
    expect(te.totalPaise).toBe(495_600);
    expect(te.nudge).toBeNull();
  });

  it("is not orderable and totals include every line", () => {
    expect(result.orderable).toBe(false);
    expect(result.totals).toEqual({
      grossPaise: 1_266_800,
      discountPaise: 0,
      taxablePaise: 1_266_800,
      gstPaise: 116_120,
      totalPaise: 1_382_920,
      cases: 8,
      freeCases: 0,
    });
  });

  it("is orderable once the out-of-stock line is removed", () => {
    expect(priceOrder(order([biscuit(5), detergent(2)])).orderable).toBe(true);
  });
});

// ---- FREE_GOODS (A3) ---------------------------------------------------------

describe("free goods: buy 10 get 1 (A3)", () => {
  it("10 cases -> 1 free, scheme applied, no nudge", () => {
    const l = one(biscuit(10));
    expect(l.freeCases).toBe(1);
    expect(l.grossPaise).toBe(777_600);
    expect(l.appliedScheme).toEqual({ id: "sch-bs", type: "FREE_GOODS", label: "Buy 10 cases get 1 free" });
    expect(l.nudge).toBeNull();
  });

  it("free cases are zero-value: gross covers only paid cases", () => {
    const l = one(biscuit(10));
    expect(l.taxablePaise).toBe(10 * 77_760);
    expect(l.gstPaise).toBe(38_880);
  });

  it("20 cases -> 2 free (repeats per full multiple)", () => {
    expect(one(biscuit(20)).freeCases).toBe(2);
  });

  it("25 cases -> 2 free plus nudge to add 5 for 1 more", () => {
    const l = one(biscuit(25));
    expect(l.freeCases).toBe(2);
    expect(l.nudge).toEqual({ kind: "FREE_GOODS", addCases: 5, freeCases: 1 });
  });

  it("340 cases (all stock) -> earned 34 free but capped to 0 and flagged", () => {
    const l = one(biscuit(340));
    expect(l.freeCases).toBe(0);
    expect(l.issues).toEqual(["FREE_GOODS_SHORT"]);
    expect(l.appliedScheme).toBeNull();
    expect(l.nudge).toBeNull();
    expect(l.orderable).toBe(true);
  });

  it("335 cases -> earned 33 free, capped to 5 (remaining stock), flagged, no nudge", () => {
    const l = one(biscuit(335));
    expect(l.freeCases).toBe(5);
    expect(l.issues).toEqual(["FREE_GOODS_SHORT"]);
    expect(l.appliedScheme?.id).toBe("sch-bs");
    // Next multiple is 340 + 34 free = 374 > 340 stock, so no nudge.
    expect(l.nudge).toBeNull();
    expect(l.orderable).toBe(true);
  });

  it("nudges only when the next level plus its free cases fits in stock", () => {
    // 299 -> next 300 + 30 free = 330 <= 340
    expect(one(biscuit(299)).nudge).toEqual({ kind: "FREE_GOODS", addCases: 1, freeCases: 1 });
    // 305 -> next 310 + 31 free = 341 > 340
    const l = one(biscuit(305));
    expect(l.freeCases).toBe(30);
    expect(l.issues).toEqual([]);
    expect(l.nudge).toBeNull();
  });

  it("no nudge on a non-orderable line", () => {
    const l = one(biscuit(5, { stockCases: 3 }));
    expect(l.issues).toContain("EXCEEDS_STOCK");
    expect(l.nudge).toBeNull();
  });

  it("supports freeQty > 1", () => {
    const scheme: SchemeRule = { ...biscuitScheme, buyQty: 5, freeQty: 2 };
    const l = one(biscuit(12, { schemes: [scheme] }));
    expect(l.freeCases).toBe(4);
    expect(l.nudge).toEqual({ kind: "FREE_GOODS", addCases: 3, freeCases: 2 });
  });
});

// ---- SLAB_PERCENT (A4) and stock ----------------------------------------------

describe("slab percent: 3% off 5+ cases (A4)", () => {
  it("5 cases -> exact brief figures", () => {
    const l = one(detergent(5));
    expect(l.grossPaise).toBe(1_015_000);
    expect(l.discountPaise).toBe(30_450);
    expect(l.taxablePaise).toBe(984_550);
    expect(l.gstPaise).toBe(177_219);
    expect(l.totalPaise).toBe(1_161_769);
    expect(l.appliedScheme).toEqual({ id: "sch-dt", type: "SLAB_PERCENT", label: "3% off 5 or more cases" });
    expect(l.nudge).toBeNull();
  });

  it("85 cases (all stock) is orderable with discount on the whole line", () => {
    const l = one(detergent(85));
    expect(l.orderable).toBe(true);
    expect(l.issues).toEqual([]);
    expect(l.grossPaise).toBe(17_255_000);
    expect(l.discountPaise).toBe(517_650);
  });

  it("86 cases -> EXCEEDS_STOCK, not cut, maxOrderableCases 85", () => {
    const l = one(detergent(86));
    expect(l.issues).toEqual(["EXCEEDS_STOCK"]);
    expect(l.orderable).toBe(false);
    expect(l.cases).toBe(86);
    expect(l.maxOrderableCases).toBe(85);
    expect(l.grossPaise).toBe(86 * 203_000);
  });

  it("4 cases -> nudge add 1", () => {
    expect(one(detergent(4)).nudge).toEqual({ kind: "SLAB", addCases: 1, percentBp: 300 });
  });

  it("no slab nudge when the threshold exceeds stock", () => {
    expect(one(detergent(2, { stockCases: 4 })).nudge).toBeNull();
  });

  it("no slab nudge on a non-orderable line", () => {
    expect(one(detergent(2, { stockCases: 0 })).nudge).toBeNull();
  });
});

// ---- Scheme dates and conflicts (A5) ------------------------------------------

describe("scheme applicability (A5)", () => {
  const withDates = (validFrom: string, validTo: string | null, active = true): SchemeRule => ({ ...detergentScheme, validFrom, validTo, active });
  const discountWith = (s: SchemeRule) => one(detergent(5, { schemes: [s] })).discountPaise;

  it("expired yesterday -> not applied", () => {
    expect(discountWith(withDates("2026-10-01", "2026-11-01"))).toBe(0);
  });
  it("starts tomorrow -> not applied", () => {
    expect(discountWith(withDates("2026-11-03", "2026-12-31"))).toBe(0);
  });
  it("validFrom == asOf -> applied (inclusive)", () => {
    expect(discountWith(withDates("2026-11-02", "2026-12-31"))).toBe(30_450);
  });
  it("validTo == asOf -> applied (inclusive)", () => {
    expect(discountWith(withDates("2026-10-01", "2026-11-02"))).toBe(30_450);
  });
  it("inactive -> not applied", () => {
    expect(discountWith(withDates("2026-10-01", "2026-12-31", false))).toBe(0);
  });
  it("open-ended validTo null -> applied", () => {
    expect(discountWith(withDates("2026-10-01", null))).toBe(30_450);
  });

  it("applicableSchemes filters by date and active flag", () => {
    const list = [withDates("2026-10-01", null), withDates("2026-12-01", null), withDates("2026-10-01", null, false)];
    expect(applicableSchemes(list, AS_OF)).toEqual([list[0]]);
  });

  it("two overlapping schemes -> MULTIPLE_SCHEMES, no benefit, still orderable", () => {
    const l = one(detergent(10, { schemes: [detergentScheme, { ...detergentScheme, id: "sch-dt-2", percentBp: 500 }] }));
    expect(l.issues).toEqual(["MULTIPLE_SCHEMES"]);
    expect(l.discountPaise).toBe(0);
    expect(l.freeCases).toBe(0);
    expect(l.appliedScheme).toBeNull();
    expect(l.nudge).toBeNull();
    expect(l.orderable).toBe(true);
  });

  it("an overlapping but expired second scheme is not a conflict", () => {
    const l = one(detergent(5, { schemes: [detergentScheme, { ...detergentScheme, id: "old", validTo: "2026-10-31" }] }));
    expect(l.issues).toEqual([]);
    expect(l.discountPaise).toBe(30_450);
  });
});

// ---- Invalid quantities -------------------------------------------------------

describe("invalid quantities", () => {
  it.each([
    [0, 0],
    [-1, -1],
    [1.5, 1.5],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [10_000, 10_000],
  ])("cases=%s -> INVALID_QUANTITY, priced as zero", (cases, shown) => {
    const result = priceOrder(order([biscuit(cases)]));
    const l = result.lines[0];
    expect(l.issues).toEqual(["INVALID_QUANTITY"]);
    expect(l.cases).toBe(shown);
    expect(l.orderable).toBe(false);
    expect([l.grossPaise, l.discountPaise, l.taxablePaise, l.gstPaise, l.totalPaise, l.freeCases]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(l.appliedScheme).toBeNull();
    expect(l.nudge).toBeNull();
    expect(result.orderable).toBe(false);
    expect(result.totals.cases).toBe(0);
  });

  it("boundaries 1 and 9999 are valid quantities", () => {
    expect(one(biscuit(1)).issues).toEqual([]);
    expect(one(biscuit(9999, { stockCases: 20_000 })).issues).not.toContain("INVALID_QUANTITY");
  });
});

// ---- Rounding -----------------------------------------------------------------

describe("half-up rounding with integer maths", () => {
  it("bpOf rounds exactly .5 up and .4999 down", () => {
    expect(bpOf(50, 100)).toBe(1); // 0.5 -> 1
    expect(bpOf(150, 100)).toBe(2); // 1.5 -> 2
    expect(bpOf(4999, 1)).toBe(0); // 0.4999 -> 0
    expect(bpOf(14_999, 1)).toBe(1); // 1.4999 -> 1
    expect(bpOf(0, 1800)).toBe(0);
  });

  const unit = (over: Partial<PricingLineInput>) =>
    one({ skuId: "X", cases: 1, packSize: 1, pricePerPiecePaise: 50, gstRateBp: 100, stockCases: 10, schemes: [], ...over });

  it("GST landing on exactly .5 paise rounds up", () => {
    expect(unit({}).gstPaise).toBe(1); // 50 x 1% = 0.5
  });
  it("GST landing on .4999 paise rounds down", () => {
    expect(unit({ pricePerPiecePaise: 1, gstRateBp: 4999 }).gstPaise).toBe(0); // 1 x 49.99% = 0.4999
  });
  it("slab discount landing on .5 rounds up", () => {
    const slab: SchemeRule = { ...detergentScheme, minQty: 1, percentBp: 100 };
    const l = unit({ schemes: [slab] });
    expect(l.discountPaise).toBe(1);
    expect(l.taxablePaise).toBe(49);
  });
});

// ---- Credit (A7) ----------------------------------------------------------------

describe("credit check (A7)", () => {
  const total = 1_161_769; // detergent x5
  const credit = (limitPaise: number, outstandingPaise: number) =>
    priceOrder(order([detergent(5)], { credit: { limitPaise, outstandingPaise } })).credit;

  it("within limit", () => {
    expect(credit(5_000_000, 1_000_000)).toEqual({ limitPaise: 5_000_000, outstandingPaise: 1_000_000, availablePaise: 4_000_000, wouldExceed: false, exceedsByPaise: 0 });
  });
  it("exactly at limit does not exceed", () => {
    const c = credit(5_000_000, 5_000_000 - total);
    expect(c.wouldExceed).toBe(false);
    expect(c.exceedsByPaise).toBe(0);
  });
  it("1 paisa over -> wouldExceed by 1", () => {
    const c = credit(5_000_000, 5_000_000 - total + 1);
    expect(c.wouldExceed).toBe(true);
    expect(c.exceedsByPaise).toBe(1);
  });
  it("outstanding already above limit -> available 0", () => {
    const c = credit(1_000_000, 1_500_000);
    expect(c.availablePaise).toBe(0);
    expect(c.wouldExceed).toBe(true);
    expect(c.exceedsByPaise).toBe(500_000 + total);
  });
  it("credit never blocks orderability", () => {
    expect(priceOrder(order([detergent(5)], { credit: { limitPaise: 0, outstandingPaise: 0 } })).orderable).toBe(true);
  });
});

// ---- Invariants -----------------------------------------------------------------

describe("invariants over generated orders", () => {
  // Park-Miller LCG (products stay < 2^53), so the test is reproducible.
  function rng(seed: number) {
    let s = seed;
    return (n: number) => {
      s = (s * 48_271) % 2_147_483_647;
      return s % n;
    };
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("seed %i", (seed) => {
    const r = rng(seed);
    const makers = [biscuit, detergent, tea];
    const lines = Array.from({ length: 1 + r(6) }, () =>
      makers[r(3)](r(120), { stockCases: r(200), gstRateBp: [0, 500, 1200, 1800, 2800][r(5)] }),
    );
    const result = priceOrder(order(lines));
    const sum = (k: "grossPaise" | "discountPaise" | "taxablePaise" | "gstPaise" | "totalPaise" | "freeCases") =>
      result.lines.reduce((a, l) => a + l[k], 0);

    for (const l of result.lines) {
      expect(l.taxablePaise).toBe(l.grossPaise - l.discountPaise);
      expect(l.totalPaise).toBe(l.taxablePaise + l.gstPaise);
      for (const v of [l.grossPaise, l.discountPaise, l.taxablePaise, l.gstPaise, l.totalPaise, l.freeCases, l.casePricePaise, l.maxOrderableCases]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      if (l.orderable) expect(l.cases + l.freeCases).toBeLessThanOrEqual(l.maxOrderableCases);
    }
    expect(result.totals.grossPaise).toBe(sum("grossPaise"));
    expect(result.totals.discountPaise).toBe(sum("discountPaise"));
    expect(result.totals.taxablePaise).toBe(sum("taxablePaise"));
    expect(result.totals.gstPaise).toBe(sum("gstPaise"));
    expect(result.totals.totalPaise).toBe(sum("totalPaise"));
    expect(result.totals.freeCases).toBe(sum("freeCases"));
    expect(result.orderable).toBe(result.lines.every((l) => l.orderable));
  });

  it("is deterministic", () => {
    const input = order([biscuit(25), detergent(7), tea(1)]);
    expect(priceOrder(input)).toEqual(priceOrder(input));
  });
});

// ---- Dates and empty order ------------------------------------------------------

describe("isoDateIST", () => {
  it("converts UTC instants to the IST calendar date", () => {
    expect(isoDateIST(new Date("2026-11-01T19:00:00Z"))).toBe("2026-11-02");
    expect(isoDateIST(new Date("2026-11-01T18:00:00Z"))).toBe("2026-11-01");
  });
  it("flips exactly at 18:30Z (IST midnight)", () => {
    expect(isoDateIST(new Date("2026-11-01T18:29:59.999Z"))).toBe("2026-11-01");
    expect(isoDateIST(new Date("2026-11-01T18:30:00.000Z"))).toBe("2026-11-02");
  });
  it("handles year end", () => {
    expect(isoDateIST(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
  });
});

describe("empty order", () => {
  it("is not orderable and has zero totals", () => {
    const result = priceOrder(order([]));
    expect(result.orderable).toBe(false);
    expect(result.lines).toEqual([]);
    expect(result.totals).toEqual({ grossPaise: 0, discountPaise: 0, taxablePaise: 0, gstPaise: 0, totalPaise: 0, cases: 0, freeCases: 0 });
    expect(result.credit.wouldExceed).toBe(false);
  });
});
