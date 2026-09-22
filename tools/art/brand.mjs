#!/usr/bin/env node
/**
 * The NIGHTCELL 7 brand marks: `favicon.svg` and `logo.svg`.
 *
 * Both are emitted rather than hand-edited, because the wordmark is geometry
 * and geometry drifts when it is nudged by hand. Re-run this and the two files
 * are byte-identical unless the constants below changed.
 *
 * **The wordmark carries no font.** The site sets Barlow Condensed, but an SVG
 * used as an `<img>`, rasterised by `fav`, or packed into an Electron bundle
 * gets no webfont and no guarantee of a system one, so `<text>` would render as
 * whatever the machine happened to have. Every letter here is a path on a fixed
 * grid: condensed, hard-edged and stencil-cut, which is the type the rest of
 * the site already uses.
 *
 * Usage:
 *   node tools/art/brand.mjs            # write the SVGs
 *   node tools/art/brand.mjs --check    # fail if they are out of date
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The palette, matching `globals.css`. */
const INK = "#07090c";
const BONE = "#ece8df";
const GOLD = "#ad9365";
const RED = "#d33a3f";
const CYAN = "#54bdca";

// ---------------------------------------------------------------- letterforms

/**
 * Condensed stencil caps on a 20-unit cap height.
 *
 * Each glyph is a list of rectangles and polygons in its own box, so the whole
 * wordmark is one flat path list with no font, no kerning table and no curves.
 */
const H = 20; // cap height
const S = 3.2; // stroke

/** A rectangle as a path, so everything is one `d` string per glyph. */
const r = (x, y, w, h) => `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
const poly = (...pts) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z`;
const f = (n) => Number(n.toFixed(2)).toString();

const GLYPHS = {
  N: {
    width: 11,
    paths: () => [
      r(0, 0, S, H),
      r(11 - S, 0, S, H),
      poly([S, 0], [S + 2.6, 0], [11 - S, H], [11 - S - 2.6, H]),
    ],
  },
  I: { width: 4.4, paths: () => [r((4.4 - S) / 2, 0, S, H)] },
  G: {
    width: 11,
    paths: () => [
      r(0, 0, S, H),
      r(0, 0, 11, S),
      r(0, H - S, 11, S),
      r(11 - S, H / 2, S, H / 2),
      r(11 / 2, H / 2 - S / 2, 11 / 2, S),
    ],
  },
  H: { width: 11, paths: () => [r(0, 0, S, H), r(11 - S, 0, S, H), r(0, H / 2 - S / 2, 11, S)] },
  T: { width: 10.4, paths: () => [r(0, 0, 10.4, S), r((10.4 - S) / 2, 0, S, H)] },
  C: { width: 11, paths: () => [r(0, 0, S, H), r(0, 0, 11, S), r(0, H - S, 11, S)] },
  E: {
    width: 9.6,
    paths: () => [r(0, 0, S, H), r(0, 0, 9.6, S), r(0, H / 2 - S / 2, 8.4, S), r(0, H - S, 9.6, S)],
  },
  L: { width: 9.2, paths: () => [r(0, 0, S, H), r(0, H - S, 9.2, S)] },
  7: {
    width: 10.4,
    paths: () => [r(0, 0, 10.4, S), poly([10.4, S], [10.4 - 2.9, S], [2.6, H], [2.6 + 2.9, H])],
  },
};

const TRACKING = 2.9;

/** Lay a string out left to right; returns the paths and the advance. */
function setText(text, x0, y0) {
  let x = x0;
  const out = [];
  for (const ch of text) {
    if (ch === " ") {
      x += 6.4;
      continue;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`no glyph for ${JSON.stringify(ch)}`);
    for (const d of glyph.paths()) {
      out.push(translate(d, x, y0));
    }
    x += glyph.width + TRACKING;
  }
  return { paths: out, width: x - x0 - TRACKING };
}

