import {
  Color3,
  Color4,
  FreeCamera,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { ARDAVAN_YARD, mapChecksum } from "@nightcell7/multiplayer-sim";
import { createRenderer, DynamicResolution } from "./renderer";

/**
 * Game entry point.
 *
 * Milestone 2 greybox: boots the renderer, builds the Ardavan Yard collision
 * volumes as visible boxes, and proves the movement feel loop before any art
 * exists. "A grey room, one enemy, and one rifle must already feel good"
 * (PRD §40).
 */

async function boot(): Promise<void> {
  const canvas = document.getElementById("viewport") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("viewport canvas missing");

  const { engine, kind } = await createRenderer(canvas);
  console.info(
    JSON.stringify({
      msg: "renderer ready",
      renderer: kind,
      map: ARDAVAN_YARD.id,
      mapChecksum: mapChecksum(ARDAVAN_YARD),
    }),
  );

  const scene = new Scene(engine);
  // Kaviran night palette: blue-black with warm industrial light (PRD §14.4).
  scene.clearColor = new Color4(0.027, 0.035, 0.047, 1);

  const camera = new FreeCamera("camera", new Vector3(0, 1.65, 40), scene);
  camera.setTarget(new Vector3(0, 1.65, 0));
  camera.attachControl(canvas, true);
  camera.minZ = 0.05;
  camera.fov = (90 * Math.PI) / 180;

  const light = new HemisphericLight("ambient", new Vector3(0.2, 1, 0.1), scene);
  light.intensity = 0.55;
  light.diffuse = new Color3(0.65, 0.72, 0.85);
  light.groundColor = new Color3(0.12, 0.1, 0.09);

  const greybox = new StandardMaterial("greybox", scene);
  greybox.diffuseColor = new Color3(0.32, 0.33, 0.35);
  greybox.specularColor = new Color3(0.05, 0.05, 0.05);

  // The visual greybox is generated FROM the collision data, so the two cannot
  // drift apart while the map is being iterated on (PRD §18.2).
  ARDAVAN_YARD.boxes.forEach((box, index) => {
    const size = {
      x: box.max.x - box.min.x,
      y: box.max.y - box.min.y,
      z: box.max.z - box.min.z,
    };
    const mesh = MeshBuilder.CreateBox(
      `col_${index}`,
      { width: size.x, height: size.y, depth: size.z },
      scene,
    );
    mesh.position = new Vector3(
      box.min.x + size.x / 2,
      box.min.y + size.y / 2,
      box.min.z + size.z / 2,
    );
    mesh.material = greybox;
    mesh.freezeWorldMatrix();
  });

  const dynamicResolution = new DynamicResolution(engine);

  engine.runRenderLoop(() => {
    dynamicResolution.update(engine.getDeltaTime());
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
}

void boot().catch((error: unknown) => {
  console.error(JSON.stringify({ msg: "boot failed", error: String(error) }));
  const ui = document.getElementById("ui");
  if (ui) {
    ui.textContent =
      "NIGHTCELL 7 could not start. Your browser may not support WebGL2. See /system-requirements.";
  }
});
