import { FACTION, faction, type FactionId } from "@nightcell7/game-core";
import { SIDE, type SideId } from "./loadout";

/**
 * First-run onboarding: a briefing on the deploy gate, then a coach in the yard.
 *
 * Pure on purpose. No DOM and no Babylon, so the whole flow is testable and
 * the HUD only has to draw what this module decides.
 *
 * **The briefing** answers the question a first-time player cannot: who am I
 * and what is this place? The sandbox is squad play in the multiplayer map, and
 * the campaigns are one-person stories, so the briefing says which institution
 * the chosen side belongs to and which protagonist's story it is, using the same
 * cast data the website's cast page is built from.
 *
 * **The coach** teaches one control at a time, in the order the PRD's first
 * mission introduces systems (§10.1: movement, then sprint, crouch and jump,
 * then the weapon, reload, weapon switching, the frag). A step completes only
 * when the player actually does the thing, never on a timer: a hint that
 * disappears before the player has tried it teaches nothing.
 */

// ------------------------------------------------------------------- storage

const ONBOARDED_KEY = "nc7.onboarded";

/** True once the player has finished or skipped onboarding. */
export function hasOnboarded(storage?: Storage): boolean {
  try {
    return storage?.getItem(ONBOARDED_KEY) === "1";
  } catch {
    // Blocked storage: treat as onboarded rather than nagging on every visit.
    return true;
  }
}

export function markOnboarded(storage?: Storage): void {
  try {
    storage?.setItem(ONBOARDED_KEY, "1");
  } catch {
    // Nothing to do; the worst case is seeing the briefing again.
  }
}

// ------------------------------------------------------------------ briefing

export interface Briefing {
  readonly title: string;
  readonly lines: readonly string[];
}

/** The institution each sandbox side belongs to in the story. */
const SIDE_FACTION: Readonly<Record<SideId, FactionId>> = {
  [SIDE.NIGHTCELL]: FACTION.NIGHTCELL,
  [SIDE.DIRECTORATE]: FACTION.DIRECTORATE,
};

const SIDE_STORY: Readonly<Record<SideId, string>> = {
  [SIDE.NIGHTCELL]: "Rook's program",
  [SIDE.DIRECTORATE]: "the service Leila serves",
};

export function briefingFor(side: SideId): Briefing {
  const own = faction(SIDE_FACTION[side]);
  return {
    title: "First deployment",
    lines: [
      `You are deploying with ${own.name}, ${SIDE_STORY[side]}. ${own.summary}`,
      "This is Ardavan Yard, the multiplayer map, played as squad Team Deathmatch against bots. The campaigns are one-person stories; the yard is where you learn to fight.",
      "Your squad wears the colour you choose below, and the other side is always given a colour you cannot confuse with it. Once you deploy, a short coach walks you through the controls one at a time.",
    ],
  };
}

// --------------------------------------------------------------------- coach

/** What the coach reads each frame. Built from the controller and the simulation. */
export interface CoachSnapshot {
  readonly speed: number;
  readonly grounded: boolean;
  readonly crouching: boolean;
  readonly sprinting: boolean;
  readonly firing: boolean;
  /** Camera yaw in radians. */
  readonly yaw: number;
  readonly reloading: boolean;
  readonly slot: number;
  readonly grenades: number;
  readonly alive: boolean;
}

export interface CoachStep {
  readonly id: string;
  readonly keys: string;
  readonly action: string;
}

/** How far the player must turn before "look" counts, in radians. */
const LOOK_RADIANS = 0.8;
/** Movement below this is standing still, m/s. */
const MOVE_SPEED = 0.8;

interface StepRule extends CoachStep {
  done(now: CoachSnapshot, start: CoachSnapshot, turned: number): boolean;
}

const STEPS: readonly StepRule[] = [
  { id: "move", keys: "W A S D", action: "Move", done: (n) => n.speed > MOVE_SPEED },
  {
    id: "look",
    keys: "Mouse",
    action: "Look around",
    done: (_n, _s, turned) => turned >= LOOK_RADIANS,
  },
  { id: "sprint", keys: "Shift", action: "Sprint while moving", done: (n) => n.sprinting },
  { id: "crouch", keys: "Ctrl / C", action: "Crouch", done: (n) => n.crouching },
  { id: "jump", keys: "Space", action: "Jump", done: (n) => !n.grounded },
  { id: "fire", keys: "Left click", action: "Fire", done: (n) => n.firing },
  { id: "reload", keys: "R", action: "Reload", done: (n) => n.reloading },
  {
    id: "switch",
    keys: "1 2 3 · Wheel",
    action: "Switch weapons",
    done: (n, s) => n.slot !== s.slot,
  },
  { id: "frag", keys: "G", action: "Throw a frag", done: (n, s) => n.grenades < s.grenades },
];

export const COACH_STEPS: readonly CoachStep[] = STEPS.map(({ id, keys, action }) => ({
  id,
  keys,
  action,
}));

export interface CoachState {
  /** The step to show, or null once every step is done. */
  readonly step: CoachStep | null;
  readonly index: number;
  readonly total: number;
  /** True on the one frame the last step completes. */
  readonly finished: boolean;
}

/**
 * Feed it a snapshot every frame; it says which step to show.
 *
 * Each step measures against a baseline taken when the step began, so
 * "switch weapons" means *change* the slot you were in, and "throw a frag"
 * means spend one of the frags you had, however the snapshot started. While
 * the player is dead the coach waits instead of advancing, because a
 * respawn resets ammunition and grenades and would otherwise complete steps on
 * its own.
 */
export class Coach {
  private index = 0;
  private baseline: CoachSnapshot | null = null;
  private lastYaw: number | null = null;
  private turned = 0;
  private done = false;

  observe(now: CoachSnapshot): CoachState {
    if (this.done) return { step: null, index: STEPS.length, total: STEPS.length, finished: false };

    if (!now.alive) {
      // Re-baseline after the respawn rather than scoring it.
      this.baseline = null;
      this.lastYaw = null;
      return this.state(false);
    }

    if (!this.baseline) this.baseline = now;

    if (this.lastYaw !== null) this.turned += Math.abs(angleDelta(now.yaw, this.lastYaw));
    this.lastYaw = now.yaw;

    const rule = STEPS[this.index]!;
    if (rule.done(now, this.baseline, this.turned)) {
      this.index += 1;
      this.baseline = now;
      this.turned = 0;
      if (this.index >= STEPS.length) {
        this.done = true;
        return { step: null, index: STEPS.length, total: STEPS.length, finished: true };
      }
    }
    return this.state(false);
  }

  /** Stop coaching; used by the Skip control. */
  skip(): void {
    this.done = true;
  }

  get complete(): boolean {
    return this.done;
  }

  private state(finished: boolean): CoachState {
    const rule = STEPS[this.index]!;
    return {
      step: { id: rule.id, keys: rule.keys, action: rule.action },
      index: this.index,
      total: STEPS.length,
      finished,
    };
  }
}

/** Shortest signed difference between two angles, so a wrap past ±π is not a full turn. */
function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
