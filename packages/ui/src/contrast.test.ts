import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLORS, contrastRatio } from "./index";

/**
 * Accessibility guards for the design system.
 *
 * WCAG 2.2 AA is a P0 launch gate (PRD §22.6), and contrast is the one part of
 * it that can regress invisibly — a primary button shipped at 1.81:1 because a
 * `.prose a` rule outranked it, and nothing failed.
 */

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

const CSS = readFileSync(new URL("../../../apps/site/app/globals.css", import.meta.url), "utf8");

describe("token contrast", () => {
  it("body text on the page background meets AA", () => {
    expect(contrastRatio(COLORS.bone100, COLORS.ink950)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(COLORS.bone300, COLORS.ink950)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("body text on raised surfaces meets AA", () => {
    for (const surface of [COLORS.ink900, COLORS.ink800]) {
      expect(contrastRatio(COLORS.bone100, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(contrastRatio(COLORS.bone300, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it("primary button text on its own background meets AA", () => {
    // bone-100 background with ink-950 text.
    expect(contrastRatio(COLORS.ink950, COLORS.bone100)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("the accent colours are unreadable on a light button, which is why buttons must opt out", () => {
    // Documents the actual bug: cyan on the bone button is 1.81:1. The CSS test
    // below is what stops it recurring.
    expect(contrastRatio(COLORS.signalCyan, COLORS.bone100)).toBeLessThan(AA_NORMAL);
    expect(contrastRatio(COLORS.signalRed, COLORS.bone100)).toBeLessThan(AA_NORMAL);
  });

  it("accent colours are readable on the dark base, where they are actually used", () => {
    expect(contrastRatio(COLORS.signalCyan, COLORS.ink950)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(COLORS.dustGold, COLORS.ink950)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(COLORS.success, COLORS.ink950)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(COLORS.warning, COLORS.ink950)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe("site stylesheet", () => {
  it("does not let prose link colour override buttons", () => {
    // The regression guard. A bare `.prose a { color: ... }` outranks
    // `.button--primary` and repaints its text.
    const proseLinkRules = CSS.match(/^\.prose a[^{]*\{/gm) ?? [];
    expect(proseLinkRules.length).toBeGreaterThan(0);

    for (const rule of proseLinkRules) {
      // Every `.prose a` colour rule must exclude buttons.
      if (/^\.prose a\.button/.test(rule)) continue;
      expect(rule, `unscoped prose link rule: ${rule}`).toMatch(/:not\(\.button\)/);
    }
  });
});
