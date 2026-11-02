"use client";

import { Button, ButtonLink } from "@/components/ui";

// Shop-level error boundary: keeps the header and bottom nav, so the retailer is never stuck.
export default function ShopError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <h1 className="text-xl font-semibold">Something went wrong · कुछ गड़बड़ हुई</h1>
      <p className="mt-2 text-[15px] text-ink-2">We could not load this page. Your cart is saved on this phone.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={reset}>Try again · फिर से</Button>
        <ButtonLink href="/shop" variant="secondary">
          Catalogue
        </ButtonLink>
      </div>
    </div>
  );
}
