import {
  Color3,
  PBRMaterial,
  Vector3,
  type AnimationGroup,
  type Material,
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
  type SimPlayer,
  type Vec3,
  spawnsForTeam,
} from "@nightcell7/multiplayer-sim";
import { placeAnimated, type AssetSet } from "./assets";
import { brightenCharacter } from "./targets";

/**
 * Pull a licensed character back into the yard's exposure range.
 *
 * The pack's materials are authored for a neutrally lit scene. This yard runs
 * ambient at 4.05 and exposure at 2.05 — raised when the environment read as
 * too dark — so light-toned character materials clip straight to white and the
 * figures render as glowing blobs. Same trap as the weapon viewmodel: the fix
 * belongs on the character's own material instances, not on the scene, because
 * the scene's exposure is correct for the environment.
 */
function tameForScene(root: TransformNode, scene: Scene): void {
  const seen = new Map<Material, Material>();

  for (const mesh of root.getChildMeshes() as Mesh[]) {
    const source = mesh.material;
    if (!source) continue;
    let clone = seen.get(source);
    if (!clone) {
      clone = source.clone(`scene_${source.name}`) ?? source;

      // Kill emissive without gating on the material class. The yard runs a
      // GlowLayer for the sodium lamps and it blooms *any* emissive surface;
      // if the imported material is not the class we expect, an
      // `instanceof` guard skips this silently and the character renders as a
      // glowing white blob with a halo.
      const anyMaterial = clone as unknown as { emissiveColor?: Color3; emissiveTexture?: unknown };
      if (anyMaterial.emissiveColor) anyMaterial.emissiveColor = new Color3(0, 0, 0);
      anyMaterial.emissiveTexture = null;

      if (clone instanceof PBRMaterial) {
        // 0.18, not 0.42.
        //
        // Worked back from the actual budget rather than guessed: the yard's
        // hemispheric light is intensity 4.05 with a diffuse colour averaging
        // ~0.45, so ~1.8 effective. At exposure 2.05, staying under the 0.62
        // bloom threshold needs an albedo near 0.17 — which is also where the
        // yard's own concrete and steel sit. The pack authors its materials
        // around 0.8 for a neutrally lit scene, so they need scaling by
        // roughly a fifth, not a half.
        clone.albedoColor = clone.albedoColor.scale(0.18);
        clone.environmentIntensity = 0.3;
        clone.enableSpecularAntiAliasing = true;
      }
      seen.set(source, clone);
    }
    mesh.material = clone;

    // Belt and braces: even with emissive cleared, keep characters out of the
    // glow layer entirely so a future material change cannot reintroduce this.
    for (const layer of scene.effectLayers) {
      const glow = layer as unknown as { addExcludedMesh?: (m: Mesh) => void };
      glow.addExcludedMesh?.(mesh);
    }
  }
}

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

/** Enemies on the Directorate side, and friendlies on the player's. */
const ENEMY_COUNT = 4;
const FRIENDLY_COUNT = 3;

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
  readonly friendly: boolean;
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
    // One model per faction. The Directorate is equipped and uniformed; the
    // Nightcell side are irregulars in civilian clothing. That difference is
    // the fastest target ID a player gets, and it is carried by the whole
    // silhouette rather than by a colour swatch.
    // Back on the generated character for now.
    //
    // The licensed Quaternius models are committed and load fine, but they
    // render as glowing white figures in this scene and three attempts did not
    // fix it: scaling albedo to the yard's actual exposure budget (0.42, then
    // 0.18), clearing emissive unconditionally, and excluding them from the
    // GlowLayer all left them blown out. Something else in their imported
    // material setup is driving it and I have not identified what.
    //
    // The generated character renders correctly, so the bots use it until the
    // licensed ones are diagnosed. Swapping back is a one-line change:
    //   assets.models.get("fighter_swat") / ("fighter_worker")
    const enemyModel = assets.models.get("character");
    const friendlyModel = assets.models.get("character");
    const character = enemyModel;
    const carbine = assets.models.get("carbine");
    if (!character) throw new Error("no character model loaded");

    this.sim = new MatchSimulation({ matchId: "sandbox", map: ARDAVAN_YARD });

    // The player, so the bots have someone to fight.
    this.sim.addPlayer({
      id: LOCAL_ID,
      userId: LOCAL_ID,
      displayName: "You",
      preferredTeam: TEAM_IDS.NIGHTCELL,
    });

    const roster = [
      ...Array.from({ length: ENEMY_COUNT }, (_, i) => ({
        id: `bot-e${i}`,
        team: TEAM_IDS.DIRECTORATE,
        model: enemyModel,
        name: `Directorate ${i + 1}`,
      })),
      ...Array.from({ length: FRIENDLY_COUNT }, (_, i) => ({
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

      const placed = placeAnimated(entry.model ?? character, id, {
        position: new Vector3(0, -50, 0), // parked until the sim spawns them
        rotationY: 0,
      });
      if (!placed) return;

      // The licensed character already carries its own weapon, so ours is
      // not attached on top of it.
      void carbine;

      brightenCharacter(placed.root);
      tameForScene(placed.root, scene);

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
