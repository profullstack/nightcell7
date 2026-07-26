import { Vector3, type AnimationGroup, type Scene, type TransformNode } from "@babylonjs/core";
import {
  ARDAVAN_YARD,
  rayAabb,
  BotController,
  MatchSimulation,
  TEAM_IDS,
  TICK_MS,
  type SimEvent,
  type SimPlayer,
  type Vec3,
  spawnsForTeam,
} from "@nightcell7/multiplayer-sim";
import { placeAll, placeAnimated, type AssetSet } from "./assets";
import { brightenCharacter } from "./targets";

/**
 * Live opponents for the single-player sandbox.
 *
 * These are not scripted dummies. They run the real `MatchSimulation` from
 * `@nightcell7/multiplayer-sim` with the real `BotController`, which produces
 * `InputFrame`s and hands them to the same movement, fire-cadence, ammunition
 * and hitscan code the authoritative server runs. A bot here cannot do anything
 * a client could not, and its behaviour is the behaviour you will meet in a
 * match — that is the whole reason to reuse the simulation rather than write
 * "sandbox AI" that would immediately drift from it.
 *
 * The simulation is **local and presentational**. Nothing it decides is
 * reported anywhere, nothing is scored, and in a real match the server owns all
 * of it. The one deliberate cheat is the local player: rather than replaying
 * their input through the sim and getting a second, diverging body, their real
 * camera position is written straight into their sim player each tick. The
 * bots therefore chase where the player actually is.
 */

const BOT_COUNT = 5;

/** Speed above which the run cycle replaces the walk cycle, m/s. */
const RUN_SPEED = 5.2;
/** Below this the bot is treated as standing still. */
const IDLE_SPEED = 0.35;

/** How long a downed bot stays down before the sandbox puts it back. */
const RESPAWN_MS = 6000;

const LOCAL_ID = "local-player";

interface BotView {
  readonly id: string;
  readonly root: TransformNode;
  readonly clips: Map<string, AnimationGroup>;
  current: string;
  dead: boolean;
}

export interface BotShot {
  readonly from: Vec3;
  readonly to: Vec3;
}

export class Opponents {
  private readonly sim: MatchSimulation;
  private readonly controllers: BotController[] = [];
  private readonly views = new Map<string, BotView>();
  private accumulatorMs = 0;
  /** Shots fired by bots since the last drain, for the renderer to draw. */
  private readonly shots: BotShot[] = [];
  private readonly deadUntil = new Map<string, number>();

  constructor(scene: Scene, assets: AssetSet) {
    const character = assets.models.get("character");
    const carbine = assets.models.get("carbine");
    if (!character) throw new Error("character model not loaded");

    this.sim = new MatchSimulation({ matchId: "sandbox", map: ARDAVAN_YARD });

    // The player, so the bots have someone to fight.
    this.sim.addPlayer({
      id: LOCAL_ID,
      userId: LOCAL_ID,
      displayName: "You",
      preferredTeam: TEAM_IDS.NIGHTCELL,
    });

    for (let i = 0; i < BOT_COUNT; i += 1) {
      const id = `bot-${i}`;
      this.sim.addPlayer({
        id,
        userId: id,
        displayName: `Directorate ${i + 1}`,
        isBot: true,
        preferredTeam: TEAM_IDS.DIRECTORATE,
      });
      // Seeded per bot so a session is reproducible and they do not all make
      // the same decision on the same tick.
      this.controllers.push(new BotController(id, 1000 + i * 37));

      const placed = placeAnimated(character, id, {
        position: new Vector3(0, -50, 0), // parked until the sim spawns them
        rotationY: 0,
      });
      if (!placed) continue;
      brightenCharacter(placed.root);

      if (carbine) {
        const socket = placed.root
          .getDescendants()
          .find((node) => node.name.includes("SOCKET_WEAPON")) as TransformNode | undefined;
        const [weapon] = placeAll(carbine, `${id}_weapon`, [
          { position: new Vector3(0, 0, 0), rotationY: Math.PI },
        ]);
        if (weapon) weapon.parent = socket ?? placed.root;
      }

      this.views.set(id, { id, root: placed.root, clips: placed.clips, current: "", dead: false });
    }

    this.sim.startNow();
    void scene;
  }

