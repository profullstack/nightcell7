import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_ORIGIN ?? "https://nightcell7.com"),
  title: {
    default: "NIGHTCELL 7: FALSE DAWN",
    template: "%s — NIGHTCELL 7",
  },
  description:
    "Two operatives. Two countries. One manufactured war. Play both sides before the truth disappears.",
  openGraph: {
    title: "NIGHTCELL 7: FALSE DAWN",
    description: "One theater. Two campaigns. $9.99.",
    type: "website",
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
