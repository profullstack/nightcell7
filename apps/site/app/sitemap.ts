import type { MetadataRoute } from "next";

const ORIGIN = "https://nightcell7.com";

/**
 * Public, indexable pages only. Account, checkout, claim and password pages
 * are per-visitor and stay out; /characters/[side] lists the two dossiers.
 */
const PATHS = [
  "/",
  "/episodes/false-dawn",
  "/multiplayer",
  "/downloads",
  "/system-requirements",
  "/yards",
  "/gallery",
  "/characters",
  "/characters/rook",
  "/characters/leila",
  "/news",
  "/faq",
  "/support",
  "/status",
  "/press",
  "/careers",
  "/credits",
  "/privacy",
  "/terms",
  "/refunds",
  "/licenses",
  "/community-guidelines",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({
    url: `${ORIGIN}${path}`,
    changeFrequency: path === "/" || path === "/news" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/episodes/false-dawn" ? 0.9 : 0.5,
  }));
}
