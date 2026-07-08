import type { MetadataRoute } from "next";

const SITE_URL = process.env.BETTER_AUTH_URL || "https://strattice.in";

// Public, indexable routes only - everything behind auth stays out.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, priority: 1 },
    { url: `${SITE_URL}/demo`, lastModified: now, priority: 0.8 },
    { url: `${SITE_URL}/sign-up`, lastModified: now, priority: 0.5 },
    { url: `${SITE_URL}/sign-in`, lastModified: now, priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, priority: 0.2 },
    { url: `${SITE_URL}/privacy`, lastModified: now, priority: 0.2 },
  ];
}