/** Shift a path built at the origin. Only M/h/v/L are emitted above. */
function translate(d, dx, dy) {
  return d
    .replace(/M(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `M${f(Number(x) + dx)} ${f(Number(y) + dy)}`)
    .replace(/L(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `L${f(Number(x) + dx)} ${f(Number(y) + dy)}`);
}

// -------------------------------------------------------------------- the mark

/**
 * The cell, at whatever size is asked for.
 *
 * The same idea as the existing `icon.svg`: one cell split down the meridian,
 * Rook's red on the west and Leila's cyan on the east. `detail` drops the parts
 * that turn to mud below about 32px — at 16px a 0.6px waveform stroke is not a
 * waveform, it is grey.
 */
function mark({ size = 64, detail = true } = {}) {
  const u = size / 64;
  const s = (n) => f(n * u);
  const parts = [
    `<rect width="${s(64)}" height="${s(64)}" rx="${s(6)}" fill="${INK}"/>`,
    `<path d="M${s(14)} ${s(22)}h${s(16)}v${s(20)}h${s(-16)}Z" fill="${RED}"/>`,
    `<path d="M${s(34)} ${s(22)}h${s(16)}v${s(20)}h${s(-16)}Z" fill="${CYAN}"/>`,
    `<rect x="${s(31)}" y="${s(14)}" width="${s(2)}" height="${s(36)}" fill="${BONE}"/>`,
  ];
  if (detail) {
    parts.push(
      `<path d="M${s(8)} ${s(6)}h${s(10)}v${s(2)}h${s(-8)}v${s(8)}h${s(-2)}Z" fill="${GOLD}"/>`,
      `<path d="M${s(56)} ${s(6)}h${s(-10)}v${s(2)}h${s(8)}v${s(8)}h${s(2)}Z" fill="${GOLD}"/>`,
      `<path d="M${s(8)} ${s(58)}h${s(10)}v${s(-2)}h${s(-8)}v${s(-8)}h${s(-2)}Z" fill="${GOLD}"/>`,
      `<path d="M${s(56)} ${s(58)}h${s(-10)}v${s(-2)}h${s(8)}v${s(-8)}h${s(2)}Z" fill="${GOLD}"/>`,
      `<path d="M${s(14)} ${s(32)}h${s(6)}l${s(3)} ${s(-7)}l${s(4)} ${s(14)}l${s(3)} ${s(-7)}h${s(4)}" fill="none" stroke="${INK}" stroke-width="${s(2.4)}" stroke-linecap="square"/>`,
      `<path d="M${s(36)} ${s(32)}h${s(3)}l${s(2)} ${s(-4)}l${s(3)} ${s(8)}l${s(2)} ${s(-4)}h${s(4)}" fill="none" stroke="${INK}" stroke-width="${s(2.4)}" stroke-linecap="square" stroke-dasharray="${s(5)} ${s(3)}"/>`,
    );
  }
  return parts.join("\n  ");
}

// ------------------------------------------------------------------- documents

function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="NIGHTCELL 7">
  <title>NIGHTCELL 7</title>
  <!--
    Generated by tools/art/brand.mjs. Do not edit by hand.

    The divided signal at favicon scale: one cell split down the meridian, red
    west and cyan east. The corner brackets and the fractured transmission that
    the full mark carries are dropped here, because at 16px a 0.6px stroke is
    not a waveform, it is grey. What survives is the split and the meridian,
    which is the whole idea.
  -->
  ${mark({ size: 64, detail: false })}
</svg>
`;
}

/**
 * The square app icon: the full mark, rounded, for a desktop dock or taskbar.
 *
 * Not the favicon. This one is shown at 256px and up, where the corner
 * brackets and the fractured transmission are the point rather than mud, so
 * it keeps the detail the favicon drops.
 */
function appicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="NIGHTCELL 7">
  <title>NIGHTCELL 7</title>
  <!-- Generated by tools/art/brand.mjs. Do not edit by hand. -->
  ${mark({ size: 64, detail: true })}
</svg>
`;
}

function logo() {
  const markSize = 64;
  const gap = 18;
  const baseline = 22;
  const word = setText("NIGHTCELL", markSize + gap, baseline);
  const seven = setText("7", markSize + gap + word.width + TRACKING + 4, baseline);
  const width =
    Math.ceil(
      seven.paths.length ? markSize + gap + word.width + TRACKING + 4 + GLYPHS[7].width : 0,
    ) + 6;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 64" role="img" aria-label="NIGHTCELL 7">
  <title>NIGHTCELL 7</title>
  <!--
    Generated by tools/art/brand.mjs. Do not edit by hand.

    The horizontal lockup: the cell, then the wordmark. Every letter is a path
    on a fixed grid rather than <text>, because this file is used as an <img>,
    rasterised by "fav" and packed into the desktop bundle, and none of those
    give it a webfont. A wordmark that renders in whatever font the machine
    happens to have is not a wordmark.
  -->
  ${mark({ size: markSize, detail: true })}
  <g fill="${BONE}">
    ${word.paths.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>
  <g fill="${RED}">
    ${seven.paths.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>
</svg>
`;
}

// ------------------------------------------------------------------------ main

const TARGETS = [
  ["apps/site/public/favicon.svg", favicon()],
  ["apps/site/public/logo.svg", logo()],
  ["apps/game/public/favicon.svg", favicon()],
  ["apps/desktop/resources/appicon.svg", appicon()],
];

const check = process.argv.includes("--check");
let stale = 0;
for (const [rel, content] of TARGETS) {
  const path = join(ROOT, rel);
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    if (current !== content) {
      console.error(`STALE ${rel} — run: node tools/art/brand.mjs`);
      stale += 1;
    }
    continue;
  }
  writeFileSync(path, content);
  console.log(`wrote ${rel} (${content.length} bytes)`);
}
if (check && stale) process.exit(1);
if (check) console.log("brand marks are up to date");
