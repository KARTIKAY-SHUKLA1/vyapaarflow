import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/dal";
import { homeFor } from "@/lib/auth/policy";
import { LandingPage } from "./_landing/landing-page";

export const metadata: Metadata = {
  title: { absolute: "VyapaarFlow — Smarter Orders. Seamless Distribution." },
  description:
    "Retailer ordering and AI-assisted order capture for FMCG distributors. Retailers order from a priced catalogue; the order desk turns Hinglish text orders into checked draft lines, confirms them, and exports approved orders to Tally.",
  openGraph: {
    title: "VyapaarFlow — Smarter Orders. Seamless Distribution.",
    description:
      "One connected platform for retailers and distributors: FMCG ordering, AI-assisted order capture with human confirmation, and Tally-ready export.",
    type: "website",
    siteName: "VyapaarFlow",
  },
};

/**
 * Signed-in users keep going straight to their role home, as before (requireViewer
 * also sends wrong-role visitors here to be forwarded). Everyone else sees the
 * public landing page.
 */
export default async function Home() {
  const viewer = await getViewer();
  if (viewer) redirect(homeFor(viewer.role));
  return <LandingPage />;
}
