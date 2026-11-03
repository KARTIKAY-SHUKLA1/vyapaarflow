import { createHmac } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { withBusyRetry } from "@/db/busy";
import { rateLimits } from "@/db/schema";
import { sessionSecret } from "./secret";

/**
 * Per-IP and global abuse limits for OTP sign-in (security audit M2). They sit in
 * front of the per-phone limits in otp.ts, which stay unchanged.
 *
 * Each check is ONE atomic upsert on a fixed-window counter, so simultaneous
 * requests can never both see "under the limit": SQLite/Turso run a single
 * statement atomically. Fixed windows can let up to twice a limit through across a
 * window boundary; that is accepted for a single-statement, lock-free counter.
 */

export type OtpAction = "send" | "verify";

export type OtpRateLimits = {
  windowMs: number;
  ipSend: number;
  ipVerify: number;
  globalSend: number;
  globalVerify: number;
};

/**
 * Defaults per 10-minute window. Per-IP limits are generous because many Indian
 * mobile users share one carrier IP (CGNAT) and sessions last 7 days, so real
 * sign-ins are rare; they stop bulk abuse from one address. The global limit is an
 * outer safety net against SMS cost and broad guessing, set well above normal use.
 */
export const DEFAULT_OTP_RATE_LIMITS: OtpRateLimits = {
  windowMs: 10 * 60_000,
  ipSend: 20,
  ipVerify: 40,
  globalSend: 300,
  globalVerify: 1000,
};

/** Optional overrides: OTP_RATE_WINDOW_SEC, OTP_IP_SEND_LIMIT, OTP_IP_VERIFY_LIMIT, OTP_GLOBAL_SEND_LIMIT, OTP_GLOBAL_VERIFY_LIMIT. */
export function otpRateLimitsFromEnv(env: Record<string, string | undefined> = process.env): OtpRateLimits {
  const positive = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value !== undefined && value.trim() !== "" && Number.isSafeInteger(n) && n > 0 ? n : fallback;
  };
  const d = DEFAULT_OTP_RATE_LIMITS;
  return {
    windowMs: positive(env.OTP_RATE_WINDOW_SEC, d.windowMs / 1000) * 1000,
    ipSend: positive(env.OTP_IP_SEND_LIMIT, d.ipSend),
    ipVerify: positive(env.OTP_IP_VERIFY_LIMIT, d.ipVerify),
    globalSend: positive(env.OTP_GLOBAL_SEND_LIMIT, d.globalSend),
    globalVerify: positive(env.OTP_GLOBAL_VERIFY_LIMIT, d.globalVerify),
  };
}

export type RateLimitResult = { ok: true; degraded?: true } | { ok: false; scope: "ip" | "global"; retryAfterSec: number };

/** Keyed hash, so the table never holds a raw IP address (and hashes can't be reversed by enumerating IPv4). */
function ipKey(ip: string): string {
  return createHmac("sha256", sessionSecret()).update(`rate-limit-ip:${ip}`).digest("hex").slice(0, 32);
}

/** Count one hit on `key` in the current window; returns the count including this hit. */
async function hit(db: DB, key: string, windowMs: number, now: Date) {
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  // A busy statement never applied, so retrying it cannot double-count.
  const [row] = await withBusyRetry(() =>
    db
      .insert(rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        // Both expressions read the row's OLD values (SQLite UPDATE semantics). The
        // window only moves forward: a request that computed an older window but runs
        // after a newer one started is counted in the newer window, never resets it.
        set: {
          count: sql`CASE WHEN excluded.window_start <= ${rateLimits.windowStart} THEN ${rateLimits.count} + 1 ELSE 1 END`,
          windowStart: sql`max(${rateLimits.windowStart}, excluded.window_start)`,
        },
      })
      .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart }),
  );
  return {
    count: row.count,
    windowStart: row.windowStart,
    retryAfterSec: Math.max(1, Math.ceil((row.windowStart + windowMs - now.getTime()) / 1000)),
  };
}

function isMissingTable(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = (e as Error & { cause?: unknown }).cause) {
    if (/no such table:?\s*`?rate_limits/i.test(e.message)) return true;
  }
  return false;
}

/**
 * Check the per-IP limit (only when the IP is known and trusted) and then the
 * global limit for one OTP send or verify. Call it before any user lookup, so the
 * answer never depends on whether a number is registered.
 *
 * If the `rate_limits` table does not exist yet (code deployed before migration
 * 0003), the check is skipped and an error is logged: sign-in keeps working with
 * the per-phone limits, never weaker than before this table existed.
 */
export async function checkOtpRateLimit(
  db: DB,
  action: OtpAction,
  ip: string | null,
  now = new Date(),
  limits: OtpRateLimits = otpRateLimitsFromEnv(),
): Promise<RateLimitResult> {
  try {
    if (ip) {
      const perIp = await hit(db, `otp:${action}:ip:${ipKey(ip)}`, limits.windowMs, now);
      if (perIp.count > (action === "send" ? limits.ipSend : limits.ipVerify)) {
        return { ok: false, scope: "ip", retryAfterSec: perIp.retryAfterSec };
      }
    }

    const global = await hit(db, `otp:${action}:global`, limits.windowMs, now);
    if (global.count === 1) {
      // First hit of a new global window (about once per window): drop counters from
      // windows that have ended, so the table only holds recent keys.
      await db.delete(rateLimits).where(lt(rateLimits.windowStart, global.windowStart));
    }
    if (global.count > (action === "send" ? limits.globalSend : limits.globalVerify)) {
      return { ok: false, scope: "global", retryAfterSec: global.retryAfterSec };
    }
    return { ok: true };
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    console.error("OTP rate limits skipped: table rate_limits is missing. Apply migration 0003 (see deployment.md).");
    return { ok: true, degraded: true };
  }
}
