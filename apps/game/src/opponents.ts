import {
  Vector3,
  type AnimationGroup,
  type AssetContainer,
  type Mesh,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";
import {
  ARDAVAN_YARD,
  rayAabb,
  BotController,
  MatchSimulation,
  TEAM_IDS,
  TICK_MS,
  type SimEvent,
  type SimGrenade,
  type SimPlayer,
  type Vec3,
  spawnsForTeam,
} from "@nightcell7/multiplayer-sim";
import { placeAll, placeAnimated, type AssetSet } from "./assets";
import { TEAM_PALETTE, brightenCharacter } from "./targets";

/** Enemies on the Directorate side, and friendlies on the player's. */
const ENEMY_COUNT = 4;
const FRIENDLY_COUNT = 3;

export interface OpponentOptions {
  /**
   * Roster size. Both default to a full Team Deathmatch.
   *
   * Zero on both is a valid, useful configuration rather than a degenerate
   * one: the Firing Range and Free Roam modes want no bots, but still need the
   * `MatchSimulation` this class owns, because that is where the player's
   * grenade count, cooldown and blast live.
   */
  readonly enemies?: number;
  readonly friendlies?: number;
}

/** Speed above which the run cycle replaces the walk cycle, m/s. */
const RUN_SPEED = 5.2;
/** Below this the bot is treated as standing still. */
const IDLE_SPEED = 0.35;

/** How long a downed bot stays down before the sandbox puts it back. */
const RESPAWN_MS = 6000;

const LOCAL_ID = "local-player";

/** A grenade in flight, and the mesh following it. */
interface GrenadeView {
  readonly root: TransformNode;
}

/** A detonation the renderer still has to draw. */
export interface Explosion {
  readonly position: Vec3;
  /** Distance from the local player, for volume. */
  readonly distanceM: number;
}

interface BotView {
  readonly id: string;
  readonly root: TransformNode;
  readonly clips: Map<string, AnimationGroup>;
  current: string;
  dead: boolean;
  readonly friendly: boolean;
}

export interface BotShot {
  readonly from: Vec3;
  readonly to: Vec3;
}

/**
 * Put a weapon in a fighter's hands.
 *
 * The rig carries a `SOCKET_WEAPON` node for exactly this. Parenting to the
 * socket rather than the root is what makes the weapon follow the animation —
 * it inherits the hand bone's transform, so it swings with a walk cycle and
 * drops with a death instead of hanging in the air where the body used to be.
 *
 * The yaw matches the viewmodel's: the weapons are modelled barrel-along--Y,
 * and Babylon's glTF loader flips handedness, so an unrotated weapon points
 * back at its owner. Failing to find the socket is not fatal — an unarmed bot
 * is worse-looking, not broken — so this returns quietly.
 */
function attachWeapon(root: TransformNode, model: AssetContainer | null, id: string): void {
  if (!model) return;

  const socket = root
    .getDescendants()
    .find((node): node is TransformNode => node.name.includes("SOCKET_WEAPON"));
  if (!socket) return;

  const [weapon] = placeAll(model, `${id}_weapon`, [{ position: Vector3.Zero() }]);
  if (!weapon) return;

  weapon.parent = socket;
  weapon.position = Vector3.Zero();
  weapon.rotation = new Vector3(0, Math.PI, 0);

  for (const mesh of weapon.getChildMeshes() as Mesh[]) {
    // A weapon is never shot at directly; hits resolve against the body.
    mesh.isPickable = false;
  }
}

export class Opponents {
  private readonly sim: MatchSimulation;
  private readonly controllers: BotController[] = [];
  private readonly views = new Map<string, BotView>();
  private accumulatorMs = 0;
  /** Shots fired by bots since the last drain, for the renderer to draw. */
  private readonly shots: BotShot[] = [];
  private readonly deadUntil = new Map<string, number>();
  private readonly grenadeViews = new Map<string, GrenadeView>();
  private readonly explosions: Explosion[] = [];
  private readonly grenadeModel: AssetContainer | null;

  constructor(_scene: Scene, assets: AssetSet, options: OpponentOptions = {}) {
    // Back on the generated character.
    //
    // The Synty models are committed and load, but the animation retarget
    // splays their limbs — measured at 1.90 x 2.00 x 2.47 m against an
    // expected 0.6 x 0.4 x 1.8. The cause is understood (see import_synty.py:
    // the rest-pose difference between the two skeletons) and the corrected
    // rest-relative maths is written, but its baked actions do not survive the
    // glTF export yet, so the models cannot be shipped animated.
    //
    // Shipping a figure that renders correctly beats shipping a better model
    // that does not. Swapping back is these two lines once the export is fixed:
    //   assets.models.get("fighter_soldier") / ("fighter_insurgent")
    //
    // One model per faction.
    //
    // Nightcell are irregulars: olive drab, boots, a pack — someone fighting
    // Both sides use the generated character.
    //
    // The licensed Synty characters would be a clear upgrade and are not ready:
    // see docs/HANDOFF-synty.md for the two attempts and where each stops. They
    // are told apart by team colour and weapon instead, which is what
    // `brightenCharacter` and `weaponFor` below are for.
    const enemyModel = assets.models.get("character");
    const friendlyModel = assets.models.get("character");
    const character = enemyModel;
    if (!character) throw new Error("no character model loaded");

    this.grenadeModel = assets.models.get("wep_grenade") ?? null;

    // Weapons for the bots.
    //
    // They fought empty-handed until now, which read as unfinished from any
    // distance. Two silhouettes rather than one: the Directorate carries the
    // rifle, Nightcell the SMG, so which side a figure is on is legible before
    // the tint confirms it.
    const weaponFor = (team: number) =>
      assets.models.get(team === TEAM_IDS.DIRECTORATE ? "wep_rifle" : "wep_smg") ?? null;

    this.sim = new MatchSimulation({ matchId: "sandbox", map: ARDAVAN_YARD });

    // The player, so the bots have someone to fight.
    this.sim.addPlayer({
      id: LOCAL_ID,
      userId: LOCAL_ID,
      displayName: "You",
      preferredTeam: TEAM_IDS.NIGHTCELL,
    });

    const enemyCount = options.enemies ?? ENEMY_COUNT;
    const friendlyCount = options.friendlies ?? FRIENDLY_COUNT;

    const roster = [
      ...Array.from({ length: enemyCount }, (_, i) => ({
        id: `bot-e${i}`,
        team: TEAM_IDS.DIRECTORATE,
        model: enemyModel,
        name: `Directorate ${i + 1}`,
      })),
      ...Array.from({ length: friendlyCount }, (_, i) => ({
        id: `bot-f${i}`,
        team: TEAM_IDS.NIGHTCELL,
        model: friendlyModel,
        name: `Nightcell ${i + 1}`,
      })),
    ];

    roster.forEach((entry, i) => {
      const id = entry.id;
      this.sim.addPlayer({
        id,
        userId: id,
        displayName: entry.name,
        isBot: true,
        preferredTeam: entry.team,
      });
      // Seeded per bot so a session is reproducible and they do not all make
      // the same decision on the same tick.
      this.controllers.push(new BotController(id, 1000 + i * 37));

      // Put them on a real spawn pad. `addPlayer` initialises movement to the
      // origin and nothing else places them, so every bot stood on top of the
      // central hard point in a single pile — which reads as "they all appear
      // where I am" the moment the player walks into the middle.
      const player = this.sim.players.get(id);
      const spawns = spawnsForTeam(ARDAVAN_YARD, entry.team);
      const spawn = spawns[i % Math.max(1, spawns.length)];
      if (player && spawn) {
        player.movement.position = { ...spawn.position };
        player.movement.yaw = spawn.yaw;
      }

      const placed = placeAnimated(entry.model ?? character, id, {
        position: new Vector3(0, -50, 0), // moved to the spawn on the first sync
        rotationY: 0,
      });
      if (!placed) return;

      // Colour the figure by side.
      //
      // Without this both teams are the *same model with the same materials*,
      // so the only difference between a friendly and an enemy is which weapon
      // it holds — invisible from the front, and at any range that matters.
      brightenCharacter(
        placed.root,
        entry.team === TEAM_IDS.NIGHTCELL ? TEAM_PALETTE.friendly : TEAM_PALETTE.enemy,
      );

      attachWeapon(placed.root, weaponFor(entry.team), id);

      this.views.set(id, {
        id,
        root: placed.root,
        clips: placed.clips,
        current: "",
        dead: false,
        friendly: entry.team === TEAM_IDS.NIGHTCELL,
      });
    });

    this.sim.startNow();
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
      if (this.views.get(id)?.friendly) continue; // no friendly fire in the sandbox
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
  /**
   * The local player throws a grenade.
   *
   * Routed through the same `MatchSimulation` the bots use rather than a
   * client-side special case, so the sandbox enforces the count, the cooldown
   * and the blast exactly as the authoritative server would. Returns false
   * when the simulation refused — out of grenades, or still on cooldown.
   */
  throwGrenade(pitch: number): boolean {
    const local = this.sim.players.get(LOCAL_ID);
    if (!local) return false;
    // The sim throws along the player's own aim, and `update` only syncs yaw.
    local.movement.pitch = pitch;
    return this.sim.throwGrenade(LOCAL_ID) !== null;
  }

  /** Grenades the local player has left, for the HUD. */
  grenadeCount(): number {
    return this.sim.players.get(LOCAL_ID)?.grenades ?? 0;
  }

  /** Detonations since the last call, for the renderer to draw and play. */
  drainExplosions(): Explosion[] {
    const drained = [...this.explosions];
    this.explosions.length = 0;
    return drained;
  }

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

    this.syncGrenades();
  }

  /**
   * Keep one mesh per grenade the simulation has in flight.
   *
   * Driven off `sim.grenades` rather than off the throw event, so a grenade
   * can never be left on screen after the simulation has forgotten it — the
   * map is the truth and the meshes follow.
   */
  private syncGrenades(): void {
    for (const [id, grenade] of this.sim.grenades) {
      let view = this.grenadeViews.get(id);
      if (!view) {
        const created = this.createGrenadeView(id, grenade);
        if (!created) continue;
        view = created;
        this.grenadeViews.set(id, view);
      }
      view.root.position.set(grenade.position.x, grenade.position.y, grenade.position.z);
      // Tumble in flight. A grenade that slides through the air facing one way
      // reads as a thrown prop rather than as something live.
      if (!grenade.resting) {
        view.root.rotation.x += 0.28;
        view.root.rotation.z += 0.19;
      }
    }

    // Anything the simulation dropped without an explosion event (a match
    // reset, a removed player) still has to lose its mesh.
    for (const [id, view] of this.grenadeViews) {
      if (this.sim.grenades.has(id)) continue;
      view.root.dispose();
      this.grenadeViews.delete(id);
    }
  }

  private createGrenadeView(id: string, grenade: SimGrenade): GrenadeView | null {
    if (!this.grenadeModel) return null;
    const [root] = placeAll(this.grenadeModel, `grenade_${id}`, [
      {
        position: new Vector3(grenade.position.x, grenade.position.y, grenade.position.z),
      },
    ]);
    if (!root) return null;
    for (const mesh of root.getChildMeshes()) mesh.isPickable = false;
    return { root };
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

      if (event.type === "grenade_exploded") {
        const view = this.grenadeViews.get(event.grenadeId);
        if (view) {
          view.root.dispose();
          this.grenadeViews.delete(event.grenadeId);
        }
        const listener = this.sim.players.get(LOCAL_ID)?.movement.position;
        this.explosions.push({
          position: { ...event.position },
          distanceM: listener
            ? Math.hypot(
                event.position.x - listener.x,
                event.position.y - listener.y,
                event.position.z - listener.z,
              )
            : 0,
        });
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
    // Clip names come from the licensed pack, whose idle holds the weapon up
    // — exactly right for a fighter, and something my generated rig lacked.
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
