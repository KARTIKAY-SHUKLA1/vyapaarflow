import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { retailers } from "@/db/schema";
import { requireViewer } from "@/lib/auth/dal";
import { getMessages } from "@/lib/i18n/server";
import { getReview } from "@/server/capture";
import { Review } from "./review";

export const metadata: Metadata = { title: "Review AI capture" };

// Server actions take their time limit from the page they are invoked on (Next.js
// maxDuration docs). AI capture can use its whole 12 s model budget plus database
// writes, so allow 30 s here; other desk pages keep the platform default.
export const maxDuration = 30;

export default async function ReviewPage({ params }: PageProps<"/desk/inbox/[id]">) {
  const { id } = await params;
  const viewer = await requireViewer("desk");
  const { lang, t } = await getMessages();
  const review = await getReview(db, viewer, id);
  if (!review) notFound();
  const shops = review.message.retailerId
    ? []
    : await db.select({ id: retailers.id, code: retailers.code, shopName: retailers.shopName, area: retailers.area }).from(retailers).orderBy(asc(retailers.shopName));

  return (
    <>
      <Link href="/desk/inbox" className="mb-3 inline-flex h-11 items-center text-[15px] font-medium text-ink-2 hover:text-ink">
        ← {t.desk.inboxPageTitle}
      </Link>
      <Review
        key={review.capture?.id ?? "none"}
        lang={lang}
        d={t.desk}
        shopT={t.shop}
        message={{ ...review.message, shopName: review.shopName, retailerCode: review.retailerCode, area: review.area }}
        capture={review.capture}
        lines={review.lines}
        catalogue={review.catalogue}
        order={review.order}
        shops={shops}
      />
    </>
  );
}
