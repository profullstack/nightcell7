import { TEAM_IDS } from "@nightcell7/multiplayer-sim";
import CATALOGUE from "./comms-lines.json";
import { CHARACTER, SIDE, type CharacterId, type SideId } from "./loadout";

/**
 * Squad radio: who says what, and when.
 *
 * Pure on purpose, like the onboarding coach: no DOM, no Web Audio, no
 * Babylon. `CommsDirector.observe` is fed a snapshot of the match and the
 * events since the last frame, and returns the transmissions to key up. The
 * audio layer only plays them (see `GameAudio.transmit`), so every rule here
 * is testable with plain numbers.
 *
 * Three kinds of traffic, in priority order:
 *
 *  1. **Callouts** from the squad, driven by what just happened: an enemy
 *     showing up somewhere ("Contact, west catwalk!"), a grenade landing near
 *     the squad, a man down, an enemy down, the player's own kill.
 *  2. **Orders** from command, addressed to the player by callsign ("Rook,
 *     push the hardpoint.") and chosen from the state of the match: the score,
 *     where the enemy is, how many are left.
 *  3. **Chatter**: the net talking to itself in the gaps, so the radio is never
 *     dead air for long, and never loud enough to cover a callout.
 *
 * One transmission at a time. A radio net is half duplex, and two voices on
 * top of each other is the exact mess the player is trying to hear through.
 */

// ---------------------------------------------------------------- the yard

/**
 * Named areas of Ardavan Yard, as callouts. Absolute, not relative to the
 * team: "west catwalk" means the same place to both sides, as it would on a
 * real net. Boundaries follow the collision layout in multiplayer-sim's
 * `map.ts` (lanes at x ~ -28 and x ~ +26, the containers either side of the
 * centre, a gate at each end).
 */
export const ZONE = {
  WEST_CATWALK: "west_catwalk",
  PIPE_RACK: "pipe_rack",
  GANTRY: "gantry",
  TANK_ROW: "tank_row",
  HARDPOINT: "hardpoint",
  NORTH_CONTAINERS: "north_containers",
  SOUTH_CONTAINERS: "south_containers",
  NORTH_GATE: "north_gate",
  YARD_GATE: "yard_gate",
  OPEN: "open",
} as const;
export type ZoneId = (typeof ZONE)[keyof typeof ZONE];

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Catwalk and gantry decks are at 6 m; anything well above the ground is up there. */
const RAISED_Y = 4.5;

export function zoneOf(p: Vec3): ZoneId {
  if (p.x < -20) return p.y > RAISED_Y ? ZONE.WEST_CATWALK : ZONE.PIPE_RACK;
  if (p.x > 19) return p.y > RAISED_Y ? ZONE.GANTRY : ZONE.TANK_ROW;
  if (p.z < -36) return ZONE.NORTH_GATE;
  if (p.z > 36) return ZONE.YARD_GATE;
  if (Math.abs(p.x) < 9 && Math.abs(p.z) < 7) return ZONE.HARDPOINT;
  if (Math.abs(p.x) < 12 && p.z <= -7) return ZONE.NORTH_CONTAINERS;
  if (Math.abs(p.x) < 12 && p.z >= 7) return ZONE.SOUTH_CONTAINERS;
  return ZONE.OPEN;
}

/** Which lane a position is in, for "push west" / "push east". */
export function laneOf(p: Vec3): "west" | "centre" | "east" {
  if (p.x < -15) return "west";
  if (p.x > 15) return "east";
  return "centre";
}

// ------------------------------------------------------------ the catalogue

export type LineId = string;

interface CatalogueLine {
  readonly speaker: "command" | "squad1" | "squad2";
  readonly text: string;
}
const LINES = CATALOGUE.lines as Record<SideId, Record<string, CatalogueLine>>;

/**
 * Every recorded take of a line: the line itself (orders) and its lettered
 * takes (`contact_hardpoint_a`, `_b`...) or numbered ones (`order_gantry_v2`).
 */
export function takesOf(side: SideId, base: LineId): LineId[] {
  const pattern = new RegExp(`^${base}(?:_[a-z]|_v\\d+)?$`);
  const found = Object.keys(LINES[side]).filter((id) => pattern.test(id));
  return found.length ? found : [base];
}

/** Every clip a side needs, for the loader. */
export function linesFor(side: SideId): LineId[] {
  return Object.keys(LINES[side]);
}

export function lineText(side: SideId, id: LineId): string | undefined {
  return LINES[side][id]?.text;
}

