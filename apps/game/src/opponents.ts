import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type AnimationGroup,
  type AssetContainer,
  type Mesh,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import {
  ARDAVAN_YARD,
  BotController,
  DEFAULT_PICKUP_RULES,
  MatchSimulation,
  PICKUP_KIND,
  TEAM_IDS,
  TICK_MS,
  add,
  applyPickup,
  scale,
  type SimEvent,
  type SimGrenade,
  type SimPickup,
  type SimPlayer,
  type SimRocket,
  type Vec3,
  spawnsForTeam,
} from "@nightcell7/multiplayer-sim";
import type { InputFrame } from "@nightcell7/multiplayer-protocol";
import { MAX_ARMOR, TDM_RULES, getWeapon, type WeaponId } from "@nightcell7/game-core";
import {
  ARMORY_ITEM,
  DEFAULT_LOADOUT,
  armorClassInfo,
  type ArmorClassId,
  type ArmoryItem,
} from "./loadout";
import { placeAll, placeAnimated, type AssetSet } from "./assets";
import type { CommsEvent, CommsSnapshot } from "./comms";
import { difficultyInfo, DEFAULT_SANDBOX_DIFFICULTY, type SandboxDifficulty } from "./difficulty";
import {
  SANDBOX_PICKUPS,
  SANDBOX_STAMINA_CAP,
  SANDBOX_STAMINA_PER_PACK,
  SANDBOX_STARTING_STAMINA,
  WEAPON_WORLD_MODEL,
  botLoadout,
} from "./sandbox-rules";
import { brightenCharacter, teamPalettes, type TeamPalette } from "./targets";

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
  /** Dynamic character and weapon shadows in the game renderer. */
  readonly shadows?: ShadowGenerator;
  /** How hard the yard hits back. Easy unless told otherwise. */
  readonly difficulty?: SandboxDifficulty;
  /** Which faction the player fights for. The other one is the enemy. */
  readonly team?: number;
  /** Armour class: plates on deploy and redeploy, and a stamina trade. */
  readonly armorClass?: ArmorClassId;
  /**
   * The colour the player chose on the gate. Their whole side wears it, and
   * the other side is given whichever palette sits furthest from it.
   */
  readonly color?: string;
}

/** Speed above which the run cycle replaces the walk cycle, m/s. */
const RUN_SPEED = 5.2;
/** Below this the bot is treated as standing still. */
const IDLE_SPEED = 0.35;

/** How long a downed fighter — bot or player — stays down before respawning. */
const RESPAWN_MS = 6000;

const LOCAL_ID = "local-player";

/** A grenade in flight, and the mesh following it. */
interface GrenadeView {
  readonly root: TransformNode;
}

/** A pickup on the ground, and the mesh drawing it. */
interface PickupView {
  readonly root: TransformNode;
  readonly baseY: number;
  phase: number;
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

/** A round fired by a bot. `to` is null on a miss; the renderer traces those. */
export interface BotShot {
  readonly from: Vec3;
  readonly direction: Vec3;
  readonly to: Vec3 | null;
}

/** A round that hit the local player, and where it came from. */
export interface LocalHit {
  readonly damage: number;
  /** The attacker's feet at the moment of the hit; null for a fall or unknown. */
  readonly from: Vec3 | null;
}

/** A round the local player fired, as the simulation resolved it. */
export interface LocalShot {
  readonly origin: Vec3;
  readonly direction: Vec3;
  /** Where it landed on a fighter, or null when it hit nobody. */
  readonly point: Vec3 | null;
}

export interface WeaponSlotStatus {
  readonly id: WeaponId;
  readonly name: string;
  readonly magazine: number;
  readonly magazineSize: number;
  readonly reserve: number;
}

/** Everything the HUD shows about the local player, read from the simulation. */
export interface LocalStatus {
  readonly alive: boolean;
  readonly health: number;
  /** Stamina: the ceiling health can reach. */
  readonly maxHealth: number;
  readonly armor: number;
  /** Milliseconds until redeploy; zero while alive. */
  readonly respawnInMs: number;
  readonly slot: number;
  readonly weapons: readonly WeaponSlotStatus[];
  readonly reloading: boolean;
  readonly grenades: number;
  readonly kills: number;
  readonly deaths: number;
}

/**
 * Put a weapon in a fighter's hands.
 *
 * The rig carries a `SOCKET_WEAPON` node for exactly this. Parenting to the
 * socket rather than the root is what makes the weapon follow the animation —
 * it inherits the hand bone's transform, so it swings with a walk cycle and
 * drops with a death instead of hanging in the air where the body used to be.
 *
 * The imported handedness conversion remains below the placement root, so
 * the C7 family points along local +Z. The socket is attached to the hand
 * bone by the full-set exporter and follows each animation clip.
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
  weapon.rotation = Vector3.Zero();

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
  private readonly localShots: LocalShot[] = [];
  private readonly grenadeViews = new Map<string, GrenadeView>();
  private readonly rocketViews = new Map<string, GrenadeView>();
  private readonly pickupViews = new Map<string, PickupView>();
  private readonly explosions: Explosion[] = [];
  private readonly notices: string[] = [];
  private readonly hits: LocalHit[] = [];
  private readonly commsEvents: CommsEvent[] = [];
  private localDied = false;
  private localRespawn: { position: Vec3; yaw: number } | null = null;
  private reloadStarted = false;
  private lastReloadingUntilMs = 0;
  private packsTaken = 0;
  /** Armour the player redeploys with; the armour class decides it. */
  private spawnArmor: number;
  /** The armour class's stamina trade currently applied to the player. */
  private armorStaminaBonus: number;
  private readonly playerTeam: number;
  /** What the player's side wears, and what the other side wears against it. */
  private palettes: { own: TeamPalette; enemy: TeamPalette };
  private readonly grenadeModel: AssetContainer | null;
  private readonly rocketModel: AssetContainer | null;
  private readonly assets: AssetSet;

