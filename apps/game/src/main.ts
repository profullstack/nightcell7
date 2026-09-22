import { FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import { ARDAVAN_YARD, mapChecksum, spawnsForTeam, TEAM_IDS } from "@nightcell7/multiplayer-sim";
import { decideAccess, loadViewer, parseMode } from "./access";
import { modeLabel, renderGate } from "./gate";
import { createHud, renderFault } from "./hud";
import { GAME_MODE, preferredMode, rememberMode } from "./modes";
import { TrainingTargets } from "./targets";
import { requestedVantage } from "./photo";
import { PlayerController } from "./player";
import { Viewmodel } from "./viewmodel";
import { GameAudio } from "./audio";
import { WeaponEffects } from "./vfx";
import { Opponents } from "./opponents";
import { createRenderer, DynamicResolution } from "./renderer";
import { buildWorld } from "./world";
import "./style.css";

/**
 * `localStorage` where it exists and is reachable.
 *
 * Reading the property itself throws in a browser with storage disabled — not
 * only the methods on it — so the guard has to wrap the access, not the call.
 */
function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Minimum gap between dry-fire clicks while the trigger is held on empty. */
const DRY_FIRE_INTERVAL_MS = 400;

/**
 * Game entry point.
 *
 * Boots the renderer, dresses the Ardavan Yard collision volumes with the
 * generated art set, and proves the movement feel loop.
 * "A grey room, one enemy, and one rifle must already feel good" (PRD §40) —
 * the room is no longer grey and the rifle is in frame, but every solid in it
 * is still the collision data, so feel and geometry cannot drift apart.
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
  // so the yard is entered the way a match would be.
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

    if (vantage.showWeapon) new Viewmodel(scene, camera, world.assets);

    // A still is not bound by the frame budget gameplay is. Push MSAA and
    // render at native scale so edges and the grating pattern survive the
    // downscale into the page.
    world.pipeline.samples = 8;
    world.pipeline.fxaaEnabled = false;
    engine.setHardwareScalingLevel(1);

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

  // Audio. Decoding happens now so the first shot of a match is not the one
  // that pays for it; the context stays suspended until the player clicks.
  const audio = new GameAudio();
  void audio.load();

  // Muzzle flash, tracers and impacts. Presentation only — the server owns
  // hit registration; this decides where to draw a spark.
  const effects = new WeaponEffects(scene, ARDAVAN_YARD);

  // The flash lights the yard, not the gun held in front of it.
  effects.excludeFromFlash(viewmodel.meshes());

  // What is in the yard, decided by the chosen mode.
  //
  // `Opponents` is built in every mode, including the ones with no bots: it
  // owns the `MatchSimulation`, which is where the player's own weapon,
  // ammunition, health, grenades and pickups are resolved. An empty roster is
  // a supported configuration, not a degenerate one.
  const gameMode = preferredMode(window.location.search, safeStorage());
  const roster = gameMode === GAME_MODE.DEATHMATCH ? {} : ({ enemies: 0, friendlies: 0 } as const);
  const opponents = new Opponents(scene, world.assets, { ...roster, shadows: world.shadows });

  // Stationary targets, for the range only. They are presentation-only hit
  // volumes; nothing here is scored.
  const targets = gameMode === GAME_MODE.RANGE ? new TrainingTargets(scene, world.assets) : null;

  const player = new PlayerController(scene, camera, canvas, ARDAVAN_YARD, spawn);

  const hud = createHud(ui, {
    renderer: kind,
    mapName: ARDAVAN_YARD.displayName,
    mapChecksum: checksum,
    mode: gameMode,
    // Remembered immediately rather than on start, so a player who picks a mode
    // and then reloads does not silently lose the choice.
    //
    // Changing it reloads: the yard is dressed at boot, and swapping a roster
    // and a set of targets live would be a second, subtly different code path
    // for something that happens once before a match.
    onModeChange: (next) => {
      rememberMode(next, safeStorage());
      if (next !== gameMode) window.location.search = `?mode=${next}`;
    },
    onStart: () => player.requestLock(),
  });

  player.onLockChanged = (locked) => {
    hud.setLocked(locked);
    if (!locked) return;
    // Browsers only allow audio to start from a user gesture, and taking
    // pointer lock is one. Without this every sound is silently discarded.
    void audio.unlock().then(() => {
      audio.startAmbience();
      audio.startMusic();
    });
  };
  hud.setLocked(false);

  // Local visual regression harness; removed from production bundles by Vite.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("inspect")) {
    Object.assign(window, {
      __NC7_DEV__: { scene, engine, camera, opponents, player, assets: world.assets },
    });
  }

  const dynamicResolution = new DynamicResolution(engine);
  let lastDryFireAt = 0;

  engine.runRenderLoop(() => {
    const deltaMs = engine.getDeltaTime();
    dynamicResolution.update(deltaMs);
    // Movement only advances while the pointer is locked; otherwise the start
    // gate is up and the yard should sit still behind it.
    if (player.isLocked) player.update(deltaMs);
    const status = player.status();
    viewmodel.update(deltaMs, status.speed, camera.rotation.y, camera.rotation.x);

    if (status.locked) {
      // Footsteps advance with distance travelled, so they track sprinting and
      // crouching without a separate state machine.
      audio.step(
        (status.speed * deltaMs) / 1000,
        status.grounded,
        // Catwalk and gantry decking sit at 6 m; anything up there is steel.
        status.position.y > 5.5,
      );

      if (!status.dead) {
        // Grenades. The throw goes through the same simulation the bots use,
        // so the count, the cooldown and the blast are all decided there
        // rather than here — this only asks and then plays the result.
        if (player.consumeThrowRequest()) {
          if (opponents.throwGrenade(camera.rotation.x)) audio.reload();
        }

        if (player.consumeReloadRequest()) opponents.reloadLocal();
        const change = player.consumeWeaponRequest();
        if (change) {
          if ("slot" in change) opponents.switchLocal(change.slot);
          else opponents.cycleLocal(change.step);
        }

        // The trigger. Same rule as the grenade: the simulation decides
        // whether a round leaves the barrel, and what it hit.
        const frame = player.lastInput();
        if (frame) opponents.applyLocalInput(frame);
      }
    }

    effects.update();
    if (status.locked) opponents.update(deltaMs, status.position, camera.rotation.y);
    targets?.update();

    const local = opponents.localStatus();
    const inHand = local.weapons[local.slot];
    if (inHand && viewmodel.setWeapon(inHand.id)) {
      // A new mesh in hand means a new mesh to keep out of the muzzle flash.
      effects.excludeFromFlash(viewmodel.meshes());
    }

    // What the player's rounds did this frame.
    for (const shot of opponents.drainLocalShots()) {
      audio.fire();
      // The tracer starts at the muzzle so it reads as coming from the gun,
      // but the trace itself is cast from the eye: the muzzle sits below and
      // right of the sight line, and tracing from there puts rounds visibly
      // off the crosshair at close range.
      const eye = camera.globalPosition;
      const aim = camera.getDirection(Vector3.Forward());
      const muzzle = viewmodel.muzzlePosition() ?? eye;

      let point = shot.point;
      let hitPerson = point !== null;
      if (!point && targets) {
        // Range targets are presentation-only volumes the simulation does
        // not know about; only a round that reached nobody can hit one, and
        // only if it is in front of whatever the round would otherwise hit.
        const reach = effects.trace(eye, aim).distance;
        const onTarget = targets.tryHit(
          { x: eye.x, y: eye.y, z: eye.z },
          { x: aim.x, y: aim.y, z: aim.z },
          reach,
        );
        if (onTarget) {
          point = onTarget.point;
          hitPerson = true;
        }
      }
      // A hit on a person gets the heavy burst; a miss sparks off the world.
      effects.fire(muzzle, eye, aim, point ?? undefined, hitPerson);
    }

    // Trigger held on an empty weapon: a click, so the silence is not a bug.
    if (
      status.firing &&
      inHand &&
      inHand.magazine === 0 &&
      inHand.reserve === 0 &&
      performance.now() - lastDryFireAt >= DRY_FIRE_INTERVAL_MS
    ) {
      lastDryFireAt = performance.now();
      audio.ui("error");
    }
    if (opponents.drainReloadStarted()) audio.reload();

    // Incoming fire, so a fight is visible from the receiving end.
    for (const shot of opponents.drainShots()) {
      const to =
        shot.to ??
        effects.trace(
          new Vector3(shot.from.x, shot.from.y, shot.from.z),
          new Vector3(shot.direction.x, shot.direction.y, shot.direction.z),
        ).point;
      effects.tracerOnly(shot.from, to);
    }
    for (const blast of opponents.drainExplosions()) {
      effects.explode(new Vector3(blast.position.x, blast.position.y, blast.position.z));
      audio.explosion(blast.distanceM);
    }

    // Taking damage, dying, coming back.
    const damage = opponents.drainDamage();
    if (damage > 0) {
      hud.flashDamage(damage);
      audio.hurt();
    }
    if (opponents.drainLocalDeath()) player.setDead(true);
    const respawn = opponents.drainLocalRespawn();
    if (respawn) {
      player.teleport(respawn.position, respawn.yaw);
      player.setDead(false);
    }
    for (const notice of opponents.drainNotices()) {
      hud.notify(notice);
      audio.pickup();
    }

    hud.update(status, engine.getFps(), local);
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