/** Who is talking and what they said, for the caption under a transmission. */
export function captionFor(
  side: SideId,
  lines: readonly LineId[],
): { speaker: string; text: string } {
  const first = LINES[side][lines[0] ?? ""];
  const voices = CATALOGUE.voices[side] as Record<string, { label: string }>;
  const speaker = (first && voices[first.speaker]?.label) ?? "Radio";
  const text = lines
    .map((id) => LINES[side][id]?.text ?? "")
    .join(" ")
    .trim();
  return { speaker, text };
}

/** How command addresses each playable character. */
const CALLSIGN: Readonly<Record<CharacterId, LineId>> = {
  [CHARACTER.ROOK]: "callsign_rook",
  [CHARACTER.VALE]: "callsign_vale",
  [CHARACTER.LEILA]: "callsign_leila",
  [CHARACTER.DARYAN]: "callsign_daryan",
};

// ---------------------------------------------------------------- the input

export interface CommsFighter {
  readonly team: number;
  readonly alive: boolean;
  readonly position: Vec3;
  readonly isLocal: boolean;
}

export interface CommsSnapshot {
  readonly fighters: readonly CommsFighter[];
  /** Kills per team, as the simulation scores them. */
  readonly scores: Readonly<Record<number, number>>;
}

export type CommsEvent =
  | {
      readonly type: "kill";
      readonly victimTeam: number;
      readonly victimIsLocal: boolean;
      readonly killerIsLocal: boolean;
    }
  | { readonly type: "grenade"; readonly team: number; readonly position: Vec3 }
  | { readonly type: "local_respawn" };

/** One key-up on the net: the clips play back to back as one transmission. */
export interface Transmission {
  readonly lines: readonly LineId[];
  readonly kind: "callout" | "order" | "chatter";
}

// -------------------------------------------------------------- the timing

/** Seconds. Tuned by playing, not derived: a radio that talks less is better. */
export const TIMING = {
  /** Nothing new keys up within this long of the last transmission starting. */
  gapAfterAny: 2.2,
  /** The same area is not called twice inside this. */
  zoneCooldown: 14,
  /** An enemy counts as "spotted" within this many metres of anyone on the squad. */
  spotRange: 32,
  /** After a spot callout, no more spot callouts for this long. */
  contactCooldown: 5,
  enemyDownCooldown: 6,
  /** A new order no sooner than this after the last one. */
  orderEvery: [38, 60] as const,
  /** Chatter only after this much quiet. */
  chatterAfterQuiet: [16, 30] as const,
  /** A grenade this close to the squad is worth shouting about. */
  grenadeRange: 12,
  /** Score difference that turns an order into "hold" or "fall back". */
  scoreSwing: 5,
  /** The player's kills this close together earn a "good work". */
  streak: { kills: 3, withinS: 25 },
} as const;

/**
 * Chatter that is a call with an answer on the net: the answer keys up a
 * breath after its call and never plays on its own. Same numbering on both
 * sides of the catalogue.
 */
const CHATTER_REPLIES: Readonly<Record<LineId, LineId>> = {
  chatter_02: "chatter_03",
  chatter_07: "chatter_08",
  chatter_11: "chatter_12",
  chatter_15: "chatter_16",
  chatter_19: "chatter_20",
  chatter_23: "chatter_24",
  chatter_27: "chatter_28",
};
/** Seconds between a chatter call and its answer. */
const REPLY_AFTER_S = 2.8;

// ------------------------------------------------------------- the director

export class CommsDirector {
  private readonly ownTeam: number;
  private readonly callsign: LineId;
  private lastKeyUp = -Infinity;
  private lastQuiet = 0;
  private quietTarget: number;
  private nextOrderAt: number;
  private lastContact = -Infinity;
  private lastEnemyDown = -Infinity;
  private readonly zoneCalled = new Map<ZoneId, number>();
  private readonly spotted = new Set<number>();
  private started = false;
  private lastOneCalled = false;
  private readonly localKillTimes: number[] = [];
  private chatterBag: LineId[] = [];
  private lastOrder: LineId | null = null;
  private pendingReply: LineId | null = null;
  private quietOverride: number | null = null;
  private readonly bags = new Map<LineId, LineId[]>();
  private readonly lastTake = new Map<LineId, LineId>();