  /**
   * The player shooting a bot.
   *
   * Damage goes through the simulation's own player state rather than a
   * parallel bookkeeping of my own, so a bot dies to the same health pool the
   * server would use. Respawn is handled here because this sandbox has no
   * match loop driving round state.
   */
  tryHit(origin: Vec3, direction: Vec3, maxDistance: number): { point: Vec3 } | null {
    let nearest: SimPlayer | null = null;
    let nearestPoint: Vec3 | null = null;
    let nearestDistance = maxDistance;

    for (const [id] of this.views) {
      const player = this.sim.players.get(id);
      if (!player || !player.alive) continue;
      const p = player.movement.position;
      const hit = rayAabb(
        origin,
        direction,
        {
          min: { x: p.x - 0.3, y: p.y, z: p.z - 0.3 },
          max: { x: p.x + 0.3, y: p.y + 1.8, z: p.z + 0.3 },
        },
        nearestDistance,
      );
      if (!hit) continue;
      nearestDistance = hit.distance;
      nearestPoint = hit.point;
      nearest = player;
    }

    if (!nearest || !nearestPoint) return null;

    // A head hit is worth roughly triple, matching the weapon table's intent
    // without duplicating its falloff maths for a presentational sandbox.
    const headshot = nearestPoint.y > nearest.movement.position.y + 1.48;
    nearest.health -= headshot ? 95 : 34;
    if (nearest.health <= 0) {
      nearest.health = 0;
      nearest.alive = false;
      this.deadUntil.set(nearest.id, performance.now() + RESPAWN_MS);
    }

    return { point: nearestPoint };
  }

  /** Bot shots fired since the last call, and clears the queue. */
  drainShots(): BotShot[] {
    return this.shots.splice(0, this.shots.length);
  }

  /**
   * Advance the simulation and the visuals.
   *
   * The simulation is stepped on its own fixed 30 Hz clock regardless of frame
   * rate — running it per frame would make bot behaviour depend on the player's
   * hardware, which is exactly what a fixed tick exists to prevent.
   */
  update(deltaMs: number, playerPosition: Vec3, playerYaw: number): void {
    const local = this.sim.players.get(LOCAL_ID);
    if (local) {
      local.movement.position = { ...playerPosition };
      local.movement.yaw = playerYaw;
      local.alive = true;
    }

    this.accumulatorMs += Math.min(deltaMs, 250); // never spiral after a stall
    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;
      for (const controller of this.controllers) controller.update(this.sim);
      this.consume(this.sim.step());
    }

    this.respawn();

    for (const [id, view] of this.views) {
      const player = this.sim.players.get(id);
      if (!player) continue;
      this.syncView(view, player);
    }
  }

  private consume(events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.type === "kill") {
        const view = this.views.get(event.victimId);
        if (view && !view.dead) {
          view.dead = true;
          this.play(view, "death", false);
          this.deadUntil.set(event.victimId, performance.now() + RESPAWN_MS);
        }
        continue;
      }

      // Incoming fire. Only landed rounds are drawn: the simulation reports
      // hits, not trigger pulls, and a tracer for every miss would need the
      // bot's aim ray, which is internal to the controller.
      if (event.type === "hit") {
        const attacker = this.sim.players.get(event.attackerId);
        const victim = this.sim.players.get(event.victimId);
        if (!attacker || !victim || !attacker.isBot) continue;
        this.shots.push({
          from: { ...attacker.movement.position, y: attacker.movement.position.y + 1.5 },
          to: { ...victim.movement.position, y: victim.movement.position.y + 1.2 },
        });
      }
    }
  }

  /** Put downed bots back on their feet. */
  private respawn(): void {
    const now = performance.now();
    for (const [id, at] of this.deadUntil) {
      if (now < at) continue;
      this.deadUntil.delete(id);

      const player = this.sim.players.get(id);
      const view = this.views.get(id);
      if (!player || !view) continue;

      const spawns = spawnsForTeam(ARDAVAN_YARD, player.team);
      const spawn = spawns[Math.floor(Math.random() * spawns.length)] ?? spawns[0];
      if (spawn) {
        player.movement.position = { ...spawn.position };
        player.movement.yaw = spawn.yaw;
      }
      player.movement.velocity = { x: 0, y: 0, z: 0 };
      player.health = 100;
      player.alive = true;
      view.dead = false;
      view.current = "";
    }
  }

  private syncView(view: BotView, player: SimPlayer): void {
    if (!player.alive) {
      if (!view.dead) {
        view.dead = true;
        this.play(view, "death", false);
      }
      return;
    }

    if (view.dead) {
      // Respawned by the simulation.
      view.dead = false;
      view.current = "";
    }

    view.root.position.set(
      player.movement.position.x,
      player.movement.position.y,
      player.movement.position.z,
    );
    // The model faces -Z; the simulation measures yaw from +Z.
    view.root.rotation.set(0, player.movement.yaw + Math.PI, 0);

    const speed = Math.hypot(player.movement.velocity.x, player.movement.velocity.z);
    const wanted = speed > RUN_SPEED ? "run" : speed > IDLE_SPEED ? "walk" : "idle";
    if (wanted !== view.current) this.play(view, wanted, true);
  }

  private play(view: BotView, clip: string, loop: boolean): void {
    for (const group of view.clips.values()) group.stop();
    const group = view.clips.get(clip);
    if (!group) return;
    group.start(loop, 1.0);
    view.current = clip;
  }

  dispose(): void {
    for (const view of this.views.values()) {
      for (const clip of view.clips.values()) clip.dispose();
      view.root.dispose();
    }
    this.views.clear();
  }
}
