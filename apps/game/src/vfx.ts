import type { Scene, Texture, AbstractMesh } from "@babylonjs/core";
import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import {
  ARDAVAN_YARD,
  raycastWorld,
  type CollisionMap,
  type Vec3,
} from "@nightcell7/multiplayer-sim";

/**
 * Weapon effects: muzzle flash, tracers, impacts.
 *
 * Firing previously produced nothing at all — the gun made no light, nothing
 * travelled, and nothing happened where the round landed, so shooting had no
 * feedback beyond the report.
 *
 * **This is presentation only.** The trace here decides where to draw a spark,
 * nothing more. Damage, hit registration and lag compensation are the server's
 * (`resolveHitscan` in `@nightcell7/multiplayer-sim`), and a tampered client
 * can move these effects without moving a single bullet. The trace does use
 * the *same* `raycastWorld` against the *same* collision map the server uses,
 * so the sparks land where the server agrees the geometry is — art and
 * simulation cannot drift.
 *
 * Everything is pooled. A burst of automatic fire must not allocate a particle
 * system per shot; at 700 rpm that is a garbage-collection stall every couple
 * of seconds, which in a shooter reads as the netcode being broken.
 */

/** Maximum trace length, metres. Longer than the map's diagonal. */
const MAX_RANGE = 200;

const POOL_SIZE = 12;

/** How long a tracer is visible, ms. Short — a tracer is a hint, not a laser. */
const TRACER_LIFE = 55;
const FLASH_LIFE = 42;

/** How long an explosion's light and particles persist, in ms. */
const BLAST_LIFE = 1200;
/** Concurrent explosions. Grenades have a 900 ms cooldown and a 2.5 s fuse. */
const BLAST_POOL = 4;
/**
 * Particles emitted per layer, in one burst.
 *
 * Each is below its system's capacity so a second explosion in the same pool
 * slot cannot be starved by the first one's survivors.
 */
const FIRE_BURST = 170;
const SHARD_BURST = 95;
const SMOKE_BURST = 120;

function toVector(v: Vec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

export interface ShotTrace {
  /** Where the round lands, or the end of its range if it hits nothing. */
  readonly point: Vec3;
  /** False when the trace left the map without touching geometry. */
  readonly hit: boolean;
  readonly distance: number;
}

/**
 * Decide where a round lands.
 *
 * Pure and Babylon-free so it can be tested against the real collision map:
 * the class around it needs a GPU context, this does not, and this is the part
 * that can actually be wrong.
 *
 * Traced from the eye rather than the muzzle. The muzzle sits below and to the
 * right of the sight line, so a trace from there converges on the crosshair
 * only at distance and lands visibly off it up close — the classic
 * "my shots miss what I'm aiming at" bug.
 */
export function traceShot(
  eye: Vec3,
  direction: Vec3,
  map: CollisionMap,
  maxDistance: number = MAX_RANGE,
): ShotTrace {
  const hit = raycastWorld(eye, direction, map, maxDistance);
  if (hit) return { point: hit.point, hit: true, distance: hit.distance };

  return {
    point: {
      x: eye.x + direction.x * maxDistance,
      y: eye.y + direction.y * maxDistance,
      z: eye.z + direction.z * maxDistance,
    },
    hit: false,
    distance: maxDistance,
  };
}

/**
 * Soft radial sprite used for flashes and sparks.
 *
 * Generated rather than loaded: it keeps the effect set inside the same "no
 * asset without provenance" rule as everything else, and a 64px gradient is
 * not worth a network request.
 */
function radialSprite(scene: Scene, name: string, inner: string, outer: string): DynamicTexture {
  const size = 64;
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.45, outer);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.update(false);
  texture.hasAlpha = true;
  return texture;
}

interface Tracer {
  mesh: Mesh;
  until: number;
}

interface Impact {
  sparks: ParticleSystem;
  dust: ParticleSystem;
  light: PointLight;
  /**
   * A billboarded flash at the point of impact.
   *
   * Sparks are centimetres across and vanish to sub-pixel beyond about thirty
   * metres, which made hits on anything down a lane look like the round simply
   * stopped. This is scaled with distance so a hit stays legible at any range —
   * it is the part the player actually sees.
   */
  flash: Mesh;
  until: number;
}

