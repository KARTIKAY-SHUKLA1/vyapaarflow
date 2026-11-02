import { jwtVerify, SignJWT } from "jose";
import type { Role } from "@/db/schema";
import { sessionSecret } from "./secret";

export const SESSION_COOKIE = "vf_session";
export const SESSION_TTL_SEC = 7 * 24 * 3600;

export type SessionClaims = { sub: string; role: Role };

export async function signSession(claims: SessionClaims, now = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SEC)
    .sign(sessionSecret());
}

/** Returns null for missing, tampered or expired tokens. Never throws on bad input. */
export async function verifySessionToken(token: string | undefined, now = new Date()): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      algorithms: ["HS256"],
      currentDate: now,
    });
    const role = payload.role;
    if (typeof payload.sub !== "string" || (role !== "retailer" && role !== "desk" && role !== "salesman")) return null;
    return { sub: payload.sub, role };
  } catch {
    return null;
  }
}
