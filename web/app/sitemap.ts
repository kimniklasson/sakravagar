import type { MetadataRoute } from "next";

const siteOrigin = "https://sakravagar.se";
const lastModified = new Date("2026-05-15T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteOrigin,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteOrigin}/integritet`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];
}
