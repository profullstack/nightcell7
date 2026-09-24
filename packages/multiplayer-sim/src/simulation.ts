import {
  GRENADE_SPEC,
  MAX_HEALTH,
  MULTIPLAYER_LOADOUT,
  REGEN_DELAY_MS,
  TDM_RULES,
  applyDamage,
  applyStatus,
  assignTeam,
  computeShotDamage,
  evaluateMatchOutcome,
  fireIntervalMs,
  getWeapon,
  isMultiplayerLegal,
  isProjectileWeapon,
  isUpgradeOver,
  regenerate,
  tickStatuses,
  type ActiveStatus,
  type StatusKind,
  type MatchRules,
  type WeaponId,
  type WeaponSpec,
} from "@nightcell7/game-core";
import {
  BUTTON,
  MAX_INPUT_BATCH,
  hasButton,
  sanitizeInputFrame,
  type InputFrame,
} from "@nightcell7/multiplayer-protocol";
import { EYE_HEIGHT_CROUCHED, EYE_HEIGHT_STANDING, MAX_REWIND_MS, TICK_MS } from "./constants";
import {
  grenadeShouldDetonate,
  resolveBlast,
  stepGrenade,
  type BlastCandidate,
  type SimGrenade,
} from "./grenades";
import { rocketLaunchVelocity, stepRocket, type RocketTarget, type SimRocket } from "./rockets";
import { PositionHistory, resolveHitscan, rewindTicks, type HitCandidate } from "./hitscan";
import type { CollisionMap } from "./map";
import {
  DEFAULT_PICKUP_RULES,
  PICKUP_KIND,
  applyPickup,
  isClearOfSolids,
  withinPickupReach,
  type PickupKind,
  type PickupRules,
  type SimPickup,
} from "./pickups";
import {
  createMovementState,
  isBelowKillPlane,
  playerHeight,
  stepMovement,
  type MovementState,
} from "./movement";
import { selectSpawn } from "./spawn";
import { add, directionFromAngles, distance, scale, type Vec3 } from "./vec";

/**
 * The authoritative match simulation.
 *
 * PRD §18.3 lists what the server owns; this class owns exactly that list and
 * nothing about presentation. It has no transport dependency either — the
 * Colyseus room drives it, and so does the bot harness and the test suite.
 *
 * "Two clients must be unable to disagree about who moved, fired, hit, died,
 * or won" (PRD §40) — this file is where that is enforced.
 */

/**
 * Movement time a single player may consume per tick.
 *
 * Without this, a client that batches eight 50 ms frames into every 33 ms tick
 * would move at twelve times normal speed while looking perfectly legitimate at
 * the packet level. Surplus frames stay buffered and are consumed next tick.
 */
export const DT_BUDGET_PER_TICK_MS = TICK_MS * 1.25;

/** How many unprocessed frames a connection may bank before we drop the oldest. */
export const MAX_BUFFERED_INPUTS = MAX_INPUT_BATCH * 4;

export interface AmmoState {
  magazine: number;
  reserve: number;
}

export interface SimPlayer {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly isBot: boolean;
  team: number;

  movement: MovementState;
  health: number;
  /** Stamina: the ceiling health can reach. 100 in a match. */
  maxHealth: number;
  armor: number;

  weapons: WeaponId[];
  weaponSlot: number;
  ammo: AmmoState[];
  nextFireAtMs: number;
  reloadingUntilMs: number;
  /** Grenades left this life. Replenished on respawn, never mid-life. */
  grenades: number;
  nextGrenadeAtMs: number;
  /** True while the trigger has been held since the last shot (semi-auto gate). */
  triggerHeld: boolean;

  alive: boolean;
  respawnAtMs: number;
  spawnProtectedUntilMs: number;
  /** Match clock until which God Mode holds. Zero when it is not running. */
  godModeUntilMs: number;
  /** Burns and arcs currently running on this fighter. */
  statuses: ActiveStatus[];
  /** Match time of the last damage taken; gates passive regeneration. */
  lastDamagedAtMs: number;

  kills: number;
  deaths: number;
  assists: number;
  score: number;

  lastAckedSeq: number;
  latencyMs: number;
  connected: boolean;
  disconnectedAtMs: number | null;
  reconnectCount: number;

  history: PositionHistory;
  pendingInputs: InputFrame[];
  /** Trigger intent from a player driven outside the input queue; see `applyWeaponIntent`. */
  pendingWeaponIntent: InputFrame | null;
  /** True until a tick has consumed `pendingWeaponIntent` at least once. */
  weaponIntentFresh: boolean;
  /** Damage taken recently, for assist attribution. */
  recentDamage: Map<string, { amount: number; atMs: number }>;
  rejectedInputs: number;
}

export type SimEvent =
  | { type: "match_start"; atMs: number }
  | {
      type: "hit";
      attackerId: string;
      victimId: string;
      damage: number;
      armorAbsorbed: boolean;
      headshot: boolean;
      tick: number;
    }
  | {
      type: "kill";
      attackerId: string | null;
      victimId: string;
      weaponId: WeaponId | null;
      headshot: boolean;
      respawnAtMs: number;
    }
  | { type: "respawn"; playerId: string; position: Vec3; yaw: number; tick: number }
  | {
      /**
       * A trigger pull that fired a round. Emitted for hits and misses alike,
       * so a client can draw the muzzle flash and tracer without guessing at
       * cadence or ammunition. `distance` is null on a miss.
       */
      type: "shot";
      playerId: string;
      weaponId: WeaponId;
      origin: Vec3;
      direction: Vec3;
      victimId: string | null;
      distance: number | null;
      tick: number;
    }
  | {
      type: "pickup_spawned";
      pickupId: string;
      kind: PickupKind;
      position: Vec3;
      weaponId: WeaponId | null;
    }
  | {
      type: "pickup_taken";
      pickupId: string;
      playerId: string;
      kind: PickupKind;
      weaponId: WeaponId | null;
      /** Health restored, for a pack. */
      healed: number;
      /** Stamina added by a pack, and the taker's stamina afterwards. */
      staminaGained: number;
      stamina: number;
      /** Rounds gained, for a weapon. */
      ammoAdded: number;
      /** Slot the weapon now occupies, and whether it is a new one. */
      slot: number;
      added: boolean;
    }
  | { type: "pickup_removed"; pickupId: string }
  /**
   * A lingering effect started on a fighter — fire taking hold, or an arc
   * jumping to them. The client drives its own effects off this; the damage
   * itself is billed on the tick, not here.
   */
  | { type: "status"; playerId: string; kind: StatusKind }
  | {
      type: "grenade_thrown";
      grenadeId: string;
      ownerId: string;
      team: number;
      position: Vec3;
      velocity: Vec3;
      fuseMs: number;
      tick: number;
    }
  | {
      type: "grenade_exploded";
      grenadeId: string;
      ownerId: string;
      position: Vec3;
      /** Everyone the blast reached, for client-side damage feedback. */
      victims: readonly { playerId: string; damage: number }[];
      tick: number;
    }
  | {
      type: "rocket_fired";
      rocketId: string;
      ownerId: string;
      team: number;
      weaponId: WeaponId;
      position: Vec3;
      velocity: Vec3;
      tick: number;
    }
  | {
      type: "rocket_exploded";
      rocketId: string;
      ownerId: string;
      position: Vec3;
      /** The body it struck head-on, if any, before the blast was resolved. */
      directHitId: string | null;
      victims: readonly { playerId: string; damage: number }[];
      tick: number;
    }
  | {
      type: "match_end";
      reason: "score_limit" | "time_limit";
      winningTeam: number | null;
      scores: Record<number, number>;
      durationMs: number;
    };