  constructor(
    private readonly scene: Scene,
    assets: AssetSet,
    options: OpponentOptions = {},
  ) {
    this.assets = assets;
    const enemyModel = assets.models.get("m3_operator_directorate");
    const friendlyModel = assets.models.get("m3_operator_nightcell");
    if (!enemyModel || !friendlyModel) throw new Error("IRON RAIN operator models not loaded");

    this.grenadeModel = assets.models.get("m3_grenade") ?? null;
    this.rocketModel = assets.models.get("m3_rocket") ?? null;

    const difficulty = options.difficulty ?? difficultyInfo(DEFAULT_SANDBOX_DIFFICULTY);
    const armorClass = armorClassInfo(options.armorClass ?? "standard");
    this.spawnArmor = armorClass.armor;
    this.armorStaminaBonus = armorClass.staminaBonus;
    this.playerTeam = options.team ?? TEAM_IDS.NIGHTCELL;
    this.palettes = teamPalettes(options.color ?? DEFAULT_LOADOUT.color);
    const enemyTeam =
      this.playerTeam === TEAM_IDS.NIGHTCELL ? TEAM_IDS.DIRECTORATE : TEAM_IDS.NIGHTCELL;

    this.sim = new MatchSimulation({
      matchId: "sandbox",
      map: ARDAVAN_YARD,
      // The public sandbox has no results screen or match rotation. Keep it
      // playable; competitive server rooms retain the normal TDM limits.
      rules: {
        ...TDM_RULES,
        durationMs: Number.MAX_SAFE_INTEGER,
        scoreLimit: Number.MAX_SAFE_INTEGER,
        respawnDelayMs: RESPAWN_MS,
      },
      pickups: SANDBOX_PICKUPS,
      humanIncomingDamage: difficulty.incomingDamage,
    });

    // The player, so the bots have someone to fight.
    const local = this.sim.addPlayer({
      id: LOCAL_ID,
      userId: LOCAL_ID,
      displayName: "You",
      preferredTeam: this.playerTeam,
      maxHealth: Math.max(50, SANDBOX_STARTING_STAMINA + armorClass.staminaBonus),
    });
    local.armor = this.spawnArmor;

    const enemyCount = options.enemies ?? ENEMY_COUNT;
    const friendlyCount = options.friendlies ?? FRIENDLY_COUNT;

    // Alternate joins so authoritative balancing honors the intended factions.
    // Adding four enemies in a row silently moved e2 onto the player's team.
    // Which faction is "enemy" follows the player's side; the models follow
    // the faction, so a Directorate player fights Nightcell irregulars.
    const modelFor = (team: number) => (team === TEAM_IDS.DIRECTORATE ? enemyModel : friendlyModel);
    const nameFor = (team: number, i: number) =>
      `${team === TEAM_IDS.DIRECTORATE ? "Directorate" : "Nightcell"} ${i + 1}`;
    const roster = Array.from({ length: Math.max(enemyCount, friendlyCount) }, (_, i) => [
      ...(i < enemyCount
        ? [
            {
              id: `bot-e${i}`,
              team: enemyTeam,
              model: modelFor(enemyTeam),
              name: nameFor(enemyTeam, i),
              loadout: botLoadout(true, i),
            },
          ]
        : []),
      ...(i < friendlyCount
        ? [
            {
              id: `bot-f${i}`,
              team: this.playerTeam,
              model: modelFor(this.playerTeam),
              name: nameFor(this.playerTeam, i),
              loadout: botLoadout(false, i),
            },
          ]
        : []),
    ]).flat();

    const spawnOffsets = new Map<number, number>();
    roster.forEach((entry, i) => {
      const id = entry.id;
      this.sim.addPlayer({
        id,
        userId: id,
        displayName: entry.name,
        isBot: true,
        preferredTeam: entry.team,
        loadout: entry.loadout,
      });
      // Seeded per bot so a session is reproducible and they do not all make
      // the same decision on the same tick.
      this.controllers.push(
        new BotController(
          id,
          1000 + i * 37,
          entry.team === enemyTeam ? difficulty.enemyTuning : undefined,
        ),
      );

      // Initial spawn scoring ties before the first tick. Spread the roster
      // across its real faction pads rather than stacking every mesh together.
      const player = this.sim.players.get(id)!;
      const pads = spawnsForTeam(ARDAVAN_YARD, player.team);
      const offset = spawnOffsets.get(player.team) ?? 0;
      spawnOffsets.set(player.team, offset + 1);
      // The player takes their team's first pad (see main.ts), and nothing
      // moves until the gate drops, so a squadmate placed there stands with
      // their visor against the camera for the whole deploy screen.
      const skip = player.team === this.playerTeam ? 1 : 0;
      const pad = pads[(offset + skip) % pads.length];
      if (pad) {
        player.movement.position = { ...pad.position };
        player.movement.yaw = pad.yaw;
      }
      const placed = placeAnimated(entry.model, id, {
        position: new Vector3(
          player.movement.position.x,
          player.movement.position.y,
          player.movement.position.z,
        ),
        rotationY: 0,
      });
      if (!placed) return;

      // Colour the figure by side.
      //
      // Without this both teams are the *same model with the same materials*,
      // so the only difference between a friendly and an enemy is which weapon
      // it holds — invisible from the front, and at any range that matters.
      //
      // Keyed on the player's own team, not on an absolute faction. It used to
      // ask `player.team === TEAM_IDS.NIGHTCELL`, which is only the same
      // question while the player is Nightcell: choose Directorate on the gate
      // and your own squad wore the enemy colour and the enemies wore yours.
      brightenCharacter(
        placed.root,
        player.team === this.playerTeam ? this.palettes.own : this.palettes.enemy,
      );

      // The weapon in hand is the one the fighter will drop, so the silhouette
      // tells the player what a kill is worth.
      const primary = player.weapons[0];
      attachWeapon(placed.root, primary ? this.weaponModel(primary) : null, id);
      for (const mesh of placed.root.getChildMeshes()) {
        if (mesh.getTotalVertices() > 0) options.shadows?.addShadowCaster(mesh, false);
      }

      this.views.set(id, {
        id,
        root: placed.root,
        clips: placed.clips,
        current: "",
        dead: false,
        friendly: player.team === this.playerTeam,
      });
    });

    this.sim.startNow();
    for (const [id, view] of this.views) this.syncView(view, this.sim.players.get(id)!);
  }

