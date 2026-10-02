import {
  FreeCamera,
  Scene,
  Vector3,
  type AnimationGroup,
  type TransformNode,
} from "@babylonjs/core";
import {
  MATCH_PHASE,
  PLAYER_STATE,
  TEAM,
  type ClientPlatform,
  type MatchState,
  type PlayerState,
} from "@nightcell7/multiplayer-protocol";
import { MAX_HEALTH, MULTIPLAYER_LOADOUT, TDM_RULES, getWeapon } from "@nightcell7/game-core";
import { ARDAVAN_YARD, mapChecksum, spawnsForTeam } from "@nightcell7/multiplayer-sim";
import type { Viewer } from "./access";
import { placeAnimated, type AssetSet } from "./assets";
import { GameAudio } from "./audio";
import { createHud, type Hud } from "./hud";
import { preferredLoadout, rememberLoadout, sideTeam, type Loadout } from "./loadout";
import type { LocalStatus } from "./opponents";
import { PlayerController } from "./player";
import { LoadoutPreview } from "./preview";
import { createRenderer, DynamicResolution } from "./renderer";
import { brightenCharacter, teamPalettes } from "./targets";
import { preferredTimeOfDay } from "./time-of-day";
import { Viewmodel } from "./viewmodel";
import { WeaponEffects } from "./vfx";
import { buildWorld } from "./world";
import { OnlineSession, privateMatchLink, signInHref, type OnlineStatus } from "./net/session";

/**
 * Online play: the gate's Quick match / Private match, and the yard drawn from
 * the match server's state instead of the local bot simulation.
 *
 * The server owns everything that matters (CLAUDE.md, Multiplayer). The client
 * moves its own camera with the shared movement code for responsiveness, sends
 * input intent, and snaps back to the server whenever the two disagree.
 */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const TEAM_NAME: Record<number, string> = {
  [TEAM.NIGHTCELL]: "Nightcell",
  [TEAM.DIRECTORATE]: "Directorate",
};

/** The game's own path, so links work under /play/ and in the desktop shell. */
function playPath(): string {
  return window.location.pathname.endsWith("/") ? window.location.pathname : "/play/";
}

/**
 * "Play online" on the sandbox gate: two links into the multiplayer lobby.
 * Signed-out players go to sign-in first and come straight back.
 */
export function playOnlineLinks(viewer: Viewer): HTMLElement {
  const section = el("fieldset", "modes online");
  section.append(el("legend", "modes__legend", "Play online"));
  const target = (query: string) => {
    const back = `${playPath()}?mode=multiplayer${query}`;
    return viewer.authenticated ? back : signInHref(back);
  };
  const quick = el("a", "online__button online__button--primary", "Quick match");
  quick.href = target("&match=quick");
  const priv = el("a", "online__button", "Private match");
  priv.href = target("");
  section.append(
    quick,
    priv,
    el(
      "p",
      "modes__blurb",
      viewer.authenticated
        ? `Free ${TDM_RULES.teamSize}v${TDM_RULES.teamSize} Team Deathmatch on a real server. Bots hold empty seats.`
        : "Free, but it needs a verified account. You will sign in and come back here.",
    ),
  );
  return section;
}

/** The lobby panel on the multiplayer gate. */
interface Lobby {
  readonly root: HTMLElement;
  render(status: OnlineStatus): void;
}

