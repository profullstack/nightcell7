import type { Scene, Texture } from "@babylonjs/core";
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

    this.flash = MeshBuilder.CreatePlane("vfx-flash", { size: 0.38 }, scene);
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
    tracerMaterial.emissiveColor = new Color3(1, 0.75, 0.38);
    tracerMaterial.disableLighting = true;
    tracerMaterial.alpha = 0.85;

    for (let i = 0; i < POOL_SIZE; i += 1) {
      // A unit-length cylinder along Z, scaled per shot to span the trace.
      const mesh = MeshBuilder.CreateCylinder(
        `vfx-tracer-${i}`,
        { height: 1, diameter: 0.035, tessellation: 5 },
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

    for (let i = 0; i < POOL_SIZE; i += 1) {
      this.impacts.push(this.createImpact(i, sparkTexture, dustTexture));
    }
  }

  private createImpact(index: number, spark: Texture, dust: Texture): Impact {
    const scene = this.scene;

    const sparks = new ParticleSystem(`vfx-sparks-${index}`, 26, scene);
    sparks.particleTexture = spark;
    sparks.emitter = Vector3.Zero();
    sparks.minSize = 0.02;
    sparks.maxSize = 0.07;
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

    const dustSystem = new ParticleSystem(`vfx-dust-${index}`, 18, scene);
    dustSystem.particleTexture = dust;
    dustSystem.emitter = Vector3.Zero();
    dustSystem.minSize = 0.12;
    dustSystem.maxSize = 0.42;
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
    light.range = 6;

    return { sparks, dust: dustSystem, light, until: 0 };
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
  fire(origin: Vector3, eye: Vector3, direction: Vector3): void {
    const now = performance.now();

    // ---- muzzle flash
    this.flash.position.copyFrom(origin);
    this.flash.scaling.setAll(0.85 + Math.random() * 0.5);
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.setEnabled(true);
    this.flashLight.position.copyFrom(origin);
    this.flashLight.intensity = 55 + Math.random() * 25;
    this.flashUntil = now + FLASH_LIFE;

    // ---- where does it land? Same raycast and same map the server uses.
    const trace = traceShot(
      { x: eye.x, y: eye.y, z: eye.z },
      { x: direction.x, y: direction.y, z: direction.z },
      this.map,
    );
    const end = toVector(trace.point);

    this.spawnTracer(origin, end, now);
    if (trace.hit) this.spawnImpact(end, direction, now);
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

  private spawnImpact(at: Vector3, direction: Vector3, now: number): void {
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
    impact.sparks.manualEmitCount = 14 + Math.floor(Math.random() * 10);
    impact.sparks.start();

    impact.dust.emitter = spawn;
    impact.dust.direction1 = back.add(new Vector3(-0.5, 0.1, -0.5));
    impact.dust.direction2 = back.add(new Vector3(0.5, 0.7, 0.5));
    impact.dust.manualEmitCount = 8 + Math.floor(Math.random() * 6);
    impact.dust.start();

    impact.light.position.copyFrom(spawn);
    impact.light.intensity = 14 + Math.random() * 8;
    impact.until = now + 340;
  }

  /** Advance and retire effects. Call once per frame. */
  update(): void {
    const now = performance.now();

    if (this.flashUntil && now >= this.flashUntil) {
      this.flash.setEnabled(false);
      this.flashLight.intensity = 0;
      this.flashUntil = 0;
    } else if (this.flashUntil) {
      // Decay across the flash's short life rather than cutting out.
      const remaining = (this.flashUntil - now) / FLASH_LIFE;
      this.flashLight.intensity = 80 * remaining;
      this.flash.visibility = Math.max(0.15, remaining);
    }

    for (const tracer of this.tracers) {
      if (tracer.until && now >= tracer.until) {
        tracer.mesh.setEnabled(false);
        tracer.until = 0;
      }
    }

    for (const impact of this.impacts) {
      if (!impact.until) continue;
      const remaining = (impact.until - now) / 340;
      impact.light.intensity = Math.max(0, 20 * remaining);
      if (now >= impact.until) {
        impact.sparks.stop();
        impact.dust.stop();
        impact.light.intensity = 0;
        impact.until = 0;
      }
    }
  }

  dispose(): void {
    this.flash.dispose();
    this.flashLight.dispose();
    for (const tracer of this.tracers) tracer.mesh.dispose();
    for (const impact of this.impacts) {
      impact.sparks.dispose();
      impact.dust.dispose();
      impact.light.dispose();
    }
  }
}
