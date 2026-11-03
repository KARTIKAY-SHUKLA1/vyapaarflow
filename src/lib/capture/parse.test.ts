import { describe, expect, it } from "vitest";
import { normalizeTokens } from "./normalize";
import { parseSegment } from "./parse";

const parse = (text: string) => parseSegment(normalizeTokens(text));

describe("parseSegment", () => {
  it.each(["peti", "petti", "case", "cases", "carton", "ctn", "box", "पेटी"])("reads %s as case", (word) => {
    expect(parse(`5 ${word} rusk`)).toMatchObject({ quantity: 5, unit: "case" });
  });

  it.each(["piece", "pieces", "pc", "pcs", "nag", "packet", "packets", "pkt", "पीस", "पैकेट"])(
    "reads %s as piece",
    (word) => {
      expect(parse(`5 ${word} rusk`)).toMatchObject({ quantity: 5, unit: "piece" });
    },
  );

  it("never defaults the unit", () => {
    expect(parse("24 biscuit cream wala")).toMatchObject({ quantity: 24, unit: "unknown" });
    expect(parse("5 chai patti 500 gram")).toMatchObject({ quantity: 5, unit: "unknown" });
  });

  it("asks when both a case and a piece word are written", () => {
    expect(parse("5 peti 10 packet maggi").unit).toBe("unknown");
  });

  it("does not treat pack sizes as order units or quantities", () => {
    const p = parse("2 peti washing powder 1 kilo");
    expect(p).toMatchObject({ quantity: 2, unit: "case" });
    expect(p.productWords).toEqual(["washing", "powder", "1kg"]);
  });

  it("takes the quantity written after the unit or product", () => {
    expect(parse("neem sabun 2 peti")).toMatchObject({ quantity: 2, unit: "case", productWords: ["neem", "sabun"] });
    expect(parse("chai patti 250 wala 1 peti")).toMatchObject({ quantity: 1, productWords: ["chai", "patti", "250g"] });
  });

  it.each([
    ["naya wala shampoo", null],
    ["0 peti rusk", null],
    ["10000 peti rusk", null],
    ["9999 peti rusk", 9999],
  ])("quantity of %j is %j", (text, quantity) => {
    expect(parse(text).quantity).toBe(quantity);
  });

  it("records every number written, for the validator", () => {
    expect(parse("5 peti biscuit 3").numbers).toEqual([5, 3]);
  });
});

describe("percentages are never quantities", () => {
  it.each(["give 50% discount", "50 % off", "50 percent off", "50 pratishat chhoot", "50 प्रतिशत छूट", "50percent"])(
    "%s → no quantity",
    (text) => {
      expect(parse(text)).toMatchObject({ quantity: null, numbers: [] });
    },
  );

  it("keeps the real quantity next to a percentage", () => {
    expect(parse("5 peti rusk 10% scheme")).toMatchObject({ quantity: 5, numbers: [5], unit: "case" });
  });
});

describe("dabba", () => {
  it("does not read डिब्बा as a case: the desk asks", () => {
    expect(parse("5 डिब्बा rusk")).toMatchObject({ quantity: 5, unit: "unknown" });
    expect(parse("5 dabba rusk")).toMatchObject({ quantity: 5, unit: "unknown" });
  });
});
