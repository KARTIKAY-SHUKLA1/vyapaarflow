import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrowserFrame } from "./frames";
import { LandingNav } from "./landing-nav";
import { PreviewTabs } from "./preview-tabs";

/*
 * Public landing page. Layout: navy hero with the real AI review and cart screens,
 * then alternating white / mist bands, each capped at max-w-6xl with a 20–32px gutter.
 * Every claim below maps to an implemented, tested feature (see docs/TDD.md §7–8).
 */

const REPO = "https://github.com/KARTIKAY-SHUKLA1/vyapaarflow";

const ctaPrimaryOnNavy =
  "inline-flex h-12 items-center justify-center gap-2 rounded-md bg-leaf-strong px-6 text-base font-semibold text-navy-950 transition-[background-color,transform] hover:-translate-y-px hover:bg-leaf";
const ctaSecondaryOnNavy =
  "inline-flex h-12 items-center justify-center rounded-md border border-white/30 px-6 text-base font-semibold text-white transition-colors hover:border-white/70 hover:bg-white/5";

function Arrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Eyebrow({ children, onNavy = false }: { children: ReactNode; onNavy?: boolean }) {
  return (
    <p className={"text-[13px] font-semibold uppercase tracking-[0.12em] " + (onNavy ? "text-leaf" : "text-accent")}>{children}</p>
  );
}

function SectionHead({ id, eyebrow, title, body, onNavy = false }: { id: string; eyebrow: string; title: string; body?: string; onNavy?: boolean }) {
  return (
    <div className="max-w-2xl">
      <Eyebrow onNavy={onNavy}>{eyebrow}</Eyebrow>
      <h2 id={id} className={"mt-3 text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-4xl " + (onNavy ? "text-white" : "text-navy-950")}>
        {title}
      </h2>
      {body && <p className={"mt-4 text-[17px] leading-relaxed " + (onNavy ? "text-navy-300" : "text-slate")}>{body}</p>}
    </div>
  );
}

/* ---------- Hero ---------- */

