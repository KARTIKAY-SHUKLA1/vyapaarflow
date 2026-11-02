import type { Role } from "@/db/schema";

/** The signed-in person, as loaded fresh from the database on each request. */
export type Viewer = {
  id: string;
  name: string;
  role: Role;
  retailerId: string | null;
  language: "en" | "hi";
};

/**
 * Brief: "A retailer's prices and credit are visible only to them, their salesman
 * and the desk." Every query that touches a retailer's prices, credit or orders
 * must pass through this check.
 */
export function canAccessRetailer(viewer: Viewer, retailer: { id: string; salesmanId: string | null }): boolean {
  switch (viewer.role) {
    case "desk":
      return true;
    case "retailer":
      return viewer.retailerId !== null && viewer.retailerId === retailer.id;
    case "salesman":
      return retailer.salesmanId !== null && retailer.salesmanId === viewer.id;
  }
}

/**
 * Roles that can sign in to this build. Salesman records exist (they define who
 * may see a retailer's data) but the salesman app is optional depth, not yet built.
 */
export const LOGIN_ROLES: readonly Role[] = ["retailer", "desk"];

/** Where each role lands after sign-in. */
export function homeFor(role: Role): string {
  return role === "retailer" ? "/shop" : role === "desk" ? "/desk" : "/login";
}

export function canUseArea(role: Role, area: "shop" | "desk"): boolean {
  if (area === "shop") return role === "retailer";
  return role === "desk";
}
