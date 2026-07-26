import type { Metadata } from "next";
import { PageShell, DraftNotice } from "../_components/page-shell";

export const metadata: Metadata = {
  title: "Downloads",
  description: "Install NIGHTCELL 7 on macOS, Windows and Linux — or play instantly in a browser.",
};

const REPO = "https://github.com/profullstack/nightcell7";

/**
 * Release availability.
 *
 * Flipped to true once the first tagged desktop release exists. Until then the
 * page shows the real commands and says plainly that nothing is published,
 * rather than linking at 404s.
 */
const HAS_RELEASE = false;

function Command({ label, children }: { label?: string; children: string }) {
  return (
    <div className="command">
      {label ? <p className="command__label">{label}</p> : null}
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

interface Manager {
  id: string;
  name: string;
  platform: string;
  install: string;
  upgrade: string;
  uninstall: string;
  note?: string;
  setup?: string;
}

const MANAGERS: Manager[] = [
  {
    id: "homebrew",
    name: "Homebrew",
    platform: "macOS",
    setup: "brew tap profullstack/tap",
    install: "brew install --cask nightcell7",
    upgrade: "brew upgrade --cask nightcell7",
    uninstall: "brew uninstall --cask nightcell7",
    note: "Installs to /Applications. The cask picks the Apple silicon or Intel build automatically.",
  },
  {
    id: "scoop",
    name: "Scoop",
    platform: "Windows",
    setup: "scoop bucket add profullstack https://github.com/profullstack/scoop-bucket",
    install: "scoop install nightcell7",
    upgrade: "scoop update nightcell7",
    uninstall: "scoop uninstall nightcell7",
    note: "Installs per-user, so it needs no administrator rights.",
  },
  {
    id: "winget",
    name: "WinGet",
    platform: "Windows",
    install: "winget install Profullstack.Nightcell7",
    upgrade: "winget upgrade Profullstack.Nightcell7",
    uninstall: "winget uninstall Profullstack.Nightcell7",
    note: "Ships with Windows 11 and recent Windows 10. Nothing to set up first.",
  },
  {
    id: "aur",
    name: "AUR",
    platform: "Arch Linux",
    install: "yay -S nightcell7-bin",
    upgrade: "yay -Syu nightcell7-bin",
    uninstall: "yay -Rns nightcell7-bin",
    note: "Any AUR helper works — paru -S nightcell7-bin is equivalent. The package wraps the AppImage and falls back to extract-and-run where FUSE is unavailable.",
  },
  {
    id: "deb",
    name: "APT / .deb",
    platform: "Debian, Ubuntu, Mint",
    install: "sudo apt install ./NIGHTCELL-7-*.deb",
    upgrade: "Download the newer .deb and install it the same way",
    uninstall: "sudo apt remove nightcell7",
    note: "Download the .deb from the releases page first. There is no hosted apt repository yet, so upgrades are manual.",
  },
  {
    id: "rpm",
    name: "RPM",
    platform: "Fedora, RHEL, openSUSE",
    install: "sudo dnf install ./NIGHTCELL-7-*.rpm",
    upgrade: "Download the newer .rpm and install it the same way",
    uninstall: "sudo dnf remove nightcell7",
    note: "Use zypper install on openSUSE. No hosted rpm repository yet, so upgrades are manual.",
  },
  {
    id: "nix",
    name: "Nix",
    platform: "NixOS, any Linux",
    install: "nix-env -iA nixpkgs.nightcell7",
    upgrade: "nix-env -uA nixpkgs.nightcell7",
    uninstall: "nix-env -e nightcell7",
    note: "Wraps the x86_64 AppImage with appimageTools.",
  },
  {
    id: "appimage",
    name: "AppImage",
    platform: "Any Linux",
    install: "chmod +x NIGHTCELL-7-*.AppImage && ./NIGHTCELL-7-*.AppImage",
    upgrade: "Replace the file with a newer one",
    uninstall: "Delete the file",
    note: "No installation and no root required. If your system lacks FUSE, run it with --appimage-extract-and-run.",
  },
];

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

      <h3 id="quick-install">Install with one command</h3>
      <Command label="macOS and Linux">curl -fsSL https://nightcell7.com/install.sh | sh</Command>
      <Command label="Windows (PowerShell)">irm https://nightcell7.com/install.ps1 | iex</Command>
      <p>
        Both scripts detect your platform and architecture, verify the download against the
        release&rsquo;s published SHA256 checksums, and refuse to install on a mismatch. If you
        would rather not pipe a script into a shell, read them first &mdash;{" "}
        <a href="/install.sh">install.sh</a> and <a href="/install.ps1">install.ps1</a> are plain
        text, and you can run them from disk instead.
      </p>
      <Command label="Inspect before running">
        {`curl -fsSL https://nightcell7.com/install.sh -o install.sh
less install.sh
sh install.sh`}
      </Command>

      {!HAS_RELEASE ? (
        <DraftNotice>
          <strong>No desktop release is published yet.</strong> Every command on this page is the
          one that will work, and the packaging pipeline is built and tested &mdash; but the first
          tagged build has not been cut. Until an installer is signed and notarised we would rather
          ship nothing than ask you to click through a security warning. Play in the browser
          meanwhile; it is the same build.
        </DraftNotice>
      ) : null}

      <h3>Package managers</h3>
      <p>
        Pick your platform&rsquo;s manager and it handles upgrades for you. Each entry has install,
        upgrade and uninstall.
      </p>

      {MANAGERS.map((manager) => (
        <section key={manager.id} id={manager.id} className="manager">
          <h4>
            {manager.name}
            <span className="manager__platform">{manager.platform}</span>
          </h4>
          {manager.note ? <p>{manager.note}</p> : null}
          {manager.setup ? <Command label="First time only">{manager.setup}</Command> : null}
          <Command label="Install">{manager.install}</Command>
          <Command label="Upgrade">{manager.upgrade}</Command>
          <Command label="Uninstall">{manager.uninstall}</Command>
        </section>
      ))}

      <h3 id="direct">Direct downloads</h3>
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
        <p>
          Builds will appear on the{" "}
          <a href={`${REPO}/releases`} target="_blank" rel="noopener noreferrer">
            releases page
          </a>{" "}
          once the first version is tagged.
        </p>
      )}

      <h3 id="verify">Verifying a download</h3>
      <p>
        Every release publishes <code>SHA256SUMS.txt</code> next to the binaries. The install
        scripts check it automatically; to check by hand:
      </p>
      <Command label="macOS / Linux">
        {`curl -fsSLO ${REPO}/releases/latest/download/SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt --ignore-missing`}
      </Command>

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
