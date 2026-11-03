import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { otpCodes, smsOutbox, users } from "@/db/schema";
import { testDb } from "@/test/db";
import { latestDemoOtp, OTP_MAX_ATTEMPTS, OTP_TTL_MS, requestOtp, verifyOtp } from "./otp";

const RETAILER = "919000000001";
const UNKNOWN = "919111111111";
const t0 = new Date("2026-11-02T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const fixed = (code: string) => () => code;

let db: DB;
beforeEach(async () => {
  ({ db } = await testDb());
});

describe("requestOtp", () => {
  it("sends a code to a registered number and stores only a hash", async () => {
    expect(await requestOtp(db, RETAILER, t0, fixed("123456"))).toEqual({ ok: true });
    const [row] = await db.select().from(otpCodes).where(eq(otpCodes.phone, RETAILER));
    expect(row.codeHash).not.toContain("123456");
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await latestDemoOtp(db, RETAILER)).toBe("123456");
  });

  it("answers the same for an unknown number but sends nothing", async () => {
    expect(await requestOtp(db, UNKNOWN, t0, fixed("123456"))).toEqual({ ok: true });
    expect(await db.select().from(smsOutbox).where(eq(smsOutbox.toPhone, UNKNOWN))).toHaveLength(0);
    expect((await verifyOtp(db, UNKNOWN, "123456", at(1000))).ok).toBe(false);
  });

  it("throttles resends within 30 seconds and caps requests per hour", async () => {
    await requestOtp(db, RETAILER, t0);
    const quick = await requestOtp(db, RETAILER, at(10_000));
    expect(quick).toMatchObject({ ok: false, error: "RATE_LIMITED" });

    for (let i = 1; i < 5; i++) expect((await requestOtp(db, RETAILER, at(i * 60_000))).ok).toBe(true);
    expect(await requestOtp(db, RETAILER, at(6 * 60_000))).toMatchObject({ ok: false, error: "RATE_LIMITED" });
    expect((await requestOtp(db, RETAILER, at(61 * 60_000))).ok).toBe(true);
  });

  it("does not send to a deactivated user", async () => {
    await db.update(users).set({ active: false }).where(eq(users.phone, RETAILER));
    await requestOtp(db, RETAILER, t0, fixed("123456"));
    expect(await latestDemoOtp(db, RETAILER)).toBeNull();
  });
});

describe("verifyOtp", () => {
  it("accepts the right code once", async () => {
    await requestOtp(db, RETAILER, t0, fixed("246810"));
    const ok = await verifyOtp(db, RETAILER, "246810", at(5_000));
    expect(ok.ok).toBe(true);
    expect(await verifyOtp(db, RETAILER, "246810", at(6_000))).toEqual({ ok: false, error: "INVALID" });
  });

  it("rejects an expired code", async () => {
    await requestOtp(db, RETAILER, t0, fixed("246810"));
    expect(await verifyOtp(db, RETAILER, "246810", at(OTP_TTL_MS + 1))).toEqual({ ok: false, error: "EXPIRED" });
  });

  it("locks the code after too many wrong attempts, even if the right one follows", async () => {
    await requestOtp(db, RETAILER, t0, fixed("246810"));
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) {
      expect(await verifyOtp(db, RETAILER, "000000", at(1000))).toEqual({ ok: false, error: "INVALID" });
    }
    expect(await verifyOtp(db, RETAILER, "000000", at(1000))).toEqual({ ok: false, error: "TOO_MANY_ATTEMPTS" });
    expect(await verifyOtp(db, RETAILER, "246810", at(1000))).toEqual({ ok: false, error: "TOO_MANY_ATTEMPTS" });
  });

  it("rejects malformed input without touching the database", async () => {
    expect(await verifyOtp(db, RETAILER, "12ab56")).toEqual({ ok: false, error: "INVALID" });
    expect(await verifyOtp(db, RETAILER, "' OR 1=1 --")).toEqual({ ok: false, error: "INVALID" });
  });

  it("uses only the latest code after a resend", async () => {
    await requestOtp(db, RETAILER, t0, fixed("111111"));
    await requestOtp(db, RETAILER, at(31_000), fixed("222222"));
    expect((await verifyOtp(db, RETAILER, "111111", at(32_000))).ok).toBe(false);
    expect((await verifyOtp(db, RETAILER, "222222", at(33_000))).ok).toBe(true);
  });
});

