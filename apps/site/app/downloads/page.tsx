import type { Metadata } from "next";
import { PageShell, DraftNotice } from "../_components/page-shell";

export const metadata: Metadata = { title: "Downloads" };

export default function DownloadsPage() {
  return (
    <PageShell
      label="Platforms"
      title="Downloads"
      lede="Play instantly in a browser, or install it properly."
    >
      <h3>Play now, install nothing</h3>
      <p>
        <a className="button button--primary" href="/play">
          Launch in browser
        </a>
      </p>
      <p>
        The browser build is the same build as everything else. Nothing is held back for the desktop
        version.
      </p>

      <h3>Install as an app</h3>
      <p>
        Open <a href="/play">/play</a> and use your browser&rsquo;s install action. The installed
        PWA runs offline once you have downloaded content and gets its own window and icon.
      </p>

      <h3>Desktop builds</h3>
      <DraftNotice>
        Windows, macOS and Linux packages are not published yet. The Electron wrapper builds from
        the repository, but signed and notarised releases are gated on the release pipeline. Until
        an installer is signed we would rather ship nothing than ask you to click through a security
        warning.
      </DraftNotice>
      <p>
        When they land, one purchase covers every platform — you never re-buy an episode to move
        between them.
      </p>

      <h3>Requirements</h3>
      <p>
        See <a href="/system-requirements">system requirements</a>, and run the in-game benchmark
        before buying.
      </p>
    </PageShell>
  );
}
