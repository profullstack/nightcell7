import type { Metadata, Viewport } from "next";
import "./globals.css";

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
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <nav aria-label="Footer">
            <a href="/system-requirements">System Requirements</a>
            <a href="/faq">FAQ</a>
            <a href="/support">Support</a>
            <a href="/press">Press</a>
            <a href="/credits">Credits</a>
            <a href="/licenses">Licenses</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/refunds">Refunds</a>
            <a href="/community-guidelines">Community Guidelines</a>
            <a href="/status">Service Status</a>
            {/* Public source. rel=noreferrer alongside target=_blank so the
                new tab cannot reach back through window.opener. */}
            <a
              href="https://github.com/profullstack/nightcell7"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>
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
      </body>
    </html>
  );
}
