import { describe, expect, it } from "vitest";
import { formatIndianMobile, normalizeIndianMobile } from "./phone";

describe("normalizeIndianMobile", () => {
  it.each([
    ["9000000001", "919000000001"],
    ["+91 90000 00001", "919000000001"],
    ["91-9000000001", "919000000001"],
    ["09000000001", "919000000001"],
    ["(900) 000-0001", "919000000001"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each(["", "12345", "5000000001", "90000000011", "+1 415 555 0100", "98765abcde", "919000000001; DROP TABLE"])(
    "rejects %s",
    (input) => {
      expect(normalizeIndianMobile(input)).toBeNull();
    },
  );

  it("formats for display", () => {
    expect(formatIndianMobile("919000000001")).toBe("+91 90000 00001");
  });
});