// Security audit H1 and M1: limits must hold when requests arrive at the same time,
// not only one after another. testDb() is a real SQLite file, so these run with
// genuine concurrent connections.
describe("concurrent requests", () => {
  const attemptsFor = async (phone: string) =>
    (await db.select({ attempts: otpCodes.attempts }).from(otpCodes).where(eq(otpCodes.phone, phone))).map((r) => r.attempts);

  it("H1: 40 simultaneous wrong guesses use at most 5 attempts, then the right code is refused", async () => {
    await requestOtp(db, RETAILER, t0, fixed("246810"));
    const wrong = Array.from({ length: 40 }, (_, i) => String(100000 + i)); // none is 246810
    const results = await Promise.all(wrong.map((c) => verifyOtp(db, RETAILER, c, at(1000))));

    expect(results.every((r) => !r.ok)).toBe(true);
    // Exactly OTP_MAX_ATTEMPTS guesses were compared: the first four say INVALID, the
    // fifth and every guess that found no attempt left say TOO_MANY_ATTEMPTS.
    expect(results.filter((r) => !r.ok && r.error === "INVALID")).toHaveLength(OTP_MAX_ATTEMPTS - 1);
    expect(results.filter((r) => !r.ok && r.error === "TOO_MANY_ATTEMPTS")).toHaveLength(40 - (OTP_MAX_ATTEMPTS - 1));
    expect(await attemptsFor(RETAILER)).toEqual([OTP_MAX_ATTEMPTS]);

    expect(await verifyOtp(db, RETAILER, "246810", at(2000))).toEqual({ ok: false, error: "TOO_MANY_ATTEMPTS" });
  });

  it("H1: the right code sent many times at once signs in exactly once", async () => {
    await requestOtp(db, RETAILER, t0, fixed("246810"));
    const results = await Promise.all(Array.from({ length: 10 }, () => verifyOtp(db, RETAILER, "246810", at(1000))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("M1: 20 simultaneous requests issue one code and queue one SMS", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => requestOtp(db, RETAILER, t0, fixed(String(300000 + i)))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "RATE_LIMITED")).toHaveLength(19);
    expect(await db.select().from(otpCodes).where(eq(otpCodes.phone, RETAILER))).toHaveLength(1);
    const sms = await db.select().from(smsOutbox).where(eq(smsOutbox.toPhone, RETAILER));
    expect(sms).toHaveLength(1);

    // The one SMS carries the one code that was stored.
    const sentCode = sms[0].body.slice(0, 6);
    expect((await verifyOtp(db, RETAILER, sentCode, at(1000))).ok).toBe(true);
  });

  it("M1: simultaneous requests cannot push past 5 codes in an hour", async () => {
    for (let i = 0; i < 4; i++) expect((await requestOtp(db, RETAILER, at(i * 60_000))).ok).toBe(true);
    const burst = await Promise.all(Array.from({ length: 20 }, () => requestOtp(db, RETAILER, at(5 * 60_000))));
    expect(burst.filter((r) => r.ok)).toHaveLength(1); // the fifth and last code this hour
    const later = await Promise.all(Array.from({ length: 20 }, () => requestOtp(db, RETAILER, at(10 * 60_000))));
    expect(later.filter((r) => r.ok)).toHaveLength(0);
    expect(await db.select().from(otpCodes).where(eq(otpCodes.phone, RETAILER))).toHaveLength(5);
    expect(await db.select().from(smsOutbox).where(eq(smsOutbox.toPhone, RETAILER))).toHaveLength(5);
  });

  it("M1: unknown numbers are throttled the same way and never get an SMS", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => requestOtp(db, UNKNOWN, t0)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.select().from(otpCodes).where(eq(otpCodes.phone, UNKNOWN))).toHaveLength(1);
    expect(await db.select().from(smsOutbox).where(eq(smsOutbox.toPhone, UNKNOWN))).toHaveLength(0);
  });
});
