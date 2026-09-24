import { FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import { ARDAVAN_YARD, mapChecksum, spawnsForTeam } from "@nightcell7/multiplayer-sim";
import { BITE, createInsectBiteState, stepInsectBite } from "@nightcell7/game-core";
import { decideAccess, loadViewer, parseMode } from "./access";
import { modeLabel, renderGate } from "./gate";
import { createHud, renderFault } from "./hud";
import { GAME_MODE, preferredMode, rememberMode } from "./modes";
import { difficultyInfo, preferredDifficulty, rememberDifficulty } from "./difficulty";
import {
  CREDITS_PER_KILL,
  CREDITS_PER_PACK,
  armoryItem,
  loadCredits,
  preferredLoadout,
  rememberLoadout,
  saveCredits,
  sideTeam,
} from "./loadout";
import { LoadoutPreview } from "./preview";
import { TrainingTargets } from "./targets";
import { requestedVantage } from "./photo";
import { PlayerController } from "./player";
import { Viewmodel } from "./viewmodel";
import { GameAudio } from "./audio";
import { WeaponEffects } from "./vfx";
import { Opponents } from "./opponents";
import { createRenderer, DynamicResolution } from "./renderer";
import { buildWorld } from "./world";
import { NightInsects } from "./insects";
import { LIGHTING, preferredTimeOfDay, rememberTimeOfDay } from "./time-of-day";
import { Coach, briefingFor, hasOnboarded, markOnboarded } from "./onboarding";
import { CommsDirector, captionFor, linesFor } from "./comms";
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

  // Enter at a real spawn of the chosen side rather than an arbitrary camera
  // position, so the yard is entered the way a match would be.
  const loadout = preferredLoadout(window.location.search, safeStorage());
  // Remembered at once: a "Play as" link from the website carries the character
  // in the URL, and changing the mode or difficulty reloads without it.
  rememberLoadout(loadout, safeStorage());
  const team = sideTeam(loadout.side);
  const spawn = spawnsForTeam(ARDAVAN_YARD, team)[0];
  if (!spawn) throw new Error("map has no spawn for the chosen side");

  const camera = new FreeCamera("camera", new Vector3(0, 1.65, 40), scene);
  camera.minZ = 0.05;
  camera.maxZ = 600;
  camera.fov = (90 * Math.PI) / 180;
  // Input is owned by PlayerController, which runs the shared authoritative
  // simulation. Attaching Babylon's own controls here would fight it.

  // Chosen before the world is built: the lighting rig, the sky texture and
  // whether insects exist at all are decided once, at boot.
  const timeOfDay = preferredTimeOfDay(window.location.search, safeStorage());
  const world = await buildWorld(scene, engine, camera, ARDAVAN_YARD, timeOfDay);

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
  const difficulty = preferredDifficulty(window.location.search, safeStorage());
  const roster = gameMode === GAME_MODE.DEATHMATCH ? {} : ({ enemies: 0, friendlies: 0 } as const);
  const opponents = new Opponents(scene, world.assets, {
    ...roster,
    shadows: world.shadows,
    difficulty: difficultyInfo(difficulty),
    team,
    armorClass: loadout.armor,
    color: loadout.color,
  });

  // The operator on the gate, in the chosen colours, idling in the yard.
  const preview = new LoadoutPreview(scene, camera, world.assets);
  preview.show(loadout);
  let currentLoadout = loadout;

  let credits = loadCredits(safeStorage());

  // Mode and difficulty are both set at boot: the yard is dressed and the
  // bots are tuned once, so changing either reloads with both in the URL.
  const reloadWith = (next: { mode?: string; difficulty?: string; time?: string }) => {
    const params = new URLSearchParams();
    params.set("mode", next.mode ?? gameMode);
    params.set("difficulty", next.difficulty ?? difficulty);
    params.set("time", next.time ?? timeOfDay);
    window.location.search = `?${params.toString()}`;
  };

  // Stationary targets, for the range only. They are presentation-only hit
  // volumes; nothing here is scored.
  const targets = gameMode === GAME_MODE.RANGE ? new TrainingTargets(scene, world.assets) : null;

  const player = new PlayerController(scene, camera, canvas, ARDAVAN_YARD, spawn);

  // First run: a briefing on the gate, then a coach in the yard until the
  // player has used every control once or skips it. Remembered, so a returning
  // player sees neither.
  const firstRun = !hasOnboarded(safeStorage());
  let coach: Coach | null = firstRun ? new Coach() : null;
  const finishCoaching = () => {
    coach = null;
    markOnboarded(safeStorage());
    hud.setCoach(null);
  };

  const hud = createHud(ui, {
    ...(firstRun ? { briefing: briefingFor } : {}),
    onSkipCoach: () => {
      coach?.skip();
      finishCoaching();
    },
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
      if (next !== gameMode) reloadWith({ mode: next });
    },
    difficulty,
    onDifficultyChange: (next) => {
      rememberDifficulty(next, safeStorage());
      if (next !== difficulty) reloadWith({ difficulty: next });
    },
    timeOfDay,
    // Same reasoning as the mode picker: the yard is lit once at boot, and
    // relighting it live would mean rebuilding the sky, the shadow generator
    // and the insect population mid-match.
    onTimeOfDayChange: (next) => {
      rememberTimeOfDay(next, safeStorage());
      if (next !== timeOfDay) reloadWith({ time: next });
    },
    loadout,
    onLoadoutChange: (next) => {
      rememberLoadout(next, safeStorage());
      // A side is a roster: bots, teams and spawns are built at boot, so a
      // new side is a reload. Armour and colour apply where the player stands.
      if (next.side !== currentLoadout.side) {
        reloadWith({});
        return;
      }
      const colorChanged = next.color !== currentLoadout.color;
      currentLoadout = next;
      opponents.setArmorClass(next.armor);
      // The squad already standing in the yard was built with the old palette,
      // so a colour picked on the gate has to be pushed to them. Without this
      // the swatch only ever tinted the preview figure.
      if (colorChanged) opponents.setColor(next.color);
      preview.show(next);
    },
    credits,
    onBuy: (id) => {
      const item = armoryItem(id);
      if (!item || credits < item.price) return false;
      if (!opponents.grant(item)) return false;
      credits -= item.price;
      saveCredits(credits, safeStorage());
      hud.setCredits(credits);
      hud.notify(`${item.name} · −${item.price} cr`);
      return true;
    },
    onStart: () => player.requestLock(),
  });

  // Squad radio: callouts, orders and chatter for the side the player is on.
  // Loaded on first deploy (it is not needed on the gate), played only while
  // the player is in the yard.
  const comms = new CommsDirector(loadout.side, loadout.character);
  let radioLoaded = false;
  let matchClockS = 0;

  player.onLockChanged = (locked) => {
    hud.setLocked(locked);
    // The figure stands in the yard only while the gate is up.
    if (locked) preview.hide();
    else preview.show(currentLoadout);
    if (!locked) return;
    // Browsers only allow audio to start from a user gesture, and taking
    // pointer lock is one. Without this every sound is silently discarded.
    void audio.unlock().then(() => {
      audio.startAmbience();
      audio.startMusic();
      if (!radioLoaded) {
        radioLoaded = true;
        void audio.loadRadio(loadout.side, linesFor(loadout.side));
      }
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

  // ------------------------------------------------------------- insects
  //
  // Night only. `LIGHTING[time].insects` is the single switch; by day nothing
  // below is constructed and the bite clock never starts.
  //
  // The bite is applied locally because these single-player modes are where
  // the client *is* the authority on its own vitals. CLAUDE.md reserves damage
  // to the server in multiplayer, so when the online path lands this flag is
  // what has to flip to false — the mosquito, the approach and the scratch all
  // still play, and only the health change goes away.
  const insectsEnabled = LIGHTING[timeOfDay].insects;
  const nightInsects = insectsEnabled ? new NightInsects(scene, world.assets, { camera }) : null;
  let biteState = createInsectBiteState(Math.random);
  let matchMs = 0;

  let lastDryFireAt = 0;
  let lastKills = 0;
  const earn = (amount: number, why: string) => {
    credits += amount;
    saveCredits(credits, safeStorage());
    hud.setCredits(credits);
    hud.notify(`+${amount} cr · ${why}`);
  };

  engine.runRenderLoop(() => {
    const deltaMs = engine.getDeltaTime();
    dynamicResolution.update(deltaMs);
    // Movement only advances while the pointer is locked; otherwise the start
    // gate is up and the yard should sit still behind it.
    if (player.isLocked) player.update(deltaMs);
    else preview.update(deltaMs);
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

    // Insects advance on the match clock, which only runs while the player is
    // actually in the yard — otherwise a match left paused on the gate would
    // come back to a bite already owed.
    if (insectsEnabled && status.locked) {
      matchMs += deltaMs;
      const step = stepInsectBite(biteState, matchMs, Math.random, {
        enabled: !status.dead,
        damage: true,
        vitals: { health: opponents.localStatus().health, armor: 0 },
      });
      biteState = step.state;
      if (step.bit) {
        // `damageDealt`, not `BITE.DAMAGE`: the rules clamp at `BITE.FLOOR`,
        // so a player already low takes the nuisance without the health cost.
        opponents.bite(step.damageDealt);
        // `stagger` is the existing flinch: it slows the player briefly and
        // kicks the view, and it already honours the reduced-motion setting.
        // That is exactly the pause-to-scratch beat, so this reuses it rather
        // than adding a second, subtly different way to interrupt control.
        player.stagger(BITE.DAMAGE);
        hud.notify("Mosquito bite");
      }
      nightInsects?.update(deltaMs, matchMs, biteState);
      // The whine is the whole point of a mosquito. Drive it off the same
      // approach value the model uses, so sound and silhouette agree.
      const near = nightInsects?.mosquitoNearness ?? 0;
      if (near > 0.01) audio.whine(near);
      else audio.stopWhine();
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
    const hits = opponents.drainHits();
    if (hits.length > 0) {
      let total = 0;
      for (const hit of hits) {
        total += hit.damage;
        // Where it came from, relative to the way the player is looking:
        // degrees clockwise from straight ahead, for the HUD arc.
        const bearing = hit.from
          ? ((Math.atan2(hit.from.x - status.position.x, hit.from.z - status.position.z) -
              camera.rotation.y) *
              180) /
            Math.PI
          : null;
        hud.showHit(hit.damage, bearing);
      }
      player.stagger(total);
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

    // Credits: kills and packs pay.
    if (local.kills > lastKills) {
      earn((local.kills - lastKills) * CREDITS_PER_KILL, "kill");
      lastKills = local.kills;
    }
    const packs = opponents.drainPacksTaken();
    if (packs > 0) earn(packs * CREDITS_PER_PACK, "health pack");

    hud.update(status, engine.getFps(), local);

    // The net only runs while the player is in the yard; events from the gate
    // are dropped rather than replayed late.
    const commsEvents = opponents.drainCommsEvents();
    // Not before the radio has loaded, or the opening order is spent on silence.
    if (status.locked && audio.radioReady()) {
      matchClockS += deltaMs / 1000;
      const transmission = comms.observe(
        matchClockS,
        opponents.commsSnapshot(),
        commsEvents,
        audio.radioBusy(),
      );
      if (transmission) {
        audio.transmit(loadout.side, transmission.lines, transmission.kind);
        const { speaker, text } = captionFor(loadout.side, transmission.lines);
        hud.caption(speaker, text, transmission.kind);
      }
    }

    // The coach only watches while the player is actually in the yard.
    if (coach && status.locked) {
      const step = coach.observe({
        speed: status.speed,
        grounded: status.grounded,
        crouching: status.crouching,
        sprinting: status.sprinting,
        firing: status.firing,
        yaw: camera.rotation.y,
        reloading: local.reloading,
        slot: local.slot,
        grenades: local.grenades,
        alive: local.alive,
      });
      hud.setCoach(step);
      if (step.finished) {
        finishCoaching();
        hud.notify("Training complete · the yard is yours");
      }
    }

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