function Hero({ demo }: { demo: boolean }) {
  return (
    <section className="relative overflow-hidden bg-navy-900 text-white">
      {/* faint grid, like a stock register; decorative */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      />
      <div className="relative mx-auto max-w-6xl px-5 pt-14 pb-16 sm:px-8 sm:pt-20 lg:pb-24">
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[13px] font-medium text-navy-100">
            <span className="h-1.5 w-1.5 rounded-full bg-leaf" aria-hidden />
            For FMCG distributors and the retailers they supply
          </p>
          <h1 className="mt-6 text-[40px] leading-[1.05] font-semibold tracking-[-0.025em] text-balance sm:text-6xl lg:text-[68px]">
            Smarter Orders. <span className="text-leaf">Seamless Distribution.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-navy-300 sm:text-xl">
            One connected platform for retailers and distributors. Simplify FMCG ordering, capture orders with AI
            assistance, and manage fulfilment with confidence.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className={ctaPrimaryOnNavy}>
              Explore Demo <Arrow />
            </Link>
            <Link href="/login" className={ctaSecondaryOnNavy}>
              Sign In
            </Link>
          </div>
          {demo && (
            <p className="mt-4 text-[14px] text-navy-300">
              Demo accounts for a retailer and the order desk are listed on the sign-in screen. All shops and products are fictional.
            </p>
          )}
        </div>

        <div className="relative mt-14 sm:mt-16 lg:mt-20 motion-safe:animate-[landing-rise_700ms_cubic-bezier(.2,.7,.2,1)]">
          <div className="sm:ml-16 lg:ml-28">
            <BrowserFrame dark>
              <Image
                src="/landing/desk-ai-review.png"
                alt="Order desk reviewing an AI-captured Hinglish order: the original message, a draft line with High 92% confidence, alternative products, unit selection, price and a confirmation checkbox."
                width={2560}
                height={1720}
                sizes="(min-width: 1152px) 1000px, 92vw"
                preload
                className="h-auto w-full"
              />
            </BrowserFrame>
          </div>
          <div className="absolute -bottom-6 left-0 w-[30%] max-w-[230px] min-w-[104px] sm:-bottom-10 lg:-bottom-12">
            <div className="rounded-[1.4rem] border-[5px] border-navy-950 bg-navy-950 shadow-frame sm:rounded-[1.9rem] sm:border-[6px]">
              <Image
                src="/landing/retailer-cart.png"
                alt="Retailer cart on a phone with server-calculated totals, a Buy 10 cases get 1 free scheme applied and an Add 3 more for 3% off nudge."
                width={780}
                height={1688}
                sizes="230px"
                preload
                className="h-auto w-full rounded-[1.05rem] sm:rounded-[1.5rem]"
              />
            </div>
          </div>
        </div>
        <p className="mt-12 text-right text-[13px] text-navy-300 sm:mt-14">
          Order desk AI review and retailer cart, captured from a local demo using the rule-based matcher.
        </p>
      </div>
    </section>
  );
}

/* ---------- Problem and response ---------- */

const PROBLEMS = [
  {
    problem: "Orders arrive as informal messages",
    detail: "WhatsApp texts in Hinglish, Hindi or English, with no fixed format.",
    answer: "The desk pastes the message into the AI inbox. VyapaarFlow splits it into draft order lines and keeps the retailer's own words beside each one.",
  },
  {
    problem: "Manual entry takes time",
    detail: "Every line is read, matched to a SKU and typed again.",
    answer: "Product, quantity and unit arrive pre-filled. The desk checks and corrects instead of typing from scratch.",
  },
  {
    problem: "Product and unit ambiguity causes mistakes",
    detail: "“Chhota” could be two pack sizes; “peti” could be a case or a carton.",
    answer: "Each line shows a confidence level and two alternative SKUs. A unit that was not stated is flagged to ask, never guessed.",
  },
  {
    problem: "Stock, pricing and credit must be exact",
    detail: "Schemes, slab discounts, GST and credit limits change the total.",
    answer: "The server prices every order from the shop's price tier and today's schemes, checks stock, and holds orders over the credit limit.",
  },
];

function Mark({ children, note }: { children: ReactNode; note: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="rounded-sm bg-warn-soft px-0.5 text-warn underline decoration-warn/50 decoration-dotted underline-offset-4">{children}</span>
      <span className="sr-only"> ({note})</span>
    </span>
  );
}

function MessageSpecimen() {
  return (
    <figure className="rounded-2xl border border-navy-100 bg-white p-5 shadow-card sm:p-6">
      <figcaption className="flex items-center justify-between text-[13px] text-slate">
        <span className="font-medium text-navy-900">Sharma Kirana Store</span>
        <span>Text order, as received</span>
      </figcaption>
      <blockquote className="mt-3 rounded-xl rounded-tl-sm bg-mist px-4 py-3 text-[17px] leading-relaxed text-navy-950">
        bhaiya 5 <Mark note="unit: case">peti</Mark> biscuit <Mark note="which pack size?">chhota</Mark>, 2 peti washing powder{" "}
        <Mark note="1 kg pack">1 kilo</Mark>, chai patti <Mark note="250 g pack">250 wala</Mark> 1 peti
      </blockquote>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
        {[
          ["peti", "a case"],
          ["chhota", "75 g or 200 g?"],
          ["1 kilo", "1 kg pack"],
          ["250 wala", "250 g pack"],
        ].map(([term, meaning]) => (
          <div key={term}>
            <dt className="font-semibold text-warn">{term}</dt>
            <dd className="text-slate">{meaning}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

function Problem() {
  return (
    <section aria-labelledby="problem-title" className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
          <div>
            <Eyebrow>The problem</Eyebrow>
            <h2 id="problem-title" className="mt-3 text-[28px] leading-tight font-semibold tracking-tight text-balance text-navy-950 sm:text-4xl">
              Retail orders arrive as messages, not as orders.
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-slate">
              A distributor&apos;s office reads dozens of short texts a day and types each one into the books. The words are
              familiar to the shopkeeper and ambiguous to everyone else.
            </p>
            <div className="mt-8">
              <MessageSpecimen />
            </div>
          </div>

          <div>
            <div className="hidden grid-cols-2 gap-6 border-b border-navy-100 pb-3 text-[13px] font-semibold uppercase tracking-[0.1em] text-slate sm:grid">
              <span>What goes wrong</span>
              <span>What VyapaarFlow does</span>
            </div>
            <ul className="divide-y divide-navy-100">
              {PROBLEMS.map((p) => (
                <li key={p.problem} className="grid gap-3 py-6 sm:grid-cols-2 sm:gap-6">
                  <div>
                    <p className="font-semibold text-navy-950">{p.problem}</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-slate">{p.detail}</p>
                  </div>
                  <p className="flex gap-2.5 text-[15px] leading-relaxed text-navy-900">
                    <svg className="mt-1 shrink-0 text-accent" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>{p.answer}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Features ---------- */

type Feature = { title: string; body: string; icon: string };

const FEATURE_GROUPS: { label: string; audience: string; features: Feature[] }[] = [
  {
    label: "For retailers",
    audience: "On the shop counter, on any phone",
    features: [
      {
        title: "Catalogue and ordering",
        body: "Search and filter products, see your own case price, reorder usual items and repeat the last order.",
        icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
      },
      {
        title: "Inventory and scheme-aware pricing",
        body: "Stock status on every product. Free goods, slab discounts and GST are applied by the server, with nudges like “Add 3 more for 3% off”.",
        icon: "M20 12l-8 8-9-9V3h8zM7.5 7.5h.01",
      },
    ],
  },
  {
    label: "AI order capture",
    audience: "Text orders, checked line by line",
    features: [
      {
        title: "Hinglish and English text capture",
        body: "Paste a retailer's message and get draft lines with product, quantity and unit. Hindi script is read too.",
        icon: "M4 5h16v11H8l-4 4zM8 9h8M8 12h5",
      },
      {
        title: "Confidence and alternative SKUs",
        body: "Each line shows how sure the match is and offers two alternative products, so a wrong pack size is a single tap to fix.",
        icon: "M4 19h16M7 15v-3M12 15V8M17 15V5",
      },
      {
        title: "Human verification before ordering",
        body: "The desk confirms that every line matches the original message. No order is created until they do.",
        icon: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4",
      },
    ],
  },
  {
    label: "For the order desk",
    audience: "Approve, hold and hand over to accounts",
    features: [
      {
        title: "Approval and credit holds",
        body: "Orders over a shop's credit limit go on hold, not into rejection. Release or cancel with a reason; every action is audited.",
        icon: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
      },
      {
        title: "Tally-ready CSV export",
        body: "Export approved orders as one CSV to import into Tally as sales orders. Exported orders are never sent twice.",
        icon: "M12 3v12M7 10l5 5 5-5M5 21h14",
      },
    ],
  },
];

function FeatureIcon({ d }: { d: string }) {
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </span>
  );
}

function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-16 bg-mist">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="max-w-2xl">
          <Eyebrow>Features</Eyebrow>
          <h2 id="features-title" className="mt-3 text-[28px] leading-tight font-semibold tracking-tight text-balance text-navy-950 sm:text-4xl">
            Built around how FMCG orders actually move.
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-slate">
            From the retailer&apos;s phone to the distributor&apos;s accounts, each step uses the same prices, stock and
            schemes.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {FEATURE_GROUPS.map((g) => (
            <div key={g.label} className="flex flex-col rounded-2xl border border-navy-100 bg-white p-6 sm:p-7">
              <div className="border-b border-navy-100 pb-4">
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-navy-900">{g.label}</h3>
                <p className="mt-1 text-[14px] text-slate">{g.audience}</p>
              </div>
              <ul className="mt-2 flex flex-1 flex-col">
                {g.features.map((f) => (
                  <li key={f.title} className="group flex gap-4 py-4">
                    <FeatureIcon d={f.icon} />
                    <div>
                      <p className="font-semibold text-navy-950">{f.title}</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-slate">{f.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Product preview ---------- */

function Preview() {
  return (
    <section id="preview" aria-labelledby="preview-title" className="scroll-mt-16 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="max-w-2xl">
          <Eyebrow>Product preview</Eyebrow>
          <h2 id="preview-title" className="mt-3 text-[28px] leading-tight font-semibold tracking-tight text-balance text-navy-950 sm:text-4xl">
            Real screens from the working app.
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-slate">
            Captured from the demo with fictional shops and products. Nothing here is a mock-up.
          </p>
        </div>
        <div className="mt-10">
          <PreviewTabs />
        </div>
      </div>
    </section>
  );
}

/* ---------- How it works ---------- */

const STEPS = [
  {
    title: "The retailer orders",
    body: "Either from the catalogue in the app, or by sending a text message that the order desk pastes into the AI inbox.",
  },
  {
    title: "AI suggests product matches",
    body: "Each line gets a matched SKU, quantity and unit with a confidence level. Unclear units, unknown products and stock problems are flagged.",
  },
  {
    title: "The order desk verifies and processes",
    body: "The desk corrects any line, confirms the order, then approves it or releases a credit hold, and exports it to Tally.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 bg-navy-900 text-white">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="max-w-2xl">
          <Eyebrow onNavy>How it works</Eyebrow>
          <h2 id="how-title" className="mt-3 text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            From a message to an approved order in three steps.
          </h2>
        </div>

        <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-white/10 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col bg-navy-900 p-6 sm:p-8 md:bg-navy-800/60">
              <span className="num inline-flex h-9 w-9 items-center justify-center rounded-full border border-leaf/50 text-[15px] font-semibold text-leaf">
                {i + 1}
              </span>
              <h3 className="mt-5 text-lg font-semibold text-balance">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-navy-300">{s.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex items-start gap-4 rounded-2xl border border-leaf/30 bg-leaf/[0.07] p-5 sm:items-center sm:p-6">
          <svg className="mt-0.5 shrink-0 text-leaf sm:mt-0" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4" />
          </svg>
          <p className="text-[16px] leading-relaxed text-navy-100">
            <strong className="font-semibold text-white">A person always confirms.</strong> The AI only proposes lines. It never
            sees prices, stock or schemes, and no order exists until someone on the desk has checked every line against the original
            message.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------- Trust and engineering ---------- */

const HIGHLIGHTS = [
  {
    title: "Role-based experiences",
    body: "Retailers see only their own prices, credit and orders. The order desk has its own area. Each role is checked on the server for every page and action.",
  },
  {
    title: "Server-side pricing and stock",
    body: "The phone sends products and case counts only. Prices, schemes, GST, stock and credit are recalculated on the server when the order is written.",
  },
  {
    title: "Human-in-the-loop AI",
    body: "AI output is checked against the catalogue and the retailer's own words, then confirmed by a person before an order is created.",
  },
  {
    title: "English and Hindi",
    body: "The retailer and order desk screens switch between English and हिंदी with one tap, and the choice is saved for each user.",
  },
];

function Trust() {
  return (
    <section aria-labelledby="trust-title" className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <SectionHead id="trust-title" eyebrow="Engineering" title="Careful where money and stock are involved." />
        <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {HIGHLIGHTS.map((h) => (
            <li key={h.title} className="border-t-2 border-navy-900 pt-5">
              <h3 className="font-semibold text-navy-950">{h.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-slate">{h.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- Final CTA and footer ---------- */

function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="bg-white">
      <div className="mx-auto max-w-6xl px-5 pb-20 sm:px-8 lg:pb-28">
        <div className="relative overflow-hidden rounded-3xl bg-navy-900 px-6 py-12 text-white sm:px-12 sm:py-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:44px_44px]"
          />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <h2 id="cta-title" className="text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
                See an order go from a text message to Tally.
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-navy-300">
                Sign in as a retailer to place an order, or as the order desk to review AI-captured messages and approve orders.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
              <Link href="/login" className={ctaPrimaryOnNavy}>
                Explore Demo <Arrow />
              </Link>
              <Link href="/login" className={ctaSecondaryOnNavy}>
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const links = [
    { href: "#features", label: "Features" },
    { href: "#how-it-works", label: "How it works" },
    { href: "#preview", label: "Product preview" },
    { href: "/login", label: "Sign In" },
  ];
  return (
    <footer className="bg-navy-950 text-navy-300">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-start md:justify-between">
        <div>
          <span className="inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-white">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
              <rect x="3" y="11" width="8" height="8" rx="1.5" fill="var(--color-leaf)" />
              <rect x="13" y="11" width="8" height="8" rx="1.5" fill="var(--color-leaf)" opacity="0.55" />
              <rect x="8" y="3" width="8" height="7" rx="1.5" fill="var(--color-leaf)" opacity="0.8" />
            </svg>
            VyapaarFlow
          </span>
          <p className="mt-2 text-[15px]">Smarter Orders. Seamless Distribution.</p>
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed">
            Demo application. All shops, people, products and prices are fictional.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-10 gap-y-1 text-[15px] sm:grid-cols-3">
            {links.map((l) => (
              <li key={l.href}>
                {l.href.startsWith("/") ? (
                  <Link href={l.href} className="inline-flex h-10 items-center hover:text-white">
                    {l.label}
                  </Link>
                ) : (
                  <a href={l.href} className="inline-flex h-10 items-center hover:text-white">
                    {l.label}
                  </a>
                )}
              </li>
            ))}
            <li>
              <a href={REPO} className="inline-flex h-10 items-center hover:text-white" rel="noopener noreferrer" target="_blank">
                Source on GitHub
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export function LandingPage() {
  const demo = process.env.DEMO_MODE === "true";
  return (
    <div lang="en-IN" className="landing-motion flex min-h-full flex-1 flex-col bg-white text-navy-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-navy-950"
      >
        Skip to content
      </a>
      <LandingNav />
      <main id="main" className="flex-1">
        <Hero demo={demo} />
        <Problem />
        <Features />
        <Preview />
        <HowItWorks />
        <Trust />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
