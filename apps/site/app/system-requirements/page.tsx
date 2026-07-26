import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";

export const metadata: Metadata = { title: "System Requirements" };

export default function RequirementsPage() {
  return (
    <PageShell
      label="Technical"
      title="System requirements"
      lede="Run the free benchmark before buying anything — it is the honest answer for your machine."
    >
      <h3>Recommended</h3>
      <ul>
        <li>1080p at medium settings, stable 60 FPS</li>
        <li>Apple M1 class, or GeForce GTX 1660 / Radeon RX 580 class</li>
        <li>16 GB system memory</li>
        <li>A browser with WebGPU, or WebGL2</li>
      </ul>

      <h3>Minimum</h3>
      <ul>
        <li>720p at low settings with dynamic resolution, stable 30 FPS</li>
        <li>A modern integrated GPU with WebGL2</li>
        <li>8 GB system memory</li>
      </ul>
      <p>
        WebGL2 is a supported target, not a degraded one: a WebGL2 machine can complete both
        campaigns and play multiplayer.
      </p>

      <h3>Download sizes</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Budget</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Game shell</td>
            <td>≤ 15 MB</td>
          </tr>
          <tr>
            <td>Menu, benchmark, common assets</td>
            <td>≤ 40 MB</td>
          </tr>
          <tr>
            <td>Each free demo route</td>
            <td>≤ 150 MB</td>
          </tr>
          <tr>
            <td>A paid episode</td>
            <td>≤ 1.2 GB</td>
          </tr>
          <tr>
            <td>Multiplayer map pack</td>
            <td>≤ 250 MB</td>
          </tr>
        </tbody>
      </table>

      <h3>Platforms</h3>
      <ul>
        <li>Browser on Windows, macOS and Linux</li>
        <li>Installable PWA</li>
        <li>Desktop builds for Windows x64, macOS Apple silicon and Linux x64</li>
      </ul>
      <p>Mobile play is not a target. The site works on a phone; the game does not.</p>

      <h3>Input</h3>
      <p>
        Keyboard and mouse or a gamepad, with full rebinding. Controller aim assist is available;
        there is no mouse aim assist.
      </p>
    </PageShell>
  );
}
