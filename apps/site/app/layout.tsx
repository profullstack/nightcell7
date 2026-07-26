import type { Metadata, Viewport } from "next";
import "./globals.css";
import Script from "next/script";

/**
 * Canonical origin.
 *
 * CLAUDE.md names nightcell7.com as the canonical public origin, and it stays
 * the target. Until the domain is cut over, the deployed Railway host is the
 * only origin that actually resolves, and an absolute OG/canonical URL pointing
 * at a domain that does not serve the site yet is worse than no tag at all.
 * Set PUBLIC_ORIGIN to override; flip this default when .com goes live.
 */
const ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://nightcell7.up.railway.app";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: {
    default: "NIGHTCELL 7: FALSE DAWN",
    template: "%s — NIGHTCELL 7",
  },
  description:
    "Two operatives. Two countries. One manufactured war. Play both sides before the truth disappears.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon-512.png", sizes: "512x512" }],
  },
  openGraph: {
    title: "NIGHTCELL 7: FALSE DAWN",
    description: "One theater. Two campaigns. $9.99.",
    type: "website",
    url: ORIGIN,
    siteName: "NIGHTCELL 7",
    images: [
      {
        url: "/media/yard/west-catwalk.webp",
        width: 1920,
        height: 1080,
        alt: "Ardavan Yard at first light, seen from the west catwalk.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NIGHTCELL 7: FALSE DAWN",
    description: "One theater. Two campaigns. $9.99.",
    images: ["/media/yard/west-catwalk.webp"],
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
