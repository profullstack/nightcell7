import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source (PRD §17.2 single-repo rule).
  transpilePackages: ["@nightcell7/ui", "@nightcell7/game-core", "@nightcell7/entitlements"],
  images: {
    formats: ["image/avif", "image/webp"],
    // Never serve a stale capture.
    //
    // Next's optimiser defaults to `Cache-Control: public, max-age=14400` on
    // /_next/image responses. The capture filenames are stable by design, so a
    // returning visitor kept the previous build's screenshots for four hours
    // after a re-capture even though the server had the new ones.
    //
    // 0 does not mean "do not store" — it means revalidate every time. With the
    // ETag Next already sends, an unchanged image costs a 304 rather than a
    // re-download, so this removes staleness without removing efficiency.
    minimumCacheTTL: 0,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // The in-engine captures are regenerated whenever the renderer changes
        // and keep their filenames, so they must always be revalidated. Paired
        // with `minimumCacheTTL: 0` above, which covers the optimised variants
        // actually served to the page.
        source: "/media/yard/:path*",
        headers: [{ key: "cache-control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default config;