export interface AddPlayerOptions {
  id: string;
  userId: string;
  displayName: string;
  isBot?: boolean;
  preferredTeam?: number;
  loadout?: readonly WeaponId[];
  /** Starting stamina. Defaults to the match value of 100. */
  maxHealth?: number;
}

export interface SimulationOptions {
  matchId: string;
  map: CollisionMap;
  rules?: MatchRules;
  /**
   * Health packs and weapon drops. Off unless asked for: the multiplayer room
   * does not render pickups yet, and an invisible health pack is worse than
   * none.
   */
  pickups?: Partial<PickupRules>;
  /**
   * Multiplier on damage human players take. 1 in a match; the single-player
   * sandbox uses the difficulty table's value so four bots do not empty a
   * player in a second.
   */
  humanIncomingDamage?: number;
}

export class MatchSimulation {
  readonly matchId: string;
  readonly map: CollisionMap;
  readonly rules: MatchRules;

  readonly players = new Map<string, SimPlayer>();
  readonly scores: Record<number, number> = { 0: 0, 1: 0 };

  tick = 0;
  /** Match clock in milliseconds; the canonical time for every deadline. */
  elapsedMs = 0;
  phase: "warmup" | "live" | "ended" = "warmup";
  winningTeam: number | null = null;
  terminationReason: "score_limit" | "time_limit" | null = null;

  /** Grenades currently in flight, keyed by id. */
  readonly grenades = new Map<string, SimGrenade>();
  /** Rockets currently in flight, keyed by id. */
  readonly rockets = new Map<string, SimRocket>();

  /** Health packs and weapon drops on the ground, keyed by id. */
  readonly pickups = new Map<string, SimPickup>();
  private readonly pickupRules: PickupRules | null;
  private readonly humanIncomingDamage: number;
  /** Per health spawn: when the next pack appears there, or null while one sits there. */
  private readonly healthSpawnDueAtMs: (number | null)[] = [];
  /** When the next God Mode appears, or null while one is already out. */
  private godSpawnDueAtMs: number | null = null;
  /** How many have been placed, which drives the spawn point and the jitter. */
  private godCycle = 0;

  private readonly recentDeaths: { position: Vec3; atMs: number }[] = [];
  private nextGrenadeSeq = 0;
  private nextRocketSeq = 0;
  private nextPickupSeq = 0;
  private events: SimEvent[] = [];
  private emitStartNextStep = false;

  constructor(options: SimulationOptions) {
    this.matchId = options.matchId;
    this.map = options.map;
    this.rules = options.rules ?? TDM_RULES;
    this.humanIncomingDamage = Math.max(0, options.humanIncomingDamage ?? 1);

    if (options.pickups) {
      const merged = { ...DEFAULT_PICKUP_RULES, ...options.pickups };
      // A spawn inside a solid would be visible and unreachable; drop it here
      // rather than ship it.
      const healthSpawns = merged.healthSpawns.filter((point) => isClearOfSolids(this.map, point));
      const godSpawns = merged.godSpawns.filter((point) => isClearOfSolids(this.map, point));
      this.pickupRules = { ...merged, healthSpawns, godSpawns };
      this.healthSpawnDueAtMs.push(...healthSpawns.map(() => merged.healthFirstSpawnMs));
      if (godSpawns.length > 0) this.godSpawnDueAtMs = merged.godFirstSpawnMs;
    } else {
      this.pickupRules = null;
    }
  }

  // ------------------------------------------------------------------------
  // Roster
  // ------------------------------------------------------------------------

