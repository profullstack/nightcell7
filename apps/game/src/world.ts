import {
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  GlowLayer,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  type AbstractEngine,
  type Camera,
} from "@babylonjs/core";
import { ARDAVAN_YARD, type CollisionMap } from "@nightcell7/multiplayer-sim";
import type { Aabb } from "@nightcell7/multiplayer-sim";
import {
  createTiledMaterial,
  loadAssets,
  meshesUnder,
  placeAll,
  type AssetSet,
  type ModelName,
  type Placement,
} from "./assets";

/**
 * Visual dressing for ARDAVAN YARD.
 *
 * PRD §14.4 "Kaviran night": blue-black base, warm industrial sodium light, and
 * the false-dawn glow on the northern horizon that the episode is named for.
 *
 * Two rules shape this file:
 *
 *  1. Every visible solid is generated FROM the collision data in
 *     `@nightcell7/multiplayer-sim`, so what you see is what you collide with.
 *     Nothing here invents geometry the server does not know about.
 *  2. Volumes are classified by their dimensions rather than by array index.
 *     The collision map is checksum-verified and will be edited; a positional
 *     lookup would silently mis-skin the yard the first time a box moves.
 *
 * The yard used to be skinned with one `MeshBuilder` box per collision volume
 * and canvas-generated noise textures — a greybox. It is now built from the
 * generated model set in `apps/game/public/assets` (see `tools/art`), placed to
 * fill exactly the same volumes. Rule 1 is unchanged and is what keeps the art
 * honest: a prop is tiled or scaled to its volume rather than the volume being
 * adjusted to suit a prop.
 */

/** Palette, mirrored from the site's DIVIDED SIGNAL tokens. */
const PALETTE = {
  ink: new Color3(0.027, 0.035, 0.047),
  concrete: new Color3(0.19, 0.2, 0.21),
  steel: new Color3(0.26, 0.28, 0.31),
  rust: new Color3(0.35, 0.21, 0.14),
  signalRed: new Color3(0.827, 0.227, 0.247),
  signalCyan: new Color3(0.329, 0.741, 0.792),
  dustGold: new Color3(0.678, 0.576, 0.396),
  sodium: new Color3(1.0, 0.71, 0.36),
} as const;

export interface WorldHandles {
  readonly shadows: ShadowGenerator;
  readonly pipeline: DefaultRenderingPipeline;
  readonly assets: AssetSet;
}

interface Volume {
  readonly box: Aabb;
  readonly size: Vector3;
  readonly centre: Vector3;
}

function volumeOf(box: Aabb): Volume {
  const size = new Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
  return {
    box,
    size,
    centre: new Vector3(box.min.x + size.x / 2, box.min.y + size.y / 2, box.min.z + size.z / 2),
  };
}

/**
 * Semantic class of a collision volume, derived from its shape and position.
 * Keeps the skinning stable across map edits.
 */
type VolumeKind =
  | "ground"
  | "perimeter"
  | "deck"
  | "tank"
  | "hardpoint"
  | "pipe_rack"
  | "stair"
  | "container"
  | "block";

function classify(v: Volume, map: CollisionMap): VolumeKind {
  const { size, centre } = v;
  const footprint = size.x * size.z;

  // The ground plane is the only volume that spans essentially the whole map.
  if (footprint > 3000 && size.y <= 2) return "ground";

  // Perimeter walls are tall, thin, and sit on the boundary.
  const onEdge =
    Math.abs(centre.x - map.bounds.min.x) < 3 ||
    Math.abs(centre.x - map.bounds.max.x) < 3 ||
    Math.abs(centre.z - map.bounds.min.z) < 3 ||
    Math.abs(centre.z - map.bounds.max.z) < 3;
  if (onEdge && size.y >= 8) return "perimeter";

  // Catwalk / gantry decks: wide but almost flat, and elevated.
  if (size.y <= 1 && v.box.min.y >= 4) return "deck";

  // Storage tanks: tall footprint blocks on the east lane.
  if (size.y >= 6 && footprint >= 60) return "tank";

  // Ramp steps: the only 1.5 m-tall volumes in the map.
  if (size.y <= 1.6) return "stair";

  // The pipe rack is the one long, mid-height run.
  if (size.y >= 3.5 && Math.max(size.x, size.z) >= 40) return "pipe_rack";

  // The central objective is wide, low and much larger in plan than a
  // container stack. Checked before `container` because it also falls inside
  // that height band.
  if (size.y <= 3.0 && footprint >= 80) return "hardpoint";

  // Shipping containers: the classic yard blocks, and the cross-link stacks.
  if (size.y >= 2 && size.y <= 3.2 && footprint >= 25) return "container";

  return "block";
}

