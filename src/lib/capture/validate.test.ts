import { describe, expect, it } from "vitest";
import { captureOrder } from "./capture";
import { answer, input, mockModel, type MockLine } from "./test-fixtures";
import type { HistoryItem, RetailerAlias } from "./types";

/** Run one message through the model path with a single mocked model line for segment 0. */
async function viaModel(
  message: string,
  line: Omit<MockLine, "index">,
  extra: { aliases?: RetailerAlias[]; history?: HistoryItem[] } = {},
) {
  const { model } = mockModel(answer([{ index: 0, ...line }]));
  const result = await captureOrder(input(message, extra), { model });
  expect(result.engine).toBe("llm");
  return result.lines[0];
}

describe("model output guards", () => {
  it("drops an invented SKU code and keeps the rules pick", async () => {
    const line = await viaModel("5 peti biscuit chhota", {
      sku_code: "SKU-XX-999",
      quantity: 5,
      unit: "case",
      confidence: 0.99,
    });
    expect(line).toMatchObject({ skuId: "SKU-BS-075", matchedBy: "fuzzy", needsReview: true });
    expect(line.issues).toContain("MODEL_INVALID_SKU");
    expect(line.confidence).toBeLessThan(80);
  });

  it("drops a real SKU that was not offered for the segment", async () => {
    const line = await viaModel("5 peti biscuit chhota", {
      sku_code: "SKU-SP-100",
      quantity: 5,
      unit: "case",
      confidence: 0.99,
    });
    expect(line.skuId).toBe("SKU-BS-075");
    expect(line.issues).toContain("MODEL_INVALID_SKU");
  });

  it("drops invented alternatives and refills them from the ranking", async () => {
    const line = await viaModel("5 peti biscuit chhota", {
      sku_code: "SKU-BS-075",
      alternative_codes: ["SKU-XX-1", "SKU-BS-075", "SKU-BC-075"],
      quantity: 5,
      unit: "case",
      confidence: 0.9,
    });
    expect(line.alternatives).toEqual(["SKU-BC-075", "SKU-BS-200"]);
    expect(line.issues).toContain("MODEL_INVALID_SKU");
  });

  it("forces an unwritten unit to unknown even if the model says case", async () => {
    const line = await viaModel("5 chai patti 500 gram", {
      sku_code: "SKU-TE-500",
      quantity: 5,
      unit: "case",
      confidence: 0.95,
    });
    expect(line).toMatchObject({ skuId: "SKU-TE-500", quantity: 5, unit: "unknown", needsReview: true });
    expect(line.issues).toContain("UNIT_UNCLEAR");
  });

  it("keeps the unit the retailer wrote even if the model says otherwise", async () => {
    const line = await viaModel("5 peti chai patti 500 gram", {
      sku_code: "SKU-TE-500",
      quantity: 5,
      unit: "piece",
      confidence: 0.95,
    });
    expect(line.unit).toBe("case");
  });

  it("uses the alias unit when the text has none", async () => {
    const aliases: RetailerAlias[] = [{ phrase: "chai patti 500g", skuId: "SKU-TE-500", unit: "case" }];
    const line = await viaModel("5 chai patti 500 gram", { sku_code: "SKU-TE-500", quantity: 5, unit: "unknown", confidence: 0.9 }, { aliases });
    expect(line).toMatchObject({ unit: "case", matchedBy: "alias" });
    expect(line.issues).not.toContain("UNIT_UNCLEAR");
  });

  it("keeps a desk alias over a disagreeing model, and shows the disagreement", async () => {
    const aliases: RetailerAlias[] = [{ phrase: "biscuit chhota", skuId: "SKU-BC-075", unit: null }];
    const line = await viaModel("5 peti biscuit chhota", { sku_code: "SKU-BS-075", quantity: 5, unit: "case", confidence: 0.9 }, { aliases });
    expect(line).toMatchObject({ skuId: "SKU-BC-075", matchedBy: "alias" });
    expect(line.issues).toContain("MODEL_DISAGREES");
  });

  it.each([
    ["a number not in the text", 50, 5],
    ["zero", 0, 5],
    ["a fraction", 2.5, 5],
    ["too large", 10000, 5],
    ["null", null, 5],
  ])("replaces a model quantity that is %s with the written one", async (_label, quantity, expected) => {
    const line = await viaModel("5 peti biscuit chhota", { sku_code: "SKU-BS-075", quantity, unit: "case", confidence: 0.9 });
    expect(line.quantity).toBe(expected);
  });

  it("leaves quantity empty when neither the text nor the model has a valid one", async () => {
    const line = await viaModel("biscuit chhota", { sku_code: "SKU-BS-075", quantity: 12, unit: "unknown", confidence: 0.9 });
    expect(line.quantity).toBeNull();
    expect(line.issues).toContain("QTY_MISSING");
  });

  it("keeps a disagreeing model pick but caps confidence at 70 and flags it", async () => {
    const line = await viaModel("5 peti biscuit chhota", { sku_code: "SKU-BS-200", quantity: 5, unit: "case", confidence: 0.99 });
    expect(line).toMatchObject({ skuId: "SKU-BS-200", matchedBy: "llm", needsReview: true });
    expect(line.confidence).toBeLessThanOrEqual(70);
    expect(line.issues).toContain("MODEL_DISAGREES");
    expect(line.alternatives).toContain("SKU-BS-075");
    expect(line.alternatives).not.toContain("SKU-BS-200");
  });

  it("keeps the rules line for a segment the model skipped", async () => {
    const { model } = mockModel(answer([]));
    const result = await captureOrder(input("5 peti biscuit chhota"), { model });
    expect(result.engine).toBe("llm");
    expect(result.lines[0]).toMatchObject({ skuId: "SKU-BS-075", matchedBy: "fuzzy" });
  });

  it("produces integer confidences, bands and review flags consistently", async () => {
    const line = await viaModel("20 cases glucose biscuit 75g", { sku_code: "SKU-BS-075", quantity: 20, unit: "case", confidence: 0.873 });
    expect(Number.isInteger(line.confidence)).toBe(true);
    expect(line).toMatchObject({ confidenceBand: "high", needsReview: false, issues: [] });
  });
});

