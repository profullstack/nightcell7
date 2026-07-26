#!/usr/bin/env node
/**
 * Rasterises the NIGHTCELL 7 mark into the PNG sizes the PWA manifest declares.
 *
 * The manifest in apps/game/vite.config.ts points at icon-192.png and
 * icon-512.png. Those files have to exist or an install shows a broken icon,
 * and a missing manifest icon is the kind of defect that never surfaces in
 * development because the SPA fallback answers 200 for anything.
 *
 * Usage: node tools/art/icons.mjs
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SOURCE = join(ROOT, "apps/game/public/icon.svg");
const TARGETS = [
  { file: "apps/game/public/icon-192.png", size: 192 },
  { file: "apps/game/public/icon-512.png", size: 512 },
  // The marketing site reuses the same mark for its favicon and OG card.
  { file: "apps/site/public/icon-512.png", size: 512 },
];

function chromePath() {
  for (const candidate of [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ]) {
    try {
      execSync(`test -x ${candidate}`);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

const svg = await readFile(SOURCE, "utf8");
const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: chromePath() });

for (const { file, size } of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><style>
       html,body{margin:0;padding:0;background:#07090c}
       svg{display:block;width:${size}px;height:${size}px}
     </style>${svg}`,
    { waitUntil: "load" },
  );
  const out = join(ROOT, file);
  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, type: "png", omitBackground: false });
  await page.close();
  console.log(`wrote ${file} (${size}x${size})`);
}

await browser.close();

await writeFile(
  join(ROOT, "apps/game/public/PROVENANCE.md"),
  `# Icon provenance

- \`icon.svg\` — original vector mark for NIGHTCELL 7, hand-authored in this
  repository. No third-party source, no traced reference, no generated raster.
- \`icon-192.png\`, \`icon-512.png\` — rasterised from \`icon.svg\` by
  \`tools/art/icons.mjs\`. Regenerate with \`node tools/art/icons.mjs\`; never
  hand-edit the PNGs.

Licence: original work, © NIGHTCELL 7. Safe to ship publicly.
`,
  "utf8",
);
console.log("wrote apps/game/public/PROVENANCE.md");
