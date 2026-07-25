/**
 * @nightcell7/ui
 *
 * Design tokens shared by the marketing site and the in-game menus.
 *
 * The "DIVIDED SIGNAL" identity (PRD §21) lives here as data so the site and
 * the game HUD cannot drift into two different-looking products. Components
 * themselves stay in their own apps — this package is deliberately framework-free.
 */

/** PRD §21.3. Signal red = threat/contradiction; cyan = verified/Leila's analysis. */
export const COLORS = {
  ink950: "#07090c",
  ink900: "#0d1116",
  ink800: "#171c22",
  bone100: "#ece8df",
  bone300: "#c6c1b7",
  signalRed: "#d33a3f",
  signalCyan: "#54bdca",
  dustGold: "#ad9365",
  success: "#70b48b",
  warning: "#d4a45b",
} as const;

export type ColorToken = keyof typeof COLORS;

/** Faction accents. Neither side is allowed to look richer or cleaner (PRD §14.3). */
export const FACTION_ACCENT = {
  rook: COLORS.signalRed,
  leila: COLORS.signalCyan,
} as const;

/** PRD §21.8. Motion should feel authored, never like a template. */
export const MOTION_MS = {
  micro: 150,
  component: 280,
  section: 520,
  hero: 900,
} as const;

export const EASING = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  signal: "cubic-bezier(0.7, 0, 0.2, 1)",
} as const;

/** PRD §21.5. Hard geometry — pills only for compact status tags. */
export const RADIUS = { none: "0", sharp: "2px", soft: "6px", pill: "999px" } as const;

export const LAYOUT = { maxWidth: 1440, columns: 12, gutter: 24 } as const;

export const BREAKPOINTS = { sm: 390, md: 768, lg: 1280, xl: 1440, xxl: 1920 } as const;

export const FONTS = {
  display: '"Barlow Condensed", "Archivo Narrow", system-ui, sans-serif',
  body: '"IBM Plex Sans", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
  persian: '"Vazirmatn", system-ui, sans-serif',
} as const;

/** Emit the token set as CSS custom properties for the site's global stylesheet. */
export function cssVariables(): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(COLORS)) {
    lines.push(`  --${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(MOTION_MS)) {
    lines.push(`  --motion-${kebab(name)}: ${value}ms;`);
  }
  for (const [name, value] of Object.entries(EASING)) {
    lines.push(`  --ease-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(RADIUS)) {
    lines.push(`  --radius-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(FONTS)) {
    lines.push(`  --font-${kebab(name)}: ${value};`);
  }
  return `:root {\n${lines.join("\n")}\n}`;
}

function kebab(value: string): string {
  return value.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
}

/**
 * Relative luminance contrast ratio.
 *
 * Used by the design-token test to keep body text above WCAG 2.2 AA on the
 * dark surfaces the whole site is built on (PRD §22.6).
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
