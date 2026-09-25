import type { Metadata } from "next";
import { PageShell, DraftNotice } from "../_components/page-shell";

export const metadata: Metadata = { title: "Licenses" };

const STACK = [
  ["Babylon.js", "Apache-2.0", "Rendering, scene graph and client physics"],
  ["Colyseus", "MIT", "Authoritative multiplayer rooms and state sync"],
  ["Next.js", "MIT", "This website"],
  ["React", "MIT", "Site and in-game menus"],
  ["Hono", "MIT", "HTTP API"],
  ["Drizzle ORM", "Apache-2.0", "Database schema and queries"],
  ["node-postgres (pg)", "MIT", "Durable data"],
  ["BullMQ", "MIT", "Background jobs"],
  ["ioredis", "MIT", "Redis client"],
  ["Zod", "MIT", "Runtime validation"],
  ["Vite", "MIT", "Game build"],
  ["Electron", "MIT", "Desktop wrapper"],
];

export default function LicensesPage() {
  return (
    <PageShell
      label="Legal"
      title="Licenses and attribution"
      lede="Everything the game and this site are built on."
    >
      <h3>Open-source dependencies</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Project</th>
            <th>License</th>
            <th>Used for</th>
          </tr>
        </thead>
        <tbody>
          {STACK.map(([name, license, use]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{license}</td>
              <td>{use}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        The full dependency tree with exact versions is in the{" "}
        <a
          href="https://github.com/profullstack/nightcell7"
          target="_blank"
          rel="noopener noreferrer"
        >
          public repository
        </a>
        .
      </p>

      <h3>Game assets</h3>
      <p>
        The yard, trailer and gameplay images are captures of the game&rsquo;s own original models.
        The cast portraits are 3D characters built in Blender with MakeHuman&rsquo;s system assets
        (CC0) and refined with an image model. The squad radio uses AI-generated voices. Every asset
        has a provenance record in the public repository.
      </p>
      <DraftNotice>
        A full register of third-party art, audio and voice licences will be published here as that
        work is commissioned.
      </DraftNotice>

      <h3>Fonts</h3>
      <p>
        The site currently uses system font stacks. Licensed display and Persian typefaces are
        pending selection and will be listed here once self-hosted.
      </p>
    </PageShell>
  );
}
