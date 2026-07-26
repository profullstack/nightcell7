import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the HUD's one silent coupling: `#ui` sets `pointer-events: none`.
 *
 * That rule exists so the overlay never eats a click meant for the canvas, and
 * it is re-enabled for exactly three selectors — `button`, `a` and
 * `[data-interactive]`. Anything interactive built from another element is
 * inert unless it opts in, and *nothing fails* when it does not: the control
 * renders correctly, highlights nothing and swallows every click. The game-mode
 * picker shipped to production in exactly that state, where it read as two
 * disabled options.
 *
 * These read source text rather than a rendered DOM because the suite runs on
 * `environment: "node"`. That is a weaker test than clicking the control, and
 * it is the one that would actually have caught this.
 */

const SRC = __dirname;
const hud = readFileSync(join(SRC, "hud.ts"), "utf8");
const css = readFileSync(join(SRC, "style.css"), "utf8");

describe("HUD interactivity", () => {
  it("keeps the global pointer-events escape hatch it depends on", () => {
    // If this selector list ever changes, every control below has to be
    // re-checked — which is the point of asserting on it here.
    expect(css).toMatch(/#ui button,\s*#ui a,\s*#ui \[data-interactive\]/);
    expect(css).toMatch(/pointer-events: auto/);
  });

  it("marks the mode picker's labels interactive", () => {
    // A <label> is neither a button nor an anchor, so it must opt in.
    expect(hud).toMatch(/label\.dataset\.interactive/);
  });

  it("builds the picker from labels wrapping real radios", () => {
    // Not divs with click handlers: the native control is what gives arrow-key
    // navigation and a screen-reader announcement (accessibility is P0).
    expect(hud).toMatch(/input\.type = "radio"/);
    expect(hud).toMatch(/modes__option/);
  });

  it("re-enables pointer events on the mode option in CSS as well", () => {
    const rule = css.slice(css.indexOf(".modes__option {"));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/pointer-events: auto/);
  });
});
