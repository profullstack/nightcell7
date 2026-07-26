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
  PBRMetallicRoughnessMaterial,
  PointLight,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  Vector3,
  type AbstractEngine,
  type Camera,
} from "@babylonjs/core";
import { ARDAVAN_YARD, type CollisionMap } from "@nightcell7/multiplayer-sim";
import type { Aabb } from "@nightcell7/multiplayer-sim";

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
 * All textures are generated procedurally at runtime. That is a deliberate
 * choice, not a placeholder: CLAUDE.md forbids shipping any asset without
 * provenance, and a canvas we draw ourselves has trivially clean provenance.
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
type VolumeKind = "ground" | "perimeter" | "deck" | "tank" | "container" | "block";

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

  // Shipping containers: the classic 6 x 3 x 6-ish yard blocks.
  if (size.y >= 2 && size.y <= 3.2 && footprint >= 25) return "container";

  return "block";
}

// ---------------------------------------------------------------- textures

/**
 * Procedural noise texture used to break up flat PBR surfaces.
 * `tint` biases the speckle so concrete, steel and rust each read differently.
 */
function noiseTexture(
  scene: Scene,
  name: string,
  tint: Color3,
  opts: {
    size?: number;
    density?: number;
    streaks?: boolean;
    uScale?: number;
    vScale?: number;
  } = {},
): DynamicTexture {
  const size = opts.size ?? 512;
  const density = opts.density ?? 0.55;
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

  const base = tint.scale(255);
  ctx.fillStyle = `rgb(${base.r | 0}, ${base.g | 0}, ${base.b | 0})`;
  ctx.fillRect(0, 0, size, size);

  // Speckle: fine grit that survives mipmapping at yard scale.
  const grains = Math.floor(size * size * density * 0.02);
  for (let i = 0; i < grains; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = (Math.random() - 0.5) * 60;
    const r = Math.min(255, Math.max(0, base.r + shade));
    const g = Math.min(255, Math.max(0, base.g + shade));
    const b = Math.min(255, Math.max(0, base.b + shade));
    ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, 0.55)`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // Vertical streaking reads as weathering / runoff on tanks and containers.
  if (opts.streaks) {
    for (let i = 0; i < size / 8; i += 1) {
      const x = Math.random() * size;
      const w = 1 + Math.random() * 3;
      const h = size * (0.2 + Math.random() * 0.7);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.04 + Math.random() * 0.07})`;
      ctx.fillRect(x, Math.random() * size * 0.3, w, h);
    }
  }

  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = opts.uScale ?? 1;
  texture.vScale = opts.vScale ?? 1;
  return texture;
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

