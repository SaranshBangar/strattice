import type { MetadataRoute } from "next";

const SITE_URL = process.env.BETTER_AUTH_URL || "https://strattice.in";

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