/**
 * One pooled explosion.
 *
 * Bigger and longer-lived than an `Impact` in every dimension, because that is
 * the entire point: a blast that merely looks like a large bullet strike does
 * not communicate that a grenade went off near you.
 */
interface Blast {
  fire: ParticleSystem;
  smoke: ParticleSystem;
  shards: ParticleSystem;
  light: PointLight;
  /**
   * A billboarded additive flash.
   *
   * Not redundant with `light`. The yard runs eleven lamp masts plus several
   * directionals, and Babylon drops lights beyond a material's
   * `maxSimultaneousLights` (6 here) *silently* — so a blast light is quite
   * likely to be the one discarded, exactly when the scene is busiest. The
   * quad is geometry and always draws, so the explosion cannot vanish.
   */
  flash: Mesh;
  until: number;
}

export class WeaponEffects {
  private readonly scene: Scene;
  private readonly map: CollisionMap;

  private readonly flash: Mesh;
  private readonly flashLight: PointLight;
  private flashUntil = 0;

  private readonly tracers: Tracer[] = [];
  private readonly impacts: Impact[] = [];
  private nextTracer = 0;
  private nextImpact = 0;
  private readonly impactFlashMaterial: StandardMaterial;

  private readonly blasts: Blast[] = [];
  private nextBlast = 0;

  constructor(scene: Scene, map: CollisionMap = ARDAVAN_YARD) {
    this.scene = scene;
    this.map = map;

    // ---- muzzle flash ------------------------------------------------
    const flashTexture = radialSprite(
      scene,
      "vfx-flash",
      "rgba(255,246,214,1)",
      "rgba(255,168,64,0.85)",
    );

    const flashMaterial = new StandardMaterial("vfx-flash", scene);
    flashMaterial.diffuseTexture = flashTexture;
    flashMaterial.opacityTexture = flashTexture;
    flashMaterial.emissiveColor = new Color3(1, 0.82, 0.5);
    flashMaterial.disableLighting = true;
    flashMaterial.backFaceCulling = false;
    flashMaterial.alphaMode = 1; // additive

    // Small on purpose. At 0.3 m from a 90-degree camera a 0.22 m quad covers
    // roughly a third of the screen width, and drawn in rendering group 1 over
    // a cleared depth buffer it painted a white blob straight over the weapon
    // every time the player fired.
    this.flash = MeshBuilder.CreatePlane("vfx-flash", { size: 0.075 }, scene);
    this.flash.material = flashMaterial;
    this.flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.flash.isPickable = false;
    this.flash.renderingGroupId = 1; // with the viewmodel, over the world
    this.flash.setEnabled(false);

    this.flashLight = new PointLight("vfx-flash-light", Vector3.Zero(), scene);
    this.flashLight.diffuse = new Color3(1, 0.78, 0.42);
    this.flashLight.specular = new Color3(1, 0.85, 0.55);
    this.flashLight.intensity = 0;
    this.flashLight.range = 14;

    // ---- tracer pool ---------------------------------------------------
    const tracerMaterial = new StandardMaterial("vfx-tracer", scene);
    // Warm but not white-hot. A tracer is a hint that something crossed the
    // space, not a laser beam.
    tracerMaterial.emissiveColor = new Color3(0.95, 0.62, 0.26);
    tracerMaterial.disableLighting = true;
    tracerMaterial.alpha = 0.5;
    tracerMaterial.alphaMode = 1; // additive, so it never occludes a target

    for (let i = 0; i < POOL_SIZE; i += 1) {
      // A unit-length cylinder along Z, scaled per shot to span the trace.
      const mesh = MeshBuilder.CreateCylinder(
        `vfx-tracer-${i}`,
        { height: 1, diameter: 0.018, tessellation: 5 },
        scene,
      );
      mesh.rotation.x = Math.PI / 2; // point along +Z so lookAt orients it
      mesh.bakeCurrentTransformIntoVertices();
      mesh.material = tracerMaterial;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.tracers.push({ mesh, until: 0 });
    }

    // ---- impact pool ---------------------------------------------------
    const sparkTexture = radialSprite(
      scene,
      "vfx-spark",
      "rgba(255,238,196,1)",
      "rgba(255,150,52,0.8)",
    );
    const dustTexture = radialSprite(
      scene,
      "vfx-dust",
      "rgba(188,182,170,0.55)",
      "rgba(120,116,108,0.25)",
    );

    const impactFlash = new StandardMaterial("vfx-impact-flash", scene);
    impactFlash.diffuseTexture = sparkTexture;
    impactFlash.opacityTexture = sparkTexture;
    impactFlash.emissiveColor = new Color3(1, 0.78, 0.42);
    impactFlash.disableLighting = true;
    impactFlash.backFaceCulling = false;
    impactFlash.alphaMode = 1; // additive
    this.impactFlashMaterial = impactFlash;

    for (let i = 0; i < POOL_SIZE; i += 1) {
      this.impacts.push(this.createImpact(i, sparkTexture, dustTexture));
    }

    // Only a few: more than this on screen at once is a mortar barrage, not a
    // 6v6 alpha, and each one carries three particle systems and a light.
    for (let i = 0; i < BLAST_POOL; i += 1) {
      this.blasts.push(this.createBlast(i, sparkTexture, dustTexture));
    }

    // Keep these out of the scene's GlowLayer.
    //
    // The yard runs a GlowLayer for the sodium lamps, and it treats any
    // emissive material as a light source to bloom. A 3.5 cm emissive tracer
    // came out as a metre-wide white beam that washed out the whole frame and
    // completely hid the impact sparks — the effects were firing correctly and
    // were simply invisible inside the glare.
    for (const layer of scene.effectLayers) {
      if (typeof (layer as { addExcludedMesh?: unknown }).addExcludedMesh !== "function") continue;
      const glow = layer as unknown as { addExcludedMesh: (m: Mesh) => void };
      glow.addExcludedMesh(this.flash);
      for (const tracer of this.tracers) glow.addExcludedMesh(tracer.mesh);
      // A 5.5 m emissive quad is a far worse offender than the tracer that
      // prompted this: bloomed, one explosion whites out the entire frame.
      for (const blast of this.blasts) glow.addExcludedMesh(blast.flash);
    }
  }

