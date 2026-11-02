"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { Messages } from "@/lib/i18n/messages";

export function DeskNav({ t, inboxCount }: { t: Messages["desk"]["nav"]; inboxCount: number }) {
  const pathname = usePathname();
  const items = [
    { href: "/desk", label: t.overview, active: pathname === "/desk" },
    { href: "/desk/orders", label: t.orders, active: pathname.startsWith("/desk/orders") },
    { href: "/desk/inbox", label: t.inbox, active: pathname.startsWith("/desk/inbox"), badge: inboxCount },
    { href: "/desk/export", label: t.export, active: pathname.startsWith("/desk/export") },
  ];
  return (
    <nav aria-label="Desk" className="border-b border-line bg-surface">
      <ul className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4">
        {items.map((i) => (
          <li key={i.href} className="shrink-0">
            <Link
              href={i.href}
              aria-current={i.active ? "page" : undefined}
              className={cx(
                "flex h-12 items-center gap-2 border-b-2 px-3 text-[15px] font-medium",
                i.active ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink",
              )}
            >
              {i.label}
              {!!i.badge && <span className="num rounded-full bg-accent px-2 text-[12px] leading-5 font-semibold text-accent-ink">{i.badge}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
