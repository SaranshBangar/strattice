import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_DESCRIPTION } from "@/lib/seo";

// Web App Manifest (served at /manifest.webmanifest). Makes the site installable
// and gives Android/Chrome a real icon + name instead of a screenshot thumbnail.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} · Algorithmic crypto trading on your own CoinDCX account`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { src: "/favicon-96.png", sizes: "96x96", type: "image/png" },
      { src: "/favicon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/favicon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
