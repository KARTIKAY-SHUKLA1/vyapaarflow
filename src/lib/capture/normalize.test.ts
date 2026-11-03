import { describe, expect, it } from "vitest";
import { normalizeTokens, numberWordValue } from "./normalize";
import { normalize } from "./normalize";

describe("normalize", () => {
  it("lowercases and strips greetings and filler", () => {
    expect(normalize("Bhaiya NAMASTE ji, please send kal subah tak bhej dena")).toBe("");
    expect(normalize("Please send 20 cases Glucose Biscuit")).toBe("20 cases glucose biscuit");
  });

  it("converts Devanagari digits", () => {
    expect(normalize("१० पेटी")).toBe("10 peti");
  });

  it.each([
    ["paanch peti chai", "5 peti chai"],
    ["teen peti rusk", "3 peti rusk"],
    ["das cases maggi", "10 cases maggi"],
    ["तीन पेटी", "3 peti"],
    ["पाँच पेटी", "5 peti"],
    ["पांच पेटी", "5 peti"],
    ["do peti chai", "2 peti chai"],
  ])("reads number words: %s", (text, expected) => {
    expect(normalize(text)).toBe(expected);
  });

  it("does not read 'do' as two in 'bhej do'", () => {
    expect(normalize("3 peti chai bhej do")).toBe("3 peti chai");
  });

  it("transliterates common Devanagari product and unit words", () => {
    expect(normalize("भैया 10 पेटी ग्लूकोज बिस्कुट")).toBe("10 peti glucose biscuit");
    expect(normalize("3 पेटी भुजिया बड़ा वाला")).toBe("3 peti bhujia bada");
    expect(normalize("चाय पत्ती 500 ग्राम")).toBe("chai patti 500g");
    expect(normalize("नीम साबुन")).toBe("neem sabun");
  });

  it.each(["1 kilo", "1kg", "1 kg", "1000 gm", "1000g", "1 KG"])("unifies %s to 1kg", (text) => {
    expect(normalize(`surf ${text}`)).toBe("surf 1kg");
  });

  it.each(["250 wala", "250g", "250 gm", "250 gram", "250 grams"])("unifies %s to 250g", (text) => {
    expect(normalize(`chai patti ${text}`)).toBe("chai patti 250g");
  });

  it("handles ml and fractional kilos", () => {
    expect(normalize("dishwash gel 500 ml")).toBe("dishwash gel 500ml");
    expect(normalize("surf 0.5 kg")).toBe("surf 500g");
  });

  it("does not read a small number before 'wala' as a pack size", () => {
    expect(normalize("5 wala biscuit")).toBe("5 biscuit");
  });

  it("splits a number glued to a unit word but keeps glued sizes", () => {
    expect(normalize("5peti biscuit 75g")).toBe("5 peti biscuit 75g");
  });

  it("folds spelling variants", () => {
    expect(normalize("biskut chota")).toBe("biscuit chhota");
    expect(normalize("2 petti chay patti")).toBe("2 peti chai patti");
  });
});

describe("numberWordValue: 'do' after discount and free words", () => {
  it.each([
    [["chhoot"], undefined, null],
    [["discount"], undefined, null],
    [["free", "mein"], undefined, null], // filler between the term and "do" is skipped
    [["free"], "peti", 2], // a unit word follows: the number two
    [["discount"], "case", 2],
    [["bhej"], undefined, null], // unchanged: "bhej do" is always the verb
    [[], "peti", 2],
    [["rusk"], "peti", 2],
  ] as const)("do after %j, before %s → %s", (before, next, expected) => {
    expect(numberWordValue("do", [...before], next)).toBe(expected);
  });

  it("keeps ordinary Hindi and Hinglish 'do' quantities", () => {
    for (const text of ["do peti rusk", "rusk do peti", "दो पेटी मैगी", "maggi do case"]) {
      expect(normalizeTokens(text)).toContain("2");
    }
  });
});

describe("pack descriptions with 'wala'", () => {
  it.each([
    ["offer wala biscuit", "offerwala"],
    ["scheme wala chai", "schemewala"],
    ["surf free wala", "freewala"],
    ["ऑफर वाला बिस्कुट", "offerwala"],
  ])("%s keeps the description as one word (%s), not a requested term", (text, word) => {
    const tokens = normalizeTokens(text);
    expect(tokens).toContain(word);
    expect(tokens).not.toContain("offer");
    expect(tokens).not.toContain("free");
  });
});
