import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { otpCodes, smsOutbox, users } from "@/db/schema";
import { sessionSecret } from "./secret";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_GAP_MS = 30_000;
export const OTP_MAX_PER_HOUR = 5;

export function hashOtp(phone: string, code: string): string {
  return createHmac("sha256", sessionSecret()).update(`${phone}:${code}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type RequestOtpResult = { ok: true } | { ok: false; error: "RATE_LIMITED"; retryAfterSec: number };

/**
 * Issues an OTP for a registered, active user. For unknown numbers it returns the
 * same `{ ok: true }` without sending anything, so the endpoint does not reveal
 * which numbers are registered. SMS is mocked: the message goes to `sms_outbox`.
 */
export async function requestOtp(
  db: DB,
  phone: string,
  now = new Date(),
  generate: () => string = () => randomInt(0, 1_000_000).toString().padStart(6, "0"),
): Promise<RequestOtpResult> {
  const recent = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), gte(otpCodes.createdAt, new Date(now.getTime() - 3_600_000))))
    .orderBy(desc(otpCodes.createdAt));

  if (recent.length > 0) {
    const sinceLast = now.getTime() - recent[0].createdAt.getTime();
    if (sinceLast < OTP_RESEND_GAP_MS) {
      return { ok: false, error: "RATE_LIMITED", retryAfterSec: Math.ceil((OTP_RESEND_GAP_MS - sinceLast) / 1000) };
    }
    if (recent.length >= OTP_MAX_PER_HOUR) {
      const oldest = recent[recent.length - 1].createdAt.getTime();
      return { ok: false, error: "RATE_LIMITED", retryAfterSec: Math.ceil((oldest + 3_600_000 - now.getTime()) / 1000) };
    }
  }

  const [user] = await db.select({ id: users.id, active: users.active }).from(users).where(eq(users.phone, phone));

  // Record the attempt for unknown numbers too, so rate limits apply uniformly.
  const code = generate();
  await db.insert(otpCodes).values({
    phone,
    codeHash: hashOtp(phone, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    createdAt: now,
    // Unknown/inactive numbers get an already-consumed code that can never verify.
    consumedAt: user?.active ? null : now,
  });

  if (user?.active) {
    await db.insert(smsOutbox).values({
      toPhone: phone,
      body: `${code} is your VyapaarFlow login code. It expires in 5 minutes. Do not share it.`,
      purpose: "otp",
      createdAt: now,
    });
  }
  return { ok: true };
}

export type VerifyOtpResult =
  | { ok: true; userId: string }
  | { ok: false; error: "INVALID" | "EXPIRED" | "TOO_MANY_ATTEMPTS" };

export async function verifyOtp(db: DB, phone: string, code: string, now = new Date()): Promise<VerifyOtpResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "INVALID" };

  const [otp] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!otp) return { ok: false, error: "INVALID" };
  if (otp.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "EXPIRED" };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };

  if (!safeEqualHex(otp.codeHash, hashOtp(phone, code))) {
    const attempts = otp.attempts + 1;
    await db.update(otpCodes).set({ attempts }).where(eq(otpCodes.id, otp.id));
    return { ok: false, error: attempts >= OTP_MAX_ATTEMPTS ? "TOO_MANY_ATTEMPTS" : "INVALID" };
  }

  // Consume atomically: only succeeds if nobody else consumed it first.
  const consumed = await db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(and(eq(otpCodes.id, otp.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id });
  if (consumed.length === 0) return { ok: false, error: "INVALID" };

  const [user] = await db.select({ id: users.id, active: users.active }).from(users).where(eq(users.phone, phone));
  if (!user?.active) return { ok: false, error: "INVALID" };
  return { ok: true, userId: user.id };
}

/** Demo mode only: the latest mocked SMS for a number, so reviewers can log in without a phone. */
export async function latestDemoOtp(db: DB, phone: string): Promise<string | null> {
  const [msg] = await db
    .select({ body: smsOutbox.body })
    .from(smsOutbox)
    .where(and(eq(smsOutbox.toPhone, phone), eq(smsOutbox.purpose, "otp")))
    .orderBy(desc(smsOutbox.createdAt))
    .limit(1);
  return msg?.body.match(/^\d{6}/)?.[0] ?? null;
}