  addPlayer(options: AddPlayerOptions): SimPlayer {
    if (this.players.has(options.id)) {
      throw new Error(`player already in match: ${options.id}`);
    }
    if (this.players.size >= this.rules.maxPlayers) {
      throw new Error("room_full");
    }

    const counts = this.teamCounts();
    const team = assignTeam(counts, options.preferredTeam, this.rules);

    const requested = options.loadout ?? MULTIPLAYER_LOADOUT;
    // A campaign-only weapon must never reach a match, whatever the client asks
    // for (PRD §5.4 — no pay-to-win, no power creep).
    const weapons = requested.filter(isMultiplayerLegal);
    if (weapons.length === 0) weapons.push(...MULTIPLAYER_LOADOUT);

    const player: SimPlayer = {
      id: options.id,
      userId: options.userId,
      displayName: options.displayName,
      isBot: options.isBot ?? false,
      team,
      movement: createMovementState({ x: 0, y: 0, z: 0 }, 0),
      health: options.maxHealth ?? MAX_HEALTH,
      maxHealth: options.maxHealth ?? MAX_HEALTH,
      armor: 50,
      weapons,
      weaponSlot: 0,
      ammo: weapons.map((id) => {
        const spec = getWeapon(id);
        return { magazine: spec.magazineSize, reserve: spec.reserveAmmo };
      }),
      nextFireAtMs: 0,
      reloadingUntilMs: 0,
      grenades: GRENADE_SPEC.carried,
      nextGrenadeAtMs: 0,
      triggerHeld: false,
      alive: true,
      respawnAtMs: 0,
      spawnProtectedUntilMs: 0,
      godModeUntilMs: 0,
      statuses: [],
      lastDamagedAtMs: -Infinity,
      kills: 0,
      deaths: 0,
      assists: 0,
      score: 0,
      lastAckedSeq: 0,
      latencyMs: 0,
      connected: true,
      disconnectedAtMs: null,
      reconnectCount: 0,
      history: new PositionHistory(),
      pendingInputs: [],
      pendingWeaponIntent: null,
      weaponIntentFresh: false,
      recentDamage: new Map(),
      rejectedInputs: 0,
    };

    this.players.set(player.id, player);
    this.respawn(player, true);
    return player;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  /** Mark a player disconnected but hold their seat (PRD §18.10). */
  markDisconnected(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = false;
    player.disconnectedAtMs = this.elapsedMs;
    player.pendingInputs.length = 0;
  }

  markReconnected(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = true;
    player.disconnectedAtMs = null;
    player.reconnectCount += 1;
  }

  /** Seats whose grace window has expired and should now be released. */
  expiredSeats(): string[] {
    const expired: string[] = [];
    for (const player of this.players.values()) {
      if (player.connected || player.disconnectedAtMs === null) continue;
      if (this.elapsedMs - player.disconnectedAtMs >= this.rules.reconnectGraceMs) {
        expired.push(player.id);
      }
    }
    return expired;
  }

  teamCounts(): Record<number, number> {
    const counts: Record<number, number> = { 0: 0, 1: 0 };
    for (const player of this.players.values()) {
      counts[player.team] = (counts[player.team] ?? 0) + 1;
    }
    return counts;
  }

  humanCount(): number {
    let count = 0;
    for (const player of this.players.values()) if (!player.isBot) count += 1;
    return count;
  }

  // ------------------------------------------------------------------------
  // Input intake
  // ------------------------------------------------------------------------

  /**
   * Accept client input intent.
   *
   * Returns the number of frames accepted. Rejections are counted per player so
   * the room can rate-limit or disconnect a client that is producing garbage,
   * instead of letting it burn tick budget forever.
   */
  queueInput(playerId: string, frames: readonly InputFrame[]): number {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return 0;

    let accepted = 0;
    for (const raw of frames) {
      // Sequence numbers must strictly increase: replays and reordered
      // duplicates are dropped rather than re-simulated (PRD §34.2).
      if (raw.seq <= player.lastAckedSeq) {
        player.rejectedInputs += 1;
        continue;
      }
      const lastPending = player.pendingInputs[player.pendingInputs.length - 1];
      if (lastPending && raw.seq <= lastPending.seq) {
        player.rejectedInputs += 1;
        continue;
      }
      player.pendingInputs.push(sanitizeInputFrame(raw));
      accepted += 1;
    }

    // Bound the buffer: a client that stops consuming ticks cannot make the
    // server hold unbounded memory (PRD §30.4).
    while (player.pendingInputs.length > MAX_BUFFERED_INPUTS) {
      player.pendingInputs.shift();
    }

    return accepted;
  }

  setLatency(playerId: string, latencyMs: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.latencyMs = Math.min(Math.max(latencyMs, 0), MAX_REWIND_MS * 4);
  }

  // ------------------------------------------------------------------------
  // Tick
  // ------------------------------------------------------------------------

  /** Advance the match one fixed tick. Returns the events produced. */
  step(): SimEvent[] {
    this.events = [];

    if (this.phase === "ended") return this.events;

    this.tick += 1;
    this.elapsedMs += TICK_MS;

    if (this.emitStartNextStep) {
      this.emitStartNextStep = false;
      this.events.push({ type: "match_start", atMs: 0 });
    }

    if (this.phase === "warmup") {
      if (
        this.elapsedMs >= this.rules.warmupMs &&
        this.humanCount() >= this.rules.minHumansToStart
      ) {
        this.startNow();
        this.events.push({ type: "match_start", atMs: 0 });
        this.emitStartNextStep = false;
      }
    }

    for (const player of this.players.values()) {
      this.stepPlayer(player);
    }

    // Record history AFTER movement so a rewind lands on the position the
    // player actually occupied at the end of that tick.
    for (const player of this.players.values()) {
      player.history.record({
        tick: this.tick,
        position: player.movement.position,
        crouching: player.movement.crouching,
        alive: player.alive,
      });
    }

    // After movement and history: a grenade detonating this tick should test
    // against where players actually ended up, not where they started.
    this.stepGrenades();
    this.stepRockets();

    this.fallBackFromDryWeapons();
    // Burns bill before regeneration, so a fighter on fire cannot heal
    // through it on the same tick that it hurts them.
    this.tickStatusEffects(TICK_MS);
    this.regenerateAll();
    this.stepPickups();

    if (this.phase === "live") {
      const outcome = evaluateMatchOutcome(this.scores, this.elapsedMs, this.rules);
      if (outcome.ended) {
        this.phase = "ended";
        this.winningTeam = outcome.winningTeam;
        this.terminationReason = outcome.reason;
        this.events.push({
          type: "match_end",
          reason: outcome.reason,
          winningTeam: outcome.winningTeam,
          scores: { ...this.scores },
          durationMs: this.elapsedMs,
        });
      }
    }

    this.pruneRecentDeaths();
    return this.events;
  }

  private stepPlayer(player: SimPlayer): void {
    if (!player.alive) {
      if (this.elapsedMs >= player.respawnAtMs) this.respawn(player, false);
      return;
    }

    let budget = DT_BUDGET_PER_TICK_MS;

    while (player.pendingInputs.length > 0) {
      const frame = player.pendingInputs[0];
      if (!frame) break;
      if (frame.dtMs > budget) break;

      player.pendingInputs.shift();
      budget -= frame.dtMs;
      player.lastAckedSeq = frame.seq;

      player.movement = stepMovement(player.movement, frame, this.map);

      if (isBelowKillPlane(player.movement.position, this.map)) {
        this.killPlayer(player, null, null, false);
        return;
      }

      this.processWeaponIntent(player, frame);

      if (!player.alive) return;
    }

    // Nothing to simulate (e.g. a bot with no queued input, or a stalled
    // client): still apply gravity so a player cannot hover by not sending.
    if (budget === DT_BUDGET_PER_TICK_MS) {
      const idle: InputFrame = {
        seq: player.lastAckedSeq,
        dtMs: TICK_MS,
        moveX: 0,
        moveZ: 0,
        yaw: player.movement.yaw,
        pitch: player.movement.pitch,
        buttons: player.movement.crouching ? BUTTON.CROUCH : 0,
        clientTimeMs: this.elapsedMs,
      };
      player.movement = stepMovement(player.movement, idle, this.map);
      if (isBelowKillPlane(player.movement.position, this.map)) {
        this.killPlayer(player, null, null, false);
        return;
      }
    }

    const intent = player.pendingWeaponIntent;
    if (intent) {
      player.weaponIntentFresh = false;
      player.movement.yaw = intent.yaw;
      player.movement.pitch = intent.pitch;
      this.processWeaponIntent(player, intent);
    }
  }

  // ------------------------------------------------------------------------
  // Weapons
  // ------------------------------------------------------------------------

  /**
   * Weapon intent for a player whose movement is driven outside the input
   * queue.
   *
   * The single-player sandbox runs `stepMovement` on the client and writes
   * the result straight into the player, so it never queues frames; without
   * this it had to fake the trigger with its own damage table. Routing the
   * pull through here gives it the same cadence, magazine, reload and hit
   * resolution a match enforces, and the same `shot` event to draw from.
   */
  applyWeaponIntent(playerId: string, frame: InputFrame): void {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;
    const clean = sanitizeInputFrame(frame);
    // Resolved on the ticks that follow, where every other intent is
    // resolved and where the events it produces are actually returned. The
    // intent stands until the next call replaces it, so a held trigger keeps
    // firing at the weapon's cadence however few frames the client renders
    // per tick. A press shorter than a frame still counts: an unconsumed
    // fire bit survives the merge.
    const unconsumed = player.weaponIntentFresh ? player.pendingWeaponIntent : null;
    const held = unconsumed?.buttons ?? 0;
    player.pendingWeaponIntent = { ...clean, buttons: clean.buttons | (held & BUTTON.FIRE) };
    player.weaponIntentFresh = true;
  }

  private processWeaponIntent(player: SimPlayer, frame: InputFrame): void {
    const wantsFire = hasButton(frame.buttons, BUTTON.FIRE);
    if (!wantsFire) {
      player.triggerHeld = false;
      return;
    }

    const wasHeld = player.triggerHeld;
    player.triggerHeld = true;

    if (this.phase !== "live") return;
    if (this.elapsedMs < player.reloadingUntilMs) return;
    if (this.elapsedMs < player.nextFireAtMs) return;

    const ammo = player.ammo[player.weaponSlot];
    const weaponId = player.weapons[player.weaponSlot];
    if (!ammo || !weaponId) return;

    if (ammo.magazine <= 0) {
      this.beginReload(player);
      return;
    }

    const spec = getWeapon(weaponId);
    // Every weapon in V1 is automatic-capable except the coil rifle, which is
    // campaign-only; `wasHeld` is kept so a future semi-auto weapon has a hook.
    void wasHeld;

    ammo.magazine -= 1;
    player.nextFireAtMs = this.elapsedMs + fireIntervalMs(spec);

    // A launcher puts a projectile in the air; everything else traces. The
    // branch is on the spec, not on the weapon id, so a second launcher needs
    // no change here.
    if (isProjectileWeapon(spec)) this.launchRocket(player, spec, frame);
    else this.resolveShot(player, spec.id, frame);
  }

  private beginReload(player: SimPlayer): void {
    const ammo = player.ammo[player.weaponSlot];
    const weaponId = player.weapons[player.weaponSlot];
    if (!ammo || !weaponId) return;
    if (ammo.reserve <= 0) return;
    if (this.elapsedMs < player.reloadingUntilMs) return;

    const spec = getWeapon(weaponId);
    if (ammo.magazine >= spec.magazineSize) return;

    const duration = ammo.magazine === 0 ? spec.emptyReloadMs : spec.reloadMs;
    player.reloadingUntilMs = this.elapsedMs + duration;

    const needed = spec.magazineSize - ammo.magazine;
    const loaded = Math.min(needed, ammo.reserve);
    ammo.magazine += loaded;
    ammo.reserve -= loaded;
  }

  /** Client intent to reload. Validated exactly like any other intent. */
  /**
   * Throw a grenade from a player's authoritative eye position.
   *
   * The client asks; it does not say from where, in which direction, or with
   * how many left. All three come from server state, so a tampered client can
   * neither throw from somewhere it is not standing nor conjure a third
   * grenade (PRD §18.3).
   */
  throwGrenade(playerId: string): SimGrenade | null {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return null;
    if (player.grenades <= 0) return null;
    if (this.elapsedMs < player.nextGrenadeAtMs) return null;

    player.grenades -= 1;
    player.nextGrenadeAtMs = this.elapsedMs + GRENADE_SPEC.cooldownMs;

    const eye = {
      x: player.movement.position.x,
      y:
        player.movement.position.y +
        (player.movement.crouching ? EYE_HEIGHT_CROUCHED : EYE_HEIGHT_STANDING),
      z: player.movement.position.z,
    };
    const aim = directionFromAngles(player.movement.yaw, player.movement.pitch);

    // Start slightly ahead of the eye. Spawning exactly on it puts the grenade
    // inside the thrower's own capsule, where the very first substep registers
    // a wall and it bounces straight back into their feet.
    const origin = add(eye, scale(aim, 0.45));

    const grenade: SimGrenade = {
      id: `${this.matchId}:g${(this.nextGrenadeSeq += 1)}`,
      ownerId: player.id,
      ownerTeam: player.team,
      position: origin,
      velocity: add(scale(aim, GRENADE_SPEC.throwSpeed), {
        x: 0,
        y: GRENADE_SPEC.throwLift,
        z: 0,
      }),
      fuseRemainingMs: GRENADE_SPEC.fuseMs,
      bounces: 0,
      resting: false,
    };
    // Inherit half the thrower's motion, so a grenade thrown while sprinting
    // does not appear to be dropped behind them.
    grenade.velocity = add(grenade.velocity, scale(player.movement.velocity, 0.5));

    this.grenades.set(grenade.id, grenade);
    this.events.push({
      type: "grenade_thrown",
      grenadeId: grenade.id,
      ownerId: player.id,
      team: player.team,
      position: { ...grenade.position },
      velocity: { ...grenade.velocity },
      fuseMs: GRENADE_SPEC.fuseMs,
      tick: this.tick,
    });
    return grenade;
  }

  /** Advance every grenade in flight and detonate the ones whose fuse ran out. */
  private stepGrenades(): void {
    for (const grenade of [...this.grenades.values()]) {
      stepGrenade(grenade, TICK_MS, this.map);
      if (!grenadeShouldDetonate(grenade)) continue;
      this.grenades.delete(grenade.id);
      this.detonate(grenade);
    }
  }

  /**
   * Put a rocket in the air from the player's authoritative eye position.
   *
   * Same rule as `throwGrenade`: the client asked to fire, and that is all it
   * contributed. Origin, direction and ammunition all come from server state.
   */
  private launchRocket(player: SimPlayer, spec: WeaponSpec, frame: InputFrame): void {
    const eye: Vec3 = {
      x: player.movement.position.x,
      y:
        player.movement.position.y +
        (player.movement.crouching ? EYE_HEIGHT_CROUCHED : EYE_HEIGHT_STANDING),
      z: player.movement.position.z,
    };
    const aim = directionFromAngles(frame.yaw, frame.pitch);

    const rocket: SimRocket = {
      id: `${this.matchId}:r${(this.nextRocketSeq += 1)}`,
      ownerId: player.id,
      ownerTeam: player.team,
      weaponId: spec.id,
      // Start a little down the bore. Spawning on the eye puts the rocket
      // inside the firer's own capsule on the first substep.
      position: add(eye, scale(aim, 0.6)),
      velocity: rocketLaunchVelocity(spec, aim),
      travelledM: 0,
      detonated: false,
      impact: null,
    };

    this.rockets.set(rocket.id, rocket);
    this.events.push({
      type: "rocket_fired",
      rocketId: rocket.id,
      ownerId: player.id,
      team: player.team,
      weaponId: spec.id,
      position: { ...rocket.position },
      velocity: { ...rocket.velocity },
      tick: this.tick,
    });
  }

  /** Advance every rocket and detonate the ones that hit something. */
  private stepRockets(): void {
    if (this.rockets.size === 0) return;

    const targets: RocketTarget[] = [...this.players.values()].map((player) => ({
      id: player.id,
      team: player.team,
      center: {
        x: player.movement.position.x,
        y: player.movement.position.y + playerHeight(player.movement.crouching) * 0.5,
        z: player.movement.position.z,
      },
      alive: player.alive,
    }));

    for (const rocket of [...this.rockets.values()]) {
      stepRocket(rocket, TICK_MS, this.map, targets);
      if (!rocket.detonated) continue;
      this.rockets.delete(rocket.id);
      this.detonateRocket(rocket);
    }
  }

  private detonateRocket(rocket: SimRocket): void {
    const spec = getWeapon(rocket.weaponId);
    const blast = spec.blast;
    if (!blast) return;

    const center = rocket.impact?.point ?? rocket.position;
    const owner = this.players.get(rocket.ownerId) ?? null;
    const applied: { playerId: string; damage: number }[] = [];

    // A direct hit lands before the blast and stacks with it, so a contact
    // shot kills and a near miss does not.
    const direct = new Map<string, number>();
    if (rocket.impact?.directHitId) direct.set(rocket.impact.directHitId, spec.damage);

    const victims = resolveBlast(
      center,
      rocket.ownerId,
      rocket.ownerTeam,
      this.blastCandidates(),
      this.map,
      blast,
    );

    const total = new Map<string, number>(direct);
    for (const victim of victims) {
      total.set(victim.playerId, (total.get(victim.playerId) ?? 0) + victim.damage);
    }

    for (const [playerId, raw] of total) {
      const player = this.players.get(playerId);
      if (!player || !player.alive) continue;
      if (this.isInvulnerable(player)) continue;

      const dealt = this.scaleIncoming(player, raw);
      const result = applyDamage(
        { health: player.health, armor: player.armor },
        dealt,
        player.maxHealth,
      );
      player.health = result.vitals.health;
      player.armor = result.vitals.armor;
      player.lastDamagedAtMs = this.elapsedMs;
      applied.push({ playerId: player.id, damage: dealt });

      if (owner && owner.id !== player.id) {
        player.recentDamage.set(owner.id, {
          amount: (player.recentDamage.get(owner.id)?.amount ?? 0) + raw,
          atMs: this.elapsedMs,
        });
      }

      this.events.push({
        type: "hit",
        attackerId: rocket.ownerId,
        victimId: player.id,
        damage: dealt,
        armorAbsorbed: result.armorAbsorbed,
        headshot: false,
        tick: this.tick,
      });

      if (result.killed) this.killPlayer(player, owner, rocket.weaponId, false);
    }

    this.events.push({
      type: "rocket_exploded",
      rocketId: rocket.id,
      ownerId: rocket.ownerId,
      position: { ...center },
      directHitId: rocket.impact?.directHitId ?? null,
      victims: applied,
      tick: this.tick,
    });
  }

  /** Everyone a blast could reach, at chest height. */
  private blastCandidates(): BlastCandidate[] {
    return [...this.players.values()].map((player) => ({
      id: player.id,
      team: player.team,
      center: {
        x: player.movement.position.x,
        y: player.movement.position.y + playerHeight(player.movement.crouching) * 0.5,
        z: player.movement.position.z,
      },
      alive: player.alive,
    }));
  }

  private detonate(grenade: SimGrenade): void {
    // Chest height. Measuring to the feet would let a blast at head height on
    // a catwalk miss the person standing in it.
    const candidates = this.blastCandidates();

    const victims = resolveBlast(
      grenade.position,
      grenade.ownerId,
      grenade.ownerTeam,
      candidates,
      this.map,
    );

    const owner = this.players.get(grenade.ownerId) ?? null;
    const applied: { playerId: string; damage: number }[] = [];

    for (const victim of victims) {
      const player = this.players.get(victim.playerId);
      if (!player || !player.alive) continue;
      // Spawn protection holds against explosions too, or a grenade lobbed at
      // a spawn exit beats the rule that protects it.
      if (this.isInvulnerable(player)) continue;

      const dealt = this.scaleIncoming(player, victim.damage);
      const result = applyDamage(
        { health: player.health, armor: player.armor },
        dealt,
        player.maxHealth,
      );
      player.health = result.vitals.health;
      player.armor = result.vitals.armor;
      player.lastDamagedAtMs = this.elapsedMs;
      applied.push({ playerId: player.id, damage: dealt });

      if (owner && owner.id !== player.id) {
        player.recentDamage.set(owner.id, {
          amount: (player.recentDamage.get(owner.id)?.amount ?? 0) + victim.damage,
          atMs: this.elapsedMs,
        });
      }

      this.events.push({
        type: "hit",
        attackerId: grenade.ownerId,
        victimId: player.id,
        damage: dealt,
        armorAbsorbed: result.armorAbsorbed,
        headshot: false,
        tick: this.tick,
      });

      if (result.killed) {
        // A grenade kill is credited to the thrower, including their own.
        this.killPlayer(player, owner, null, false);
      }
    }

    this.events.push({
      type: "grenade_exploded",
      grenadeId: grenade.id,
      ownerId: grenade.ownerId,
      position: { ...grenade.position },
      victims: applied,
      tick: this.tick,
    });
  }

  requestReload(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;
    this.beginReload(player);
  }

  requestWeaponSwitch(playerId: string, slot: number): void {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;
    if (!Number.isInteger(slot) || slot < 0 || slot >= player.weapons.length) return;
    if (slot === player.weaponSlot) return;
    player.weaponSlot = slot;
    // Switching cancels a reload and costs a short ready time.
    player.reloadingUntilMs = 0;
    player.nextFireAtMs = Math.max(player.nextFireAtMs, this.elapsedMs + 350);
  }

  private resolveShot(player: SimPlayer, weaponId: WeaponId, frame: InputFrame): void {
    const spec = getWeapon(weaponId);

    // Origin comes from the SERVER's authoritative position, never from the
    // client. Direction comes from the sanitised view angles.
    const origin: Vec3 = {
      x: player.movement.position.x,
      y:
        player.movement.position.y +
        (player.movement.crouching ? EYE_HEIGHT_CROUCHED : EYE_HEIGHT_STANDING),
      z: player.movement.position.z,
    };
    const direction = directionFromAngles(frame.yaw, frame.pitch);

    const rewind = rewindTicks(player.latencyMs);
    const targetTick = this.tick - rewind;

    const candidates: HitCandidate[] = [];
    for (const other of this.players.values()) {
      if (other.id === player.id) continue;
      const snapshot =
        rewind > 0
          ? other.history.at(targetTick)
          : {
              tick: this.tick,
              position: other.movement.position,
              crouching: other.movement.crouching,
              alive: other.alive,
            };
      if (!snapshot) continue;
      candidates.push({ id: other.id, team: other.team, snapshot });
    }

    const pellets = spec.pellets;
    let totalDamage = 0;
    let victimId: string | null = null;
    let headshot = false;
    let distanceM = 0;

    // Spread weapons trace each pellet along a deterministic cone offset so the
    // result does not depend on a random source the client could desync from.
    for (let i = 0; i < pellets; i += 1) {
      const traced =
        pellets === 1 ? direction : conePellet(direction, spec.spreadRadians, i, pellets);
      const hit = resolveHitscan({
        origin,
        direction: traced,
        maxDistance: spec.maxRangeM,
        map: this.map,
        candidates,
        shooterTeam: player.team,
        shooterId: player.id,
      });
      if (!hit) continue;
      // Only the first victim per trigger pull is credited, which keeps the
      // shotgun from splitting damage across a crowd in confusing ways.
      if (victimId === null) {
        victimId = hit.victimId;
        distanceM = hit.distance;
      } else if (hit.victimId !== victimId) {
        continue;
      }
      headshot = headshot || hit.headshot;
      totalDamage += computeShotDamage({
        spec,
        distanceM: hit.distance,
        headshot: hit.headshot,
        pelletsHit: 1,
      });
    }

    // The shot itself, before whatever it did: a client draws the flash and
    // tracer from this, then the hit on top.
    this.events.push({
      type: "shot",
      playerId: player.id,
      weaponId: spec.id,
      origin,
      direction,
      victimId,
      distance: victimId === null ? null : distanceM,
      tick: this.tick,
    });

    if (victimId === null || totalDamage <= 0) return;

    const victim = this.players.get(victimId);
    if (!victim || !victim.alive) return;
    if (this.isInvulnerable(victim)) return;

    const dealt = this.scaleIncoming(victim, totalDamage);
    const result = applyDamage(
      { health: victim.health, armor: victim.armor },
      dealt,
      victim.maxHealth,
    );
    victim.health = result.vitals.health;
    victim.armor = result.vitals.armor;

    // What the weapon leaves behind. Asked of the spec, never of the id, so a
    // third burning thing needs no branch here (see `projectileSpeedMps`).
    if (spec.status) {
      victim.statuses = applyStatus(victim.statuses, spec.status, this.elapsedMs);
      if (spec.chain) this.chainStatus(victim, spec, player.team);
    }

    victim.lastDamagedAtMs = this.elapsedMs;
    victim.recentDamage.set(player.id, {
      amount: (victim.recentDamage.get(player.id)?.amount ?? 0) + totalDamage,
      atMs: this.elapsedMs,
    });

    this.events.push({
      type: "hit",
      attackerId: player.id,
      victimId: victim.id,
      damage: dealt,
      armorAbsorbed: result.armorAbsorbed,
      headshot,
      tick: this.tick,
    });

    if (result.killed) {
      this.killPlayer(victim, player, spec.id, headshot);
    }
  }

  // ------------------------------------------------------------------------
  // Death, scoring, respawn
  // ------------------------------------------------------------------------

  private killPlayer(
    victim: SimPlayer,
    attacker: SimPlayer | null,
    weaponId: WeaponId | null,
    headshot: boolean,
  ): void {
    if (!victim.alive) return;

    victim.alive = false;
    victim.health = 0;
    victim.deaths += 1;
    victim.respawnAtMs = this.elapsedMs + this.rules.respawnDelayMs;
    victim.pendingInputs.length = 0;
    victim.pendingWeaponIntent = null;
    victim.weaponIntentFresh = false;
    victim.triggerHeld = false;

    this.recentDeaths.push({ position: { ...victim.movement.position }, atMs: this.elapsedMs });

    this.dropWeapons(victim, attacker);

    if (attacker && attacker.id !== victim.id) {
      if (attacker.team === victim.team) {
        // Team kills are a penalty, never a score (PRD §13.3).
        attacker.score += this.rules.pointsPerTeamKill;
      } else {
        attacker.kills += 1;
        attacker.score += this.rules.pointsPerKill;
        this.scores[attacker.team] = (this.scores[attacker.team] ?? 0) + 1;
        this.creditAssists(victim, attacker.id);
      }
    }

    this.events.push({
      type: "kill",
      attackerId: attacker?.id ?? null,
      victimId: victim.id,
      weaponId,
      headshot,
      respawnAtMs: victim.respawnAtMs,
    });
  }

  private creditAssists(victim: SimPlayer, killerId: string): void {
    for (const [contributorId, record] of victim.recentDamage) {
      if (contributorId === killerId) continue;
      if (this.elapsedMs - record.atMs > this.rules.assistWindowMs) continue;
      if (record.amount < 100 * this.rules.assistDamageFraction) continue;
      const contributor = this.players.get(contributorId);
      if (!contributor || contributor.team === victim.team) continue;
      contributor.assists += 1;
      contributor.score += this.rules.pointsPerAssist;
    }
    victim.recentDamage.clear();
  }

  private respawn(player: SimPlayer, initial: boolean): void {
    const spawn = selectSpawn({
      map: this.map,
      team: player.team,
      occupants: [...this.players.values()]
        .filter((p) => p.id !== player.id)
        .map((p) => ({ position: p.movement.position, team: p.team, alive: p.alive })),
      recentDeaths: this.recentDeaths,
      nowMs: this.elapsedMs,
    });

    player.movement = createMovementState(spawn.position, spawn.yaw);
    // Stamina built up in a life is kept: dying costs the fight, not the
    // packs collected getting there.
    player.health = player.maxHealth;
    player.armor = 50;
    player.alive = true;
    player.respawnAtMs = 0;
    player.spawnProtectedUntilMs = this.elapsedMs + this.rules.spawnProtectionMs;
    // God Mode does not survive dying. Carrying it through a respawn would
    // turn one lucky pickup into a permanent advantage across a life.
    player.godModeUntilMs = 0;
    // Fire does not follow you through a respawn.
    player.statuses = [];
    player.reloadingUntilMs = 0;
    player.nextFireAtMs = 0;
    // Grenades come back with a life, never during one — a resupply mid-fight
    // turns the throwable into a second primary.
    player.grenades = GRENADE_SPEC.carried;
    player.nextGrenadeAtMs = 0;
    player.recentDamage.clear();
    player.lastDamagedAtMs = -Infinity;
    player.history.clear();
    player.ammo = player.weapons.map((id) => {
      const spec = getWeapon(id);
      return { magazine: spec.magazineSize, reserve: spec.reserveAmmo };
    });

    if (!initial) {
      this.events.push({
        type: "respawn",
        playerId: player.id,
        position: { ...spawn.position },
        yaw: spawn.yaw,
        tick: this.tick,
      });
    }
  }

  // ------------------------------------------------------------------------
  // Vitals
  // ------------------------------------------------------------------------

  /** Damage as a human actually takes it; bots always take it in full. */
  private scaleIncoming(victim: SimPlayer, damage: number): number {
    return victim.isBot ? damage : damage * this.humanIncomingDamage;
  }

  /**
   * Passive regeneration up to the stabilisation ceiling (PRD §12.4).
   *
   * Only after a pause in incoming damage, and never past `REGEN_CEILING`:
   * getting back to full is what health packs are for.
   */
  private regenerateAll(): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      if (this.elapsedMs - player.lastDamagedAtMs < REGEN_DELAY_MS) continue;
      player.health = regenerate({ health: player.health, armor: player.armor }, TICK_MS).health;
    }
  }

  // ------------------------------------------------------------------------
  // Pickups
  // ------------------------------------------------------------------------

  private stepPickups(): void {
    const rules = this.pickupRules;
    if (!rules) return;

    // Health packs come back on their own clock.
    rules.healthSpawns.forEach((position, index) => {
      const dueAt = this.healthSpawnDueAtMs[index];
      if (dueAt === null || dueAt === undefined || this.elapsedMs < dueAt) return;
      this.healthSpawnDueAtMs[index] = null;
      this.placePickup({
        kind: PICKUP_KIND.HEALTH,
        position: { ...position },
        heal: rules.healAmount,
        weaponId: null,
        magazine: 0,
        reserve: 0,
        expiresAtMs: null,
        spawnIndex: index,
      });
    });

    // God Mode: one on the field at a time, at a random one of its spawns,
    // on a jittered clock so it can never be camped.
    if (
      this.godSpawnDueAtMs !== null &&
      this.elapsedMs >= this.godSpawnDueAtMs &&
      rules.godSpawns.length > 0
    ) {
      this.godSpawnDueAtMs = null;
      // Deterministic, like `conePellet`: this simulation carries no RNG on
      // purpose, because the server has to be reproducible for replay and
      // there is no shared seed to desync against. A golden-ratio sequence
      // gives an interval and a location that vary without being random, so
      // the pickup is still not campable on a stopwatch.
      const at = rules.godSpawns[this.godCycle % rules.godSpawns.length];
      if (at) {
        this.placePickup({
          kind: PICKUP_KIND.GOD_MODE,
          position: { ...at },
          heal: 0,
          weaponId: null,
          magazine: 0,
          reserve: 0,
          expiresAtMs: null,
          spawnIndex: null,
        });
      }
    }

    // Drops nobody wanted are swept up.
    for (const pickup of this.pickups.values()) {
      if (pickup.expiresAtMs !== null && this.elapsedMs >= pickup.expiresAtMs) {
        this.pickups.delete(pickup.id);
        this.events.push({ type: "pickup_removed", pickupId: pickup.id });
      }
    }

    for (const player of this.players.values()) {
      if (!player.alive) continue;
      for (const pickup of this.pickups.values()) {
        // Bots take health but leave weapons: a bot's silhouette is its
        // weapon, and swapping it mid-match would make the sides unreadable.
        if (pickup.kind === PICKUP_KIND.WEAPON && player.isBot) continue;
        if (
          !withinPickupReach(
            player.movement.position,
            player.movement.crouching,
            pickup.position,
            rules.pickupRadiusM,
          )
        ) {
          continue;
        }
        const outcome = applyPickup(player, pickup, rules);
        if (!outcome) continue;

        if (outcome.kind === "weapon" && outcome.added) {
          // Put a better weapon in your hands rather than in your pocket.
          // Finding a launcher and having to remember a slot key for it is
          // the kind of friction that makes a reward feel like paperwork.
          const inHand = player.weapons[player.weaponSlot];
          if (!inHand || isUpgradeOver(outcome.weaponId, inHand)) {
            player.weaponSlot = outcome.slot;
            player.reloadingUntilMs = 0;
          }
        }

        if (outcome.kind === "god_mode") {
          // Extend, never stack, and never past the full duration: two taken
          // back to back must not chain into a minute of invulnerability.
          const from = Math.max(this.elapsedMs, player.godModeUntilMs);
          player.godModeUntilMs = Math.min(
            from + outcome.durationMs,
            this.elapsedMs + rules.godDurationMs,
          );
          this.godCycle += 1;
          this.godSpawnDueAtMs =
            this.elapsedMs +
            rules.godRespawnMs +
            goldenFraction(this.godCycle) * rules.godRespawnJitterMs;
        }

        this.pickups.delete(pickup.id);
        if (pickup.spawnIndex !== null) {
          this.healthSpawnDueAtMs[pickup.spawnIndex] = this.elapsedMs + rules.healthRespawnMs;
        }
        this.events.push({
          type: "pickup_taken",
          pickupId: pickup.id,
          playerId: player.id,
          kind: pickup.kind,
          weaponId: pickup.weaponId,
          healed: outcome.kind === "health" ? outcome.healed : 0,
          staminaGained: outcome.kind === "health" ? outcome.staminaGained : 0,
          stamina: player.maxHealth,
          ammoAdded: outcome.kind === "weapon" ? outcome.ammoAdded : 0,
          slot: outcome.kind === "weapon" ? outcome.slot : -1,
          added: outcome.kind === "weapon" ? outcome.added : false,
        });
      }
    }
  }

  /**
   * What a dead fighter leaves on the ground: the weapon in their hands, with
   * whatever rounds it had — and only when a human made the kill.
   *
   * Only the one in hand. Dropping the whole kit read well on paper and
   * littered the yard in practice — seven bots dying every twenty seconds
   * left forty weapons floating in the lanes. Dropping on every kill did
   * the same at half the rate: bots kill each other constantly, and a
   * player walking into a lane full of guns they never fought for read it
   * as a bug. A drop is the reward for a kill, so it needs a killer who can
   * collect it.
   */
  /**
   * Whether a fighter can be hurt right now.
   *
   * One predicate rather than a condition repeated at each damage site: there
   * are three of them, and a fourth added later that forgot God Mode would be
   * a bug nobody sees until a player dies while invulnerable.
   */
  private isInvulnerable(player: SimPlayer): boolean {
    return this.elapsedMs < player.spawnProtectedUntilMs || this.elapsedMs < player.godModeUntilMs;
  }

  /**
   * Jump the discharge to nearby fighters.
   *
   * Only the status carries, never the direct damage: an arc that dealt its
   * full hit to three people at once would out-damage the rifle at close
   * range, and the weapon is meant to take aim away rather than to kill.
   * Teammates are skipped — chaining onto your own squad turns a support
   * weapon into a grief tool.
   */
  private chainStatus(from: SimPlayer, spec: WeaponSpec, team: number): void {
    const chain = spec.chain;
    const status = spec.status;
    if (!chain || !status) return;

    const candidates = [...this.players.values()]
      .filter((p) => p.alive && p.id !== from.id && p.team !== team && !this.isInvulnerable(p))
      .map((p) => ({ p, d: distance(p.movement.position, from.movement.position) }))
      .filter((e) => e.d <= chain.radiusM)
      .sort((a, b) => a.d - b.d)
      .slice(0, chain.targets);

    for (const { p } of candidates) {
      p.statuses = applyStatus(p.statuses, status, this.elapsedMs);
      this.events.push({ type: "status", playerId: p.id, kind: status.kind });
    }
  }

  /**
   * Bill every running effect for this tick.
   *
   * Burn damage is credited to nobody: it has no bearing, no headshot and no
   * killer to reward, and routing it through the shot pipeline would put fire
   * in the kill feed as though someone had shot them.
   */
  private tickStatusEffects(deltaMs: number): void {
    for (const player of this.players.values()) {
      if (player.statuses.length === 0) continue;
      if (!player.alive) {
        player.statuses = [];
        continue;
      }

      const tick = tickStatuses(player.statuses, this.elapsedMs, deltaMs);
      player.statuses = tick.active;
      if (tick.damage <= 0) continue;
      if (this.isInvulnerable(player)) continue;

      const before = player.health;
      const result = applyDamage(
        { health: player.health, armor: player.armor },
        this.scaleIncoming(player, tick.damage),
        player.maxHealth,
      );
      player.health = result.vitals.health;
      player.armor = result.vitals.armor;
      if (player.health <= 0 && before > 0) this.killPlayer(player, null, null, false);
    }
  }

  /**
   * Come off a weapon that has nothing left, onto the best one that has.
   *
   * The other half of switching to a pickup automatically: a launcher you
   * were handed is worth holding until the tube is empty, and then it is
   * worth nothing at all. Leaving the player standing there dry-firing it is
   * the same friction in the other direction.
   *
   * Reload is checked first, so this never pulls a weapon out of someone's
   * hands while they are in the middle of feeding it.
   */
  private fallBackFromDryWeapons(): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      if (this.elapsedMs < player.reloadingUntilMs) continue;

      const held = player.ammo[player.weaponSlot];
      if (!held || held.magazine + held.reserve > 0) continue;

      let best = -1;
      let bestTier = -1;
      player.weapons.forEach((id, slot) => {
        const ammo = player.ammo[slot];
        if (!ammo || ammo.magazine + ammo.reserve <= 0) return;
        const tier = getWeapon(id).tier;
        if (tier > bestTier) {
          bestTier = tier;
          best = slot;
        }
      });

      if (best >= 0 && best !== player.weaponSlot) player.weaponSlot = best;
    }
  }

  private dropWeapons(victim: SimPlayer, attacker: SimPlayer | null): void {
    const rules = this.pickupRules;
    if (!rules || !rules.dropWeapons) return;
    if (!attacker || attacker.isBot || attacker.id === victim.id) return;

    const weaponId = victim.weapons[victim.weaponSlot];
    const ammo = victim.ammo[victim.weaponSlot];
    if (!weaponId || !ammo || ammo.magazine + ammo.reserve <= 0) return;
    this.placePickup({
      kind: PICKUP_KIND.WEAPON,
      position: { ...victim.movement.position },
      heal: 0,
      weaponId,
      magazine: ammo.magazine,
      reserve: ammo.reserve,
      expiresAtMs: this.elapsedMs + rules.dropExpiresMs,
      spawnIndex: null,
    });
  }

  private placePickup(pickup: Omit<SimPickup, "id">): void {
    this.nextPickupSeq += 1;
    const placed: SimPickup = { ...pickup, id: `pickup-${this.nextPickupSeq}` };
    this.pickups.set(placed.id, placed);
    this.events.push({
      type: "pickup_spawned",
      pickupId: placed.id,
      kind: placed.kind,
      position: { ...placed.position },
      weaponId: placed.weaponId,
    });
  }

  private pruneRecentDeaths(): void {
    const cutoff = this.elapsedMs - 30_000;
    while (this.recentDeaths.length > 0 && (this.recentDeaths[0]?.atMs ?? 0) < cutoff) {
      this.recentDeaths.shift();
    }
    // Hard cap as well, so a very long match cannot grow this array.
    while (this.recentDeaths.length > 64) this.recentDeaths.shift();
  }

  /**
   * Skip the remainder of warmup and go live.
   *
   * Used by private matches, where the room owner starts on demand rather than
   * waiting for a matchmaking population, and by the test and load-test
   * harnesses. Public quick-match rooms still go through the normal warmup gate.
   */
  startNow(): void {
    if (this.phase !== "warmup") return;
    this.phase = "live";
    this.elapsedMs = 0;
    this.emitStartNextStep = true;
  }

  /** Force the match to end, e.g. because the shard is draining (PRD §18.8). */
  abort(): void {
    this.phase = "ended";
    this.terminationReason = null;
  }

  timeRemainingMs(): number {
    if (this.phase !== "live") return this.rules.durationMs;
    return Math.max(0, this.rules.durationMs - this.elapsedMs);
  }
}

