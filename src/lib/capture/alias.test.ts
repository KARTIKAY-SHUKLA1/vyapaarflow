import { describe, expect, it } from "vitest";
import { aliasEligible, aliasPhrase } from "./alias";

describe("aliasPhrase", () => {
  it("keeps only product words", () => {
    expect(aliasPhrase("bhaiya 5 peti biscuit chhota")).toBe("biscuit chhota");
    expect(aliasPhrase("chai patti 250 wala 1 peti")).toBe("250g chai patti");
  });

  it.each([
    "biscuit chhota",
    "5 peti biscuit chhota",
    "  5   PETI  Biscuit   Chhota ",
    "chhota biscuit 10 cases",
    "bhaiya 5 petti biskut chota please",
    "पाँच पेटी बिस्कुट छोटा",
    "५ पेटी छोटा बिस्कुट",
    "biscuit biscuit chhota",
  ])("is stable for %j", (text) => {
    expect(aliasPhrase(text)).toBe("biscuit chhota");
  });

  it("is idempotent, so stored phrases can be looked up again", () => {
    for (const text of ["2 peti washing powder 1 kilo", "भुजिया बड़ा वाला", "neem sabun"]) {
      expect(aliasPhrase(aliasPhrase(text))).toBe(aliasPhrase(text));
    }
  });

  it("unifies pack-size spellings", () => {
    expect(aliasPhrase("surf 1 kilo")).toBe(aliasPhrase("surf 1000 gm"));
  });

  it("keeps different products apart", () => {
    expect(aliasPhrase("biscuit chhota")).not.toBe(aliasPhrase("biscuit bada"));
    expect(aliasPhrase("chai patti 250g")).not.toBe(aliasPhrase("chai patti 500g"));
  });

  it("is empty for text with no product words", () => {
    expect(aliasPhrase("bhaiya 5 peti")).toBe("");
  });
});

describe("aliasEligible", () => {
  it.each(["5 peti biscuit chhota", "offer wala biscuit", "scheme wala chai", "surf excel free wala", "lal wala sabun", "ऑफर वाला बिस्कुट"])(
    "allows plain item words and pack descriptions: %j",
    (text) => {
      expect(aliasEligible(text, [])).toBe(true);
    },
  );

  it.each(["give 50% discount", "set price to 0", "5 peti biscuit 50% off", "biscuit free", "add free", "mark tea leaf 250g as in stock", "डिस्काउंट दो", "5 peti", ""])(
    "refuses instruction, terms, percentage and product-less phrases: %j",
    (text) => {
      expect(aliasEligible(text, [])).toBe(false);
    },
  );

  it.each(["INSTRUCTION_TEXT", "TERMS_REQUESTED", "QTY_SEPARATED"])("refuses any line flagged %s", (issue) => {
    expect(aliasEligible("glucose biscuit 75g", [issue])).toBe(false);
  });

  it("ignores unrelated issues", () => {
    expect(aliasEligible("biscuit chhota", ["SIZE_SIBLING", "UNIT_UNCLEAR"])).toBe(true);
  });
});
