import type { Metadata } from "next";
import { PageShell, DraftNotice } from "../_components/page-shell";

export const metadata: Metadata = {
  title: "Downloads",
  description: "Play in a browser, or install NIGHTCELL 7 on macOS, Windows and Linux.",
};

const REPO = "https://github.com/profullstack/nightcell7";

/**
 * Release availability.
 *
 * Flipped to true once the first tagged desktop release is published. Until
 * then the page shows the commands and says plainly that there is nothing to
 * download yet, rather than linking at 404s.
 */
const HAS_RELEASE = false;

function Command({ label, children }: { label: string; children: string }) {
  return (
    <div className="command">
      <p className="command__label">{label}</p>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export default function DownloadsPage() {
  return (
    <PageShell
      label="Platforms"
      title="Downloads"
      lede="Play instantly in a browser, or install it properly. One purchase covers every platform."
    >
      <h3>Play now, install nothing</h3>
      <p className="cta-row">
        <a className="button button--primary" href="/play">
          Launch in browser
        </a>
      </p>
      <p>
        The browser build is the same build as everything else. Nothing is held back for the desktop
        version.
      </p>

      <h3>Install with one command</h3>
      <Command label="macOS and Linux">curl -fsSL https://nightcell7.com/install.sh | sh</Command>
      <Command label="Windows (PowerShell)">irm https://nightcell7.com/install.ps1 | iex</Command>
      <p>
        Both scripts detect your platform and architecture, verify the download against the
        release&rsquo;s published SHA256 checksums, and refuse to install on a mismatch. Read them
        first if you would rather not pipe a script into a shell &mdash;{" "}
        <a href="/install.sh">install.sh</a> and <a href="/install.ps1">install.ps1</a> are plain
        text.
      </p>

      <h3>Package managers</h3>
      <Command label="Homebrew (macOS)">brew install --cask nightcell7</Command>
      <Command label="Scoop (Windows)">scoop install nightcell7</Command>
      <Command label="WinGet (Windows)">winget install Profullstack.Nightcell7</Command>
      <Command label="AUR (Arch Linux)">yay -S nightcell7-bin</Command>
      <Command label="Nix">nix-env -iA nixpkgs.nightcell7</Command>

      <h3>Direct downloads</h3>
      {HAS_RELEASE ? (
        <ul>
          <li>
            <a href={`${REPO}/releases/latest`}>macOS &mdash; .dmg (Apple silicon and Intel)</a>
          </li>
          <li>
            <a href={`${REPO}/releases/latest`}>Windows &mdash; installer .exe</a>
          </li>
          <li>
            <a href={`${REPO}/releases/latest`}>Linux &mdash; .AppImage, .deb, .rpm</a>
          </li>
        </ul>
      ) : (
        <DraftNotice>
          <strong>No desktop release is published yet.</strong> The packaging pipeline is built and
          the commands above are the ones that will work, but the first tagged build has not been
          cut. Until an installer is signed and notarised we would rather ship nothing than ask you
          to click through a security warning. Play in the browser meanwhile &mdash; it is the same
          build.
        </DraftNotice>
      )}

      <h3>Verifying a download</h3>
      <p>
        Every release publishes <code>SHA256SUMS.txt</code> alongside the binaries. To check a file
        by hand:
      </p>
      <Command label="macOS / Linux">{`shasum -a 256 -c SHA256SUMS.txt --ignore-missing`}</Command>

      <h3>Install as a web app</h3>
      <p>
        Open <a href="/play">/play</a> and use your browser&rsquo;s install action. The installed
        PWA gets its own window and icon, and runs offline once content is downloaded.
      </p>

      <h3>Requirements</h3>
      <p>
        See <a href="/system-requirements">system requirements</a>. Run the in-game benchmark before
        buying anything &mdash; it is the honest answer for your machine.
      </p>
    </PageShell>
  );
}
