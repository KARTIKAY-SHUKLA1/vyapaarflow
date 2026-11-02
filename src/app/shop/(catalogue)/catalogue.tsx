"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { ProductImage } from "@/components/product-image";
import { Badge, Button, cx, EmptyState } from "@/components/ui";
import { fill, type Messages } from "@/lib/i18n/messages";
import { formatPaise } from "@/lib/money";
import type { StockStatus } from "@/server/catalogue";
import { categoryLabel, shortName, StockBadge } from "../labels";
import { useCart, type CartLine } from "../cart-store";
import { useToast } from "../toast";
import { Stepper } from "../stepper";

export type CatalogueCard = {
  id: string;
  code: string;
  name: string;
  searchText: string;
  category: string;
  packSize: number;
  imageKey: string;
  sizeLabel: string;
  casePricePaise: number;
  pricePerPiecePaise: number;
  stockCases: number;
  stockStatus: StockStatus;
  scheme: string | null;
};

type T = Messages["shop"];

export function Catalogue({
  items,
  t,
  common,
  ownerName,
  availablePaise,
  lastOrder,
  usual,
}: {
  items: CatalogueCard[];
  t: T;
  common: Messages["common"];
  ownerName: string;
  availablePaise: number;
  lastOrder: { number: string; lines: CartLine[] } | null;
  /** The shop's usual items (from its own past orders) with its usual case quantity. */
  usual: { skuId: string; cases: number }[];
}) {
  const router = useRouter();
  const cart = useCart();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const visible = useMemo(() => {
    const words = deferredQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => (!category || i.category === category) && words.every((w) => i.searchText.includes(w)));
  }, [items, category, deferredQuery]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const showUsual = usual.length > 0 && !category && !deferredQuery.trim();

  if (items.length === 0) return <EmptyState icon="search" title={t.emptyCatalogueTitle} body={t.emptyCatalogueBody} />;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{fill(t.welcome, { name: ownerName })}</h1>
          <p className="text-[15px] text-ink-2">
            {t.available}: <span className="num font-semibold text-ink">{formatPaise(availablePaise)}</span>
          </p>
        </div>
        {lastOrder && (
          <Button
            variant="secondary"
            onClick={() => {
              cart.addMany(lastOrder.lines);
              router.push("/shop/cart");
            }}
          >
            <span className="flex flex-col items-start leading-tight">
              <span>{t.repeatLast}</span>
              <span className="text-[13px] font-normal text-ink-3">{fill(t.repeatLastHint, { number: lastOrder.number, n: lastOrder.lines.length })}</span>
            </span>
          </Button>
        )}
      </div>

      <div className="sticky top-14 z-10 -mx-4 bg-canvas/95 px-4 pt-1 pb-3 backdrop-blur">
        <label className="sr-only" htmlFor="catalogue-search">
          {t.searchLabel}
        </label>
        <input
          id="catalogue-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchPlaceholder}
          autoComplete="off"
          className="h-12 w-full rounded-md border border-line-strong bg-surface px-4 text-base outline-none focus:border-accent"
        />
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Categories">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? "all"}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cx(
                "h-10 shrink-0 rounded-full border px-4 text-[15px] font-medium",
                category === c ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken",
              )}
            >
              {c ? categoryLabel(t, c) : t.allCategories}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="search"
          title={t.noResultsTitle}
          body={t.noResultsBody}
          action={
            <Button variant="secondary" onClick={() => (setQuery(""), setCategory(null))}>
              {t.clearSearch}
            </Button>
          }
        />
      ) : (
        <>
          {showUsual && (
            <section aria-labelledby="usual-title" className="mb-5">
              <h2 id="usual-title" className="text-[17px] font-semibold">
                {t.usualTitle}
              </h2>
              <p className="text-[14px] text-ink-2">{t.usualHint}</p>
              <ul className="-mx-4 mt-2 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
                {[...usual].sort((a, b) => Number(byId.get(a.skuId)?.stockStatus === "out") - Number(byId.get(b.skuId)?.stockStatus === "out")).map((u) => {
                  const item = byId.get(u.skuId);
                  return item ? <UsualTile key={u.skuId} item={item} usualCases={u.cases} t={t} /> : null;
                })}
              </ul>
            </section>
          )}
          {showUsual && <h2 className="mb-2 text-[17px] font-semibold">{t.allProducts}</h2>}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => (
              <ProductCard key={item.id} item={item} t={t} common={common} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Small gift mark so a scheme reads as an offer at a glance (inline SVG, no request). */
function SchemeBadge({ text }: { text: string }) {
  return (
    <Badge tone="scheme" className="font-semibold">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
      </svg>
      {text}
    </Badge>
  );
}

/** One usual item: what the shop normally buys, added in one tap at its usual quantity. */
function UsualTile({ item, usualCases, t }: { item: CatalogueCard; usualCases: number; t: T }) {
  const cart = useCart();
  const toast = useToast();
  const inCart = cart.casesOf(item.id);
  const out = item.stockStatus === "out";
  const cases = Math.max(1, Math.min(usualCases, item.stockCases));
  return (
    <li className={cx("flex w-44 shrink-0 snap-start flex-col rounded-lg border border-line bg-surface p-3 shadow-card", out && "opacity-75")}>
      <Link href={`/shop/p/${item.code}`} className="flex items-start gap-2">
        <ProductImage imageKey={item.imageKey} label={item.sizeLabel} size="sm" alt="" />
        <span className="line-clamp-3 text-[14px] leading-snug font-semibold">{item.name}</span>
      </Link>
      <p className="num mt-2 text-[13px] text-ink-2">{fill(t.usualQty, { n: usualCases })}</p>
      <div className="mt-auto pt-2">
        {out ? (
          <Button variant="secondary" disabled className="w-full">
            {t.outOfStock}
          </Button>
        ) : inCart > 0 ? (
          <Button variant="secondary" onClick={() => (cart.setCases(item.id, inCart + cases), toast.added(shortName(item.name)))} className="w-full">
            {fill(t.inCart, { n: inCart })} · +{cases}
          </Button>
        ) : (
          <Button onClick={() => (cart.setCases(item.id, cases), toast.added(shortName(item.name)))} className="w-full">
            {fill(t.addUsual, { n: cases })}
          </Button>
        )}
      </div>
    </li>
  );
}

/** Compact card: about twice as many products per phone screen; the action sits beside the price. */
function ProductCard({ item, t, common }: { item: CatalogueCard; t: T; common: Messages["common"] }) {
  const cart = useCart();
  const toast = useToast();
  const inCart = cart.casesOf(item.id);
  const out = item.stockStatus === "out";
  const labels = { decrease: t.decrease, increase: t.increase, cases: t.casesLabel };

  return (
    <li className={cx("flex gap-3 rounded-lg border border-line bg-surface p-3 shadow-card", out && "opacity-75")}>
      <Link href={`/shop/p/${item.code}`} className="shrink-0" aria-label={item.name}>
        <ProductImage imageKey={item.imageKey} label={item.sizeLabel} size="md" alt="" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={`/shop/p/${item.code}`} className="line-clamp-2 text-[15px] leading-snug font-semibold hover:underline">
          {item.name}
        </Link>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <StockBadge t={t} status={item.stockStatus} cases={item.stockCases} />
          {item.scheme && <SchemeBadge text={item.scheme} />}
        </div>
        <p className="num mt-1 text-[13px] text-ink-3">
          {fill(t.perPiece, { price: formatPaise(item.pricePerPiecePaise) })} · {fill(t.caseOf, { n: item.packSize })}
        </p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="leading-tight whitespace-nowrap">
              <span className="num text-[17px] font-semibold">{formatPaise(item.casePricePaise)}</span>{" "}
              <span className="text-[13px] text-ink-2">{t.perCase}</span>
            </p>
            <p className="text-[13px] text-ink-3">{common.exclGst}</p>
          </div>
          {out ? (
            <span className="shrink-0 pb-1 text-[14px] font-medium text-ink-3">{t.outOfStock}</span>
          ) : inCart === 0 ? (
            <Button onClick={() => (cart.setCases(item.id, 1), toast.added(shortName(item.name)))} className="shrink-0 px-5" aria-label={`${t.add}: ${item.name}`}>
              + {t.add}
            </Button>
          ) : null}
        </div>
        {!out && inCart > 0 && (
          <div className="mt-2">
            <Stepper value={inCart} max={item.stockCases} onChange={(n) => cart.setCases(item.id, n)} labels={labels} />
          </div>
        )}
      </div>
    </li>
  );
}
