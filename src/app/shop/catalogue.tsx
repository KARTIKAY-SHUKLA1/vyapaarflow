"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { ProductImage } from "@/components/product-image";
import { Badge, Button, cx, EmptyState } from "@/components/ui";
import { fill, type Messages } from "@/lib/i18n/messages";
import { formatPaise } from "@/lib/money";
import type { StockStatus } from "@/server/catalogue";
import { categoryLabel, StockBadge } from "./labels";
import { useCart, type CartLine } from "./cart-store";
import { Stepper } from "./stepper";

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
}: {
  items: CatalogueCard[];
  t: T;
  common: Messages["common"];
  ownerName: string;
  availablePaise: number;
  lastOrder: { number: string; lines: CartLine[] } | null;
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

  if (items.length === 0) return <EmptyState title={t.emptyCatalogueTitle} body={t.emptyCatalogueBody} />;

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
              <span className="text-[12px] font-normal text-ink-3">{fill(t.repeatLastHint, { number: lastOrder.number, n: lastOrder.lines.length })}</span>
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
          title={t.noResultsTitle}
          body={t.noResultsBody}
          action={
            <Button variant="secondary" onClick={() => (setQuery(""), setCategory(null))}>
              {t.clearSearch}
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <ProductCard key={item.id} item={item} t={t} common={common} />
          ))}
        </ul>
      )}
    </>
  );
}

function ProductCard({ item, t, common }: { item: CatalogueCard; t: T; common: Messages["common"] }) {
  const cart = useCart();
  const inCart = cart.casesOf(item.id);
  const out = item.stockStatus === "out";
  const labels = { decrease: t.decrease, increase: t.increase, cases: t.casesLabel };

  return (
    <li className={cx("flex gap-3 rounded-lg border border-line bg-surface p-3 shadow-card", out && "opacity-75")}>
      <Link href={`/shop/p/${item.code}`} className="shrink-0" aria-label={item.name}>
        <ProductImage imageKey={item.imageKey} label={item.sizeLabel} size="md" alt="" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={`/shop/p/${item.code}`} className="text-[15px] leading-snug font-semibold hover:underline">
          {item.name}
        </Link>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <StockBadge t={t} status={item.stockStatus} cases={item.stockCases} />
          {item.scheme && <Badge tone="scheme">{item.scheme}</Badge>}
        </div>
        <p className="mt-1.5">
          <span className="num text-[17px] font-semibold">{formatPaise(item.casePricePaise)}</span>{" "}
          <span className="text-[13px] text-ink-2">
            {t.perCase} · {common.exclGst}
          </span>
        </p>
        <p className="num text-[13px] text-ink-3">{fill(t.perPiece, { price: formatPaise(item.pricePerPiecePaise) })} · {fill(t.caseOf, { n: item.packSize })}</p>
        <div className="mt-2">
          {out ? (
            <Button variant="secondary" disabled className="w-full sm:w-auto">
              {t.outOfStock}
            </Button>
          ) : inCart > 0 ? (
            <Stepper value={inCart} max={item.stockCases} onChange={(n) => cart.setCases(item.id, n)} labels={labels} />
          ) : (
            <Button onClick={() => cart.setCases(item.id, 1)} className="w-full sm:w-auto sm:px-6">
              {t.add}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
