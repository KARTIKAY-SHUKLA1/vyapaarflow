import type { MetadataRoute } from "next";

/** Installable web app (brief: "Installable web app"). Opens straight to sign-in / the user's home. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VyapaarFlow",
    short_name: "VyapaarFlow",
    description: "Order stock from your distributor in a minute — prices, schemes and stock in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f6f2",
    theme_color: "#1f5d46",
    lang: "en-IN",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
