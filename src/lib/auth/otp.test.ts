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
