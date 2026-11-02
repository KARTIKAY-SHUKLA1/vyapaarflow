"use client";

import { createContext, use, useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";

/**
 * The cart holds ONLY SKU ids and case counts, per retailer, in localStorage
 * (instant on slow 3G, survives reloads). It never holds prices: every price,
 * scheme and total shown is computed on the server.
 */
export type CartLine = { skuId: string; cases: number };

const MAX_CASES = 9999;
const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; lines: CartLine[] }>();

function sanitize(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return EMPTY;
  const lines: CartLine[] = [];
  for (const v of value) {
    if (v && typeof v.skuId === "string" && Number.isInteger(v.cases) && v.cases >= 1) {
      lines.push({ skuId: v.skuId.slice(0, 64), cases: Math.min(v.cases, MAX_CASES) });
    }
  }
  return lines.slice(0, 100);
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / storage blocked: cart just lives for the session
  }
}

function read(key: string): CartLine[] {
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.lines; // stable reference for useSyncExternalStore
  let lines = EMPTY;
  try {
    lines = raw ? sanitize(JSON.parse(raw)) : EMPTY;
  } catch {
    lines = EMPTY;
  }
  cache.set(key, { raw, lines });
  return lines;
}

function write(key: string, lines: CartLine[]) {
  const raw = lines.length ? JSON.stringify(lines) : null;
  try {
    if (raw) localStorage.setItem(key, raw);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
  cache.set(key, { raw: readRaw(key) ?? raw, lines });
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  const onStorage = (e: StorageEvent) => e.key?.startsWith("vf_cart_") && callback(); // other tabs
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

type CartApi = {
  lines: CartLine[];
  count: number; // distinct items
  casesOf: (skuId: string) => number;
  setCases: (skuId: string, cases: number) => void;
  add: (skuId: string, cases: number) => void;
  addMany: (lines: CartLine[]) => void;
  remove: (skuId: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartApi | null>(null);

export function CartProvider({ retailerId, children }: { retailerId: string; children: ReactNode }) {
  const key = `vf_cart_${retailerId}`;
  const lines = useSyncExternalStore(subscribe, () => read(key), () => EMPTY);

  const setCases = useCallback(
    (skuId: string, cases: number) => {
      const current = read(key);
      const n = Math.max(0, Math.min(MAX_CASES, Math.floor(cases || 0)));
      const exists = current.some((l) => l.skuId === skuId);
      const next =
        n === 0
          ? current.filter((l) => l.skuId !== skuId)
          : exists
            ? current.map((l) => (l.skuId === skuId ? { ...l, cases: n } : l))
            : [...current, { skuId, cases: n }];
      write(key, next);
    },
    [key],
  );

  const api = useMemo<CartApi>(() => {
    const casesOf = (skuId: string) => lines.find((l) => l.skuId === skuId)?.cases ?? 0;
    return {
      lines,
      count: lines.length,
      casesOf,
      setCases,
      add: (skuId, cases) => setCases(skuId, (read(key).find((l) => l.skuId === skuId)?.cases ?? 0) + cases),
      addMany: (extra) => {
        const merged = new Map(read(key).map((l) => [l.skuId, l.cases]));
        for (const l of extra) merged.set(l.skuId, Math.min(MAX_CASES, (merged.get(l.skuId) ?? 0) + l.cases));
        write(key, [...merged].map(([skuId, cases]) => ({ skuId, cases })));
      },
      remove: (skuId) => setCases(skuId, 0),
      clear: () => write(key, EMPTY),
    };
  }, [lines, setCases, key]);

  return <CartContext value={api}>{children}</CartContext>;
}

export function useCart(): CartApi {
  const api = use(CartContext);
  if (!api) throw new Error("useCart must be used inside CartProvider");
  return api;
}
