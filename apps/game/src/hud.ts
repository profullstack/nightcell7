import type { ControllerStatus } from "./player";

/**
 * HUD and start gate.
 *
 * Written against the DOM directly rather than through Preact on purpose:
 * CLAUDE.md requires that the component layer never owns per-frame state. The
 * readouts below change every frame, so they are text-node writes behind a
 * change check, not a render pass.
 */

export interface HudOptions {
  readonly renderer: string;
  readonly mapName: string;
  readonly mapChecksum: string;
  onStart: () => void;
}

export interface Hud {
  /** Cheap enough to call every frame; writes only what actually changed. */
  update(status: ControllerStatus, fps: number): void;
  setLocked(locked: boolean): void;
  dispose(): void;
}

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["W A S D", "Move"],
  ["Shift", "Sprint"],
  ["Ctrl / C", "Crouch"],
  ["Space", "Jump"],
  ["Mouse", "Look"],
  ["Esc", "Release cursor"],
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createHud(root: HTMLElement, options: HudOptions): Hud {
  root.replaceChildren();

  // ------------------------------------------------------------ atmosphere
  const vignette = el("div", "vignette");
  const grain = el("div", "grain");
  document.body.append(vignette, grain);

  // ------------------------------------------------------------------ HUD
  const hud = el("div", "hud");
  hud.append(el("div", "hud__frame"));

  const reticle = el("div", "reticle");
  for (let i = 0; i < 5; i += 1) reticle.append(el("span"));
  hud.append(reticle);

  // Top-left: operation identity.
  const tl = el("div", "hud__block hud__block--tl");
  tl.append(el("p", "hud__label", "Operation"));
  tl.append(el("p", "hud__value", "FALSE DAWN"));
  tl.append(el("p", "hud__sub", options.mapName.toUpperCase()));
  hud.append(tl);

  // Top-right: build / integrity, mirroring the join-handshake checksum.
  const tr = el("div", "hud__block hud__block--tr");
  tr.append(el("p", "hud__label", "Map integrity"));
  tr.append(el("p", "hud__value hud__value--cyan", options.mapChecksum.toUpperCase()));
  tr.append(el("p", "hud__sub", `${options.renderer.toUpperCase()} · GREYBOX`));
  hud.append(tr);

  // Bottom-left: movement telemetry.
  const bl = el("div", "hud__block hud__block--bl");
  bl.append(el("p", "hud__label", "Velocity"));
  const speedValue = el("p", "hud__value", "0.0");
  bl.append(speedValue);
  const stanceValue = el("p", "hud__sub", "STANDING");
  bl.append(stanceValue);
  hud.append(bl);

  // Bottom-right: position + frame budget.
  const br = el("div", "hud__block hud__block--br");
  br.append(el("p", "hud__label", "Grid reference"));
  const posValue = el("p", "hud__value", "0 / 0");
  br.append(posValue);
  const fpsValue = el("p", "hud__sub", "-- FPS");
  br.append(fpsValue);
  hud.append(br);

  root.append(hud);

  // ------------------------------------------------------------ start gate
  const gate = el("div", "gate");

  const mark = el("h1", "gate__mark");
  mark.append(document.createTextNode("NIGHTCELL "));
  const seven = el("i", undefined, "7");
  mark.append(seven);
  gate.append(mark);

  gate.append(el("p", "gate__sub", "False Dawn — Ardavan Yard"));
  gate.append(
    el(
      "p",
      "gate__hint",
      "Greybox build. Movement runs the same authoritative simulation as multiplayer, so what you feel here is what the server enforces.",
    ),
  );

  const button = el("button", "gate__button", "Enter the yard");
  button.type = "button";
  button.addEventListener("click", () => options.onStart());
  gate.append(button);

  const keys = el("ul", "keys");
  for (const [combo, meaning] of KEYS) {
    const li = el("li");
    li.append(el("kbd", undefined, combo));
    li.append(document.createTextNode(meaning));
    keys.append(li);
  }
  gate.append(keys);

  root.append(gate);

  // ---------------------------------------------------------------- state

  // Previous values, so a frame that changed nothing costs no DOM writes.
  let lastSpeed = "";
  let lastStance = "";
  let lastPos = "";
  let lastFps = "";
  let fpsAccumulator = 0;
  let fpsFrames = 0;

  return {
    update(status: ControllerStatus, fps: number): void {
      const speed = status.speed.toFixed(1);
      if (speed !== lastSpeed) {
        speedValue.textContent = speed;
        lastSpeed = speed;
      }

      const stance = status.crouching
        ? "CROUCHED"
        : status.sprinting && status.speed > 0.2
          ? "SPRINTING"
          : status.grounded
            ? "STANDING"
            : "AIRBORNE";
      if (stance !== lastStance) {
        stanceValue.textContent = stance;
        lastStance = stance;
      }

      const pos = `${status.position.x.toFixed(0)} / ${status.position.z.toFixed(0)}`;
      if (pos !== lastPos) {
        posValue.textContent = pos;
        lastPos = pos;
      }

      // Average the frame rate over ~0.5 s; a per-frame number is unreadable.
      fpsAccumulator += fps;
      fpsFrames += 1;
      if (fpsFrames >= 30) {
        const text = `${Math.round(fpsAccumulator / fpsFrames)} FPS`;
        if (text !== lastFps) {
          fpsValue.textContent = text;
          lastFps = text;
        }
        fpsAccumulator = 0;
        fpsFrames = 0;
      }
    },

    setLocked(locked: boolean): void {
      hud.dataset.active = String(locked);
      gate.hidden = locked;
    },

    dispose(): void {
      vignette.remove();
      grain.remove();
      root.replaceChildren();
    },
  };
}

/** Replaces the whole UI layer with a terminal failure state. */
export function renderFault(root: HTMLElement, message: string): void {
  root.replaceChildren();
  const fault = el("div", "fault");
  fault.append(el("h1", undefined, "Signal lost"));
  fault.append(el("p", undefined, message));

  const link = el("a", undefined, "System requirements");
  link.href = "/system-requirements";
  link.setAttribute("data-interactive", "true");
  fault.append(link);

  root.append(fault);
}
