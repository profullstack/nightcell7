import type { Metadata, Viewport } from "next";
import "./globals.css";
import Script from "next/script";
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

export const metadata: Metadata = {
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
            <a href="/news">News</a>
            <a href="/play">Play</a>
            <a href="/account">Account</a>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="footer__columns">
            <div>
              <h3>Game</h3>
              <ul>
                <li>
                  <a href="/episodes/false-dawn">Episode 1 &mdash; False Dawn</a>
                </li>
                <li>
                  <a href="/multiplayer">Multiplayer Alpha</a>
                </li>
                <li>
                  <a href="/characters/rook">Rook</a>
                </li>
                <li>
                  <a href="/characters/leila">Leila</a>
                </li>
                <li>
                  <a href="/characters">Full cast</a>
                </li>
                <li>
                  <a href="/play">Play in browser</a>
                </li>
              </ul>
            </div>

            <div>
              <h3>Install</h3>
              <ul>
                <li>
                  <a href="/downloads">All downloads</a>
                </li>
                <li>
                  <a href="/downloads#homebrew">Homebrew (macOS)</a>
                </li>
                <li>
                  <a href="/downloads#scoop">Scoop (Windows)</a>
                </li>
                <li>
                  <a href="/downloads#winget">WinGet (Windows)</a>
                </li>
                <li>
                  <a href="/downloads#aur">AUR (Arch)</a>
                </li>
                <li>
                  <a href="/downloads#deb">APT / .deb</a>
                </li>
                <li>
                  <a href="/downloads#rpm">RPM (Fedora)</a>
                </li>
                <li>
                  <a href="/downloads#nix">Nix</a>
                </li>
              </ul>
            </div>

            <div>
              <h3>Resources</h3>
              <ul>
                <li>
                  <a href="/system-requirements">System Requirements</a>
                </li>
                <li>
                  <a href="/faq">FAQ</a>
                </li>
                <li>
                  <a href="/support">Support</a>
                </li>
                <li>
                  <a href="/news">News</a>
                </li>
                <li>
                  <a href="/status">Service Status</a>
                </li>
                <li>
                  <a href="/press">Press Kit</a>
                </li>
                <li>
                  <a
                    href="https://github.com/profullstack/nightcell7"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Source on GitHub
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3>Legal</h3>
              <ul>
                <li>
                  <a href="/privacy">Privacy</a>
                </li>
                <li>
                  <a href="/terms">Terms</a>
                </li>
                <li>
                  <a href="/refunds">Refunds</a>
                </li>
                <li>
                  <a href="/licenses">Licenses</a>
                </li>
                <li>
                  <a href="/community-guidelines">Community Guidelines</a>
                </li>
                <li>
                  <a href="/credits">Credits</a>
                </li>
                <li>
                  <a href="/careers">Careers</a>
                </li>
                <li>
                  <a href="https://profullstack.com" target="_blank" rel="noopener noreferrer">
                    Profullstack, Inc.
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Required fiction disclaimer (PRD §32). */}
          <p className="disclaimer">
            NIGHTCELL 7 is a fictional work set in an invented near-future crisis. Its
            organizations, facilities, operations, and characters are fictional. The game does not
            depict or endorse any real government, military operation, political movement, or
            current event.
          </p>
          <p className="disclaimer">
            Photosensitivity notice: this game contains flashing lights and can be played with flash
            reduction enabled. Payments are processed by CoinPayPortal.
          </p>
        </footer>
        <Script
          data-site="af9ab953-caa6-4a2b-a306-42fb4eac4630"
          src="https://crawlproof.com/stats.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