/**
 * Sky: near-black zenith falling to the false-dawn band that sits ON the
 * horizon line.
 *
 * Babylon maps a sphere's V from zenith (0) to nadir (1), so the horizon is
 * v = 0.5 — the whole lower half of this canvas is below the ground plane and
 * never seen. Putting the warm band at the very bottom of the gradient is the
 * easy mistake: it renders correctly and is completely invisible.
 *
 * U is azimuth, which lets the dawn be directional: a broad lobe centred on
 * one quadrant, so the yard has an actual north to read against.
 */
function skyTexture(scene: Scene): DynamicTexture {
  const w = 2048;
  const h = 1024;
  const horizon = h * 0.5;
  const texture = new DynamicTexture("sky", { width: w, height: h }, scene, false);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

  // Zenith -> horizon. Everything below the horizon is occluded by the ground.
  const grad = ctx.createLinearGradient(0, 0, 0, horizon);
  grad.addColorStop(0.0, "#03050a");
  grad.addColorStop(0.42, "#070b14");
  grad.addColorStop(0.7, "#0d1524");
  grad.addColorStop(0.88, "#1b2130");
  grad.addColorStop(1.0, "#2f3038");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, horizon);
  ctx.fillStyle = "#2f3038";
  ctx.fillRect(0, horizon, w, h - horizon);

  // Sparse cold stars, thinning toward the lit horizon.
  for (let i = 0; i < 700; i += 1) {
    const y = Math.pow(Math.random(), 1.6) * horizon * 0.94;
    const x = Math.random() * w;
    const a = 0.3 + Math.random() * 0.55;
    ctx.fillStyle = `rgba(214, 228, 244, ${a * (1 - y / horizon)})`;
    ctx.fillRect(x, y, 1 + (Math.random() > 0.93 ? 1 : 0), 1);
  }

  // The false dawn itself: a wide warm lobe hugging the horizon. Drawn as
  // stacked radial gradients so it falls off in both azimuth and elevation.
  // The false dawn itself.
  //
  // Built as (vertical falloff) x (azimuth mask) on a separate canvas rather
  // than as radial lobes. A radial lobe's outer boundary is a line of constant
  // latitude, and every constant-latitude line projects as a *curve* when the
  // camera pitches — which reads as the edge of a dome sitting over the map.
  // A gradual vertical ramp has no boundary to betray itself.
  const centreU = w * 0.25;
  const bandTop = horizon - h * 0.34;
  const bandHeight = horizon - bandTop;

  const dawn = document.createElement("canvas");
  dawn.width = w;
  dawn.height = bandHeight;
  const dctx = dawn.getContext("2d");
  if (dctx) {
    // Elevation: warm and bright at the horizon, gone well before the zenith.
    const vertical = dctx.createLinearGradient(0, 0, 0, bandHeight);
    vertical.addColorStop(0.0, "rgba(90, 56, 26, 0)");
    vertical.addColorStop(0.42, "rgba(126, 78, 34, 0.3)");
    vertical.addColorStop(0.72, "rgba(178, 112, 48, 0.6)");
    vertical.addColorStop(0.9, "rgba(226, 156, 76, 0.85)");
    vertical.addColorStop(1.0, "rgba(255, 200, 128, 1)");
    dctx.fillStyle = vertical;
    dctx.fillRect(0, 0, w, bandHeight);

    // Azimuth: strongest to the north, falling away toward the flanks.
    const azimuth = dctx.createLinearGradient(centreU - w * 0.5, 0, centreU + w * 0.5, 0);
    azimuth.addColorStop(0.0, "rgba(0, 0, 0, 0)");
    azimuth.addColorStop(0.28, "rgba(0, 0, 0, 0.35)");
    azimuth.addColorStop(0.5, "rgba(0, 0, 0, 1)");
    azimuth.addColorStop(0.72, "rgba(0, 0, 0, 0.35)");
    azimuth.addColorStop(1.0, "rgba(0, 0, 0, 0)");
    dctx.globalCompositeOperation = "destination-in";
    dctx.fillStyle = azimuth;
    dctx.fillRect(0, 0, w, bandHeight);

    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.85;
    ctx.drawImage(dawn, 0, bandTop);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  texture.update(false);
  return texture;
}

