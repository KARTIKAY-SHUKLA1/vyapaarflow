import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import type { DB } from "@/db";
import { rateLimits } from "@/db/schema";
import { testDb } from "@/test/db";
import { requestOtp } from "./otp";
import { checkOtpRateLimit, DEFAULT_OTP_RATE_LIMITS, otpRateLimitsFromEnv, type OtpRateLimits } from "./rate-limit";

// Small limits keep the tests fast; production defaults are in DEFAULT_OTP_RATE_LIMITS.
const L: OtpRateLimits = { windowMs: 10 * 60_000, ipSend: 3, ipVerify: 5, globalSend: 10, globalVerify: 20 };
const t0 = new Date("2026-11-02T10:00:00Z"); // aligned to a 10-minute window
const at = (ms: number) => new Date(t0.getTime() + ms);
const IP_A = "203.0.113.7";
const IP_B = "198.51.100.20";
const okCount = (rs: { ok: boolean }[]) => rs.filter((r) => r.ok).length;

let db: DB;
let client: Client;
beforeEach(async () => {
  ({ db, client } = await testDb());
});

describe("checkOtpRateLimit", () => {
  it("40 simultaneous sends from one IP: exactly the per-IP limit gets through", async () => {
    const rs = await Promise.all(Array.from({ length: 40 }, () => checkOtpRateLimit(db, "send", IP_A, t0, L)));
    expect(okCount(rs)).toBe(L.ipSend);
    expect(rs.filter((r) => !r.ok && r.scope === "ip")).toHaveLength(40 - L.ipSend);
  });

  it("40 simultaneous sends from 40 IPs: exactly the global limit gets through", async () => {
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => checkOtpRateLimit(db, "send", `192.0.2.${i + 1}`, t0, L)));
    expect(okCount(rs)).toBe(L.globalSend);
    expect(rs.filter((r) => !r.ok && r.scope === "global")).toHaveLength(40 - L.globalSend);
  });

  it("one IP cycling through many phone numbers is stopped, with the same answer for registered and unknown numbers", async () => {
    const phones = ["919000000001", "919000000002", "919111111111", "919000000003", "919222222222", "919000000004"];
    const outcomes: unknown[] = [];
    for (const phone of phones) {
      const limited = await checkOtpRateLimit(db, "send", IP_A, at(1000), L);
      outcomes.push(limited.ok ? await requestOtp(db, phone, at(1000)) : limited);
    }
    // First three go through to the per-phone step; the rest are refused before any user lookup.
    expect(outcomes.slice(0, 3)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    const refused = outcomes.slice(3);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(r).toEqual({ ok: false, scope: "ip", retryAfterSec: 599 });
  });

  it("retailers on different IPs are not affected by an exhausted IP", async () => {
    for (let i = 0; i < L.ipSend + 5; i++) await checkOtpRateLimit(db, "send", IP_A, t0, L);
    expect((await checkOtpRateLimit(db, "send", IP_A, t0, L)).ok).toBe(false);
    expect((await checkOtpRateLimit(db, "send", IP_B, t0, L)).ok).toBe(true);
  });

  it("missing IP: the per-IP check is skipped, the global limit still applies", async () => {
    const rs = await Promise.all(Array.from({ length: 25 }, () => checkOtpRateLimit(db, "send", null, t0, L)));
    expect(okCount(rs)).toBe(L.globalSend);
    expect(rs.every((r) => r.ok || r.scope === "global")).toBe(true);
    const keys = (await db.select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key);
    expect(keys).toEqual(["otp:send:global"]);
  });

  it("limits expire with their window", async () => {
    for (let i = 0; i < L.ipSend; i++) expect((await checkOtpRateLimit(db, "send", IP_A, at(i * 1000), L)).ok).toBe(true);
    const refused = await checkOtpRateLimit(db, "send", IP_A, at(4 * 60_000), L);
    expect(refused).toEqual({ ok: false, scope: "ip", retryAfterSec: 6 * 60 });
    expect(await checkOtpRateLimit(db, "send", IP_A, at(L.windowMs - 1), L)).toEqual({ ok: false, scope: "ip", retryAfterSec: 1 });
    expect((await checkOtpRateLimit(db, "send", IP_A, at(L.windowMs), L)).ok).toBe(true);
  });

  it("a late request from the previous window cannot reset a newer window's count", async () => {
    const next = L.windowMs; // start of the second window
    for (let i = 0; i < L.ipSend; i++) expect((await checkOtpRateLimit(db, "send", IP_A, at(next + 1000), L)).ok).toBe(true);
    // Computed "now" just before the boundary, but executed after the new window began.
    const late = await checkOtpRateLimit(db, "send", IP_A, at(next - 1), L);
    expect(late).toEqual({ ok: false, scope: "ip", retryAfterSec: 601 });
    expect((await checkOtpRateLimit(db, "send", IP_A, at(next + 2000), L)).ok).toBe(false);
  });

  it("counts sends and verifications separately, with their own limits", async () => {
    for (let i = 0; i < L.ipSend; i++) await checkOtpRateLimit(db, "send", IP_A, t0, L);
    expect((await checkOtpRateLimit(db, "send", IP_A, t0, L)).ok).toBe(false);
    const verifies = await Promise.all(Array.from({ length: 12 }, () => checkOtpRateLimit(db, "verify", IP_A, t0, L)));
    expect(okCount(verifies)).toBe(L.ipVerify);
  });

  it("keeps the per-phone limits: a second code within 30 s is refused even when the IP is under its limit", async () => {
    expect((await checkOtpRateLimit(db, "send", IP_A, t0, L)).ok).toBe(true);
    expect(await requestOtp(db, "919000000001", t0)).toEqual({ ok: true });
    expect((await checkOtpRateLimit(db, "send", IP_A, at(5000), L)).ok).toBe(true);
    expect(await requestOtp(db, "919000000001", at(5000))).toMatchObject({ ok: false, error: "RATE_LIMITED" });
  });

  it("stores no raw IP address", async () => {
    await checkOtpRateLimit(db, "send", IP_A, t0, L);
    await checkOtpRateLimit(db, "verify", "2001:db8:abcd:12::/64", t0, L);
    const keys = (await db.select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key).join(" ");
    expect(keys).not.toContain(IP_A);
    expect(keys).not.toContain("2001:db8");
    expect(keys).toMatch(/otp:send:ip:[0-9a-f]{32}/);
  });

  it("drops counters from finished windows when a new window starts", async () => {
    await checkOtpRateLimit(db, "send", IP_A, t0, L);
    await checkOtpRateLimit(db, "send", IP_B, t0, L);
    expect(await db.select().from(rateLimits)).toHaveLength(3); // two IPs + global
    await checkOtpRateLimit(db, "send", null, at(L.windowMs), L); // first hit of the next window
    const rows = await db.select().from(rateLimits);
    expect(rows.map((r) => r.key)).toEqual(["otp:send:global"]);
    expect(rows[0].count).toBe(1);
  });

  it("if migration 0003 has not been applied, allows the request (per-phone limits still apply) instead of breaking sign-in", async () => {
    await client.execute("DROP TABLE rate_limits");
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      expect(await checkOtpRateLimit(db, "send", IP_A, t0, L)).toEqual({ ok: true, degraded: true });
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });
});

describe("otpRateLimitsFromEnv", () => {
  it("uses the defaults when nothing is set", () => {
    expect(otpRateLimitsFromEnv({})).toEqual(DEFAULT_OTP_RATE_LIMITS);
  });

  it("accepts positive integer overrides and ignores invalid ones", () => {
    expect(
      otpRateLimitsFromEnv({ OTP_RATE_WINDOW_SEC: "300", OTP_IP_SEND_LIMIT: "50", OTP_IP_VERIFY_LIMIT: "-1", OTP_GLOBAL_SEND_LIMIT: "abc", OTP_GLOBAL_VERIFY_LIMIT: "1.5" }),
    ).toEqual({ ...DEFAULT_OTP_RATE_LIMITS, windowMs: 300_000, ipSend: 50 });
  });
});
