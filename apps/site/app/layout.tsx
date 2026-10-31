import PwaRegistration from "./PwaRegistration";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import Script from "next/script";
import { Footer } from "@profullstack/footer/react";
import { AdUnit } from "./_components/ad-unit";
import captures from "../public/media/yard/manifest.json";
import trailer from "../public/media/trailer/manifest.json";

const shareShot =
  captures.shots.find((shot) => shot.name === "yard-approach") ?? captures.shots[0]!;
const shareImage = `/media/yard/${shareShot.file}`;

/**
 * Canonical origin.
 *
 * CLAUDE.md names nightcell7.com as the canonical public origin. This used to
 * default to the Railway host, because pointing an absolute OG or canonical URL
 * at a domain that does not serve the site yet is worse than no tag at all, and
 * the note said to flip it when .com went live.
 *
 * It is live: nightcell7.com serves the whole site, so every share card and
 * canonical URL now names the domain we actually want indexed rather than the
 * deploy host. Set PUBLIC_ORIGIN to override, which is what a preview
 * deployment should do.
 */
const ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://nightcell7.com";

/**
 * Absolute, unlike `shareImage`.
 *
 * Next resolves a relative `openGraph.images` entry against `metadataBase` but
 * leaves `openGraph.videos` alone, so the tag shipped as `/media/trailer/…` —
 * a path no crawler can fetch. Declared after ORIGIN because it reads it, and a
 * `const` read above its own initialiser is a module-eval crash, not a warning.
 */
const shareVideo = `${ORIGIN}/media/trailer/${trailer.file}`;

/*
 * Re-render pages at most hourly (ISR), so @profullstack/footer and the
 * pit.world global footer below pick up new releases without a redeploy. Routes that set
 * their own (smaller) value or are dynamic keep it.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  metadataBase: new URL(ORIGIN),
  title: {
    default: "NIGHTCELL 7: FALSE DAWN",
    template: "%s — NIGHTCELL 7",
  },
  description:
    "Two operatives. Two countries. One manufactured war. Play both sides before the truth disappears.",
  icons: {
    // favicon.svg first: a browser that understands SVG gets the mark at any
    // size, and the .ico is the fallback for the ones that do not. Both are
    // generated — the SVG by `tools/art/brand.mjs`, the rasters by `fav`.
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [{ url: "/icons/apple-touch-icon-180x180.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "NIGHTCELL 7: FALSE DAWN",
    description: "One theater. Two campaigns. $9.99.",
    type: "website",
    url: ORIGIN,
    siteName: "NIGHTCELL 7",
    images: [
      {
        url: shareImage,
        width: captures.viewport.width,
        height: captures.viewport.height,
        alt: shareShot.caption,
      },
    ],
    // og:video, so a shared link previews the film rather than a still where
    // the platform supports it. The image above stays the fallback: most
    // crawlers will not play a 7 MB MP4, and og:image is what they show.
    videos: [
      {
        url: shareVideo,
        width: trailer.width,
        height: trailer.height,
        type: "video/mp4",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NIGHTCELL 7: FALSE DAWN",
    description: "One theater. Two campaigns. $9.99.",
    images: [shareImage],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaRegistration />
        <a href="#main" className="tag" style={{ position: "absolute", left: "-9999px" }}>
          Skip to content
        </a>
        <header className="masthead">
          <a href="/" className="wordmark" aria-label="NIGHTCELL 7 home">
            NIGHTCELL <span>7</span>
          </a>
          <nav aria-label="Primary">
            <a href="/episodes/false-dawn">Episode 1</a>
            <a href="/multiplayer">Multiplayer</a>
            <a href="/downloads">Downloads</a>
            <a href="/yards">Yards</a>
            <a href="/gallery">Gallery</a>
            <a href="/news">News</a>
            <a href="/play">Play</a>
            <a href="/account">Account</a>
          </nav>
        </header>
        <main id="main">
          <AdUnit />
          {children}
        </main>
        {/* Keep the game's fiction and photosensitivity notice outside the shared footer. */}
        <p className="disclaimer">
          NIGHTCELL 7 is a fictional work set in an invented near-future crisis. Its organizations,
          facilities, operations, and characters are fictional. The game does not depict or endorse
          any real government, military operation, political movement, or current event. It contains
          flashing lights and can be played with flash reduction enabled.
        </p>
        {/* The shared template carries the site's links, badges, webring, and copyright. */}
        <Footer
          site="https://nightcell7.com/"
          builtIndieHref="https://built.indie.pit.world/p/nightcell-7?ref=badge"
          links={[
            { label: "Downloads", href: "/downloads" },
            { label: "FAQ", href: "/faq" },
            { label: "Support", href: "/support" },
            { label: "Status", href: "/status" },
            { label: "Press", href: "/press" },
            {
              label: "Source",
              href: "https://github.com/profullstack/nightcell7",
              rel: "noopener noreferrer",
            },
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
            { label: "Refunds", href: "/refunds" },
            { label: "Licenses", href: "/licenses" },
            { label: "Guidelines", href: "/community-guidelines" },
          ]}
          badges={[
            {
              href: "https://foundplay.io/games/nightcell-7-false-dawn?utm_source=badge",
              src: "https://foundplay.io/badge/nightcell-7-false-dawn.svg",
              alt: "Play NIGHTCELL 7: FALSE DAWN on Foundplay",
              width: 242,
              height: 28,
            },
          ]}
        />
        <Script
          data-site="af9ab953-caa6-4a2b-a306-42fb4eac4630"
          src="https://crawlproof.com/stats.js"
          strategy="afterInteractive"
        />
        <Script src="https://crawlproof.com/ad.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