  private createImpact(index: number, spark: Texture, dust: Texture): Impact {
    const scene = this.scene;

    const sparks = new ParticleSystem(`vfx-sparks-${index}`, 64, scene);
    sparks.particleTexture = spark;
    sparks.emitter = Vector3.Zero();
    sparks.minSize = 0.05;
    sparks.maxSize = 0.16;
    sparks.minLifeTime = 0.1;
    sparks.maxLifeTime = 0.32;
    sparks.emitRate = 600;
    sparks.minEmitPower = 3.2;
    sparks.maxEmitPower = 8.5;
    sparks.updateSpeed = 0.016;
    sparks.gravity = new Vector3(0, -18, 0);
    sparks.color1 = new Color4(1, 0.86, 0.5, 1);
    sparks.color2 = new Color4(1, 0.52, 0.16, 1);
    sparks.colorDead = new Color4(0.5, 0.16, 0.04, 0);
    sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
    sparks.disposeOnStop = false;

    const dustSystem = new ParticleSystem(`vfx-dust-${index}`, 40, scene);
    dustSystem.particleTexture = dust;
    dustSystem.emitter = Vector3.Zero();
    dustSystem.minSize = 0.22;
    dustSystem.maxSize = 0.75;
    dustSystem.minLifeTime = 0.25;
    dustSystem.maxLifeTime = 0.65;
    dustSystem.emitRate = 220;
    dustSystem.minEmitPower = 0.5;
    dustSystem.maxEmitPower = 1.9;
    dustSystem.updateSpeed = 0.016;
    dustSystem.gravity = new Vector3(0, -1.2, 0);
    dustSystem.color1 = new Color4(0.72, 0.7, 0.66, 0.5);
    dustSystem.color2 = new Color4(0.5, 0.49, 0.47, 0.35);
    dustSystem.colorDead = new Color4(0.4, 0.39, 0.38, 0);
    dustSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    dustSystem.disposeOnStop = false;

    const light = new PointLight(`vfx-impact-light-${index}`, Vector3.Zero(), scene);
    light.diffuse = new Color3(1, 0.7, 0.35);
    light.intensity = 0;
    light.range = 9;

    const flash = MeshBuilder.CreatePlane(`vfx-impact-flash-${index}`, { size: 1 }, scene);
    flash.material = this.impactFlashMaterial;
    flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
    flash.isPickable = false;
    flash.setEnabled(false);

    return { sparks, dust: dustSystem, light, flash, until: 0 };
  }

