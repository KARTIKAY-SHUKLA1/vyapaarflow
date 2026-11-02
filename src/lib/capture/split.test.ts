import { describe, expect, it } from "vitest";
import { splitMessage } from "./split";
import { BRIEF_MESSAGE } from "./test-fixtures";

const texts = (message: string) => splitMessage(message).segments.map((s) => s.text);

describe("splitMessage", () => {
  it("splits the brief message on commas and drops the greeting from the span", () => {
    expect(texts(BRIEF_MESSAGE)).toEqual([
      "5 peti biscuit chhota",
      "2 peti washing powder 1 kilo",
      "chai patti 250 wala 1 peti",
    ]);
  });

  it("keeps exact original spans (offsets into the message)", () => {
    for (const seg of splitMessage(BRIEF_MESSAGE).segments) {
      expect(BRIEF_MESSAGE.slice(seg.start, seg.end)).toBe(seg.text);
    }
  });

  it.each([
    ["5 peti rusk aur 2 peti maggi", ["5 peti rusk", "2 peti maggi"]],
    ["5 peti rusk and 2 peti maggi", ["5 peti rusk", "2 peti maggi"]],
    ["5 peti rusk & 2 peti maggi", ["5 peti rusk", "2 peti maggi"]],
    ["5 peti rusk; 2 peti maggi", ["5 peti rusk", "2 peti maggi"]],
    ["5 peti rusk\n2 peti maggi", ["5 peti rusk", "2 peti maggi"]],
    ["5 पेटी रस्क और 2 पेटी मैगी", ["5 पेटी रस्क", "2 पेटी मैगी"]],
    ["2 rusk. aur woh naya wala shampoo bhi", ["2 rusk", "naya wala shampoo"]],
  ])("splits %j", (message, expected) => {
    expect(texts(message)).toEqual(expected);
  });

  it("splits back-to-back quantity groups with no separator", () => {
    expect(texts("5 peti biscuit 2 peti surf 3 peti chai")).toEqual(["5 peti biscuit", "2 peti surf", "3 peti chai"]);
  });

  it("does not split on a pack size or a quantity written after the product", () => {
    expect(texts("2 peti washing powder 1 kilo")).toEqual(["2 peti washing powder 1 kilo"]);
    expect(texts("neem sabun 2 peti")).toEqual(["neem sabun 2 peti"]);
    expect(texts("surf 2.5 kg 3 peti")).toEqual(["surf 2.5 kg 3 peti"]);
  });

  it("returns greeting-only pieces as ignored", () => {
    const { segments, ignored } = splitMessage("Namaste bhai. 12 peti maggi");
    expect(segments.map((s) => s.text)).toEqual(["12 peti maggi"]);
    expect(ignored).toEqual(["Namaste bhai"]);
  });

  it("keeps a leading number word that looks like filler", () => {
    expect(texts("do peti chai bhej do")).toEqual(["do peti chai"]);
  });
});