function createLobby(session: OnlineSession): Lobby {
  const root = el("fieldset", "modes online");
  root.append(
    el(
      "legend",
      "modes__legend",
      `Play online · ${TDM_RULES.teamSize}v${TDM_RULES.teamSize} Team Deathmatch`,
    ),
  );

  const status = el("p", "online__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const actions = el("div", "online__actions");
  const quick = el("button", "online__button online__button--primary", "Quick match");
  quick.type = "button";
  quick.addEventListener("click", () => void session.quickMatch());
  const create = el("button", "online__button", "Create private match");
  create.type = "button";
  create.addEventListener("click", () => void session.createPrivate());
  const codeForm = el("form", "online__code");
  codeForm.dataset.interactive = "";
  const codeInput = el("input", "online__input");
  codeInput.dataset.interactive = "";
  codeInput.name = "code";
  codeInput.placeholder = "CODE";
  codeInput.autocomplete = "off";
  codeInput.maxLength = 12;
  codeInput.setAttribute("aria-label", "Private match code");
  const join = el("button", "online__button", "Join");
  join.type = "submit";
  codeForm.append(codeInput, join);
  codeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void session.joinPrivate(codeInput.value);
  });
  actions.append(quick, create, codeForm);

  const share = el("div", "online__share");
  share.hidden = true;
  const shareCode = el("p", "online__code-value");
  const shareLink = el("input", "online__input online__input--link");
  shareLink.dataset.interactive = "";
  shareLink.readOnly = true;
  shareLink.setAttribute("aria-label", "Private match link");
  const copy = el("button", "online__button", "Copy link");
  copy.type = "button";
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(shareLink.value).then(
      () => (copy.textContent = "Copied"),
      () => shareLink.select(),
    );
  });
  share.append(shareCode, shareLink, copy);

  const after = el("div", "online__actions");
  const retry = el("button", "online__button online__button--primary", "Retry");
  retry.type = "button";
  retry.addEventListener("click", () => void session.retry());
  const leave = el("button", "online__button", "Leave match");
  leave.type = "button";
  leave.addEventListener("click", () => void session.leave());
  const signIn = el("a", "online__button online__button--primary", "Sign in");
  signIn.href = signInHref(`${playPath()}${window.location.search}`);
  after.append(retry, leave, signIn);

  root.append(status, actions, share, after);

  const busy = (kind: OnlineStatus["kind"]) => kind === "ticket" || kind === "connecting";

  return {
    root,
    render(next) {
      const inRoom = next.kind === "waiting" || next.kind === "live";
      root.dataset.state = next.kind;
      status.textContent = describe(next);
      actions.hidden = inRoom || busy(next.kind);
      retry.hidden = !(next.kind === "disconnected" || (next.kind === "error" && !next.signIn));
      retry.textContent = next.kind === "disconnected" ? "Rejoin" : "Retry";
      leave.hidden = !inRoom;
      signIn.hidden = !(next.kind === "error" && next.signIn);

      const lobby = session.lobby;
      const isPrivate = lobby?.kind === "private" && next.kind !== "idle" && next.kind !== "error";
      share.hidden = !isPrivate;
      if (isPrivate && lobby?.kind === "private") {
        shareCode.textContent = `Match code ${lobby.code}`;
        shareLink.value = privateMatchLink(window.location.origin, lobby.code);
        copy.textContent = "Copy link";
      }
    },
  };
}

export function describe(status: OnlineStatus): string {
  switch (status.kind) {
    case "idle":
      return "Free and server-authoritative. Bots hold the seats nobody has taken.";
    case "ticket":
      return "Requesting a match ticket...";
    case "connecting":
      return "Connecting to the match server...";
    case "waiting":
      return `Waiting for players: ${status.humans} in the room, ${status.bots} bots. Warmup ends shortly. Deploy when ready.`;
    case "live":
      return `Match live: ${status.humans} players, ${status.bots} bots.`;
    case "ended": {
      const r = status.result;
      if (!r) return "Match over.";
      const score = `${TEAM_NAME[0]} ${r.scores[0] ?? 0}, ${TEAM_NAME[1]} ${r.scores[1] ?? 0}`;
      const winner = r.winningTeam === null ? "Draw" : `${TEAM_NAME[r.winningTeam]} win`;
      return `Match over. ${winner}. ${score}.`;
    }
    case "disconnected":
      return `Connection lost (${status.code}). Rejoin to get back in.`;
    case "error":
      return status.message;
  }
}

// ------------------------------------------------------------- remote players

interface RemoteView {
  readonly root: TransformNode;
  readonly clips: Map<string, AnimationGroup>;
  current: string;
  team: number;
}

