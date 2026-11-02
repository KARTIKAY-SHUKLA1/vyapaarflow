"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { isoDateIST } from "@/lib/pricing";
import { placeOrder, type PlaceOrderResult } from "@/server/orders";
import { cartSchema, priceCart, type CartPricing } from "@/server/pricing";

export type PriceCartResponse = { ok: true; pricing: CartPricing } | { ok: false; error: "INVALID_INPUT" | "FORBIDDEN" };

/** Authoritative pricing for the signed-in retailer's cart. Input: SKU ids + cases only. */
export async function priceCartAction(lines: unknown): Promise<PriceCartResponse> {
  const viewer = await requireViewer("shop");
  const parsed = cartSchema.safeParse(lines);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const pricing = await priceCart(db, viewer.retailerId!, parsed.data, isoDateIST(new Date()));
  return pricing ? { ok: true, pricing } : { ok: false, error: "FORBIDDEN" };
}

export async function placeOrderAction(input: unknown): Promise<PlaceOrderResult> {
  const viewer = await requireViewer("shop");
  const result = await placeOrder(db, viewer, input);
  if (result.ok) {
    revalidatePath("/shop", "layout");
  }
  return result;
}
