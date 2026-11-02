"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { Messages } from "@/lib/i18n/messages";
import { useCart } from "./cart-store";

const ICONS = {
  catalogue: "M4 5h16v4H4zM4 11h7v8H4zM13 11h7v8h-7z",
  cart: "M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L21 8H6.2M10 20.5h.01M17 20.5h.01",
  orders: "M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6",
};

function useItems(t: Messages["shop"]["nav"]) {
  const pathname = usePathname();
  const { count } = useCart();
  return [
    { href: "/shop", label: t.catalogue, icon: ICONS.catalogue, active: pathname === "/shop" || pathname.startsWith("/shop/p/"), badge: 0 },
    { href: "/shop/cart", label: t.cart, icon: ICONS.cart, active: pathname === "/shop/cart" || pathname === "/shop/checkout", badge: count },
    { href: "/shop/orders", label: t.orders, icon: ICONS.orders, active: pathname.startsWith("/shop/orders"), badge: 0 },
  ];
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="num absolute -top-1.5 left-3.5 min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold leading-5 text-accent-ink">
      {n}
    </span>
  );
}

/** Desktop: tabs under the header. */
export function ShopTabs({ t }: { t: Messages["shop"]["nav"] }) {
  const items = useItems(t);
  return (
    <nav aria-label="Shop" className="hidden gap-1 sm:flex">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cx(
            "relative flex h-11 items-center gap-2 rounded-md px-3 text-[15px] font-medium",
            i.active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-sunken hover:text-ink",
          )}
        >
          <span className="relative">
            <Icon d={i.icon} />
            <CountBadge n={i.badge} />
          </span>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Phone: fixed bottom bar with large targets, clear of the home indicator. */
export function ShopBottomNav({ t }: { t: Messages["shop"]["nav"] }) {
  const items = useItems(t);
  return (
    <nav
      aria-label="Shop"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-3">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={i.active ? "page" : undefined}
              className={cx("flex h-full flex-col items-center justify-center gap-0.5 text-[12px] font-medium", i.active ? "text-accent" : "text-ink-3")}
            >
              <span className="relative">
                <Icon d={i.icon} />
                <CountBadge n={i.badge} />
              </span>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