  constructor(
    private readonly side: SideId,
    character: CharacterId,
    private readonly random: () => number = Math.random,
  ) {
    this.ownTeam = side === SIDE.DIRECTORATE ? TEAM_IDS.DIRECTORATE : TEAM_IDS.NIGHTCELL;
    this.callsign = CALLSIGN[character];
    this.quietTarget = this.between(TIMING.chatterAfterQuiet);
    this.nextOrderAt = this.between(TIMING.orderEvery);
  }

  /**
   * Called every frame while the player is in the yard. `nowS` is match time
   * in seconds. Returns at most one transmission; whatever else happened this
   * frame and was not worth waiting for is simply not said.
   */
  observe(
    nowS: number,
    snapshot: CommsSnapshot,
    events: readonly CommsEvent[],
    /** True while the last transmission is still playing: nothing keys up over it. */
    netBusy = false,
  ): Transmission | null {
    const pick = this.choose(nowS, snapshot, events, netBusy);
    if (pick) {
      this.lastKeyUp = nowS;
      this.lastQuiet = nowS;
      this.quietTarget = this.quietOverride ?? this.between(TIMING.chatterAfterQuiet);
      this.quietOverride = null;
      if (pick.kind === "order") this.nextOrderAt = nowS + this.between(TIMING.orderEvery);
    }
    return pick;
  }

  private choose(
    now: number,
    snap: CommsSnapshot,
    events: readonly CommsEvent[],
    netBusy: boolean,
  ): Transmission | null {
    const busy = netBusy || now - this.lastKeyUp < TIMING.gapAfterAny;

    // Deploying: the first thing on the net is always command sending the squad in.
    if (!this.started) {
      this.started = true;
      this.nextOrderAt = now + this.between(TIMING.orderEvery);
      return { kind: "order", lines: ["order_move_out"] };
    }

    // Events are rare and time-critical; a busy net drops them rather than
    // playing them late, because "grenade" three seconds late is worse than silence.
    for (const event of events) {
      if (busy) break;
      const said = this.onEvent(now, snap, event);
      if (said) return said;
    }
    if (busy) return null;

    const contact = this.contact(now, snap);
    if (contact) return contact;

    // An answer on the net comes before routine orders: a call left hanging
    // sounds like a dropped transmission.
    if (this.pendingReply && now - this.lastQuiet >= REPLY_AFTER_S) return this.chatter();

    const enemiesAlive = snap.fighters.filter((f) => f.team !== this.ownTeam && f.alive).length;
    const enemiesTotal = snap.fighters.filter((f) => f.team !== this.ownTeam).length;
    if (enemiesTotal > 1 && enemiesAlive === 1 && !this.lastOneCalled) {
      this.lastOneCalled = true;
      return this.order("order_last_one");
    }
    if (enemiesAlive > 1) this.lastOneCalled = false;

    if (now >= this.nextOrderAt) return this.order(this.pickOrder(snap));

    if (now - this.lastQuiet >= this.quietTarget) return this.chatter();
    return null;
  }

  private onEvent(now: number, snap: CommsSnapshot, event: CommsEvent): Transmission | null {
    switch (event.type) {
      case "grenade": {
        if (event.team === this.ownTeam) return null;
        const near = snap.fighters.some(
          (f) =>
            f.team === this.ownTeam &&
            f.alive &&
            distance(f.position, event.position) < TIMING.grenadeRange,
        );
        return near ? this.callout("grenade") : null;
      }
      case "kill": {
        if (event.victimIsLocal) return this.callout("operator_down");
        if (event.victimTeam === this.ownTeam) return this.callout("man_down");
        if (event.killerIsLocal) {
          this.localKillTimes.push(now);
          const recent = this.localKillTimes.filter((t) => now - t <= TIMING.streak.withinS);
          this.localKillTimes.splice(0, this.localKillTimes.length, ...recent);
          if (recent.length >= TIMING.streak.kills) {
            this.localKillTimes.length = 0;
            return this.order("order_good_work");
          }
          return this.random() < 0.6 ? this.callout("nice_shot") : null;
        }
        if (now - this.lastEnemyDown < TIMING.enemyDownCooldown || this.random() > 0.55)
          return null;
        this.lastEnemyDown = now;
        return this.callout("enemy_down");
      }
      case "local_respawn":
        return this.order("order_back_in");
    }
  }