  /**
   * Keep the muzzle flash's light off the given meshes.
   *
   * The flash light exists to throw the yard into relief for a frame. It sits
   * *at* the muzzle, which is centimetres from the weapon viewmodel, so with
   * inverse-square falloff the gun received orders of magnitude more light
   * than anything else and rendered as a solid white blob every time the
   * player fired. Excluding the viewmodel keeps the effect where it is wanted.
   */
  excludeFromFlash(meshes: readonly AbstractMesh[]): void {
    this.flashLight.excludedMeshes.push(...meshes);
  }

  /**
   * Fire one round.
   *
   * @param origin  muzzle position, for the flash and the tracer's start
   * @param eye     eye position — the trace starts here, not at the muzzle,
   *                because the muzzle sits below and right of the sight line
   *                and tracing from it makes rounds land off-centre from the
   *                crosshair at close range
   * @param direction normalised aim direction
   */
  /** Where a round fired from `eye` would land on world geometry. */
  trace(eye: Vector3, direction: Vector3): ShotTrace {
    return traceShot(
      { x: eye.x, y: eye.y, z: eye.z },
      { x: direction.x, y: direction.y, z: direction.z },
      this.map,
    );
  }

  fire(origin: Vector3, eye: Vector3, direction: Vector3, override?: Vec3, heavy = false): void {
    const now = performance.now();

    // ---- muzzle flash
    this.flash.position.copyFrom(origin);
    this.flash.scaling.setAll(0.75 + Math.random() * 0.5);
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.setEnabled(true);

    // The light sits ahead of the muzzle, not on it.
    //
    // Its job is to throw the yard into relief for one frame. Placed at the
    // muzzle it is centimetres from the weapon, and inverse-square falloff
    // meant the viewmodel received orders of magnitude more light than the
    // scene and rendered pure white on every shot. `excludedMeshes` did not
    // help: the viewmodel is instantiated from an asset container, and
    // instances take their lighting from the source mesh. Moving the light
    // 0.9 m downrange fixes it geometrically instead of fighting the
    // instancing.
    this.flashLight.position.copyFrom(origin.add(direction.scale(0.9)));
    this.flashLight.intensity = 30 + Math.random() * 14;
    this.flashUntil = now + FLASH_LIFE;

    // ---- where does it land? Same raycast and same map the server uses.
    // `override` is a closer hit — a training target standing in front of the
    // geometry — so the round stops there instead of passing through it.
    const trace = this.trace(eye, direction);
    const landed = override ?? trace.point;
    const end = toVector(landed);

    this.spawnTracer(origin, end, now);
    if (override || trace.hit) this.spawnImpact(end, direction, now, heavy);
  }

  private spawnTracer(from: Vector3, to: Vector3, now: number): void {
    const tracer = this.tracers[this.nextTracer % this.tracers.length];
    this.nextTracer += 1;
    if (!tracer) return;

    const delta = to.subtract(from);
    const length = delta.length();
    if (length < 0.05) return;

    tracer.mesh.position.copyFrom(from.add(delta.scale(0.5)));
    tracer.mesh.lookAt(to);
    tracer.mesh.scaling.set(1, 1, length);
    tracer.mesh.setEnabled(true);
    tracer.until = now + TRACER_LIFE;
  }

