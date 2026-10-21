import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/account", "/orders", "/library", "/checkout/", "/claim/"],
    },
    sitemap: "https://nightcell7.com/sitemap.xml",
  };
}