  private weaponModel(weapon: WeaponId): AssetContainer | null {
    return this.assets.models.get(WEAPON_WORLD_MODEL[weapon]) ?? null;
  }

  // ------------------------------------------------------------ the player

  /**
   * The local player's trigger, reload and aim for this frame.
   *
   * Handed to the simulation rather than resolved here, so the sandbox
   * enforces the same cadence, magazine and hit rules a match would, and a
   * hit costs the bot the same health it would cost a human. What the shot
   * did comes back through `drainLocalShots`.
   */
  applyLocalInput(frame: InputFrame): void {
    this.sim.applyWeaponIntent(LOCAL_ID, frame);
  }

  reloadLocal(): void {
    this.sim.requestReload(LOCAL_ID);
  }

  switchLocal(slot: number): void {
    this.sim.requestWeaponSwitch(LOCAL_ID, slot);
  }

  /** Next or previous weapon, wrapping. */
  cycleLocal(step: number): void {
    const local = this.sim.players.get(LOCAL_ID);
    if (!local || local.weapons.length < 2) return;
    const count = local.weapons.length;
    const next = (((local.weaponSlot + step) % count) + count) % count;
    this.sim.requestWeaponSwitch(LOCAL_ID, next);
  }

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

  /**
   * Buy something from the armory. Applies to the simulation's player at
   * once. Returns false when there was nothing to gain — full health, full
   * reserve, no free slot — so the caller can keep the credits.
   */
  grant(item: ArmoryItem): boolean {
    const local = this.sim.players.get(LOCAL_ID);
    if (!local) return false;
    switch (item.id) {
      case ARMORY_ITEM.AMMO: {
        let changed = false;
        local.weapons.forEach((id, i) => {
          const spec = getWeapon(id);
          const ammo = local.ammo[i];
          if (!ammo) return;
          if (ammo.magazine < spec.magazineSize || ammo.reserve < spec.reserveAmmo) changed = true;
          ammo.magazine = Math.max(ammo.magazine, spec.magazineSize);
          ammo.reserve = Math.max(ammo.reserve, spec.reserveAmmo);
        });
        return changed;
      }
      case ARMORY_ITEM.MEDKIT:
        if (local.health >= local.maxHealth) return false;
        local.health = local.maxHealth;
        return true;
      case ARMORY_ITEM.PLATES:
        if (local.armor >= MAX_ARMOR) return false;
        local.armor = MAX_ARMOR;
        return true;
      case ARMORY_ITEM.CONDITIONING: {
        if (local.maxHealth >= SANDBOX_STAMINA_CAP) return false;
        const gained = Math.min(SANDBOX_STAMINA_PER_PACK, SANDBOX_STAMINA_CAP - local.maxHealth);
        local.maxHealth += gained;
        local.health += gained;
        return true;
      }
      default: {
        if (!item.weapon) return false;
        const spec = getWeapon(item.weapon);
        const outcome = applyPickup(
          local,
          {
            id: `armory-${item.id}`,
            kind: PICKUP_KIND.WEAPON,
            position: { ...local.movement.position },
            heal: 0,
            weaponId: item.weapon,
            magazine: spec.magazineSize,
            reserve: spec.reserveAmmo,
            expiresAtMs: null,
            spawnIndex: null,
          },
          { ...DEFAULT_PICKUP_RULES, ...SANDBOX_PICKUPS },
        );
        return outcome !== null;
      }
    }
  }