  /**
   * @param heavy a hit on a person rather than on concrete — a much larger,
   *   longer burst, because a body taking a round has to read completely
   *   differently from a ricochet off a wall or the player cannot tell whether
   *   they connected.
   */
  private spawnImpact(at: Vector3, direction: Vector3, now: number, heavy = false): void {
    // Recolour for the surface being hit. Concrete throws bright orange
    // sparks; a body does not, and firing ricochet colours at a person was
    // both wrong and unreadable — the player could not tell a hit on a wall
    // from a hit on a man.
    const impactNow = this.impacts[this.nextImpact % this.impacts.length];
    if (impactNow) {
      if (heavy) {
        impactNow.sparks.color1 = new Color4(0.62, 0.05, 0.05, 1);
        impactNow.sparks.color2 = new Color4(0.34, 0.02, 0.02, 1);
        impactNow.sparks.colorDead = new Color4(0.14, 0.01, 0.01, 0);
        impactNow.dust.color1 = new Color4(0.42, 0.05, 0.05, 0.55);
        impactNow.dust.color2 = new Color4(0.24, 0.03, 0.03, 0.38);
        impactNow.dust.colorDead = new Color4(0.1, 0.01, 0.01, 0);
        impactNow.light.diffuse = new Color3(0.7, 0.12, 0.1);
      } else {
        impactNow.sparks.color1 = new Color4(1, 0.86, 0.5, 1);
        impactNow.sparks.color2 = new Color4(1, 0.52, 0.16, 1);
        impactNow.sparks.colorDead = new Color4(0.5, 0.16, 0.04, 0);
        impactNow.dust.color1 = new Color4(0.72, 0.7, 0.66, 0.5);
        impactNow.dust.color2 = new Color4(0.5, 0.49, 0.47, 0.35);
        impactNow.dust.colorDead = new Color4(0.4, 0.39, 0.38, 0);
        impactNow.light.diffuse = new Color3(1, 0.7, 0.35);
      }
    }

    const impact = this.impacts[this.nextImpact % this.impacts.length];
    this.nextImpact += 1;
    if (!impact) return;

    // Lift off the surface slightly so particles are not born inside it.
    const spawn = at.subtract(direction.scale(0.04));

    // Sparks spray back along the incoming round, in a cone.
    const back = direction.scale(-1);
    impact.sparks.emitter = spawn;
    impact.sparks.direction1 = back.add(new Vector3(-0.75, -0.35, -0.75));
    impact.sparks.direction2 = back.add(new Vector3(0.75, 0.9, 0.75));
    const scale = heavy ? 2.6 : 1.0;
    impact.sparks.manualEmitCount = Math.floor((30 + Math.random() * 16) * scale);
    impact.sparks.start();

    impact.dust.emitter = spawn;
    impact.dust.direction1 = back.add(new Vector3(-0.5, 0.1, -0.5));
    impact.dust.direction2 = back.add(new Vector3(0.5, 0.7, 0.5));
    impact.dust.manualEmitCount = Math.floor((16 + Math.random() * 8) * scale);
    impact.dust.start();

    impact.light.position.copyFrom(spawn);
    impact.light.intensity = (40 + Math.random() * 18) * (heavy ? 0.5 : 1.0);

    // Grow with distance so a hit is as readable across the yard as it is at
    // point blank, but clamped so a close impact does not fill the screen.
    const camera = this.scene.activeCamera;
    const distance = camera ? Vector3.Distance(camera.globalPosition, spawn) : 10;
    const size = Math.min(2.2, 0.3 + distance * 0.035);
    impact.flash.position.copyFrom(spawn);
    impact.flash.scaling.setAll(size * (0.85 + Math.random() * 0.3));
    impact.flash.rotation.z = Math.random() * Math.PI;
    impact.flash.setEnabled(true);

    impact.until = now + (heavy ? 620 : 340);
  }

  /**
   * Draw a tracer between two points with no muzzle flash or impact.
   *
   * Used for incoming fire: the shot came from someone else's weapon, so the
   * player should see the round cross the yard without a flash appearing at
   * their own muzzle.
   */
  tracerOnly(from: Vec3, to: Vec3): void {
    this.spawnTracer(
      new Vector3(from.x, from.y, from.z),
      new Vector3(to.x, to.y, to.z),
      performance.now(),
    );
  }

