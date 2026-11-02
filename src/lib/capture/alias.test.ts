import { describe, expect, it } from "vitest";
import { aliasPhrase } from "./alias";

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