  /**
   * Change the armour class between deployments: plates now and on every
   * redeploy, and the stamina trade moved from the old class to the new.
   */
  setArmorClass(id: ArmorClassId): void {
    const armorClass = armorClassInfo(id);
    this.spawnArmor = armorClass.armor;
    const local = this.sim.players.get(LOCAL_ID);
    if (local) {
      local.armor = this.spawnArmor;
      const delta = armorClass.staminaBonus - this.armorStaminaBonus;
      local.maxHealth = Math.max(50, local.maxHealth + delta);
      local.health = Math.min(local.health + Math.max(0, delta), local.maxHealth);
    }
    this.armorStaminaBonus = armorClass.staminaBonus;
  }

  /**
   * Repaint both sides for a colour picked on the gate.
   *
   * The gate lets a player change colour without redeploying, and the figures
   * already standing in the yard were built with the old palette, so the choice
   * has to reach them here. Changing the player's colour also moves the enemy
   * if the two would otherwise collide, which is why both sides are repainted
   * rather than just the friendly one.
   */
  setColor(id: string): void {
    this.palettes = teamPalettes(id);
    for (const view of this.views.values()) {
      const player = this.sim.players.get(view.id);
      if (!player) continue;
      brightenCharacter(
        view.root,
        player.team === this.playerTeam ? this.palettes.own : this.palettes.enemy,
      );
    }
  }

  /** Health packs the player took since the last call. */
  drainPacksTaken(): number {
    const taken = this.packsTaken;
    this.packsTaken = 0;
    return taken;
  }

