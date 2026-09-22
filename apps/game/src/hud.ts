import type { ControllerStatus } from "./player";
import type { LocalStatus } from "./opponents";
import { DEFAULT_GAME_MODE, GAME_MODES, modeInfo, type GameMode } from "./modes";
import {
  DEFAULT_SANDBOX_DIFFICULTY,
  SANDBOX_DIFFICULTIES,
  difficultyInfo,
  type SandboxDifficultyId,
} from "./difficulty";
import {
  ARMOR_CLASSES,
  ARMORY,
  COLORS,
  CREDITS_PER_KILL,
  CREDITS_PER_PACK,
  DEFAULT_LOADOUT,
  GENDERS,
  SIDES,
  affordable,
  armorClassInfo,
  type ArmoryItemId,
  type Loadout,
} from "./loadout";

/**
 * HUD and start gate.
 *
 * Written against the DOM directly rather than through Preact on purpose:
 * CLAUDE.md requires that the component layer never owns per-frame state. The
 * readouts below change every frame, so they are text-node writes behind a
 * change check, not a render pass.
 */

export interface HudOptions {
  /** Preselected mode, and the sink for whichever the player picks. */
  mode?: GameMode;
  onModeChange?: (mode: GameMode) => void;
  /** Preselected difficulty, and the sink for whichever the player picks. */
  difficulty?: SandboxDifficultyId;
  onDifficultyChange?: (difficulty: SandboxDifficultyId) => void;
  /** The operator: side, gender, armour, colour. Every change is reported whole. */
  loadout?: Loadout;
  onLoadoutChange?: (loadout: Loadout) => void;
  /** Credits on hand, and the purchase sink. Returns whether the sale went through. */
  credits?: number;
  onBuy?: (item: ArmoryItemId) => boolean;
  readonly renderer: string;
  readonly mapName: string;
  readonly mapChecksum: string;
  onStart: () => void;
}

export interface Hud {
  /** Cheap enough to call every frame; writes only what actually changed. */
  update(status: ControllerStatus, fps: number, local: LocalStatus): void;
  /**
   * Incoming damage. Blood at the screen edge sized to the hit, an arc
   * toward where it came from (`bearing` in degrees clockwise from straight
   * ahead, null when unknown), and the health readout glowing red.
   */
  showHit(amount: number, bearing: number | null): void;
  /** A one-line notice above the status bar — a pickup, mostly. Fades on its own. */
  notify(text: string): void;
  setLocked(locked: boolean): void;
  /** Credits on hand; re-enables and disables the armory's buttons. */
  setCredits(credits: number): void;
  dispose(): void;
}

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["W A S D", "Move"],
  ["Shift", "Sprint"],
  ["Ctrl / C", "Crouch"],
  ["Space", "Jump"],
  ["Mouse", "Look"],
  ["← →", "Turn (keyboard)"],
  ["R", "Reload"],
  ["1 2 3 · Wheel", "Weapon"],
  ["G", "Throw frag"],
  ["Esc", "Release cursor"],
];

/** Health at or below this fraction of stamina reads as critical: the readout pulses. */
const CRITICAL_FRACTION = 0.3;

/** How long a notice stays before fading, and how long the fade takes. */
const NOTICE_HOLD_MS = 2200;
const NOTICE_FADE_MS = 500;

