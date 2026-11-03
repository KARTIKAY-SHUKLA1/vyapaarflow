import type { ReactNode } from "react";

/** Light window chrome around a desktop screenshot. Decorative only. */
export function BrowserFrame({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <div className={"overflow-hidden rounded-xl border shadow-frame " + (dark ? "border-white/15 bg-navy-800" : "border-navy-100 bg-white")}>
      <div className={"flex h-8 items-center gap-1.5 px-3 " + (dark ? "bg-navy-800" : "bg-navy-100/60")} aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-navy-300/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-navy-300/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-navy-300/60" />
      </div>
      {children}
    </div>
  );
}
