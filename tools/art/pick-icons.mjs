#!/usr/bin/env node
/**
 * Assemble the shipped icon set from the two rasterised marks.
 *
 * `fav` is run twice, once over `favicon.svg` and once over `appicon.svg`, and
 * this picks which output belongs at which size. Below 128px the detailed mark
 * turns to mud — a 0.6px waveform stroke is grey, not a waveform — so the small
 * sizes take the simplified one and the large sizes take the full mark.
 *
 * Usage: node tools/art/pick-icons.mjs <simplified-dir> <detailed-dir> <out-dir>
 */

import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [simplified, detailed, out] = process.argv.slice(2);
if (!simplified || !detailed || !out) {
  console.error("usage: pick-icons.mjs <simplified-dir> <detailed-dir> <out-dir>");
  process.exit(1);
}

/** The largest number in the filename is the pixel size. */
function sizeOf(name) {
  const numbers = name.match(/\d+/g);
  return numbers ? Number(numbers[numbers.length - 1]) : 0;
}

const CUTOVER = 128;
const picked = { detailed: [], simplified: [] };

for (const name of readdirSync(out)
  .filter((f) => f.endsWith(".png"))
  .sort()) {
  const size = sizeOf(name);
  const useDetailed = size >= CUTOVER;
  const source = join(useDetailed ? detailed : simplified, name);
  if (!existsSync(source)) continue;
  copyFileSync(source, join(out, name));
  picked[useDetailed ? "detailed" : "simplified"].push(`${name} (${size})`);
}

console.log(`detailed   >= ${CUTOVER}px: ${picked.detailed.join(", ") || "none"}`);
console.log(`simplified  < ${CUTOVER}px: ${picked.simplified.join(", ") || "none"}`);
