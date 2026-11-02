import { describe, expect, it } from "vitest";
import { canAccessRetailer, canUseArea, homeFor, type Viewer } from "./policy";

const v = (role: Viewer["role"], extra: Partial<Viewer> = {}): Viewer => ({
  id: "u-" + role,
  name: role,
  role,
  retailerId: null,
  language: "en",
  ...extra,
});

const shopA = { id: "r-A", salesmanId: "u-salesman" };
const shopB = { id: "r-B", salesmanId: "u-other-salesman" };

describe("canAccessRetailer (prices and credit visible only to the retailer, their salesman and the desk)", () => {
  it("lets a retailer see only their own shop", () => {
    const me = v("retailer", { retailerId: "r-A" });
    expect(canAccessRetailer(me, shopA)).toBe(true);
    expect(canAccessRetailer(me, shopB)).toBe(false);
  });

  it("denies a retailer user with no linked shop", () => {
    expect(canAccessRetailer(v("retailer"), shopA)).toBe(false);
  });

  it("lets a salesman see only shops assigned to them", () => {
    const s = v("salesman");
    expect(canAccessRetailer(s, shopA)).toBe(true);
    expect(canAccessRetailer(s, shopB)).toBe(false);
    expect(canAccessRetailer(s, { id: "r-C", salesmanId: null })).toBe(false);
  });

  it("lets the desk see every shop", () => {
    expect(canAccessRetailer(v("desk"), shopA)).toBe(true);
    expect(canAccessRetailer(v("desk"), shopB)).toBe(true);
  });
});

describe("areas", () => {
  it("keeps retailers out of the desk and the desk out of the shop", () => {
    expect(canUseArea("retailer", "shop")).toBe(true);
    expect(canUseArea("retailer", "desk")).toBe(false);
    expect(canUseArea("desk", "desk")).toBe(true);
    expect(canUseArea("desk", "shop")).toBe(false);
    expect(canUseArea("salesman", "desk")).toBe(false);
  });

  it("routes each role home", () => {
    expect(homeFor("retailer")).toBe("/shop");
    expect(homeFor("desk")).toBe("/desk");
  });
});