  /** The first sighting of an enemy since they (re)spawned, named by area. */
  private contact(now: number, snap: CommsSnapshot): Transmission | null {
    const squad = snap.fighters.filter((f) => f.team === this.ownTeam && f.alive);
    let found: ZoneId | null = null;
    snap.fighters.forEach((enemy, index) => {
      if (enemy.team === this.ownTeam) return;
      if (!enemy.alive) {
        this.spotted.delete(index);
        return;
      }
      if (this.spotted.has(index)) return;
      const seen = squad.some((f) => distance(f.position, enemy.position) < TIMING.spotRange);
      if (!seen) return;
      this.spotted.add(index);
      const zone = zoneOf(enemy.position);
      const last = this.zoneCalled.get(zone) ?? -Infinity;
      if (
        !found &&
        now - last >= TIMING.zoneCooldown &&
        now - this.lastContact >= TIMING.contactCooldown
      ) {
        found = zone;
      }
    });
    if (!found) return null;
    this.zoneCalled.set(found, now);
    this.lastContact = now;
    return this.callout(`contact_${found}`);
  }

  /**
   * What command wants now. Winning comfortably: hold the centre. Losing badly:
   * fall back. Otherwise push where the enemy is thinnest, or take height.
   */
  private pickOrder(snap: CommsSnapshot): LineId {
    const enemyTeam =
      this.ownTeam === TEAM_IDS.NIGHTCELL ? TEAM_IDS.DIRECTORATE : TEAM_IDS.NIGHTCELL;
    const diff = (snap.scores[this.ownTeam] ?? 0) - (snap.scores[enemyTeam] ?? 0);
    if (diff >= TIMING.scoreSwing) return "order_hold_hardpoint";
    if (diff <= -TIMING.scoreSwing) return "order_fall_back";

    const enemies = snap.fighters.filter((f) => f.team !== this.ownTeam && f.alive);
    const count = { west: 0, centre: 0, east: 0 };
    for (const e of enemies) count[laneOf(e.position)] += 1;
    const options: LineId[] = [];
    if (count.west < count.east) options.push("order_push_west");
    if (count.east < count.west) options.push("order_push_east");
    if (count.centre === 0) options.push("order_push_hardpoint");
    options.push("order_catwalk", "order_gantry", "order_push_hardpoint");
    const fresh = options.filter((o) => o !== this.lastOrder);
    return fresh[Math.floor(this.random() * fresh.length)] ?? "order_push_hardpoint";
  }

  private order(base: LineId): Transmission {
    this.lastOrder = base;
    const id = this.take(base);
    // Broadcasts ("All elements...") are not addressed; everything else is.
    const addressed = /^[a-z]/.test(lineText(this.side, id) ?? "");
    return { kind: "order", lines: addressed ? [this.callsign, id] : [id] };
  }

  private callout(base: string): Transmission {
    return { kind: "callout", lines: [this.take(base)] };
  }

  /**
   * One take of a line, from a shuffle bag: every take plays once before any
   * repeats, and the last take of one pass is never the first of the next.
   * Takes alternate squad voices in the catalogue, so this also spreads the
   * talking across the squad.
   */
  private take(base: LineId): LineId {
    let bag = this.bags.get(base);
    if (!bag || bag.length === 0) {
      const all = takesOf(this.side, base);
      bag = [...all];
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      const last = this.lastTake.get(base);
      if (bag.length > 1 && bag[0] === last) [bag[0], bag[1]] = [bag[1]!, bag[0]!];
      this.bags.set(base, bag);
    }
    const id = bag.shift() ?? base;
    this.lastTake.set(base, id);
    return id;
  }

  private chatter(): Transmission {
    if (this.pendingReply) {
      const reply = this.pendingReply;
      this.pendingReply = null;
      return { kind: "chatter", lines: [reply] };
    }
    if (this.chatterBag.length === 0) {
      // Every line but the answers: those only follow their call.
      const answers = new Set(Object.values(CHATTER_REPLIES));
      this.chatterBag = linesFor(this.side).filter(
        (id) => id.startsWith("chatter_") && !answers.has(id),
      );
    }
    const index = Math.floor(this.random() * this.chatterBag.length);
    const [line = "chatter_01"] = this.chatterBag.splice(index, 1);
    const reply = CHATTER_REPLIES[line];
    if (reply) {
      // The answer comes back after a breath, not after the usual long quiet.
      this.pendingReply = reply;
      this.quietOverride = REPLY_AFTER_S;
    }
    return { kind: "chatter", lines: [line] };
  }

  private between(range: readonly [number, number]): number {
    return range[0] + this.random() * (range[1] - range[0]);
  }
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
