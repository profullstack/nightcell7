import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { CapturePlate } from "../gallery";

export const metadata: Metadata = { title: "Credits" };

export default function CreditsPage() {
  return (
    <PageShell
      label="Credits"
      title="Who and what built this"
      lede="Kept current rather than saved for launch."
    >
      <h3>Development</h3>
      <p>Profullstack, Inc.</p>

      <h3>Built with</h3>
      <p>
        Babylon.js for rendering, Colyseus for authoritative multiplayer, Next.js for this site,
        Hono for the API, Drizzle and Postgres for data, BullMQ for background work. Full list on
        the <a href="/licenses">licenses page</a>.
      </p>

      <h3>Artwork</h3>
      <p>
        The yard, trailer and gameplay images are in-engine captures of our own geometry, produced
        by a reproducible tool in the repository. The cast portraits are 3D characters built in
        Blender with <a href="http://www.makehumancommunity.org/">MakeHuman</a>&rsquo;s CC0 assets
        and MPFB, then refined with an image model; how each was made is recorded in the repository.
      </p>

      <h3>Voices</h3>
      <p>
        The squad radio in the yard uses AI-generated voices (OpenAI text-to-speech), directed and
        radio-processed for this game. No real person&rsquo;s voice is cloned or imitated.
      </p>

      <h3>Still to come</h3>
      <p>
        Cultural consultation and native Farsi review are required before any Iranian or
        Farsi-language content ships, and are not complete. Voice, music and art credits will be
        listed here as that work is commissioned — with named people, not vague thanks.
      </p>

      <h3>Source</h3>
      <p>
        <a
          href="https://github.com/profullstack/nightcell7"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/profullstack/nightcell7
        </a>
      </p>

      <CapturePlate name="pipe-rack-run" label="In engine" />
    </PageShell>
  );
}
