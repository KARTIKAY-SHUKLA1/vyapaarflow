"use client";

import Image from "next/image";
import { useRef, useState, type KeyboardEvent } from "react";
import { BrowserFrame } from "./frames";

type Shot = {
  id: string;
  tab: string;
  title: string;
  body: string;
  points: string[];
  src: string;
  alt: string;
  width: number;
  height: number;
  phone?: boolean;
  note?: string;
};

const SHOTS: Shot[] = [
  {
    id: "catalogue",
    tab: "Retailer catalogue",
    title: "A catalogue priced for each shop",
    body: "Retailers sign in with their mobile number and an OTP, then order from a catalogue that shows their own price, stock status and today's scheme.",
    points: ["Your usual items and Repeat last order", "Search and category filters", "Available credit on the first screen"],
    src: "/landing/retailer-catalogue.png",
    alt: "Retailer catalogue on a phone: greeting with available credit, Repeat last order, search, category chips, usual items with Add buttons and a product card showing In stock and the case price.",
    width: 780,
    height: 1688,
    phone: true,
  },
  {
    id: "review",
    tab: "AI order review",
    title: "Every captured line is checked by a person",
    body: "The desk sees the retailer's original words beside each draft line, with a confidence level, alternative products, the unit and the server-calculated price.",
    points: ["Unclear units are asked, never guessed", "One tap to switch to an alternative SKU", "Order is created only after the desk confirms"],
    src: "/landing/desk-ai-review.png",
    alt: "Order desk review screen: the original Hinglish message, a draft line for Glucose biscuit 75 g with High 92% confidence, two alternative products, a unit selector, price with a scheme nudge, and a confirmation checkbox before Create order.",
    width: 2560,
    height: 1720,
    note: "Captured from a local demo running the rule-based matcher only, so the screen says the AI was not used.",
  },
  {
    id: "desk",
    tab: "Order desk",
    title: "What needs attention, first",
    body: "The desk overview puts messages to review, orders to approve and credit holds at the top, followed by the latest messages and shops over their limit.",
    points: ["Approve orders or release credit holds with a reason", "Orders over the credit limit go to hold, not rejection", "Every action is recorded in the audit history"],
    src: "/landing/desk-dashboard.png",
    alt: "Order desk overview: Needs your attention with 6 messages to review, 2 orders to approve and 1 on credit hold; Ready for Tally and Orders today totals; latest messages in Hinglish and Hindi; a credit hold over its limit.",
    width: 2560,
    height: 1720,
  },
  {
    id: "tally",
    tab: "Tally export",
    title: "Approved orders, ready for Tally",
    body: "Select approved orders and export one CSV file to import into Tally as sales orders. Exported orders are marked so they are never sent twice.",
    points: ["Select all or pick individual orders", "Running total of the selection", "Past exports kept for download"],
    src: "/landing/desk-tally-export.png",
    alt: "Tally export screen: three approved orders selected with order numbers, shops and totals, and an Export CSV for Tally button.",
    width: 2560,
    height: 1720,
  },
];

export function PreviewTabs() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const last = SHOTS.length - 1;
    // Move from the focused tab, which can differ from the selected one.
    const focused = tabs.current.findIndex((t) => t === document.activeElement);
    const from = focused === -1 ? active : focused;
    const next =
      e.key === "ArrowRight" ? (from === last ? 0 : from + 1)
      : e.key === "ArrowLeft" ? (from === 0 ? last : from - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Product screens"
        onKeyDown={onKeyDown}
        className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {SHOTS.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`tab-${s.id}`}
            role="tab"
            type="button"
            aria-selected={i === active}
            aria-controls={`panel-${s.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={
              "h-11 shrink-0 rounded-full px-4 text-[15px] font-medium transition-colors " +
              (i === active
                ? "bg-navy-900 text-white"
                : "text-slate hover:bg-mist hover:text-navy-950")
            }
          >
            {s.tab}
          </button>
        ))}
      </div>

      {SHOTS.map((s, i) => (
        <div
          key={s.id}
          id={`panel-${s.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${s.id}`}
          hidden={i !== active}
          tabIndex={0}
          className="mt-6 grid items-center gap-8 rounded-2xl bg-mist p-5 motion-safe:animate-[landing-fade_240ms_ease-out] sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12 lg:p-10"
        >
          <div className="lg:order-1">
            <h3 className="text-xl font-semibold tracking-tight text-navy-950 text-balance">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-slate">{s.body}</p>
            <ul className="mt-5 grid gap-2.5">
              {s.points.map((p) => (
                <li key={p} className="flex gap-2.5 text-[15px] text-navy-900">
                  <svg className="mt-1 shrink-0 text-accent" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {p}
                </li>
              ))}
            </ul>
            {s.note && <p className="mt-5 text-[13px] leading-relaxed text-slate">{s.note}</p>}
          </div>

          <div className="lg:order-2">
            {s.phone ? (
              <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border-[6px] border-navy-900 bg-navy-900 shadow-frame">
                <Image
                  src={s.src}
                  alt={s.alt}
                  width={s.width}
                  height={s.height}
                  sizes="300px"
                  className="h-auto w-full rounded-[1.6rem]"
                />
              </div>
            ) : (
              <BrowserFrame>
                <Image
                  src={s.src}
                  alt={s.alt}
                  width={s.width}
                  height={s.height}
                  sizes="(min-width: 1024px) 720px, 100vw"
                  className="h-auto w-full"
                />
              </BrowserFrame>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