  /** Grenades the local player has left, for the HUD. */
  grenadeCount(): number {
    return this.sim.players.get(LOCAL_ID)?.grenades ?? 0;
  }

  /** Vitals, weapon and ammunition, straight from the simulation. */
  localStatus(): LocalStatus {
    const local = this.sim.players.get(LOCAL_ID);
    if (!local) {
      return {
        alive: true,
        health: 0,
        maxHealth: 0,
        armor: 0,
        respawnInMs: 0,
        slot: 0,
        weapons: [],
        reloading: false,
        grenades: 0,
        kills: 0,
        deaths: 0,
      };
    }
    return {
      alive: local.alive,
      health: Math.round(local.health),
      maxHealth: Math.round(local.maxHealth),
      armor: Math.round(local.armor),
      respawnInMs: local.alive ? 0 : Math.max(0, local.respawnAtMs - this.sim.elapsedMs),
      slot: local.weaponSlot,
      weapons: local.weapons.map((id, i) => {
        const spec = getWeapon(id);
        return {
          id,
          name: spec.displayName,
          magazine: local.ammo[i]?.magazine ?? 0,
          magazineSize: spec.magazineSize,
          reserve: local.ammo[i]?.reserve ?? 0,
        };
      }),
      reloading: this.sim.elapsedMs < local.reloadingUntilMs,
      grenades: local.grenades,
      kills: local.kills,
      deaths: local.deaths,
    };
  }

  // ---------------------------------------------------------------- drains

  /** Detonations since the last call, for the renderer to draw and play. */
  drainExplosions(): Explosion[] {
    const drained = [...this.explosions];
    this.explosions.length = 0;
    return drained;
  }

  drainShots(): BotShot[] {
    return this.shots.splice(0, this.shots.length);
  }

  drainLocalShots(): LocalShot[] {
    return this.localShots.splice(0, this.localShots.length);
  }

  /** Every hit the local player took since the last call, with its source. */
  /** What the squad radio reacts to since the last call; see comms.ts. */
  drainCommsEvents(): CommsEvent[] {
    return this.commsEvents.splice(0);
  }

  /** Everyone in the match and the score, for the squad radio. */
  commsSnapshot(): CommsSnapshot {
    const fighters = [...this.sim.players.values()].map((p) => ({
      team: p.team,
      alive: p.alive,
      position: p.movement.position,
      isLocal: p.id === LOCAL_ID,
    }));
    return { fighters, scores: this.sim.scores };
  }

  drainHits(): LocalHit[] {
    return this.hits.splice(0, this.hits.length);
  }

  /** True once, when the local player has just been killed. */
  drainLocalDeath(): boolean {
    const died = this.localDied;
    this.localDied = false;
    return died;
  }

  /** Where the simulation just put the local player back, if it did. */
  drainLocalRespawn(): { position: Vec3; yaw: number } | null {
    const respawn = this.localRespawn;
    this.localRespawn = null;
    return respawn;
  }

  /** True once per reload the simulation accepted. */
  drainReloadStarted(): boolean {
    const started = this.reloadStarted;
    this.reloadStarted = false;
    return started;
  }

  /** One line each: what the player just picked up. */
  drainNotices(): string[] {
    return this.notices.splice(0, this.notices.length);
  }

  // ---------------------------------------------------------------- update

  /**
   * Advance the simulation and the visuals.
   *
   * The simulation is stepped on its own fixed 30 Hz clock regardless of frame
   * rate — running it per frame would make bot behaviour depend on the player's
   * hardware, which is exactly what a fixed tick exists to prevent.
   */
  update(deltaMs: number, playerPosition: Vec3, playerYaw: number): void {
    const local = this.sim.players.get(LOCAL_ID);
    // The controller owns where a living player is. A dead one is the
    // simulation's until it respawns them, and the controller follows.
    if (local && local.alive) {
      local.movement.position = { ...playerPosition };
      local.movement.yaw = playerYaw;
    }

    this.accumulatorMs += Math.min(deltaMs, 250); // never spiral after a stall
    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;
      for (const controller of this.controllers) controller.update(this.sim);
      this.consume(this.sim.step());
    }

    if (local) {
      const reloadingUntil = local.reloadingUntilMs;
      if (reloadingUntil !== this.lastReloadingUntilMs) {
        if (reloadingUntil > this.sim.elapsedMs) this.reloadStarted = true;
        this.lastReloadingUntilMs = reloadingUntil;
      }
    }

