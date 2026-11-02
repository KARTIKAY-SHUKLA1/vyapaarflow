import { describe, expect, it } from "vitest";
import { schemes } from "@/db/seed-data";
import { describeScheme } from "./describe";

describe("describeScheme", () => {
  it("reproduces every seeded English label exactly (incl. the brief's two)", () => {
    for (const s of schemes) expect(describeScheme(s, "en")).toBe(s.label);
  });

  it("describes schemes in Hindi from the same rule", () => {
    expect(describeScheme({ type: "FREE_GOODS", buyQty: 10, freeQty: 1 }, "hi")).toBe("10 केस पर 1 केस मुफ़्त");
    expect(describeScheme({ type: "SLAB_PERCENT", minQty: 5, percentBp: 300 }, "hi")).toBe("5 या ज़्यादा केस पर 3% छूट");
    expect(describeScheme({ type: "SLAB_PERCENT", minQty: 10, percentBp: 250 }, "hi")).toBe("10 या ज़्यादा केस पर 2.5% छूट");
  });

  it("uses the singular for buying one case", () => {
    expect(describeScheme({ type: "FREE_GOODS", buyQty: 1, freeQty: 1 }, "en")).toBe("Buy 1 case get 1 free");
    expect(describeScheme({ type: "SLAB_PERCENT", minQty: 1, percentBp: 100 }, "en")).toBe("1% off 1 or more cases");
  });
});
