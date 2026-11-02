import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n/server";
import { CartView } from "./cart-view";

export const metadata: Metadata = { title: "Cart" };

export default async function CartPage() {
  const { lang, t } = await getMessages();
  return <CartView t={t.shop} common={t.common} lang={lang} />;
}
