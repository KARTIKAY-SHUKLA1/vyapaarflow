"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#preview", label: "Product preview" },
];

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-white">
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
        <rect x="3" y="11" width="8" height="8" rx="1.5" fill="var(--color-leaf)" />
        <rect x="13" y="11" width="8" height="8" rx="1.5" fill="var(--color-leaf)" opacity="0.55" />
        <rect x="8" y="3" width="8" height="7" rx="1.5" fill="var(--color-leaf)" opacity="0.8" />
      </svg>
      VyapaarFlow
    </span>
  );
}

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onResize = () => window.innerWidth >= 768 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-40 border-b border-white/10 bg-navy-950">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="rounded-md" aria-label="VyapaarFlow home">
          <Wordmark />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="rounded-md px-3 py-2 text-[15px] text-navy-300 transition-colors hover:bg-white/5 hover:text-white"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden h-10 items-center rounded-md border border-white/25 px-4 text-[15px] font-medium text-white transition-colors hover:border-white/60 hover:bg-white/5 sm:inline-flex"
          >
            Sign In
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10 md:hidden"
            aria-expanded={open}
            aria-controls="landing-mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      <div id="landing-mobile-menu" hidden={!open} className="border-t border-white/10 bg-navy-950 md:hidden">
        <ul className="mx-auto flex max-w-6xl flex-col px-5 py-3">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                onClick={() => setOpen(false)}
                className="flex h-12 items-center rounded-md px-2 text-base text-navy-100 hover:bg-white/5 hover:text-white"
              >
                {l.label}
              </a>
            </li>
          ))}
          <li className="mt-2 border-t border-white/10 pt-3">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="flex h-12 items-center justify-center rounded-md bg-leaf-strong text-base font-semibold text-navy-950 hover:bg-leaf"
            >
              Sign In
            </Link>
          </li>
        </ul>
      </div>
    </header>
  );
}