// ------------------------------------------------------------------ build

/**
 * Tile a model along one horizontal axis to fill a volume exactly.
 *
 * The count is rounded to the nearest whole section and the remainder is taken
 * up by scaling, so a 68 m catwalk built from 4 m decks has no gap at the end
 * and no section hanging over the edge. The scale correction is always within a
 * few percent, which is invisible, whereas a gap in a walkway is not.
 */
function tileAlong(
  axis: "x" | "z",
  v: Volume,
  sectionLength: number,
  baseY?: number,
): { placements: Placement[]; scale: number } {
  const span = axis === "x" ? v.size.x : v.size.z;
  const count = Math.max(1, Math.round(span / sectionLength));
  const scale = span / (count * sectionLength);
  const y = baseY ?? v.box.min.y;

  const placements: Placement[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = -span / 2 + (i + 0.5) * (span / count);
    placements.push({
      position:
        axis === "x"
          ? new Vector3(v.centre.x + offset, y, v.centre.z)
          : new Vector3(v.centre.x, y, v.centre.z + offset),
      rotationY: axis === "x" ? Math.PI / 2 : 0,
      scaling: axis === "x" ? new Vector3(1, 1, scale) : new Vector3(1, 1, scale),
    });
  }
  return { placements, scale };
}

/** Native footprint of each tiled model, in metres. Must match `tools/art`. */
const SECTION = {
  wall: 6.0, // wall.glb spans 6 m along its length
  deck: 4.0,
  pipe_rack: 5.0,
  containerWidth: 2.9,
  containerLength: 6.0,
} as const;