/** Everyone else in the room, drawn with the same operator rigs the bots use. */
class RemoteSquad {
  private readonly views = new Map<string, RemoteView>();

  constructor(
    private readonly assets: AssetSet,
    private readonly color: string,
  ) {}

  update(state: MatchState, me: string, myTeam: number, session: OnlineSession): void {
    const palettes = teamPalettes(this.color);
    state.players.forEach((player, id) => {
      if (id === me) return;
      let view = this.views.get(id);
      if (!view || view.team !== player.team) {
        view?.root.dispose();
        const model = this.assets.models.get(
          player.team === TEAM.DIRECTORATE ? "m3_operator_directorate" : "m3_operator_nightcell",
        );
        if (!model) return;
        const placed = placeAnimated(model, `remote_${id}`, {
          position: new Vector3(player.x, player.y, player.z),
          rotationY: 0,
        });
        if (!placed) return;
        brightenCharacter(placed.root, player.team === myTeam ? palettes.own : palettes.enemy);
        view = { root: placed.root, clips: placed.clips, current: "", team: player.team };
        this.views.set(id, view);
      }

      const sample = session.net?.remotePosition(id);
      const pos = sample?.position ?? { x: player.x, y: player.y, z: player.z };
      view.root.position.set(pos.x, pos.y, pos.z);
      view.root.rotation.set(0, sample?.yaw ?? player.yaw, 0);

      const speed = Math.hypot(player.vx, player.vz);
      const wanted =
        player.lifeState !== PLAYER_STATE.ALIVE
          ? "death"
          : speed > 5.2
            ? "run"
            : speed > 0.35
              ? "walk"
              : "idle";
      if (wanted !== view.current) {
        for (const clip of view.clips.values()) clip.stop();
        view.clips.get(wanted)?.start(wanted !== "death", 1.0);
        view.current = wanted;
      }
    });

    for (const [id, view] of this.views) {
      if (state.players.get(id)) continue;
      view.root.dispose();
      this.views.delete(id);
    }
  }

  clear(): void {
    for (const view of this.views.values()) view.root.dispose();
    this.views.clear();
  }
}

