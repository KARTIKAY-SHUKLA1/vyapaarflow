import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { users } from "@/db/schema";
import { canUseArea, LOGIN_ROLES, type Viewer } from "./policy";
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession, verifySessionToken } from "./token";

/**
 * Data Access Layer entry point. The cookie only proves *who*; role, retailer link
 * and active flag are re-read from the database on every request, so a disabled
 * user or a changed role takes effect immediately.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const [user] = await db.select().from(users).where(eq(users.id, claims.sub));
  if (!user || !user.active || user.role !== claims.role || !LOGIN_ROLES.includes(user.role)) return null;
  if (user.role === "retailer" && !user.retailerId) return null;

  return { id: user.id, name: user.name, role: user.role, retailerId: user.retailerId, language: user.language };
});

export async function requireViewer(area: "shop" | "desk"): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!canUseArea(viewer.role, area)) redirect("/");
  return viewer;
}

export async function startSession(userId: string, role: Viewer["role"]) {
  const token = await signSession({ sub: userId, role });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
