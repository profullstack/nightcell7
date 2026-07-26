import { FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import { ARDAVAN_YARD, mapChecksum, spawnsForTeam, TEAM_IDS } from "@nightcell7/multiplayer-sim";
import { decideAccess, loadViewer, parseMode } from "./access";
import { modeLabel, renderGate } from "./gate";
import { createHud, renderFault } from "./hud";
import { requestedVantage } from "./photo";
import { PlayerController } from "./player";
import { Viewmodel } from "./viewmodel";
import { createRenderer, DynamicResolution } from "./renderer";
import { buildWorld } from "./world";
import "./style.css";

/**
 * Game entry point.
 *
 * Milestone 2 greybox: boots the renderer, dresses the Ardavan Yard collision
 * volumes, and proves the movement feel loop before any authored art exists.
 * "A grey room, one enemy, and one rifle must already feel good" (PRD §40) —
 * the room is no longer grey, but every solid in it is still the collision
 * data, so feel and geometry cannot drift apart.
 */

async function boot(): Promise<void> {
  const canvas = document.getElementById("viewport") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("viewport canvas missing");

  const ui = document.getElementById("ui");
  if (!ui) throw new Error("ui root missing");

  // Access is decided BEFORE the renderer starts: unavailable content is never
  // downloaded or booted, and the demo stays open to everyone (PRD §23.1).
  const mode = parseMode(window.location.search);
  const viewer = await loadViewer();
  const access = decideAccess(mode, viewer);

  if (!access.allowed) {
    canvas.style.display = "none";
    renderGate(ui, access);
    console.info(JSON.stringify({ msg: "access denied", mode, reason: access.reason }));
    return;
  }

  console.info(JSON.stringify({ msg: "starting", mode: modeLabel(mode) }));

  const { engine, kind } = await createRenderer(canvas);

  const checksum = mapChecksum(ARDAVAN_YARD);
  console.info(
    JSON.stringify({
      msg: "renderer ready",
      renderer: kind,
      map: ARDAVAN_YARD.id,
      mapChecksum: checksum,
    }),
  );

  const scene = new Scene(engine);

  // Enter at a real Nightcell spawn rather than an arbitrary camera position,
  // so the greybox is entered the way a match would be.
  const spawn = spawnsForTeam(ARDAVAN_YARD, TEAM_IDS.NIGHTCELL)[0];
  if (!spawn) throw new Error("map has no Nightcell spawn");

  const camera = new FreeCamera("camera", new Vector3(0, 1.65, 40), scene);
  camera.minZ = 0.05;
  camera.maxZ = 600;
  camera.fov = (90 * Math.PI) / 180;
  // Input is owned by PlayerController, which runs the shared authoritative
  // simulation. Attaching Babylon's own controls here would fight it.

  const world = await buildWorld(scene, engine, camera, ARDAVAN_YARD);

  // Photo mode: park the camera at a named vantage, leave the UI layer empty,
  // and skip the controller entirely. Used to regenerate marketing captures
  // and lighting baselines reproducibly (see tools/art/capture.mjs).
  const vantage = requestedVantage(window.location.search);
  if (vantage) {
    camera.position.set(...vantage.position);
    camera.rotation.set(vantage.pitch, vantage.yaw, 0);
    if (vantage.fovDegrees) camera.fov = (vantage.fovDegrees * Math.PI) / 180;

    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    engine.resize();

    // The capture script waits on this flag rather than a fixed sleep, so a
    // slow machine cannot produce a half-converged frame.
    scene.executeWhenReady(() => {
      window.setTimeout(() => {
        (window as unknown as { __NC7_PHOTO_READY?: boolean }).__NC7_PHOTO_READY = true;
      }, 400);
    });
    return;
  }

  // The rifle. PRD §40 wants "one enemy and one rifle" to feel good before
  // anything else; until now the player's hands were empty.
  //
  // Created after the photo-mode return on purpose: the vantages in photo.ts
  // are environment showcases for the marketing site, and a weapon filling the
  // lower third of frame hides the yard they exist to show.
  const viewmodel = new Viewmodel(scene, camera, world.assets);

  const player = new PlayerController(scene, camera, canvas, ARDAVAN_YARD, spawn);

  const hud = createHud(ui, {
    renderer: kind,
    mapName: ARDAVAN_YARD.displayName,
    mapChecksum: checksum,
    onStart: () => player.requestLock(),
  });

  player.onLockChanged = (locked) => hud.setLocked(locked);
  hud.setLocked(false);

  const dynamicResolution = new DynamicResolution(engine);

  engine.runRenderLoop(() => {
    const deltaMs = engine.getDeltaTime();
    dynamicResolution.update(deltaMs);
    // Movement only advances while the pointer is locked; otherwise the start
    // gate is up and the yard should sit still behind it.
    if (player.isLocked) player.update(deltaMs);
    const status = player.status();
    viewmodel.update(deltaMs, status.speed, camera.rotation.y, camera.rotation.x);
    hud.update(status, engine.getFps());
    scene.render();
  });

  // Babylon sizes the backbuffer from the canvas' CSS box, so a resize must be
  // forwarded or the image keeps the old aspect ratio and stretches.
  window.addEventListener("resize", () => engine.resize());
  engine.resize();
}

void boot().catch((error: unknown) => {
  console.error(JSON.stringify({ msg: "boot failed", error: String(error) }));
  const ui = document.getElementById("ui");
  if (ui) {
    renderFault(
      ui,
      "NIGHTCELL 7 could not start. Your browser may not support WebGL2, or hardware acceleration may be disabled.",
    );
  }
});
