"use client";

import { useEffect, useRef, useState } from "react";
import type { CartPricing } from "@/server/pricing";

export type CartLine = { skuId: string; cases: number };
export type PriceFetcher = (lines: CartLine[]) => Promise<{ ok: true; pricing: CartPricing } | { ok: false }>;

type State = { key: string; pricing: CartPricing | null; error: boolean };

/**
 * Asks the server to price the cart whenever it changes (debounced). The UI shows
 * the previous result dimmed while a new one is on its way, so typing a quantity
 * never flashes an empty screen. Stale responses are ignored.
 */
export function usePricing(lines: CartLine[], fetcher: PriceFetcher, debounceMs = 250, scope = "") {
  // `scope` (e.g. the retailer being priced for) is part of the key, so changing it re-prices.
  const key = JSON.stringify([scope, lines]);
  const [state, setState] = useState<State>({ key: "", pricing: null, error: false });
  const [attempt, setAttempt] = useState(0);
  // Latest fetcher without re-running the effect on every render (callers may pass closures).
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;
    const parsed = (JSON.parse(key) as [string, CartLine[]])[1];
    const timer = setTimeout(async () => {
      try {
        const res = await fetcherRef.current(parsed);
        if (!cancelled) setState({ key, pricing: res.ok ? res.pricing : null, error: !res.ok });
      } catch {
        if (!cancelled) setState((s) => ({ key, pricing: s.pricing, error: true }));
      }
    }, parsed.length ? debounceMs : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, attempt, debounceMs]);

  return {
    pricing: state.pricing,
    loading: state.key !== key,
    error: state.key === key && state.error,
    retry: () => {
      setState((s) => ({ ...s, key: "", error: false }));
      setAttempt((a) => a + 1);
    },
    /** Replace with a server result obtained elsewhere (e.g. PRICE_CHANGED on checkout). */
    accept: (pricing: CartPricing) => setState({ key, pricing, error: false }),
  };
}
