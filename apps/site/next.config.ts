import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source (PRD §17.2 single-repo rule).
  transpilePackages: ["@nightcell7/ui", "@nightcell7/game-core", "@nightcell7/entitlements"],
  images: {
    // Serve the shipped WebP files as they are; no on-the-fly optimisation.
    //
    // The optimiser (sharp, under Bun, encoding AVIF at up to 3840w) took the
    // Next process from ~130 MB to ~1.5 GB RSS after one pass over the home
    // page's 200 image variants, and that memory is never handed back. In the
    // single 1.5 GB container that runs site + api + multiplayer + worker +
    // gateway, the kernel OOM-killed Next at 02:24 UTC on 2026-10-02 (1.35 GB
    // anon RSS). The sources are already WebP, at most 1920 px wide and
    // 150-350 KB, so the optimiser bought almost nothing for that cost.
    // Freshness is unchanged: /media/* is still revalidated on every request
    // by the headers below.
    unoptimized: true,
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
        // and keep their filenames, so they must always be revalidated.
        source: "/media/yard/:path*",
        headers: [{ key: "cache-control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        // The trailer keeps its filename across re-renders for the same reason
        // the captures do, so it gets the same revalidate-always rule. The
        // file is only fetched when a visitor presses play (`preload="none"`),
        // and an unchanged one costs a 304 rather than 7 MB.
        source: "/media/trailer/:path*",
        headers: [{ key: "cache-control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        source: "/media/yard-films/:path*",
        headers: [{ key: "cache-control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        // The gameplay frames and the asset sheet are regenerated whenever the
        // art pass or the build changes, and the sheet keeps its filename, so
        // it gets the same rule as everything else under /media.
        source: "/media/art/:path*",
        headers: [{ key: "cache-control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default config;
