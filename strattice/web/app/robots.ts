import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Authed/app surfaces and APIs: nothing indexable there.
        disallow: [
          "/api/",
          "/dashboard",
          "/strategies",
          "/account",
          "/settings",
          "/admin",
          "/billing",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