describe("retailer history never authorises an unrelated SKU (eval F5)", () => {
  const detergentHistory = [{ skuId: "SKU-DT-4KG", timesOrdered: 14, lastCases: 2 }];

  it("rejects a past-order detergent SKU chosen for a biscuit message", async () => {
    const line = await viaModel(
      "10 peti glucose biscuit 75g",
      { sku_code: "SKU-DT-4KG", alternative_codes: ["SKU-DT-4KG"], quantity: 10, unit: "case", confidence: 0.99 },
      { history: detergentHistory },
    );
    expect(line).toMatchObject({ skuId: "SKU-BS-075", matchedBy: "fuzzy", quantity: 10, unit: "case" });
    expect(line.issues).toContain("MODEL_INVALID_SKU");
    expect(line.alternatives).not.toContain("SKU-DT-4KG");
  });

  it("still accepts a past SKU that is one of the segment's candidates", async () => {
    const line = await viaModel(
      "5 peti biscuit chhota",
      { sku_code: "SKU-BC-075", quantity: 5, unit: "case", confidence: 0.9 },
      { history: [{ skuId: "SKU-BC-075", timesOrdered: 9, lastCases: 5 }] },
    );
    expect(line).toMatchObject({ skuId: "SKU-BC-075", matchedBy: "llm" });
    expect(line.issues).not.toContain("MODEL_INVALID_SKU");
  });

  it("gives a line with no candidates no SKU, whatever the model picks from history", async () => {
    const line = await viaModel(
      "give 50% discount",
      { sku_code: "SKU-DT-4KG", quantity: 50, unit: "unknown", confidence: 0.95 },
      { history: detergentHistory },
    );
    expect(line).toMatchObject({ skuId: null, quantity: null, needsReview: true });
  });
});

describe("same-size sibling on the model path", () => {
  it("keeps SIZE_SIBLING and a below-high confidence when the model agrees on 'biscuit chhota'", async () => {
    const line = await viaModel("5 peti biscuit chhota", { sku_code: "SKU-BS-075", quantity: 5, unit: "case", confidence: 0.99 });
    expect(line).toMatchObject({ skuId: "SKU-BS-075", matchedBy: "llm", confidenceBand: "medium", needsReview: true });
    expect(line.issues).toContain("SIZE_SIBLING");
    expect(line.confidence).toBeLessThanOrEqual(79);
  });

  it("does not flag a specific match the model agrees with", async () => {
    const line = await viaModel("5 peti glucose biscuit 75g", { sku_code: "SKU-BS-075", quantity: 5, unit: "case", confidence: 0.95 });
    expect(line.issues).toEqual([]);
    expect(line.confidenceBand).toBe("high");
  });
});
