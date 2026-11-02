import type { Metadata, Viewport } from "next";
import { getLang } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VyapaarFlow", template: "%s · VyapaarFlow" },
  description: "Retailer ordering and AI order capture for an FMCG distributor.",
  applicationName: "VyapaarFlow",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f5d46",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getLang();
  return (
    <html lang={lang === "hi" ? "hi" : "en-IN"} className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
