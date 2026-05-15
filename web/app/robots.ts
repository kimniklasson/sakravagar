import type { MetadataRoute } from "next";

const siteOrigin = "https://sakravagar.se";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${siteOrigin}/sitemap.xml`,
  };
}