  /** Advance and retire effects. Call once per frame. */
  private createBlast(index: number, spark: Texture, dust: Texture): Blast {
    const scene = this.scene;

    // Fireball: brief, bright, and thrown outward hard.
    const fire = new ParticleSystem(`vfx-blast-fire-${index}`, 220, scene);
    fire.particleTexture = spark;
    fire.emitter = Vector3.Zero();
    fire.createSphereEmitter(0.6);
    fire.minSize = 0.5;
    fire.maxSize = 2.4;
    fire.minLifeTime = 0.14;
    fire.maxLifeTime = 0.42;
    fire.emitRate = 0; // burst, see `explode`
    fire.minEmitPower = 6;
    fire.maxEmitPower = 20;
    fire.updateSpeed = 0.016;
    fire.gravity = new Vector3(0, 2.5, 0);
    fire.color1 = new Color4(1, 0.94, 0.66, 1);
    fire.color2 = new Color4(1, 0.5, 0.12, 1);
    fire.colorDead = new Color4(0.35, 0.09, 0.02, 0);
    fire.blendMode = ParticleSystem.BLENDMODE_ADD;
    fire.disposeOnStop = false;

    // Smoke outlives the fireball by a long way — it is what remains to show
    // where the grenade went off after the light is gone.
    const smoke = new ParticleSystem(`vfx-blast-smoke-${index}`, 160, scene);
    smoke.particleTexture = dust;
    smoke.emitter = Vector3.Zero();
    smoke.createSphereEmitter(0.9);
    smoke.minSize = 1.2;
    smoke.maxSize = 4.2;
    smoke.minLifeTime = 0.7;
    smoke.maxLifeTime = 1.9;
    smoke.emitRate = 0;
    smoke.minEmitPower = 1.2;
    smoke.maxEmitPower = 5;
    smoke.updateSpeed = 0.016;
    smoke.gravity = new Vector3(0, 1.1, 0);
    smoke.color1 = new Color4(0.34, 0.32, 0.3, 0.72);
    smoke.color2 = new Color4(0.18, 0.17, 0.16, 0.5);
    smoke.colorDead = new Color4(0.12, 0.12, 0.12, 0);
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.disposeOnStop = false;

    // Fragments thrown along the ground. Heavy gravity so they arc and land
    // rather than drifting, which is what separates a blast from a fireball.
    const shards = new ParticleSystem(`vfx-blast-shards-${index}`, 120, scene);
    shards.particleTexture = spark;
    shards.emitter = Vector3.Zero();
    shards.createSphereEmitter(0.3);
    shards.minSize = 0.04;
    shards.maxSize = 0.13;
    shards.minLifeTime = 0.35;
    shards.maxLifeTime = 0.95;
    shards.emitRate = 0;
    shards.minEmitPower = 9;
    shards.maxEmitPower = 26;
    shards.updateSpeed = 0.016;
    shards.gravity = new Vector3(0, -24, 0);
    shards.color1 = new Color4(1, 0.85, 0.5, 1);
    shards.color2 = new Color4(0.95, 0.42, 0.1, 1);
    shards.colorDead = new Color4(0.3, 0.1, 0.02, 0);
    shards.blendMode = ParticleSystem.BLENDMODE_ADD;
    shards.disposeOnStop = false;

    const light = new PointLight(`vfx-blast-light-${index}`, Vector3.Zero(), scene);
    light.diffuse = new Color3(1, 0.66, 0.3);
    light.intensity = 0;
    light.range = 26;

    const flash = MeshBuilder.CreatePlane(`vfx-blast-flash-${index}`, { size: 1 }, scene);
    flash.material = this.impactFlashMaterial;
    flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
    flash.isPickable = false;
    flash.setEnabled(false);

    return { fire, smoke, shards, light, flash, until: 0 };
  }

