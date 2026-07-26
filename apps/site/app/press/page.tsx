import type { Metadata } from "next";
import { PageShell, DraftNotice } from "../_components/page-shell";
import { CaptureStrip, CaptureNotice } from "../gallery";

export const metadata: Metadata = { title: "Press" };

export default function PressPage() {
  return (
    <PageShell label="Press" title="Press kit" lede="Facts, images and a contact address.">
      <h3>Fact sheet</h3>
      <table className="table">
        <tbody>
          <tr>
            <td>Title</td>
            <td>NIGHTCELL 7: FALSE DAWN</td>
          </tr>
          <tr>
            <td>Genre</td>
            <td>First-person tactical action shooter</td>
          </tr>
          <tr>
            <td>Structure</td>
            <td>Episodic, two opposing playable campaigns per episode</td>
          </tr>
          <tr>
            <td>Price</td>
            <td>$9.99 per episode; free demo and free multiplayer alpha</td>
          </tr>
          <tr>
            <td>Platforms</td>
            <td>Browser, PWA, Windows, macOS, Linux</td>
          </tr>
          <tr>
            <td>Engine</td>
            <td>Babylon.js and TypeScript</td>
          </tr>
          <tr>
            <td>Multiplayer</td>
            <td>Server-authoritative 6v6 Team Deathmatch</td>
          </tr>
          <tr>
            <td>Status</td>
            <td>Early development; campaigns not yet playable</td>
          </tr>
          <tr>
            <td>Source</td>
            <td>
              <a
                href="https://github.com/profullstack/nightcell7"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/profullstack/nightcell7
              </a>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Description</h3>
      <p>
        A premium episodic shooter that launches from a browser. Every theater contains two opposing
        playable campaigns that overlap in time and reinterpret each other — an American deep-cover
        operative and an Iranian counterintelligence officer, each hunting the other on evidence
        that has been manufactured. Neither country is written as the villain.
      </p>

      <h3>Images</h3>
      <CaptureStrip names={["west-catwalk", "tank-row", "gantry-overlook"]} />
      <CaptureNotice />

      <DraftNotice>
        There is no key art, character art or trailer yet, so there is no full press pack to
        download. We would rather say that than hand out screenshots of untextured boxes labelled as
        finished work.
      </DraftNotice>

      <h3>Contact</h3>
      <p>
        <a href="mailto:press@nightcell7.com">press@nightcell7.com</a>
      </p>

      <h3>Fiction notice</h3>
      <p>
        NIGHTCELL 7 is fictional. Its organisations, facilities, operations and characters are
        invented, and it does not depict any real government, military operation or current event.
        We ask that coverage reflects that.
      </p>
    </PageShell>
  );
}
