"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { cx } from "@/components/ui";
import type { Messages } from "@/lib/i18n/messages";

/**
 * Desk tabs. Phones: four equal tabs with icons, so every section (incl. Tally
 * export) fits without sideways scrolling. Larger screens: a text tab row.
 */
export function DeskNav({ t, inboxCount }: { t: Messages["desk"]["nav"]; inboxCount: number }) {
  const pathname = usePathname();
  const items: { href: string; label: string; icon: IconName; active: boolean; badge?: number }[] = [
    { href: "/desk", label: t.overview, icon: "overview", active: pathname === "/desk" },
    { href: "/desk/orders", label: t.orders, icon: "orders", active: pathname.startsWith("/desk/orders") },
    { href: "/desk/inbox", label: t.inbox, icon: "inbox", active: pathname.startsWith("/desk/inbox"), badge: inboxCount },
    { href: "/desk/export", label: t.export, icon: "export", active: pathname.startsWith("/desk/export") },
  ];
  return (
    <nav aria-label="Desk" className="border-b border-line bg-surface">
      <ul className="mx-auto grid w-full max-w-6xl grid-cols-4 sm:flex sm:gap-1 sm:px-4">
        {items.map((i) => (
          <li key={i.href} className="min-w-0 sm:shrink-0">
            <Link
              href={i.href}
              aria-current={i.active ? "page" : undefined}
              className={cx(
                "flex h-14 flex-col items-center justify-center gap-0.5 border-b-2 px-1 text-[12px] font-medium sm:h-12 sm:flex-row sm:gap-2 sm:px-3 sm:text-[15px]",
                i.active ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink",
              )}
            >
              <span className="relative">
                <Icon name={i.icon} size={20} className="sm:hidden" />
                {!!i.badge && (
                  <span className="num absolute -top-1.5 left-3 min-w-5 rounded-full bg-accent px-1.5 text-center text-[12px] leading-5 font-semibold text-accent-ink sm:hidden">
                    {i.badge}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate">{i.label}</span>
              {!!i.badge && <span className="num hidden rounded-full bg-accent px-2 text-[13px] leading-5 font-semibold text-accent-ink sm:inline">{i.badge}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
