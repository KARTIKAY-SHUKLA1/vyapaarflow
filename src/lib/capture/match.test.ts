import { describe, expect, it } from "vitest";
import { buildMatchContext, matchSegment } from "./match";
import { normalizeTokens } from "./normalize";
import { parseSegment } from "./parse";
import { catalogue } from "./test-fixtures";
import type { HistoryItem, RetailerAlias } from "./types";

function match(text: string, opts: { aliases?: RetailerAlias[]; history?: HistoryItem[] } = {}) {
  const ctx = buildMatchContext(catalogue, opts.aliases ?? [], opts.history ?? []);
  return matchSegment(parseSegment(normalizeTokens(text)).productWords, ctx);
}

const top = (text: string) => match(text).ranked[0]?.skuId ?? null;

describe("matchSegment", () => {
  it.each([
    ["washing powder 1 kilo", "SKU-DT-1KG"],
    ["surf 500 gm", "SKU-DT-500"],
    ["detergent 4 kg", "SKU-DT-4KG"],
    ["chai patti 250 wala", "SKU-TE-250"],
    ["tea dust 250g", "SKU-TD-250"],
    ["maggi type noodles", "SKU-ND-070"],
    ["neem sabun", "SKU-SP-100"],
    ["dishwash gel", "SKU-DW-500"],
    ["vim bar", "SKU-DW-BAR"],
    ["biscuit cream wala", "SKU-BC-075"],
    ["marie biscuit", "SKU-MR-100"],
    ["rusk", "SKU-RK-200"],
    ["khatta meetha", "SKU-MX-200"],
    ["डिटर्जेंट पाउडर 1 किलो", "SKU-DT-1KG"],
  ])("%s → %s", (text, sku) => {
    expect(top(text)).toBe(sku);
  });

  it("uses chhota / bada to pick the smallest / largest pack of the product", () => {
    expect(top("biscuit chhota")).toBe("SKU-BS-075");
    expect(top("bhujia bada wala")).toBe("SKU-NM-400");
    expect(top("chhota bhujia")).toBe("SKU-NM-150");
    expect(top("surf bada")).toBe("SKU-DT-4KG");
  });

  it("returns a ranked list with scores between 0 and 100", () => {
    const { ranked } = match("glucose biscuit 75g");
    expect(ranked[0]).toEqual({ skuId: "SKU-BS-075", score: 100 });
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].score).toBeLessThanOrEqual(ranked[i - 1].score);
      expect(ranked[i].score).toBeGreaterThanOrEqual(0);
    }
  });

  it("is confident when the size decides, and not when it is missing", () => {
    expect(match("glucose biscuit 75g").confidence).toBeGreaterThanOrEqual(80);
    expect(match("glucose biscuit").confidence).toBeLessThan(50);
  });

  it("lowers confidence for words it did not understand", () => {
    expect(match("rusk").confidence).toBeGreaterThan(match("rusk kesari special").confidence);
  });

  it("returns nothing for unknown products", () => {
    expect(match("naya wala shampoo")).toMatchObject({ ranked: [], confidence: 0, matchedBy: "none" });
  });

  it("puts a retailer alias on top with its unit", () => {
    const aliases: RetailerAlias[] = [{ phrase: "biscuit chhota", skuId: "SKU-BC-075", unit: "piece" }];
    const m = match("biscuit chhota", { aliases });
    expect(m.ranked[0].skuId).toBe("SKU-BC-075");
    expect(m.ranked.filter((c) => c.skuId === "SKU-BC-075")).toHaveLength(1);
    expect(m).toMatchObject({ matchedBy: "alias", aliasUnit: "piece" });
    expect(m.confidence).toBeGreaterThanOrEqual(90);
  });

  it("ignores aliases for SKUs that are not in the catalogue", () => {
    const aliases: RetailerAlias[] = [{ phrase: "biscuit chhota", skuId: "SKU-GONE", unit: null }];
    expect(match("biscuit chhota", { aliases }).matchedBy).toBe("fuzzy");
  });

  it("uses retailer history to break a near-tie", () => {
    const history: HistoryItem[] = [
      { skuId: "SKU-TE-500", timesOrdered: 12, lastCases: 3 },
      { skuId: "SKU-TE-100", timesOrdered: 1, lastCases: 1 },
    ];
    expect(match("chai").ranked[0].skuId).toBe("SKU-TE-100");
    const m = match("chai", { history });
    expect(m.ranked[0].skuId).toBe("SKU-TE-500");
    expect(m.matchedBy).toBe("history");
  });

  it("does not let history override an explicit pack size", () => {
    const history: HistoryItem[] = [{ skuId: "SKU-TE-500", timesOrdered: 50, lastCases: 3 }];
    const m = match("chai patti 250 wala", { history });
    expect(m.ranked[0].skuId).toBe("SKU-TE-250");
    expect(m.matchedBy).toBe("fuzzy");
  });
});
