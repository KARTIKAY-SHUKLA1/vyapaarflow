import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n/server";
import { Checkout } from "./checkout";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const { lang, t } = await getMessages();
  return <Checkout t={t.shop} common={t.common} lang={lang} />;
}