function localStatusFrom(me: PlayerState | undefined): LocalStatus {
  const slot = me?.weaponSlot ?? 0;
  return {
    alive: !me || me.lifeState === PLAYER_STATE.ALIVE,
    health: me?.health ?? MAX_HEALTH,
    godModeMs: 0,
    maxHealth: MAX_HEALTH,
    armor: me?.armor ?? 0,
    respawnInMs: 0,
    slot,
    weapons: MULTIPLAYER_LOADOUT.map((id, i) => {
      const spec = getWeapon(id);
      return {
        id,
        name: spec.displayName,
        // The schema carries the weapon in hand only; the others show full.
        magazine: i === slot ? (me?.ammoInMagazine ?? 0) : spec.magazineSize,
        magazineSize: spec.magazineSize,
        reserve: i === slot ? (me?.ammoReserve ?? 0) : 0,
      };
    }),
    reloading: (me?.reloadingUntilMs ?? 0) > 0,
    grenades: me?.grenades ?? 0,
    kills: me?.kills ?? 0,
    deaths: me?.deaths ?? 0,
  };
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// ----------------------------------------------------------------------- boot

function clientPlatform(): ClientPlatform {
  if (!navigator.userAgent.includes("Electron")) return "web";
  const os = navigator.userAgent;
  return os.includes("Windows") ? "windows" : os.includes("Mac") ? "macos" : "linux";
}

export async function bootOnline(
  canvas: HTMLCanvasElement,
  ui: HTMLElement,
  buildVersion: string,
): Promise<void> {
  const { engine, kind } = await createRenderer(canvas);
  const map = ARDAVAN_YARD; // the only map the match server runs
  const scene = new Scene(engine);

  let loadout: Loadout = preferredLoadout(window.location.search, safeStorage());
  rememberLoadout(loadout, safeStorage());
  const spawn = spawnsForTeam(map, sideTeam(loadout.side))[0];
  if (!spawn) throw new Error("map has no spawn");

  const camera = new FreeCamera("camera", new Vector3(0, 1.65, 40), scene);
  camera.minZ = 0.05;
  camera.maxZ = 600;
  camera.fov = (90 * Math.PI) / 180;

  const timeOfDay = preferredTimeOfDay(window.location.search, safeStorage());
  const world = await buildWorld(scene, engine, camera, map, timeOfDay);
  const viewmodel = new Viewmodel(scene, camera, world.assets);
  const audio = new GameAudio();
  void audio.load();
  const effects = new WeaponEffects(scene, map);
  effects.excludeFromFlash(viewmodel.meshes());
  const preview = new LoadoutPreview(scene, camera, world.assets);
  preview.show(loadout);
  const player = new PlayerController(scene, camera, canvas, map, spawn);
  const squad = new RemoteSquad(world.assets, loadout.color);

  const names = new Map<string, string>();
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "Someone") : "The yard");

  let hud: Hud | null = null;
  const session = new OnlineSession({
    buildVersion,
    platform: clientPlatform(),
    preferredTeam: () => sideTeam(loadout.side),
    events: {
      onKill: (kill) => {
        hud?.notify(`${nameOf(kill.attackerSessionId)} downed ${nameOf(kill.victimSessionId)}`);
      },
      onHit: (hit) => {
        const state = session.net?.state;
        const from = state?.players.get(hit.attackerSessionId);
        const to = state?.players.get(hit.victimSessionId);
        if (from && to && hit.attackerSessionId !== session.sessionId) {
          effects.tracerOnly(
            { x: from.x, y: from.y + 1.5, z: from.z },
            { x: to.x, y: to.y + 1.2, z: to.z },
          );
        }
        if (hit.victimSessionId !== session.sessionId) return;
        const at = player.status().position;
        const bearing = from
          ? ((Math.atan2(from.x - at.x, from.z - at.z) - camera.rotation.y) * 180) / Math.PI
          : null;
        hud?.showHit(hit.damage, bearing);
        player.stagger(hit.damage);
        audio.hurt();
      },
      onRespawn: (respawn) => {
        if (respawn.sessionId !== session.sessionId) return;
        player.teleport({ x: respawn.x, y: respawn.y, z: respawn.z }, respawn.yaw);
        player.setDead(false);
      },
    },
  });

  const lobby = createLobby(session);
  hud = createHud(ui, {
    renderer: kind,
    mapName: map.displayName,
    mapChecksum: mapChecksum(map),
    yard: map.id,
    loadout,
    onLoadoutChange: (next) => {
      loadout = next;
      rememberLoadout(next, safeStorage());
      preview.show(next);
    },
    sandboxPickers: false,
    extra: lobby.root,
    startLabel: "Deploy",
    onStart: () => player.requestLock(),
  });

  const banner = el("p", "online-banner");
  banner.setAttribute("aria-live", "off");
  ui.append(banner);

  const render = (status: OnlineStatus) => {
    lobby.render(status);
    hud?.setStartVisible(status.kind === "waiting" || status.kind === "live");
    if (status.kind !== "waiting" && status.kind !== "live") {
      squad.clear();
      banner.hidden = true;
      // Out of the room: hand the cursor back so the gate can be used.
      if (player.isLocked) document.exitPointerLock();
    }
    console.info(JSON.stringify({ msg: "online status", status: status.kind }));
  };
  session.onStatus(render);
  render(session.status);

  player.onLockChanged = (locked) => {
    hud?.setLocked(locked);
    if (locked) preview.hide();
    else preview.show(loadout);
    if (locked) {
      void audio.unlock().then(() => {
        audio.startAmbience();
        audio.startMusic();
      });
    }
  };
  hud.setLocked(false);

  // Links arrive with the intent: ?match=quick, ?code=XXXXXX (the desktop
  // shell's invite link says ?private=), or ?match=private to host one.
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code") ?? params.get("private");
  if (code) void session.joinPrivate(code);
  else if (params.get("match") === "quick") void session.quickMatch();
  else if (params.get("match") === "private") void session.createPrivate();

  window.addEventListener("pagehide", () => void session.leave());

  // Test hook for the headless two-browser check; harmless in production.
  (window as unknown as { __NC7_ONLINE__?: unknown }).__NC7_ONLINE__ = {
    status: () => session.status,
    roomId: () => session.roomId,
    sessionId: () => session.sessionId,
    players: () => {
      const out: { id: string; name: string; bot: boolean; team: number }[] = [];
      session.net?.state?.players.forEach((p, id) =>
        out.push({ id, name: p.displayName, bot: p.isBot, team: p.team }),
      );
      return out;
    },
  };

  const dynamicResolution = new DynamicResolution(engine);
  let lastAmmo = -1;
  let lastSlot = -1;
  let wasDead = false;

  engine.runRenderLoop(() => {
    const deltaMs = engine.getDeltaTime();
    dynamicResolution.update(deltaMs);
    session.refresh();

    const state = session.net?.state;
    const me = state?.players.get(session.sessionId);
    const inRoom = session.status.kind === "waiting" || session.status.kind === "live";

    if (player.isLocked && inRoom) {
      player.update(deltaMs);
      const frame = player.lastInput();
      session.net?.update(deltaMs, {
        moveX: frame?.moveX ?? 0,
        moveZ: frame?.moveZ ?? 0,
        yaw: frame?.yaw ?? 0,
        pitch: frame?.pitch ?? 0,
        buttons: frame?.buttons ?? 0,
      });
      if (player.consumeReloadRequest()) session.net?.reload();
      const change = player.consumeWeaponRequest();
      if (change && "slot" in change) session.net?.switchWeapon(change.slot);
      player.consumeThrowRequest();

      // Server wins: if the shared prediction and the camera disagree by more
      // than a step, put the camera where the server says.
      const predicted = session.net?.localPlayer?.renderPosition();
      const at = player.status().position;
      if (predicted && Math.hypot(predicted.x - at.x, predicted.z - at.z) > 1.5) {
        player.teleport(predicted, frame?.yaw ?? camera.rotation.y);
      }
    } else if (!player.isLocked) {
      preview.update(deltaMs);
    }

    if (state && me) {
      state.players.forEach((p, id) => names.set(id, p.displayName));
      squad.update(state, session.sessionId, me.team, session);

      const dead = me.lifeState !== PLAYER_STATE.ALIVE;
      if (dead !== wasDead) {
        player.setDead(dead);
        wasDead = dead;
      }

      // Our own shots: the server spent a round, so draw and play it.
      if (me.weaponSlot === lastSlot && me.ammoInMagazine < lastAmmo) {
        audio.fire();
        const eye = camera.globalPosition;
        const aim = camera.getDirection(Vector3.Forward());
        effects.fire(viewmodel.muzzlePosition() ?? eye, eye, aim, undefined, false);
      }
      lastAmmo = me.ammoInMagazine;
      lastSlot = me.weaponSlot;

      const weapon = MULTIPLAYER_LOADOUT[me.weaponSlot];
      if (weapon && viewmodel.setWeapon(weapon)) effects.excludeFromFlash(viewmodel.meshes());

      const phase =
        state.phase === MATCH_PHASE.WARMUP
          ? "WARMUP"
          : state.phase === MATCH_PHASE.LIVE
            ? "LIVE"
            : "ENDED";
      const scores = state.teams.map((t) => `${TEAM_NAME[t.id] ?? t.id} ${t.score}`).join(" · ");
      const text = `${phase} · ${scores} · ${formatClock(state.timeRemainingMs)}`;
      if (banner.textContent !== text) banner.textContent = text;
      banner.hidden = false;
    }

    viewmodel.update(deltaMs, player.status().speed, camera.rotation.y, camera.rotation.x);
    effects.update();
    hud?.update(player.status(), engine.getFps(), localStatusFrom(me));
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
  engine.resize();
}