/** How long the health readout glows and the alert shows after a hit. */
const HIT_GLOW_MS = 1400;
/** Lifetimes of the blood and the direction arc; matched by the CSS animations. */
const SPATTER_MS = 1900;
const HITDIR_MS = 1300;
/** Most spatter marks on screen at once, so a burst does not paint it over. */
const MAX_SPATTER = 10;

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
  // Damage feedback sits above the grain and below the HUD text.
  const hurt = el("div", "hurt");
  document.body.append(vignette, grain, hurt);

  // ------------------------------------------------------------------ HUD
  const hud = el("div", "hud");
  hud.append(el("div", "hud__frame"));

  const reticle = el("div", "reticle");
  for (let i = 0; i < 5; i += 1) reticle.append(el("span"));
  hud.append(reticle);

  // Top-left: operation identity.
  const tl = el("div", "hud__block hud__block--tl");
  tl.append(el("p", "hud__label", "NIGHTCELL 7"));
  tl.append(el("p", "hud__value", "IRON RAIN"));
  tl.append(el("p", "hud__sub", options.mapName.toUpperCase()));
  hud.append(tl);

  // Top-right: build / integrity, mirroring the join-handshake checksum.
  const tr = el("div", "hud__block hud__block--tr");
  tr.append(el("p", "hud__label", "Deployment"));
  tr.append(el("p", "hud__value hud__value--cyan", "ARDAVAN"));
  tr.append(el("p", "hud__sub", "TACTICAL OPERATIONS"));
  hud.append(tr);

  // Bottom-left: movement telemetry.
  const bl = el("div", "hud__block hud__block--bl");
  bl.append(el("p", "hud__label", "Velocity"));
  const speedValue = el("p", "hud__value", "0.0");
  bl.append(speedValue);
  const stanceValue = el("p", "hud__sub", "STANDING");
  bl.append(stanceValue);
  hud.append(bl);

  // Bottom-centre: the status bar. Health, the weapon in hand with its
  // magazine and reserve, and the frag count — the three numbers a player
  // checks between fights, in one glance, in one place.
  const bc = el("div", "hud__block hud__block--bc status");

  const vitals = el("div", "status__group status__group--vitals");
  vitals.append(el("p", "hud__label", "Health"));
  const healthValue = el("p", "hud__value status__health", "100");
  vitals.append(healthValue);
  const healthBar = el("div", "status__bar");
  const healthFill = el("i", "status__fill");
  healthBar.append(healthFill);
  vitals.append(healthBar);
  // Stamina is the bar's full width; the number is what is left of it.
  const armorValue = el("p", "hud__sub status__armor", "STAMINA 100 · ARMOR 50");
  vitals.append(armorValue);
  // Shown for a moment after every hit, so the number is not the only tell.
  const alert = el("p", "status__alert", "TAKING FIRE");
  alert.hidden = true;
  vitals.append(alert);
  bc.append(vitals);

  const weapon = el("div", "status__group status__group--weapon");
  const weaponName = el("p", "hud__label status__weapon", "—");
  weapon.append(weaponName);
  const ammoValue = el("p", "hud__value status__ammo");
  const magazineValue = el("b", undefined, "0");
  const reserveValue = el("span", undefined, "/ 0");
  ammoValue.append(magazineValue, reserveValue);
  weapon.append(ammoValue);
  const weaponState = el("p", "hud__sub status__state", "");
  weapon.append(weaponState);
  const slots = el("ul", "slots");
  weapon.append(slots);
  bc.append(weapon);

  const frag = el("div", "status__group status__group--frag");
  frag.append(el("p", "hud__label", "Frag"));
  const grenadeValue = el("p", "hud__value", "0");
  frag.append(grenadeValue);
  frag.append(el("p", "hud__sub", "G TO THROW"));
  bc.append(frag);

  hud.append(bc);

  // Notices stack just above the status bar.
  const notices = el("div", "notices");
  hud.append(notices);

  // Blood and hit-direction arcs are created per hit and remove themselves.
  const spatter = el("div", "spatter");
  hud.append(spatter);
  const hitdirs = el("div", "hitdirs");
  hud.append(hitdirs);

  // Down. Shown over the yard until the simulation redeploys the player.
  const kia = el("div", "kia");
  kia.hidden = true;
  kia.append(el("p", "kia__mark", "KIA"));
  const kiaSub = el("p", "kia__sub", "REDEPLOY IN 6");
  kia.append(kiaSub);
  hud.append(kia);

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

  gate.append(el("p", "gate__sub", "IRON RAIN / ARDAVAN INDUSTRIAL DISTRICT"));
  gate.append(
    el(
      "p",
      "gate__hint",
      "Secure the industrial district. Move between cover, watch the elevated lanes, and keep your squad in the fight.",
    ),
  );

  // Mode picker.
  //
  // Radios rather than buttons, because this is a choice that persists into the
  // match rather than an action — and a radio group gives arrow-key navigation
  // and a screen-reader announcement for free, which a row of divs would not
  // (reduced motion and accessibility are P0).
  let selected: GameMode = options.mode ?? DEFAULT_GAME_MODE;
  const modes = el("fieldset", "modes");
  const legend = el("legend", "modes__legend", "Game mode");
  modes.append(legend);

  const blurb = el("p", "modes__blurb", modeInfo(selected).blurb);

  for (const mode of GAME_MODES) {
    const label = el("label", "modes__option");
    // `#ui` sets `pointer-events: none` so the HUD never eats a click meant for
    // the canvas, and re-enables it only for `button`, `a` and
    // `[data-interactive]`. A label is none of those, so without this the whole
    // picker is inert — it renders, highlights nothing and swallows every
    // click, which reads exactly like two disabled options. It shipped that
    // way; see the guard in hud.test.ts.
    label.dataset.interactive = "";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "nc7-mode";
    input.value = mode.id;
    input.checked = mode.id === selected;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      selected = mode.id;
      blurb.textContent = mode.blurb;
      options.onModeChange?.(mode.id);
    });
    label.append(input);
    label.append(el("span", "modes__name", mode.name));
    modes.append(label);
  }

  modes.append(blurb);
  gate.append(modes);

  // Difficulty picker. Same construction as the mode picker, for the same
  // reasons; a separate group so the two choices read as two questions.
  let tier: SandboxDifficultyId = options.difficulty ?? DEFAULT_SANDBOX_DIFFICULTY;
  const tiers = el("fieldset", "modes modes--difficulty");
  tiers.append(el("legend", "modes__legend", "Difficulty"));
  const tierBlurb = el("p", "modes__blurb", difficultyInfo(tier).blurb);
  for (const entry of SANDBOX_DIFFICULTIES) {
    const label = el("label", "modes__option");
    label.dataset.interactive = "";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "nc7-difficulty";
    input.value = entry.id;
    input.checked = entry.id === tier;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      tier = entry.id;
      tierBlurb.textContent = entry.blurb;
      options.onDifficultyChange?.(entry.id);
    });
    label.append(input);
    label.append(el("span", "modes__name", entry.name));
    tiers.append(label);
  }
  tiers.append(tierBlurb);
  gate.append(tiers);

  // ------------------------------------------------------------- operator
  //
  // Side, gender, armour, colour. The figure standing in the yard behind
  // the gate is this choice made visible; see preview.ts.
  let loadout: Loadout = options.loadout ?? DEFAULT_LOADOUT;
  const changeLoadout = (next: Partial<Loadout>) => {
    loadout = { ...loadout, ...next };
    options.onLoadoutChange?.(loadout);
  };
  const operator = el("div", "operator");
  operator.dataset.interactive = "";

  const radios = <T extends string>(
    legendText: string,
    entries: readonly { id: T; name: string; disabled?: boolean; note?: string }[],
    current: T,
    onPick: (id: T) => void,
    extra?: (entry: { id: T }) => HTMLElement | null,
  ) => {
    const group = el("fieldset", "modes modes--compact");
    group.append(el("legend", "modes__legend", legendText));
    for (const entry of entries) {
      const label = el("label", "modes__option");
      label.dataset.interactive = "";
      if (entry.disabled) {
        label.classList.add("modes__option--disabled");
        label.title = entry.note ?? "";
      }
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `nc7-${legendText.toLowerCase().replace(/\s+/g, "-")}`;
      input.value = entry.id;
      input.checked = entry.id === current;
      input.disabled = Boolean(entry.disabled);
      input.addEventListener("change", () => {
        if (input.checked) onPick(entry.id);
      });
      label.append(input);
      const swatch = extra?.(entry);
      if (swatch) label.append(swatch);
      label.append(
        el(
          "span",
          "modes__name",
          entry.disabled ? `${entry.name} · ${entry.note ?? ""}` : entry.name,
        ),
      );
      group.append(label);
    }
    return group;
  };

  const armorBlurb = el("p", "modes__blurb", armorClassInfo(loadout.armor).blurb);
  operator.append(
    radios("Side", SIDES, loadout.side, (side) => changeLoadout({ side })),
    radios(
      "Gender",
      GENDERS.map((g) => ({ id: g.id, name: g.name, disabled: !g.available, note: g.note })),
      loadout.gender,
      (gender) => changeLoadout({ gender }),
    ),
    radios("Armour", ARMOR_CLASSES, loadout.armor, (armor) => {
      armorBlurb.textContent = armorClassInfo(armor).blurb;
      changeLoadout({ armor });
    }),
  );
  operator.append(armorBlurb);
  operator.append(
    radios(
      "Colour",
      COLORS,
      loadout.color,
      (color) => changeLoadout({ color }),
      (entry) => {
        const color = COLORS.find((c) => c.id === entry.id);
        if (!color) return null;
        const swatch = el("i", "swatch");
        swatch.style.setProperty("--band", color.band);
        swatch.style.setProperty("--cloth", color.cloth);
        return swatch;
      },
    ),
  );
  gate.append(operator);

  // --------------------------------------------------------------- armory
  //
  // Credits earned in the yard, spent between deployments. Free of money
  // while the game is being built; the note says so, in the interface.
  let credits = options.credits ?? 0;
  const armory = el("div", "armory");
  armory.dataset.interactive = "";
  const armoryHead = el("div", "armory__head");
  armoryHead.append(el("p", "hud__label", "Armory"));
  const creditsValue = el("p", "armory__credits", `${credits} CR`);
  armoryHead.append(creditsValue);
  armory.append(armoryHead);
  const rack = el("div", "armory__rack");
  const buyButtons: { button: HTMLButtonElement; price: number }[] = [];
  for (const item of ARMORY) {
    const button = el("button", "armory__item");
    button.type = "button";
    button.append(el("b", undefined, item.name));
    button.append(el("span", "armory__price", `${item.price} CR`));
    button.append(el("small", undefined, item.blurb));
    button.addEventListener("click", () => {
      if (!options.onBuy) return;
      const bought = options.onBuy(item.id);
      button.classList.remove("armory__item--bought", "armory__item--nothing");
      // Reflow so a second click re-triggers the animation.
      void button.offsetWidth;
      button.classList.add(bought ? "armory__item--bought" : "armory__item--nothing");
    });
    buyButtons.push({ button, price: item.price });
    rack.append(button);
  }
  armory.append(rack);
  armory.append(
    el(
      "p",
      "armory__note",
      `Test build: credits only, no money. +${CREDITS_PER_KILL} per kill, +${CREDITS_PER_PACK} per health pack.`,
    ),
  );
  gate.append(armory);

  const refreshArmory = () => {
    creditsValue.textContent = `${credits} CR`;
    for (const entry of buyButtons) {
      entry.button.disabled = !affordable(credits, { price: entry.price } as never);
    }
  };
  refreshArmory();

  const button = el("button", "gate__button", "Deploy to Ardavan");
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
  let lastGrenades = "";
  let lastHealth = "";
  let lastArmor = "";
  let lastWeapon = "";
  let lastAmmo = "";
  let lastState = "";
  let lastSlots = "";
  let lastKia = "";
  let lastDead = false;
  let fpsAccumulator = 0;
  let fpsFrames = 0;

  // Damage pulse: driven up by hits, bled off every frame.
  let hurtLevel = 0;
  let hitGlowUntil = 0;
  let lastGlow = false;
  let lastHurtWritten = -1;
  let lastTickAt = performance.now();

  const noticeTimers = new Set<number>();

  return {
    update(status: ControllerStatus, fps: number, local: LocalStatus): void {
      const now = performance.now();
      const elapsed = Math.min(now - lastTickAt, 250);
      lastTickAt = now;

      // ---- vitals
      const health = `${local.health}/${local.maxHealth}`;
      if (health !== lastHealth) {
        healthValue.textContent = String(local.health);
        const stamina = Math.max(1, local.maxHealth);
        healthFill.style.width = `${Math.max(0, Math.min(100, (local.health / stamina) * 100))}%`;
        healthValue.classList.toggle(
          "status__health--critical",
          local.health <= stamina * CRITICAL_FRACTION,
        );
        lastHealth = health;
      }
      const armor = `STAMINA ${local.maxHealth} · ARMOR ${local.armor}`;
      if (armor !== lastArmor) {
        armorValue.textContent = armor;
        lastArmor = armor;
      }

      // ---- weapon
      const current = local.weapons[local.slot];
      const name = current ? current.name.toUpperCase() : "—";
      if (name !== lastWeapon) {
        weaponName.textContent = name;
        lastWeapon = name;
      }
      const ammo = current ? `${current.magazine}/${current.reserve}` : "0/0";
      if (ammo !== lastAmmo) {
        magazineValue.textContent = String(current?.magazine ?? 0);
        reserveValue.textContent = `/ ${current?.reserve ?? 0}`;
        // Empty is worth showing differently: a magazine that reads "0" is easy
        // to miss mid-fight and then the trigger silently does nothing.
        ammoValue.classList.toggle("status__ammo--empty", (current?.magazine ?? 0) === 0);
        ammoValue.classList.toggle(
          "status__ammo--low",
          current !== undefined &&
            current.magazine > 0 &&
            current.magazine <= Math.ceil(current.magazineSize * 0.25),
        );
        lastAmmo = ammo;
      }
      const state = local.reloading
        ? "RELOADING"
        : current && current.magazine === 0
          ? current.reserve > 0
            ? "R TO RELOAD"
            : "NO AMMO"
          : "";
      if (state !== lastState) {
        weaponState.textContent = state;
        lastState = state;
      }
      const slotSignature = `${local.slot}|${local.weapons.map((w) => w.id).join(",")}`;
      if (slotSignature !== lastSlots) {
        slots.replaceChildren(
          ...local.weapons.map((w, i) => {
            const li = el(
              "li",
              i === local.slot ? "slots__slot slots__slot--active" : "slots__slot",
            );
            li.append(el("b", undefined, String(i + 1)));
            li.append(document.createTextNode(w.name.toUpperCase()));
            return li;
          }),
        );
        lastSlots = slotSignature;
      }

      // ---- frag
      const grenadeText = String(local.grenades);
      if (grenadeText !== lastGrenades) {
        grenadeValue.textContent = grenadeText;
        grenadeValue.classList.toggle("hud__value--spent", local.grenades <= 0);
        lastGrenades = grenadeText;
      }

      // ---- down
      if (local.alive !== !lastDead) {
        lastDead = !local.alive;
        kia.hidden = local.alive;
        hud.classList.toggle("hud--dead", !local.alive);
      }
      if (!local.alive) {
        const text = `REDEPLOY IN ${Math.ceil(local.respawnInMs / 1000)}`;
        if (text !== lastKia) {
          kiaSub.textContent = text;
          lastKia = text;
        }
      }

      // ---- damage pulse
      if (hurtLevel > 0) hurtLevel = Math.max(0, hurtLevel - elapsed / 650);
      const glowing = now < hitGlowUntil;
      if (glowing !== lastGlow) {
        healthValue.classList.toggle("status__health--hit", glowing);
        vitals.classList.toggle("status__group--hit", glowing);
        alert.hidden = !glowing;
        lastGlow = glowing;
      }
      const written = Math.round(Math.min(1, hurtLevel) * 100);
      if (written !== lastHurtWritten) {
        hurt.style.opacity = String(written / 100);
        lastHurtWritten = written;
      }

      // ---- movement
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
      if (Number.isFinite(fps) && fps > 0) {
        fpsAccumulator += fps;
        fpsFrames += 1;
      }
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

    showHit(amount: number, bearing: number | null): void {
      // A graze is a flicker; a shotgun blast is the whole edge. Capped so a
      // burst cannot stack into a screen that stays red for seconds.
      hurtLevel = Math.min(1.4, hurtLevel + 0.45 + amount / 40);
      hitGlowUntil = performance.now() + HIT_GLOW_MS;

      // Blood. Two or three marks per hit, thrown toward the edge the round
      // came from when that is known, anywhere on the rim when it is not.
      const marks = 2 + (amount > 6 ? 1 : 0);
      for (let i = 0; i < marks; i += 1) {
        while (spatter.childElementCount >= MAX_SPATTER) spatter.firstElementChild?.remove();
        const mark = el("i", "spatter__mark");
        const angle = bearing === null ? Math.random() * 360 : bearing + (Math.random() - 0.5) * 80;
        const rad = (angle * Math.PI) / 180;
        // Radius in viewport units from centre; keep marks out of the middle
        // where the target is.
        const radius = 30 + Math.random() * 18;
        const x = 50 + Math.sin(rad) * radius;
        const y = 50 - Math.cos(rad) * radius * 0.75;
        const size = 90 + Math.random() * 120 * Math.min(1, amount / 8 + 0.5);
        mark.style.left = `${x}%`;
        mark.style.top = `${y}%`;
        mark.style.width = `${size}px`;
        mark.style.height = `${size * (0.7 + Math.random() * 0.6)}px`;
        mark.style.transform = `translate(-50%, -50%) rotate(${Math.random() * 360}deg)`;
        mark.style.borderRadius = `${40 + Math.random() * 30}% ${50 + Math.random() * 30}% ${35 + Math.random() * 40}% ${55 + Math.random() * 25}%`;
        spatter.append(mark);
        const timer = window.setTimeout(() => {
          mark.remove();
          noticeTimers.delete(timer);
        }, SPATTER_MS);
        noticeTimers.add(timer);
      }

      // Which way. An arc on the crosshair ring, pointing at the shooter.
      if (bearing !== null) {
        while (hitdirs.childElementCount >= 6) hitdirs.firstElementChild?.remove();
        const arc = el("i", "hitdir");
        arc.style.transform = `translate(-50%, -50%) rotate(${bearing}deg)`;
        hitdirs.append(arc);
        const timer = window.setTimeout(() => {
          arc.remove();
          noticeTimers.delete(timer);
        }, HITDIR_MS);
        noticeTimers.add(timer);
      }
    },

    notify(text: string): void {
      const line = el("p", "notice", text.toUpperCase());
      notices.append(line);
      // Newest at the bottom, and never more than three: a pickup spree
      // should not build a column of text over the crosshair.
      while (notices.childElementCount > 3) notices.firstElementChild?.remove();
      const fade = window.setTimeout(() => {
        line.classList.add("notice--fading");
        const remove = window.setTimeout(() => {
          line.remove();
          noticeTimers.delete(remove);
        }, NOTICE_FADE_MS);
        noticeTimers.add(remove);
        noticeTimers.delete(fade);
      }, NOTICE_HOLD_MS);
      noticeTimers.add(fade);
    },

    setLocked(locked: boolean): void {
      hud.dataset.active = String(locked);
      gate.hidden = locked;
    },

    setCredits(next: number): void {
      credits = Math.max(0, Math.floor(next));
      refreshArmory();
    },

    dispose(): void {
      for (const timer of noticeTimers) window.clearTimeout(timer);
      noticeTimers.clear();
      vignette.remove();
      grain.remove();
      hurt.remove();
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