/**
 * A low-discrepancy fraction in [0, 1) from a counter.
 *
 * Successive values spread evenly rather than clustering, so a schedule built
 * on it looks irregular without any RNG — the same reason `conePellet` uses a
 * golden-angle spiral instead of random spread.
 */
function goldenFraction(n: number): number {
  return (n * 0.6180339887498949) % 1;
}

/**
 * Deterministic pellet direction for spread weapons.
 *
 * A golden-angle spiral rather than RNG: the server must be reproducible for
 * replay-based investigation, and there is no shared random seed to desync.
 */
function conePellet(direction: Vec3, spread: number, index: number, total: number): Vec3 {
  if (index === 0) return direction;

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const radius = spread * Math.sqrt(index / total);
  const theta = index * goldenAngle;

  // Build an orthonormal basis around the aim direction.
  const up: Vec3 = Math.abs(direction.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const right = normalizeVec(crossVec(direction, up));
  const realUp = crossVec(right, direction);

  const offsetX = Math.cos(theta) * radius;
  const offsetY = Math.sin(theta) * radius;

  return normalizeVec({
    x: direction.x + right.x * offsetX + realUp.x * offsetY,
    y: direction.y + right.y * offsetX + realUp.y * offsetY,
    z: direction.z + right.z * offsetX + realUp.z * offsetY,
  });
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalizeVec(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return len > 1e-9 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 0, z: 1 };
}
