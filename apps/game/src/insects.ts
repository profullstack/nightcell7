import type { AbstractMesh, Camera, TransformNode } from "@babylonjs/core";
import { Color3, PBRMaterial, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { InsectBiteState } from "@nightcell7/game-core";

import type { AssetSet } from "./assets";
import { placeAll } from "./assets";

/**
 * Night ambience: drifting fireflies, and the one mosquito that bothers you.
 *
 * Presentation only. Whether a bite happens, and when, is decided by
 * `stepInsectBite` in `game-core`; this file's job is to make sure a mosquito
 * is visibly on its way in before the bite lands and visibly gone afterwards,
 * so the health tick has a cause the player can see. Nothing here subtracts
 * health or reads input — Babylon owns per-frame presentation and nothing else
 * (CLAUDE.md, "Game architecture").
 *
 * Only built at night. `LIGHTING[time].insects` is the switch, and by day this
 * class is never constructed.
 */

/**
 * Fireflies in the yard.
 *
 * Twelve is a deliberate ceiling. They are instantiated as *unique* meshes
 * rather than hardware instances, which costs a draw call each, because an
 * instance shares its source's material and a shared material can only flash
 * all twelve in unison — which looks like a string of fairy lights on a timer
 * rather than insects. Twelve unique lanterns pulsing out of phase is the
 * whole effect, and twelve draw calls in a yard that already draws well over a
 * hundred props is a price worth paying for it.
 */
const FIREFLY_COUNT = 12;

/**
 * Wingbeat, in flaps per second.
 *
 * Nowhere near the truth: a mosquito beats near 600 Hz and a firefly near 45.
 * Both alias into a strobing mess at 60 fps — below about 12 Hz is the most
 * that samples cleanly, and past it the wing appears to crawl backwards or
 * stand still. Games solve this with a blurred fan; at 16 mm the honest
 * cheap answer is a fast readable flutter that says "flying" and gets out of
 * the way. The whine carries the real frequency instead, where the ear can
 * actually resolve it.
 */
const WINGBEAT_HZ = 9;

/** Yard bounds to scatter within, in metres. Matches Ardavan Yard's footprint. */
const FIELD = { x: 34, zNear: -46, zFar: 52, yLow: 0.6, yHigh: 6.5 } as const;

interface Firefly {
  readonly root: TransformNode;
  readonly lantern: PBRMaterial | StandardMaterial | null;
  /** The membrane mesh, flapped as one; see `WINGBEAT_HZ`. */
  readonly wings: AbstractMesh | null;
  /** Centre of this one's wander, so the swarm stays spread out. */
  readonly home: Vector3;
  readonly radius: number;
  /** Seconds between flashes, and where in that cycle this one starts. */
  readonly period: number;
  phase: number;
  wander: number;
}

export interface NightInsectsOptions {
  readonly camera: Camera;
  /** Deterministic in tests, `Math.random` in play. */
  readonly random?: () => number;
}

export class NightInsects {
  private readonly fireflies: Firefly[] = [];
  private readonly mosquito: TransformNode | null = null;
  private readonly mosquitoWings: AbstractMesh | null = null;
  private readonly camera: Camera;
  /** 0 = parked offscreen, 1 = at the player's ear. Eased, never snapped. */
  private approach = 0;
  private mosquitoAngle = 0;
  private elapsed = 0;

  constructor(assets: AssetSet, options: NightInsectsOptions) {
    this.camera = options.camera;
    const rand = options.random ?? Math.random;

    const fireflyModel = assets.models.get("m3_firefly");
    if (fireflyModel) {
      const placements = Array.from({ length: FIREFLY_COUNT }, () => ({
        position: new Vector3(
          (rand() * 2 - 1) * FIELD.x,
          FIELD.yLow + rand() * (FIELD.yHigh - FIELD.yLow),
          FIELD.zNear + rand() * (FIELD.zFar - FIELD.zNear),
        ),
        rotationY: rand() * Math.PI * 2,
      }));

      const roots = placeAll(fireflyModel, "firefly", placements, { unique: true });
      roots.forEach((root, index) => {
        const placed = placements[index]!;
        this.fireflies.push({
          root,
          lantern: lanternMaterial(root),
          wings: membrane(root),
          home: placed.position.clone(),
          radius: 0.8 + rand() * 2.4,
          period: 3.2 + rand() * 3.0,
          phase: rand() * 6.2,
          wander: rand() * 6.2,
        });
      });
    }

    const mosquitoModel = assets.models.get("m3_mosquito");
    if (mosquitoModel) {
      const [root] = placeAll(mosquitoModel, "mosquito", [{ position: new Vector3(0, -50, 0) }], {
        unique: true,
      });
      this.mosquito = root ?? null;
      this.mosquitoWings = root ? membrane(root) : null;
      // Parked far below the yard until it is wanted; it is a single insect
      // and hiding it costs less than creating and destroying one per bite.
      if (this.mosquito) this.mosquito.setEnabled(false);
    }
  }

  /**
   * Advance the ambience.
   *
   * `bite` is the state `stepInsectBite` returned this tick. The mosquito's
   * approach is driven off `nextBiteAt` so that it is already in frame when
   * the bite lands, rather than teleporting in on the same tick the health
   * drops — a hit with no visible cause reads as a bug.
   */
  update(deltaMs: number, nowMs: number, bite: Readonly<InsectBiteState>): void {
    const dt = Math.min(deltaMs, 100) / 1000;
    this.elapsed += dt;

    for (const fly of this.fireflies) {
      fly.wander += dt * 0.35;
      // A slow Lissajous drift around the home point. Cheap, non-repeating
      // enough at this scale, and it keeps them from all moving in step.
      fly.root.position.set(
        fly.home.x + Math.sin(fly.wander * 0.9) * fly.radius,
        fly.home.y + Math.sin(fly.wander * 1.7) * fly.radius * 0.35,
        fly.home.z + Math.cos(fly.wander * 1.3) * fly.radius,
      );
      fly.root.rotation.y = Math.atan2(Math.cos(fly.wander * 0.9), -Math.sin(fly.wander * 1.3));

      // Both wings are one mesh (the exporter joins by material), which is
      // no loss: an insect beats its pair in sync anyway.
      if (fly.wings) {
        fly.wings.rotation.x = Math.sin(this.elapsed * WINGBEAT_HZ * Math.PI * 2) * 0.42;
      }

      if (!fly.lantern) continue;
      fly.phase += dt;
      // Photinus flashes in short pulses with long gaps, not a sine wave. A
      // sharp attack and a slower decay is what reads as a firefly.
      const t = (fly.phase % fly.period) / fly.period;
      const pulse = t < 0.14 ? Math.sin((t / 0.14) * Math.PI) ** 0.6 : 0;
      setLantern(fly.lantern, pulse);
    }

    this.updateMosquito(dt, nowMs, bite);
  }

  private updateMosquito(dt: number, nowMs: number, bite: Readonly<InsectBiteState>): void {
    const mosquito = this.mosquito;
    if (!mosquito) return;

    const scratching = nowMs < bite.scratchUntil;
    const untilBite = bite.nextBiteAt - nowMs;
    // Come in over the last two and a half seconds; leave during the scratch.
    const wanted = scratching ? 0 : untilBite < 2500 && untilBite > -200 ? 1 : 0;
    this.approach += (wanted - this.approach) * Math.min(1, dt * (wanted > 0 ? 1.6 : 3.2));

    if (this.approach < 0.01) {
      if (mosquito.isEnabled()) mosquito.setEnabled(false);
      return;
    }
    if (!mosquito.isEnabled()) {
      mosquito.setEnabled(true);
      // Pick the side it comes from once per visit, not per frame.
      this.mosquitoAngle = Math.random() * Math.PI * 2;
    }

    // Orbit the camera, closing from about two metres to just off the ear.
    const distance = 2.2 - 1.9 * this.approach;
    const bob = Math.sin(this.elapsed * 11) * 0.03 * this.approach;
    const angle = this.mosquitoAngle + this.elapsed * 0.9;
    const origin = this.camera.globalPosition;

    mosquito.position.set(
      origin.x + Math.cos(angle) * distance,
      origin.y - 0.12 + bob,
      origin.z + Math.sin(angle) * distance,
    );
    mosquito.rotation.y = -angle + Math.PI / 2;
    if (this.mosquitoWings) {
      this.mosquitoWings.rotation.x = Math.sin(this.elapsed * WINGBEAT_HZ * Math.PI * 2) * 0.5;
    }
    // It is 14 mm long. Without a lift toward the camera it is a subpixel
    // speck exactly when the player is meant to notice it.
    const scale = 1 + 6 * this.approach;
    mosquito.scaling.setAll(scale);
  }

  /**
   * How close the mosquito is, 0 to 1. Drives the whine in `main.ts`.
   *
   * Exposed rather than the class owning the sound, because audio belongs to
   * `GameAudio` and this file is presentation only.
   */
  get mosquitoNearness(): number {
    return this.approach;
  }

  dispose(): void {
    for (const fly of this.fireflies) fly.root.dispose();
    this.mosquito?.dispose();
    this.fireflies.length = 0;
  }
}

/** The membrane mesh — both wings, joined by the exporter into one material. */
function membrane(root: TransformNode): AbstractMesh | null {
  return root.getChildMeshes().find((m) => m.material?.name.includes("ir_membrane")) ?? null;
}

/** The lantern mesh's own material, cloned per firefly by `unique` placement. */
function lanternMaterial(root: TransformNode): PBRMaterial | StandardMaterial | null {
  const mesh = root
    .getChildMeshes()
    .find((m: AbstractMesh) => m.material?.name.includes("firefly_lantern"));
  const material = mesh?.material;
  if (material instanceof PBRMaterial || material instanceof StandardMaterial) {
    // Each unique placement must not share this, or the whole swarm flashes
    // together. Cloning here is what makes the per-firefly phase visible.
    const own = material.clone(`${material.name}_${root.name}`);
    if (own && mesh) mesh.material = own;
    return own ?? material;
  }
  return null;
}

/** Yellow-green, scaled by the flash envelope. */
function setLantern(material: PBRMaterial | StandardMaterial, pulse: number): void {
  const level = 0.06 + pulse * 2.6;
  const colour = new Color3(0.86 * level, 1.0 * level, 0.26 * level);
  if (material instanceof PBRMaterial) material.emissiveColor = colour;
  else material.emissiveColor = colour;
}
