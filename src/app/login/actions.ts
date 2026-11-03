"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { clientIp } from "@/lib/auth/client-ip";
import { startSession } from "@/lib/auth/dal";
import { latestDemoOtp, OTP_RESEND_GAP_MS, requestOtp, verifyOtp } from "@/lib/auth/otp";
import { homeFor, LOGIN_ROLES } from "@/lib/auth/policy";
import { checkOtpRateLimit } from "@/lib/auth/rate-limit";
import { normalizeIndianMobile } from "@/lib/phone";

export type LoginState = {
  step: "phone" | "otp";
  phone?: string; // normalised, 91XXXXXXXXXX
  error?: "phoneInvalid" | "otpInvalid" | "otpExpired" | "tooManyAttempts" | "rateLimited" | "roleNotEnabled" | "generic";
  retryAfterSec?: number;
  demoOtp?: string | null;
  /** Epoch ms after which "Resend" is allowed again. */
  waitUntil?: number;
};

const isDemo = () => process.env.DEMO_MODE === "true";

const sendSchema = z.object({ phone: z.string().trim().min(10).max(20) });
const verifySchema = z.object({ phone: z.string().regex(/^91[6-9]\d{9}$/), code: z.string().trim().regex(/^\d{6}$/) });

export async function loginAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  const intent = formData.get("intent");

  if (intent === "change") return { step: "phone" };

  if (intent === "send") {
    const parsed = sendSchema.safeParse({ phone: formData.get("phone") });
    const phone = parsed.success ? normalizeIndianMobile(parsed.data.phone) : null;
    if (!phone) return { step: "phone", error: "phoneInvalid" };

    // Per-IP and global limits first, before any user lookup: the answer is the same
    // whether or not the number is registered. Per-phone limits follow in requestOtp.
    const limited = await checkOtpRateLimit(db, "send", clientIp(await headers()));
    if (!limited.ok) {
      return {
        step: prev.step === "otp" ? "otp" : "phone",
        phone,
        error: "rateLimited",
        retryAfterSec: limited.retryAfterSec,
        waitUntil: Date.now() + limited.retryAfterSec * 1000,
        demoOtp: prev.demoOtp,
      };
    }

    // Block roles not enabled in this build before sending a code.
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.phone, phone));
    if (user && !LOGIN_ROLES.includes(user.role)) return { step: "phone", phone, error: "roleNotEnabled" };

    const result = await requestOtp(db, phone);
    if (!result.ok) {
      // Already have a live code? Stay on the OTP step and show the wait.
      return {
        step: prev.step === "otp" ? "otp" : "phone",
        phone,
        error: "rateLimited",
        retryAfterSec: result.retryAfterSec,
        waitUntil: Date.now() + result.retryAfterSec * 1000,
        demoOtp: prev.demoOtp,
      };
    }
    return { step: "otp", phone, waitUntil: Date.now() + OTP_RESEND_GAP_MS, demoOtp: isDemo() ? await latestDemoOtp(db, phone) : undefined };
  }

  if (intent === "verify") {
    const parsed = verifySchema.safeParse({ phone: formData.get("phone"), code: formData.get("code") });
    if (!parsed.success) return { ...prev, step: "otp", error: "otpInvalid" };

    const limited = await checkOtpRateLimit(db, "verify", clientIp(await headers()));
    if (!limited.ok) return { ...prev, step: "otp", error: "rateLimited", retryAfterSec: limited.retryAfterSec };

    const result = await verifyOtp(db, parsed.data.phone, parsed.data.code);
    if (!result.ok) {
      const error = result.error === "EXPIRED" ? "otpExpired" : result.error === "TOO_MANY_ATTEMPTS" ? "tooManyAttempts" : "otpInvalid";
      return { ...prev, step: "otp", error };
    }

    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, result.userId));
    if (!user || !LOGIN_ROLES.includes(user.role)) return { step: "phone", error: "roleNotEnabled" };

    await startSession(result.userId, user.role);
    await db.insert(auditLog).values({ actorId: result.userId, action: "auth.login", entity: "user", entityId: result.userId });
    redirect(homeFor(user.role));
  }

  return { step: "phone", error: "generic" };
}