  /**
   * A grenade detonating at `at`.
   *
   * Presentation only — the blast that matters already happened in the
   * simulation, which decided who it hurt. This is what the player sees, and
   * it is deliberately loud: an explosion the player cannot locate is worse
   * than no explosion, because they cannot learn to move away from the next
   * one.
   */
  explode(at: Vector3): void {
    const now = performance.now();
    const blast = this.blasts[this.nextBlast % this.blasts.length];
    this.nextBlast += 1;
    if (!blast) return;

    // Lift the emitters slightly. A grenade rests on the floor, and a sphere
    // emitter centred there buries half the fireball in the ground.
    const centre = new Vector3(at.x, at.y + 0.35, at.z);
    blast.fire.emitter = centre;
    blast.smoke.emitter = centre;
    blast.shards.emitter = centre;
    blast.light.position = centre;
    blast.flash.position = centre;
    // Roughly the lethal radius, so the flash reads as the size of the thing
    // that just happened rather than as a generic spark.
    blast.flash.scaling.setAll(5.5);
    blast.flash.visibility = 1;
    blast.flash.setEnabled(true);

    // A burst, emitted in one step — `manualEmitCount` with `emitRate = 0`.
    //
    // The obvious alternative is to emit at a high rate for a short window and
    // then stop, and every way of timing that window is wrong here. A
    // `setTimeout` measures wall-clock and expires between frames on a slow
    // machine, so nothing is emitted at all; checking the deadline in `update`
    // has the same failure whenever one frame is longer than the window; and
    // `targetStopDuration` leaves the system reporting `isStarted() === false`,
    // which makes Babylon skip animating it entirely, freezing its particles at
    // full count so they are neither drawn nor retired.
    //
    // An explosion is a burst rather than a stream, so saying exactly that
    // removes the timing question completely: the count is the count whether
    // the frame took 4 ms or 400.
    blast.fire.stop();
    blast.smoke.stop();
    blast.shards.stop();
    blast.fire.manualEmitCount = FIRE_BURST;
    blast.shards.manualEmitCount = SHARD_BURST;
    blast.smoke.manualEmitCount = SMOKE_BURST;
    blast.fire.start();
    blast.smoke.start();
    blast.shards.start();

    blast.light.intensity = 220;
    blast.until = now + BLAST_LIFE;
  }

  update(): void {
    const now = performance.now();

    if (this.flashUntil && now >= this.flashUntil) {
      this.flash.setEnabled(false);
      this.flashLight.intensity = 0;
      this.flashUntil = 0;
    } else if (this.flashUntil) {
      // Decay across the flash's short life rather than cutting out.
      const remaining = (this.flashUntil - now) / FLASH_LIFE;
      this.flashLight.intensity = 46 * remaining;
      this.flash.visibility = Math.max(0.15, remaining);
    }

    for (const tracer of this.tracers) {
      if (tracer.until && now >= tracer.until) {
        tracer.mesh.setEnabled(false);
        tracer.until = 0;
      }
    }

    for (const blast of this.blasts) {
      if (!blast.until) continue;

      const remaining = (blast.until - now) / BLAST_LIFE;
      // Quartic falloff: the light should read as a flash that dies, not as a
      // lamp someone switched on for a second.
      blast.light.intensity = Math.max(0, 220 * remaining * remaining * remaining * remaining);
      // The flash is the briefest part — a fireball, not a fire.
      const flashLeft = (remaining - 0.82) / 0.18;
      if (flashLeft <= 0) {
        blast.flash.setEnabled(false);
      } else {
        blast.flash.visibility = flashLeft;
        blast.flash.scaling.setAll(5.5 + (1 - flashLeft) * 3.5);
      }

      if (now >= blast.until) {
        blast.light.intensity = 0;
        blast.flash.setEnabled(false);
        blast.fire.stop();
        blast.smoke.stop();
        blast.shards.stop();
        blast.until = 0;
      }
    }

    for (const impact of this.impacts) {
      if (!impact.until) continue;
      const remaining = (impact.until - now) / 340; // decay reference, not the exact life
      impact.light.intensity = Math.max(0, 20 * remaining);
      // The flash is the briefest part: it is a spark of light, not a fire.
      impact.flash.visibility = Math.max(0, (remaining - 0.72) / 0.28);
      if (remaining < 0.72) impact.flash.setEnabled(false);

      if (now >= impact.until) {
        impact.sparks.stop();
        impact.dust.stop();
        impact.light.intensity = 0;
        impact.flash.setEnabled(false);
        impact.until = 0;
      }
    }
  }

  dispose(): void {
    this.flash.dispose();
    this.flashLight.dispose();
    for (const blast of this.blasts) {
      blast.flash.dispose();
      blast.fire.dispose();
      blast.smoke.dispose();
      blast.shards.dispose();
      blast.light.dispose();
    }
    for (const tracer of this.tracers) tracer.mesh.dispose();
    for (const impact of this.impacts) {
      impact.sparks.dispose();
      impact.dust.dispose();
      impact.light.dispose();
      impact.flash.dispose();
    }
  }
}
