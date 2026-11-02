import { describe, expect, it } from "vitest";
import { SESSION_TTL_SEC, signSession, verifySessionToken } from "./token";

describe("session token", () => {
  const now = new Date("2026-11-02T10:00:00Z");

  it("round-trips subject and role", async () => {
    const token = await signSession({ sub: "u1", role: "desk" }, now);
    expect(await verifySessionToken(token, now)).toEqual({ sub: "u1", role: "desk" });
  });

  it("rejects a tampered token", async () => {
    const token = await signSession({ sub: "u1", role: "retailer" }, now);
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "u1", role: "desk", iat: 0, exp: 9e9 })).toString("base64url");
    expect(await verifySessionToken(`${h}.${forged}.${s}`, now)).toBeNull();
    expect(await verifySessionToken(`${h}.${p}.${s.slice(0, -2)}xx`, now)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession({ sub: "u1", role: "retailer" }, now);
    const later = new Date(now.getTime() + (SESSION_TTL_SEC + 60) * 1000);
    expect(await verifySessionToken(token, later)).toBeNull();
  });

  it("rejects garbage and missing tokens without throwing", async () => {
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
  });
});