    for (const [id, view] of this.views) {
      const player = this.sim.players.get(id);
      if (!player) continue;
      this.syncView(view, player);
    }

    this.syncGrenades();
    this.syncRockets();
    this.syncPickups(deltaMs);
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

  /**
   * Keep one mesh per rocket in flight, and point it where it is going.
   *
   * Driven off `sim.rockets` for the same reason grenades are: the simulation
   * map is the truth and the meshes follow it, so nothing can be left hanging
   * in the air after the rocket it belonged to has gone.
   */
  private syncRockets(): void {
    for (const [id, rocket] of this.sim.rockets) {
      let view = this.rocketViews.get(id);
      if (!view) {
        const created = this.createRocketView(id, rocket);
        if (!created) continue;
        view = created;
        this.rocketViews.set(id, view);
      }
      view.root.position.set(rocket.position.x, rocket.position.y, rocket.position.z);
      // Nose along the velocity. A rocket that flies sideways reads as debris.
      const v = rocket.velocity;
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > 0.001) {
        view.root.rotation.y = Math.atan2(v.x, v.z);
        view.root.rotation.x = -Math.asin(Math.max(-1, Math.min(1, v.y / speed)));
      }
    }

    for (const [id, view] of this.rocketViews) {
      if (this.sim.rockets.has(id)) continue;
      view.root.dispose();
      this.rocketViews.delete(id);
    }
  }

  private createRocketView(id: string, rocket: SimRocket): GrenadeView | null {
    if (!this.rocketModel) return null;
    const [root] = placeAll(this.rocketModel, `rocket_${id}`, [
      {
        position: new Vector3(rocket.position.x, rocket.position.y, rocket.position.z),
      },
    ]);
    if (!root) return null;
    for (const mesh of root.getChildMeshes()) mesh.isPickable = false;
    return { root };
  }

  /**
   * One mesh per pickup on the ground, same map-is-truth rule as grenades.
   *
   * They hover and turn slowly. A weapon lying flat in the dark is a prop;
   * one floating and turning is the oldest signal in the genre for "walk
   * over this", and the yard is dark enough to need it.
   */
  private syncPickups(deltaMs: number): void {
    for (const [id, pickup] of this.sim.pickups) {
      let view = this.pickupViews.get(id);
      if (!view) {
        const created = this.createPickupView(id, pickup);
        if (!created) continue;
        view = created;
        this.pickupViews.set(id, view);
      }
      view.phase += deltaMs * 0.0025;
      view.root.position.y = view.baseY + 0.45 + Math.sin(view.phase) * 0.06;
      view.root.rotation.y = view.phase * 0.6;
    }

    for (const [id, view] of this.pickupViews) {
      if (this.sim.pickups.has(id)) continue;
      view.root.dispose();
      this.pickupViews.delete(id);
    }
  }

  private createPickupView(id: string, pickup: SimPickup): PickupView | null {
    const p = pickup.position;
    if (pickup.kind === PICKUP_KIND.WEAPON && pickup.weaponId) {
      const model = this.weaponModel(pickup.weaponId);
      if (!model) return null;
      const [root] = placeAll(model, `pickup_${id}`, [{ position: new Vector3(p.x, p.y, p.z) }]);
      if (!root) return null;
      // Tipped rather than level, so it reads as dropped, not racked.
      root.rotation.z = 0.35;
      for (const mesh of root.getChildMeshes()) mesh.isPickable = false;
      return { root, baseY: p.y, phase: Math.random() * Math.PI * 2 };
    }

    // A health pack: an olive field case with a pale cross. Built rather
    // than imported — there is no medical prop in the set, and a box with a
    // cross is legible from across the yard, which is the whole job.
    const root = new TransformNode(`pickup_${id}`, this.scene);
    root.position.set(p.x, p.y, p.z);

    const caseMaterial = new StandardMaterial(`pickup_${id}_case`, this.scene);
    caseMaterial.diffuseColor = new Color3(0.3, 0.36, 0.24);
    caseMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
    caseMaterial.emissiveColor = new Color3(0.05, 0.07, 0.04);

    const crossMaterial = new StandardMaterial(`pickup_${id}_cross`, this.scene);
    crossMaterial.diffuseColor = new Color3(0.95, 0.94, 0.88);
    crossMaterial.emissiveColor = new Color3(0.75, 0.74, 0.66);
    crossMaterial.specularColor = Color3.Black();

    const body = MeshBuilder.CreateBox(
      `pickup_${id}_body`,
      { width: 0.5, height: 0.26, depth: 0.36 },
      this.scene,
    );
    body.material = caseMaterial;
    const barAcross = MeshBuilder.CreateBox(
      `pickup_${id}_bar_a`,
      { width: 0.3, height: 0.025, depth: 0.09 },
      this.scene,
    );
    const barAlong = MeshBuilder.CreateBox(
      `pickup_${id}_bar_b`,
      { width: 0.09, height: 0.025, depth: 0.3 },
      this.scene,
    );
    for (const bar of [barAcross, barAlong]) {
      bar.material = crossMaterial;
      bar.position.y = 0.135;
    }
    for (const mesh of [body, barAcross, barAlong]) {
      mesh.parent = root;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
    }
    return { root, baseY: p.y, phase: Math.random() * Math.PI * 2 };
  }

  private consume(events: readonly SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case "shot": {
          const landed =
            event.distance === null
              ? null
              : add(event.origin, scale(event.direction, event.distance));
          if (event.playerId === LOCAL_ID) {
            this.localShots.push({
              origin: event.origin,
              direction: event.direction,
              point: landed,
            });
          } else if (this.sim.players.get(event.playerId)?.isBot) {
            // Incoming fire, hits and misses alike, so a fight is visible
            // from the receiving end.
            this.shots.push({ from: event.origin, direction: event.direction, to: landed });
          }
          break;
        }

        case "hit":
          if (event.victimId === LOCAL_ID) {
            const attacker = this.sim.players.get(event.attackerId);
            this.hits.push({
              damage: event.damage,
              from: attacker && attacker.id !== LOCAL_ID ? { ...attacker.movement.position } : null,
            });
          }
          break;

        case "kill": {
          this.commsEvents.push({
            type: "kill",
            victimTeam: this.sim.players.get(event.victimId)?.team ?? -1,
            victimIsLocal: event.victimId === LOCAL_ID,
            killerIsLocal: event.attackerId === LOCAL_ID,
          });
          if (event.victimId === LOCAL_ID) {
            this.localDied = true;
            break;
          }
          const view = this.views.get(event.victimId);
          if (view && !view.dead) {
            view.dead = true;
            this.play(view, "death", false);
          }
          break;
        }

        case "respawn":
          if (event.playerId === LOCAL_ID) {
            this.commsEvents.push({ type: "local_respawn" });
            this.localRespawn = { position: { ...event.position }, yaw: event.yaw };
            // The simulation issues match armour; the armour class overrides it.
            const local = this.sim.players.get(LOCAL_ID);
            if (local) local.armor = this.spawnArmor;
          }
          break;

        case "pickup_taken": {
          if (event.playerId !== LOCAL_ID) break;
          if (event.kind === PICKUP_KIND.HEALTH) {
            this.packsTaken += 1;
            const stamina = event.staminaGained > 0 ? ` · stamina ${event.stamina}` : "";
            this.notices.push(`+${Math.round(event.healed)} health${stamina}`);
          } else if (event.weaponId) {
            const name = getWeapon(event.weaponId).displayName;
            this.notices.push(
              event.added
                ? `${name} — slot ${event.slot + 1}`
                : `+${event.ammoAdded} ${name} rounds`,
            );
          }
          break;
        }

        case "rocket_exploded": {
          const view = this.rocketViews.get(event.rocketId);
          if (view) {
            view.root.dispose();
            this.rocketViews.delete(event.rocketId);
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
          break;
        }

        case "grenade_thrown":
          // Only the squad radio cares about the throw itself; the grenade's
          // view is built from the simulation's live grenades.
          this.commsEvents.push({
            type: "grenade",
            team: event.team,
            position: { ...event.position },
          });
          break;

        case "grenade_exploded": {
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
          break;
        }

        default:
          break;
      }
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
    // IRON RAIN operators face the same forward axis as the simulation.
    view.root.rotation.set(0, player.movement.yaw, 0);

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
    for (const view of this.pickupViews.values()) view.root.dispose();
    this.pickupViews.clear();
    for (const view of this.grenadeViews.values()) view.root.dispose();
    this.grenadeViews.clear();
    for (const view of this.rocketViews.values()) view.root.dispose();
    this.rocketViews.clear();
  }
}
