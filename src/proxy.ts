import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";

/**
 * Optimistic check only: bounce visitors without a valid session cookie to /login
 * before rendering. Real authorisation happens in the Data Access Layer
 * (src/lib/auth/dal.ts) on every page and server action.
 */
export async function proxy(request: NextRequest) {
  const claims = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!claims) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/shop/:path*", "/desk/:path*"],
};
