import type { AbstractMesh, Camera, Scene, TransformNode } from "@babylonjs/core";
import {
  Color3,
  Color4,
  PBRMaterial,
  Sprite,
  SpriteManager,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
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
const FIREFLY_COUNT = 18;

/**
 * Distance scaling for the lantern, in size per metre of range.
 *
 * A firefly is 25 mm. At a 90-degree field of view a 1920-wide frame resolves
 * about 0.0008 rad per pixel, so past roughly 30 m the animal is under one
 * pixel: not dim, *gone*, and the GlowLayer cannot bloom what was never
 * rasterised. The first cut scattered 12 of them across the whole 68 x 98 m
 * yard at true scale and the result was nothing a player would ever notice.
 *
 * So the lantern holds an angular size instead, the same trick the mosquito
 * uses as it closes. 0.1 puts the crossover near 10 m: nearer than that it is
 * exactly its real 25 mm, further out it keeps about three pixels of glow.
 */
const LANTERN_SCALE_PER_METRE = 0.1;
const LANTERN_SCALE_MAX = 10;

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
const FIELD = { x: 30, zNear: -42, zFar: 48, yLow: 0.5, yHigh: 4.2 } as const;

/**
 * Screen size, in pixels, the lantern glow is held at.
 *
 * The mesh alone cannot carry this. A firefly is 25 mm and the lantern is
 * about a third of it, so even scaled until the whole insect spans three
 * pixels the *glowing* part is still one — which is why two playtests and
 * every pixel measurement found nothing. A camera-facing sprite sized in
 * screen space is the standard answer for a distant point light, and it costs
 * one draw call for the whole swarm rather than one per insect.
 */
// Tuned down after a playtest read the first version as *explosions*: 18 px at
// high alpha over a 26% duty cycle is a sustained bright blob, which is what an
// explosion looks like. A firefly is a small point that blinks briefly, so the
// flash is now short and the glow stays a few pixels.
const GLOW_PIXELS_RESTING = 2.5;
const GLOW_PIXELS_FLASH = 10;

/** A soft radial dot, built at runtime so the swarm ships no texture file. */
function glowTextureUrl(): string {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, "rgba(255,255,235,1)");
  g.addColorStop(0.25, "rgba(226,255,90,0.95)");
  g.addColorStop(0.55, "rgba(150,220,40,0.35)");
  g.addColorStop(1.0, "rgba(120,200,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas.toDataURL();
}

interface Firefly {
  readonly root: TransformNode;
  readonly lantern: PBRMaterial | StandardMaterial | null;
  /** The membrane mesh, flapped as one; see `WINGBEAT_HZ`. */
  readonly wings: AbstractMesh | null;
  /** The camera-facing glow; this, not the mesh, is what a player sees. */
  readonly glow: Sprite | null;
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
  private readonly glows: SpriteManager | null = null;
  private readonly engineHeight: () => number;
  /** 0 = parked offscreen, 1 = at the player's ear. Eased, never snapped. */
  private approach = 0;
  private mosquitoAngle = 0;
  private elapsed = 0;

  constructor(scene: Scene, assets: AssetSet, options: NightInsectsOptions) {
    this.camera = options.camera;
    this.engineHeight = () => scene.getEngine().getRenderHeight();

    const url = glowTextureUrl();
    if (url) {
      // One manager, one draw call, one texture for the whole swarm.
      this.glows = new SpriteManager("firefly-glow", url, FIREFLY_COUNT, 64, scene);
      this.glows.isPickable = false;
      // Additive, so a lantern brightens the yard behind it rather than
      // punching a grey square into it.
      this.glows.blendMode = 1; // BLENDMODE_ADD
    }
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
          glow: this.glows ? new Sprite(`firefly-glow-${index}`, this.glows) : null,
          home: placed.position.clone(),
          radius: 0.8 + rand() * 2.4,
          period: 2.4 + rand() * 2.4,
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

      // Hold a readable angular size at range; see LANTERN_SCALE_PER_METRE.
      const range = Vector3.Distance(fly.root.position, this.camera.globalPosition);
      fly.root.scaling.setAll(
        Math.min(LANTERN_SCALE_MAX, Math.max(1, range * LANTERN_SCALE_PER_METRE)),
      );

      // Both wings are one mesh (the exporter joins by material), which is
      // no loss: an insect beats its pair in sync anyway.
      if (fly.wings) {
        fly.wings.rotation.x = Math.sin(this.elapsed * WINGBEAT_HZ * Math.PI * 2) * 0.42;
      }

      // The glow is the firefly, as far as a player at yard range is
      // concerned: held at a fixed pixel size so distance cannot shrink it
      // out of existence.
      if (fly.glow) {
        const range = Math.max(
          0.2,
          Vector3.Distance(fly.root.position, this.camera.globalPosition),
        );
        const t0 = (fly.phase % fly.period) / fly.period;
        const lit = t0 < 0.15 ? Math.sin((t0 / 0.15) * Math.PI) ** 0.8 : 0;
        const px = GLOW_PIXELS_RESTING + lit * (GLOW_PIXELS_FLASH - GLOW_PIXELS_RESTING);
        // World size that subtends `px` pixels at this range.
        const fov = (this.camera as unknown as { fov: number }).fov ?? 1.0;
        const size = 2 * range * Math.tan(fov / 2) * (px / Math.max(1, this.engineHeight()));
        fly.glow.position.copyFrom(fly.root.position);
        fly.glow.width = size;
        fly.glow.height = size;
        fly.glow.color = new Color4(0.78, 1.0, 0.42, 0.1 + lit * 0.5);
      }

      if (!fly.lantern) continue;
      fly.phase += dt;
      // Photinus flashes in short pulses with long gaps, not a sine wave. A
      // sharp attack and a slower decay is what reads as a firefly.
      const t = (fly.phase % fly.period) / fly.period;
      const pulse = t < 0.15 ? Math.sin((t / 0.15) * Math.PI) ** 0.8 : 0;
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

    // Hold it inside the forward view cone while it closes.
    //
    // It used to orbit the head on a free angle, which meant it was as likely
    // to be behind the player as in front at the moment it bit — a playtester
    // saw "something that flies around occasionally with a buzz" and never
    // connected it to anything. Now it weaves across the front, so the thing
    // that bites you is the thing you were just looking at.
    const distance = 2.2 - 1.9 * this.approach;
    const bob = Math.sin(this.elapsed * 11) * 0.03 * this.approach;
    const facing = (this.camera as unknown as { rotation?: { y: number } }).rotation?.y ?? 0;
    // Babylon yaw 0 looks down +Z, so forward is (sin, cos) — and the weave is
    // capped well inside a 90 degree field of view.
    // A hard jink during the swat window, so the wave visibly misses before
    // the bite lands. Outside it the weave is the slow drift.
    const untilBiteS = (bite.nextBiteAt - nowMs) / 1000;
    const dodging = untilBiteS > 0 && untilBiteS < 0.85;
    const weave =
      Math.sin(this.elapsed * 0.7 + this.mosquitoAngle) * 0.6 +
      (dodging ? Math.sin(this.elapsed * 14) * 0.5 : 0);
    const angle = Math.PI / 2 - (facing + weave);
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

  /** Where the mosquito is, for the HUD's directional hit arc. */
  get mosquitoPosition(): Vector3 | null {
    return this.mosquito && this.mosquito.isEnabled() ? this.mosquito.position : null;
  }

  dispose(): void {
    for (const fly of this.fireflies) {
      fly.glow?.dispose();
      fly.root.dispose();
    }
    this.glows?.dispose();
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

/**
 * Yellow-green, scaled by the flash envelope.
 *
 * The resting level is deliberately a real glow rather than the near-black
 * ember a live firefly actually shows between flashes. Strict realism made the
 * swarm imperceptible: with a 26 % duty cycle, three quarters of the animals
 * are dark at any instant, and an unlit 25 mm abdomen tip at yard range is
 * simply not on screen. A soft constant mote with a bright flash on top reads
 * as a field of fireflies; the physically honest version read as an empty
 * yard, which is what a player reported.
 */
function setLantern(material: PBRMaterial | StandardMaterial, pulse: number): void {
  const level = 0.18 + pulse * 1.8;
  const colour = new Color3(0.86 * level, 1.0 * level, 0.26 * level);
  if (material instanceof PBRMaterial) material.emissiveColor = colour;
  else material.emissiveColor = colour;
}