export async function buildWorld(
  scene: Scene,
  engine: AbstractEngine,
  camera: Camera,
  map: CollisionMap = ARDAVAN_YARD,
): Promise<WorldHandles> {
  scene.clearColor = new Color4(PALETTE.ink.r, PALETTE.ink.g, PALETTE.ink.b, 1);
  scene.ambientColor = new Color3(0.14, 0.17, 0.22);

  // Distance haze. Ardavan Yard is 80 x 120 m, so density is tuned to soften
  // the far perimeter without fogging out the mid-lane sightlines.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0085;
  // Slightly warm and lifted: distance should read as haze catching the yard's
  // sodium light, not as a black void the far perimeter falls into.
  scene.fogColor = new Color3(0.135, 0.14, 0.175);

  const assets = await loadAssets(scene);

  // ------------------------------------------------------------------ sky
  const sky = MeshBuilder.CreateSphere(
    "sky",
    { diameter: 900, sideOrientation: Mesh.BACKSIDE },
    scene,
  );
  const skyMat = new StandardMaterial("sky", scene);
  skyMat.disableLighting = true;
  skyMat.emissiveTexture = skyTexture(scene);
  skyMat.backFaceCulling = false;
  skyMat.fogEnabled = false;
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;

  // ---------------------------------------------------------------- lights

  // Cool fill from the sky, warm bounce from sodium-lit ground. This carries
  // most of the shadow detail — with a near-black palette the fill is what
  // separates "moody" from "an unlit scene".
  // Carries most of the image. The yard is played looking north into the
  // dawn, which means the camera almost always sees the *shadowed* face of
  // every container and wall; without a strong fill those faces are black
  // silhouettes and the lanes stop reading as space you can move through.
  const ambient = new HemisphericLight("ambient", new Vector3(0.1, 1, 0.05), scene);
  ambient.intensity = 4.05;
  ambient.diffuse = new Color3(0.34, 0.45, 0.66);
  ambient.groundColor = new Color3(0.22, 0.16, 0.12);
  ambient.specular = new Color3(0.16, 0.2, 0.26);

  // The false dawn: a low, warm key raking from the north. Low elevation is
  // what produces the long shadows the yard reads by.
  const key = new DirectionalLight("false-dawn", new Vector3(0.12, -0.2, 1), scene);
  key.position = new Vector3(-10, 26, -95);
  key.intensity = 5.4;
  key.diffuse = PALETTE.dustGold;
  key.specular = new Color3(0.9, 0.75, 0.5);

  // Cold counter-rim from the south, so silhouettes separate from the sky
  // instead of dissolving into it.
  const rim = new DirectionalLight("rim", new Vector3(-0.25, -0.35, -1), scene);
  rim.position = new Vector3(20, 30, 90);
  rim.intensity = 1.95;
  rim.diffuse = new Color3(0.4, 0.58, 0.78);
  rim.specular = new Color3(0.5, 0.68, 0.85);

  const shadows = new ShadowGenerator(2048, key);
  shadows.useExponentialShadowMap = true;
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.darkness = 0.55;
  shadows.bias = 0.0018;
  shadows.normalBias = 0.02;

  // --------------------------------------------------------------- glow
  const glow = new GlowLayer("glow", scene, { blurKernelSize: 48 });
  glow.intensity = 0.85;

  // ------------------------------------------------------------- geometry

  const casters: Mesh[] = [];
  const model = (name: ModelName) => {
    const container = assets.models.get(name);
    if (!container) throw new Error(`model not loaded: ${name}`);
    return container;
  };

  /** Place a model and register everything it produced as a shadow caster. */
  const put = (name: ModelName, label: string, placements: readonly Placement[]) => {
    if (placements.length === 0) return;
    casters.push(...meshesUnder(placeAll(model(name), label, placements)));
  };

  map.boxes.forEach((box, index) => {
    const v = volumeOf(box);
    const kind = classify(v, map);

    switch (kind) {
      case "ground": {
        // The one surface still built as a primitive: it is a flat slab, and a
        // tiled model would only add draw calls and seams.
        const ground = MeshBuilder.CreateBox(
          "ground",
          { width: v.size.x, height: v.size.y, depth: v.size.z },
          scene,
        );
        ground.position = v.centre;
        ground.isPickable = false;
        ground.receiveShadows = true;
        ground.material = createTiledMaterial(scene, "concrete", v.size.x / 4, v.size.z / 4);
        ground.freezeWorldMatrix();
        break;
      }

      case "perimeter": {
        // Walls run along whichever horizontal axis is longer.
        const axis = v.size.x >= v.size.z ? "x" : "z";
        put("wall", `wall_${index}`, tileAlong(axis, v, SECTION.wall).placements);
        break;
      }

      case "deck": {
        const axis = v.size.x >= v.size.z ? "x" : "z";
        put("deck", `deck_${index}`, tileAlong(axis, v, SECTION.deck).placements);
        break;
      }

      case "pipe_rack": {
        const axis = v.size.x >= v.size.z ? "x" : "z";
        put("pipe_rack", `pipes_${index}`, tileAlong(axis, v, SECTION.pipe_rack).placements);
        break;
      }

      case "tank": {
        put("tank", `tank_${index}`, [
          { position: new Vector3(v.centre.x, v.box.min.y, v.centre.z) },
        ]);
        break;
      }

      case "hardpoint": {
        put("hardpoint", `hardpoint_${index}`, [
          { position: new Vector3(v.centre.x, v.box.min.y, v.centre.z) },
        ]);
        break;
      }

      case "stair": {
        // The stair model climbs toward -z. The west ramp (z > 0) climbs that
        // way already; the east ramp climbs the other way and is turned round.
        // This is map-specific on purpose — deriving the direction would need
        // the neighbouring steps, and the collision map is the thing that
        // defines "up" here.
        put("stair", `stair_${index}`, [
          {
            position: new Vector3(v.centre.x, v.box.min.y, v.centre.z),
            rotationY: v.centre.z > 0 ? 0 : Math.PI,
          },
        ]);
        break;
      }

      case "container":
      case "block": {
        // Fill the volume with a grid of container-sized units, so a 6 x 6
        // volume gets two side by side and a 4 x 12 cross-link gets two
        // end to end.
        const nx = Math.max(1, Math.round(v.size.x / SECTION.containerWidth));
        const nz = Math.max(1, Math.round(v.size.z / SECTION.containerLength));
        const placements: Placement[] = [];
        for (let ix = 0; ix < nx; ix += 1) {
          for (let iz = 0; iz < nz; iz += 1) {
            placements.push({
              position: new Vector3(
                v.centre.x - v.size.x / 2 + (ix + 0.5) * (v.size.x / nx),
                v.box.min.y,
                v.centre.z - v.size.z / 2 + (iz + 0.5) * (v.size.z / nz),
              ),
              // Alternate the door end so a row of containers is not a
              // repeating stamp.
              rotationY: (ix + iz) % 2 === 0 ? 0 : Math.PI,
              scaling: new Vector3(
                v.size.x / nx / SECTION.containerWidth,
                v.size.y / 3.0,
                v.size.z / nz / SECTION.containerLength,
              ),
            });
          }
        }
        put("container", `container_${index}`, placements);
        break;
      }
    }
  });

  // --------------------------------------------------------- sodium lamps

  // Lamp masts along the three lanes. Each is the generated mast model plus a
  // real point light at the head, so the fitting and the pool of light it
  // casts cannot drift apart.
  const lampSpots: Array<[number, number]> = [
    [-28, -24],
    [-28, 8],
    [-28, 34],
    [0, -30],
    [0, 0],
    [0, 30],
    [28, -12],
    [28, 16],
    [28, 40],
    [-14, -44],
    [14, 44],
  ];

  put(
    "lamp_mast",
    "lamp",
    lampSpots.map(([x, z]) => ({ position: new Vector3(x, 0, z) })),
  );

  lampSpots.forEach(([x, z], i) => {
    // Every mast is lit. Lighting only half of them left long unlit stretches
    // between pools, and the masts without a light read as broken fittings.
    // Babylon's per-mesh light cap is raised below to keep them all active.
    // Matches SOCKET_LAMP on lamp_mast.glb: 0.86 m out on the bracket arm,
    // 8.5 m up.
    const lamp = new PointLight(`lamp-light_${i}`, new Vector3(x + 0.86, 8.5, z), scene);
    lamp.diffuse = PALETTE.sodium;
    lamp.specular = PALETTE.sodium;
    lamp.intensity = 250;
    lamp.range = 40;
    lamp.falloffType = PointLight.FALLOFF_PHYSICAL;
  });

  // Two cold accent lights mark the opposing spawn ends, echoing the split
  // palette the whole product is built on.
  const southMark = new PointLight("mark-south", new Vector3(0, 5, 50), scene);
  southMark.diffuse = PALETTE.signalRed;
  southMark.specular = PALETTE.signalRed;
  southMark.intensity = 420;
  southMark.range = 40;

  const northMark = new PointLight("mark-north", new Vector3(0, 5, -50), scene);
  northMark.diffuse = PALETTE.signalCyan;
  northMark.specular = PALETTE.signalCyan;
  northMark.intensity = 420;
  northMark.range = 40;

  // Registering the source meshes is enough: Babylon renders their instances
  // into the shadow map with them.
  for (const mesh of casters) {
    shadows.addShadowCaster(mesh);
    mesh.receiveShadows = true;
  }

  // ------------------------------------------------------- post-processing

  const pipeline = new DefaultRenderingPipeline("post", true, scene, [camera]);

  pipeline.samples = 4;
  pipeline.fxaaEnabled = true;

  // Bloom carries the sodium lamps and the false-dawn horizon.
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.62;
  pipeline.bloomWeight = 0.42;
  pipeline.bloomKernel = 64;
  pipeline.bloomScale = 0.6;

  // ACES + a lifted contrast curve is what stops a near-black palette from
  // collapsing into mud on cheap panels.
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure = 2.05;
  pipeline.imageProcessing.contrast = 1.25;
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 1.35;
  pipeline.imageProcessing.vignetteStretch = 0.4;
  pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0);

  // Subtle lens character. Kept low: this is a competitive shooter, not a
  // photo mode, and heavy aberration hurts target acquisition.
  pipeline.chromaticAberrationEnabled = true;
  pipeline.chromaticAberration.aberrationAmount = 7;
  pipeline.chromaticAberration.radialIntensity = 0.55;

  pipeline.grainEnabled = true;
  pipeline.grain.intensity = 8;
  pipeline.grain.animated = true;

  pipeline.sharpenEnabled = true;
  pipeline.sharpen.edgeAmount = 0.22;
  pipeline.sharpen.colorAmount = 1;

  // Depth of field stays off: it reads as "cutscene" and costs frames.
  pipeline.depthOfFieldEnabled = false;

  void engine;
  return { shadows, pipeline, assets };
}
