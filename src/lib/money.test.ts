import { describe, expect, it } from "vitest";
import { formatBp, formatPaise, formatPaiseCompact } from "./money";

describe("money formatting", () => {
  it("formats paise as rupees with Indian grouping", () => {
    expect(formatPaise(77760)).toBe("₹777.60");
    expect(formatPaise(12345600)).toBe("₹1,23,456.00");
    expect(formatPaise(0)).toBe("₹0.00");
  });

  it("compacts lakhs and crores", () => {
    expect(formatPaiseCompact(12345600)).toBe("₹1.23 L");
    expect(formatPaiseCompact(90_00_00_00_000)).toBe("₹90.00 Cr");
  });

  it("formats basis points", () => {
    expect(formatBp(300)).toBe("3%");
    expect(formatBp(250)).toBe("2.5%");
    expect(formatBp(1800)).toBe("18%");
  });
});
