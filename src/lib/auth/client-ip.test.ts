import { describe, expect, it } from "vitest";
import { clientIp, normalizeIp } from "./client-ip";

const VERCEL = { VERCEL: "1" };
const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  it("ignores forwarded headers when not on Vercel (they are client-controlled there)", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7" }), {})).toBeNull();
    expect(clientIp(h({ "x-real-ip": "203.0.113.7" }), { VERCEL: "0" })).toBeNull();
  });

  it("on Vercel uses x-real-ip, which the edge sets", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.7" }), VERCEL)).toBe("203.0.113.7");
  });

  it("prefers x-real-ip over x-forwarded-for, and falls back to its first entry", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1" }), VERCEL)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }), VERCEL)).toBe("198.51.100.1");
  });

  it("returns null for missing or malformed values", () => {
    expect(clientIp(h({}), VERCEL)).toBeNull();
    expect(clientIp(h({ "x-real-ip": "" }), VERCEL)).toBeNull();
    expect(clientIp(h({ "x-real-ip": "unknown" }), VERCEL)).toBeNull();
    expect(clientIp(h({ "x-real-ip": "1.2.3.4; DROP TABLE users" }), VERCEL)).toBeNull();
    expect(clientIp(h({ "x-real-ip": "999.1.1.1" }), VERCEL)).toBeNull();
  });
});

describe("normalizeIp", () => {
  it("keeps IPv4 as is and unwraps IPv4-mapped IPv6", () => {
    expect(normalizeIp("192.0.2.10")).toBe("192.0.2.10");
    expect(normalizeIp("::ffff:192.0.2.10")).toBe("192.0.2.10");
  });

  it("groups IPv6 by /64, so rotating the interface part does not give a fresh limit", () => {
    const a = normalizeIp("2001:db8:abcd:12:1:2:3:4");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(normalizeIp("2001:db8:abcd:12::99")).toBe(a);
    expect(normalizeIp("2001:0DB8:ABCD:0012:ffff:0:0:1")).toBe(a);
    expect(normalizeIp("2001:db8:abcd:13::1")).not.toBe(a);
    expect(normalizeIp("::1")).toBe("0:0:0:0::/64");
  });
});
