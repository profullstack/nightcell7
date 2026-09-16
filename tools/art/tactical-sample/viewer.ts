import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Color3,
  Color4,
  MeshBuilder,
  PBRMaterial,
  LoadAssetContainerAsync,
  ShadowGenerator,
  ImageProcessingConfiguration,
  EquiRectangularCubeTexture,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { bindTacticalMaterials } from "./bind-materials";

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.035, 0.044, 0.044, 1);
scene.environmentTexture = new EquiRectangularCubeTexture("./textures/env_sky.webp", scene, 128);
scene.environmentIntensity = 1.0;
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
scene.imageProcessingConfiguration.exposure = 1.25;
const camera = new ArcRotateCamera("orbit", -0.85, 1.15, 1.7, new Vector3(0, 0, 0), scene);
camera.attachControl(canvas, true);
camera.minZ = 0.01;
camera.wheelDeltaPercentage = 0.01;
camera.lowerRadiusLimit = 0.3;
camera.upperRadiusLimit = 9;
const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
fill.intensity = 1.25;
fill.groundColor = new Color3(0.15, 0.14, 0.12);
const key = new DirectionalLight("key", new Vector3(-0.8, -1, 0.4), scene);
key.position = new Vector3(3, 5, -2);
key.intensity = 3;
key.diffuse = new Color3(1, 0.9, 0.77);
const rim = new DirectionalLight("rim", new Vector3(1, -0.5, -1), scene);
rim.intensity = 2;
rim.diffuse = new Color3(0.68, 0.82, 1);
const shadow = new ShadowGenerator(2048, key);
shadow.useBlurExponentialShadowMap = true;
shadow.blurKernel = 24;
shadow.bias = 0.002;
const ground = MeshBuilder.CreateGround("ground", { width: 200, height: 200 }, scene);
const floor = new PBRMaterial("floor", scene);
floor.albedoColor = new Color3(0.055, 0.063, 0.06);
floor.roughness = 0.9;
floor.metallic = 0;
ground.material = floor;
ground.receiveShadows = true;
const entries = [
  {
    name: "nc7_carbine_v1",
    title: "C7 / CARBINE",
    desc: "17,344 triangles · five attachment sockets · 0.96 m long",
    target: new Vector3(0, -0.025, 0.13),
    radius: 1.35,
    ground: -0.24,
  },
  {
    name: "nc7_equipment_case_v1",
    title: "FIELD / EQUIPMENT CASE",
    desc: "5,956 triangles · carry socket · 0.88 m wide",
    target: new Vector3(0, 0.23, 0),
    radius: 1.5,
    ground: 0,
  },
  {
    name: "nc7_concrete_cover_v1",
    title: "CHECKPOINT / CONCRETE COVER",
    desc: "4,372 triangles · collision proxy · 2.40 m long",
    target: new Vector3(0, 0.53, 0),
    radius: 3.4,
    ground: 0,
  },
];
let current: Awaited<ReturnType<typeof LoadAssetContainerAsync>> | undefined;
let serial = 0;
let selected = 0;
function fitCamera() {
  camera.radius =
    entries[selected]!.radius * Math.max(1, engine.getRenderHeight() / engine.getRenderWidth());
}
async function show(i: number) {
  const token = ++serial;
  document.querySelector("#status")!.textContent = "Loading geometry…";
  const next = await LoadAssetContainerAsync(`models/${entries[i]!.name}.glb`, scene);
  if (token !== serial) {
    next.dispose();
    return;
  }
  current?.removeAllFromScene();
  current?.dispose();
  bindTacticalMaterials(next, scene, "./");
  next.addAllToScene();
  current = next;
  for (const mat of next.materials)
    if (mat instanceof PBRMaterial)
      mat.wireframe = document.querySelector<HTMLInputElement>("#wire")!.checked;
  const meshList = next.meshes.filter((m) => m.getTotalVertices() > 0);
  shadow.getShadowMap()!.renderList = meshList;
  camera.target.copyFrom(entries[i]!.target);
  selected = i;
  fitCamera();
  camera.alpha = i === 0 ? -2.18 : 0.85;
  camera.beta = 1.12;
  ground.position.y = entries[i]!.ground;
  document.querySelector("#title")!.textContent = entries[i]!.title;
  document.querySelector("#status")!.textContent = entries[i]!.desc;
  document
    .querySelectorAll<HTMLButtonElement>("[data-asset]")
    .forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
  await scene.whenReadyAsync();
  (window as unknown as { assetReady: string }).assetReady = entries[i]!.name;
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-asset]"))
  button.onclick = () => void show(Number(button.dataset.asset));
let rotating = false;
document.querySelector<HTMLButtonElement>("#rotate")!.onclick = () => {
  rotating = !rotating;
  document.querySelector("#rotate")!.textContent = rotating ? "Pause rotation" : "Auto rotate";
};
document.querySelector<HTMLInputElement>("#wire")!.onchange = (e) => {
  for (const m of current?.materials ?? [])
    if (m instanceof PBRMaterial) m.wireframe = (e.target as HTMLInputElement).checked;
};
engine.runRenderLoop(() => {
  if (rotating) camera.alpha += engine.getDeltaTime() * 0.00017;
  scene.render();
});
window.addEventListener("resize", () => {
  engine.resize();
  fitCamera();
});
void show(0);
