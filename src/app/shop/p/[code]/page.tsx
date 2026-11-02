import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImage } from "@/components/product-image";
import { Badge, Card } from "@/components/ui";
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
      <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="mx-auto w-full max-w-xs md:max-w-none">
          <ProductImage imageKey={item.imageKey} label={sizeLabel} size="lg" alt={name} />
        </div>
        <div>
          <p className="text-[13px] font-medium text-ink-3">
            {item.brand} · {categoryLabel(t.shop, item.category)} · {item.code}
          </p>
          <h1 className="mt-1 text-[24px] leading-tight font-semibold tracking-tight">{name}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StockBadge t={t.shop} status={item.stockStatus} cases={item.stockCases} />
            {item.scheme && <Badge tone="scheme">{describeScheme(item.scheme, lang)}</Badge>}
          </div>

          <p className="mt-4">
            <span className="num text-[26px] font-semibold">{formatPaise(item.casePricePaise)}</span>{" "}
            <span className="text-[15px] text-ink-2">
              {t.shop.perCase} · {t.common.exclGst}
            </span>
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[15px] sm:max-w-sm">
            <dt className="text-ink-3">{fill(t.shop.caseOf, { n: item.packSize })}</dt>
            <dd className="num text-right">{fill(t.shop.perPiece, { price: formatPaise(item.pricePerPiecePaise) })}</dd>
            <dt className="text-ink-3">{t.shop.gstRate}</dt>
            <dd className="num text-right">{formatBp(item.gstRateBp)}</dd>
          </dl>

          <Card className="mt-5 p-4">
            <h2 className="text-[15px] font-semibold">{t.shop.schemeTitle}</h2>
            <p className="mt-1 text-[15px] text-ink-2">{item.scheme ? describeScheme(item.scheme, lang) : t.shop.noScheme}</p>
          </Card>

          <div className="mt-5">
            <QuantityPicker skuId={item.id} stockCases={item.stockCases} t={t.shop} retryLabel={t.common.retry} />
          </div>
        </div>
      </div>
    </>
  );
}