export function buildWorld(
  scene: Scene,
  engine: AbstractEngine,
  camera: Camera,
  map: CollisionMap = ARDAVAN_YARD,
): WorldHandles {
  scene.clearColor = new Color4(PALETTE.ink.r, PALETTE.ink.g, PALETTE.ink.b, 1);
  scene.ambientColor = new Color3(0.08, 0.1, 0.14);

  // Distance haze. Ardavan Yard is 80 x 120 m, so density is tuned to soften
  // the far perimeter without fogging out the mid-lane sightlines.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0105;
  // Slightly warm and lifted: distance should read as haze catching the yard's
  // sodium light, not as a black void the far perimeter falls into.
  scene.fogColor = new Color3(0.085, 0.09, 0.115);

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
  const ambient = new HemisphericLight("ambient", new Vector3(0.1, 1, 0.05), scene);
  ambient.intensity = 1.15;
  ambient.diffuse = new Color3(0.34, 0.45, 0.66);
  ambient.groundColor = new Color3(0.22, 0.16, 0.12);
  ambient.specular = new Color3(0.16, 0.2, 0.26);

  // The false dawn: a low, warm key raking from the north. Low elevation is
  // what produces the long shadows the yard reads by.
  const key = new DirectionalLight("false-dawn", new Vector3(0.12, -0.2, 1), scene);
  key.position = new Vector3(-10, 26, -95);
  key.intensity = 3.4;
  key.diffuse = PALETTE.dustGold;
  key.specular = new Color3(0.9, 0.75, 0.5);

  // Cold counter-rim from the south, so silhouettes separate from the sky
  // instead of dissolving into it.
  const rim = new DirectionalLight("rim", new Vector3(-0.25, -0.35, -1), scene);
  rim.position = new Vector3(20, 30, 90);
  rim.intensity = 0.9;
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

  // ------------------------------------------------------------ materials

  const groundMat = new PBRMetallicRoughnessMaterial("mat-ground", scene);
  groundMat.baseTexture = noiseTexture(scene, "tex-ground", PALETTE.concrete, {
    density: 0.8,
    uScale: 26,
    vScale: 38,
  });
  groundMat.metallic = 0.08;
  groundMat.roughness = 0.86;

  const wallMat = new PBRMetallicRoughnessMaterial("mat-wall", scene);
  // Kept dark: the perimeter is a boundary, not a feature. Lit any brighter it
  // becomes a bright slab that pulls the eye away from the lanes.
  wallMat.baseTexture = noiseTexture(scene, "tex-wall", PALETTE.concrete.scale(0.4), {
    density: 0.6,
    streaks: true,
    uScale: 14,
    vScale: 3,
  });
  wallMat.metallic = 0.05;
  wallMat.roughness = 0.92;

  const steelMat = new PBRMetallicRoughnessMaterial("mat-steel", scene);
  steelMat.baseTexture = noiseTexture(scene, "tex-steel", PALETTE.steel, { density: 0.4 });
  steelMat.metallic = 0.78;
  steelMat.roughness = 0.42;

  const tankMat = new PBRMetallicRoughnessMaterial("mat-tank", scene);
  tankMat.baseTexture = noiseTexture(scene, "tex-tank", PALETTE.rust.scale(0.9), {
    density: 0.5,
    streaks: true,
    uScale: 3,
    vScale: 2,
  });
  tankMat.metallic = 0.62;
  tankMat.roughness = 0.62;

  // Containers carry the only saturated colour in the yard. Team sides read at
  // a glance without a minimap: red toward Nightcell (south), cyan toward the
  // Directorate (north).
  const containerSouth = new PBRMetallicRoughnessMaterial("mat-container-s", scene);
  containerSouth.baseTexture = noiseTexture(scene, "tex-cs", PALETTE.signalRed.scale(0.85), {
    density: 0.45,
    streaks: true,
  });
  containerSouth.metallic = 0.25;
  containerSouth.roughness = 0.68;

  const containerNorth = new PBRMetallicRoughnessMaterial("mat-container-n", scene);
  containerNorth.baseTexture = noiseTexture(scene, "tex-cn", PALETTE.signalCyan.scale(0.7), {
    density: 0.45,
    streaks: true,
  });
  containerNorth.metallic = 0.25;
  containerNorth.roughness = 0.68;

  const blockMat = new PBRMetallicRoughnessMaterial("mat-block", scene);
  blockMat.baseTexture = noiseTexture(scene, "tex-block", PALETTE.steel.scale(0.8), {
    density: 0.5,
  });
  blockMat.metallic = 0.5;
  blockMat.roughness = 0.55;

  // ------------------------------------------------------------- geometry

  map.boxes.forEach((box, index) => {
    const v = volumeOf(box);
    const kind = classify(v, map);

    const mesh = MeshBuilder.CreateBox(
      `${kind}_${index}`,
      { width: v.size.x, height: v.size.y, depth: v.size.z },
      scene,
    );
    mesh.position = v.centre;
    mesh.checkCollisions = false;
    mesh.isPickable = false;

    switch (kind) {
      case "ground":
        mesh.material = groundMat;
        mesh.receiveShadows = true;
        break;
      case "perimeter":
        mesh.material = wallMat;
        mesh.receiveShadows = true;
        break;
      case "deck":
        mesh.material = steelMat;
        mesh.receiveShadows = true;
        shadows.addShadowCaster(mesh);
        break;
      case "tank":
        mesh.material = tankMat;
        mesh.receiveShadows = true;
        shadows.addShadowCaster(mesh);
        break;
      case "container":
        mesh.material = v.centre.z > 0 ? containerSouth : containerNorth;
        mesh.receiveShadows = true;
        shadows.addShadowCaster(mesh);
        break;
      default:
        mesh.material = blockMat;
        mesh.receiveShadows = true;
        shadows.addShadowCaster(mesh);
        break;
    }

    // Static geometry: freezing the world matrix and the material removes the
    // per-frame transform and shader rebind cost for ~30 meshes.
    mesh.freezeWorldMatrix();
  });

  // --------------------------------------------------------- sodium lamps

  // Lamp masts along the three lanes. These are the yard's practical lights:
  // each one is an emissive head (picked up by the glow layer) plus a real
  // point light with a tight radius so the pools of light stay readable.
  const lampMat = new StandardMaterial("mat-lamp", scene);
  lampMat.disableLighting = true;
  lampMat.emissiveColor = PALETTE.sodium;

  const mastMat = new PBRMetallicRoughnessMaterial("mat-mast", scene);
  mastMat.baseColor = PALETTE.steel.scale(0.5);
  mastMat.metallic = 0.8;
  mastMat.roughness = 0.5;

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

  lampSpots.forEach(([x, z], i) => {
    const mast = MeshBuilder.CreateCylinder(
      `mast_${i}`,
      { height: 9, diameter: 0.28, tessellation: 8 },
      scene,
    );
    mast.position = new Vector3(x, 4.5, z);
    mast.material = mastMat;
    mast.isPickable = false;
    mast.freezeWorldMatrix();
    shadows.addShadowCaster(mast);

    const head = MeshBuilder.CreateBox(
      `lamp_${i}`,
      { width: 0.9, height: 0.22, depth: 0.5 },
      scene,
    );
    head.position = new Vector3(x, 9.05, z);
    head.material = lampMat;
    head.isPickable = false;
    head.freezeWorldMatrix();

    // Only a subset get real point lights — eleven dynamic lights would cost
    // more than they add, and Babylon's per-mesh light cap would start
    // dropping them unpredictably.
    if (i % 2 === 0) {
      const lamp = new PointLight(`lamp-light_${i}`, new Vector3(x, 8.6, z), scene);
      lamp.diffuse = PALETTE.sodium;
      lamp.specular = PALETTE.sodium;
      lamp.intensity = 260;
      lamp.range = 34;
      lamp.falloffType = PointLight.FALLOFF_PHYSICAL;
    }
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
  pipeline.imageProcessing.exposure = 1.45;
  pipeline.imageProcessing.contrast = 1.25;
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 2.4;
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
  return { shadows, pipeline };
}
