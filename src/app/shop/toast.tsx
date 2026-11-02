"use client";

import Link from "next/link";
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { fill, type Messages } from "@/lib/i18n/messages";
import { useCart } from "./cart-store";

/**
 * "Added to cart" confirmation. One toast at a time, auto-hides after 3.5 s, sits
 * above the bottom nav on phones, and is announced politely to screen readers.
 * It never blocks the catalogue: the shopkeeper can keep adding.
 */
type ToastApi = { added: (name: string) => void };
const ToastContext = createContext<ToastApi | null>(null);

const SHOW_MS = 3500;

export function ToastProvider({ t, children }: { t: Messages["shop"]; children: ReactNode }) {
  const cart = useCart();
  const [name, setName] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const added = useCallback((itemName: string) => {
    setName(itemName);
    setSeq((n) => n + 1); // restart the timer for each add
  }, []);

  useEffect(() => {
    if (!name) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setName(null), SHOW_MS);
    return () => clearTimeout(timer.current);
  }, [name, seq]);

  return (
    <ToastContext value={{ added }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 sm:bottom-6"
        style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {name && (
          <div key={seq} role="status" className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg bg-ink px-4 py-3 text-surface shadow-pop motion-safe:animate-[toast-in_160ms_ease-out]">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
              <Icon name="check" size={16} />
            </span>
            <span className="min-w-0 flex-1 text-[14px] leading-snug">
              <span className="block truncate font-semibold">{fill(t.toastAdded, { name })}</span>
              <span className="num opacity-80">{fill(t.toastInCart, { n: cart.count })}</span>
            </span>
            <Link href="/shop/cart" className="shrink-0 rounded-md bg-surface px-3 py-2 text-[14px] font-semibold text-ink hover:bg-sunken">
              {t.viewCart}
            </Link>
          </div>
        )}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}
