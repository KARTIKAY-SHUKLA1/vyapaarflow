"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useCart, type CartLine } from "../../cart-store";

/** Puts the same quantities in the cart; the cart then re-prices and re-checks stock live. */
export function OrderAgainButton({ lines, label }: { lines: CartLine[]; label: string }) {
  const cart = useCart();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={() => {
        cart.addMany(lines);
        router.push("/shop/cart");
      }}
    >
      {label}
    </Button>
  );
}
