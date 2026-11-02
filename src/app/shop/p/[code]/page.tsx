import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImage } from "@/components/product-image";
import { db } from "@/db";
import { requireViewer } from "@/lib/auth/dal";
import { fill } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { formatBp, formatPaise } from "@/lib/money";
import { describeScheme, isoDateIST } from "@/lib/pricing";
import { loadCatalogue, loadRetailer } from "@/server/catalogue";
import { categoryLabel, sizeLabel as sizeOf, StockBadge } from "../../labels";
import { QuantityPicker } from "./quantity-picker";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/shop/p/[code]">) {
  const { code } = await params;
  const viewer = await requireViewer("shop");
  const { lang, t } = await getMessages();
  const retailer = (await loadRetailer(db, viewer.retailerId!))!;
  const item = (await loadCatalogue(db, retailer.priceTier, isoDateIST(new Date()))).find((i) => i.code === code);
  if (!item) notFound();

  const name = lang === "hi" ? item.nameHi : item.name;
  const sizeLabel = sizeOf(item.name);

  return (
    <>
      <Link href="/shop" className="mb-4 inline-flex h-11 items-center text-[15px] font-medium text-ink-2 hover:text-ink">
        ← {t.shop.backToCatalogue}
      </Link>
      {/* Phones: a compact image beside the name keeps price and quantity on the first screen. */}
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-x-6 md:gap-y-5">
        <div className="w-full md:row-span-2">
          <ProductImage imageKey={item.imageKey} label={sizeLabel} size="lg" alt={name} />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-3">
            {item.brand} · {categoryLabel(t.shop, item.category)} · {item.code}
          </p>
          <h1 className="mt-1 text-[20px] leading-tight font-semibold tracking-tight md:text-[24px]">{name}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StockBadge t={t.shop} status={item.stockStatus} cases={item.stockCases} />
          </div>
          <p className="mt-3">
            <span className="num text-[22px] font-semibold md:text-[26px]">{formatPaise(item.casePricePaise)}</span>{" "}
            <span className="text-[14px] text-ink-2">
              {t.shop.perCase} · {t.common.exclGst}
            </span>
          </p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[14px] sm:max-w-sm md:text-[15px]">
            <dt className="text-ink-3">{fill(t.shop.caseOf, { n: item.packSize })}</dt>
            <dd className="num text-right">{fill(t.shop.perPiece, { price: formatPaise(item.pricePerPiecePaise) })}</dd>
            <dt className="text-ink-3">{t.shop.gstRate}</dt>
            <dd className="num text-right">{formatBp(item.gstRateBp)}</dd>
          </dl>
        </div>

        <div className="col-span-2 md:col-span-1 md:col-start-2">
          <QuantityPicker
          skuId={item.id}
          stockCases={item.stockCases}
          t={t.shop}
          retryLabel={t.common.retry}
            scheme={item.scheme ? { text: describeScheme(item.scheme, lang), percentBp: item.scheme.type === "SLAB_PERCENT" ? item.scheme.percentBp : null } : null}
          />
        </div>
      </div>
    </>
  );
}
