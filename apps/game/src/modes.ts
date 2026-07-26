/**
 * Game modes offered on the start gate.
 *
 * All three are single-player against NPCs. That is deliberate and is not a
 * placeholder for "real multiplayer later": PRD §23.1 draws the line at
 * *access*, not at content — browsing, the demo and the technical scenes need
 * no account, while online multiplayer needs a verified one. Everything here
 * sits on the free side of that line, so `/play` stays openable by anyone.
 *
 * These are also not new competitive modes. The locked V1 decision is one
 * multiplayer mode — 6v6 Team Deathmatch — and inventing a second would
 * contradict it. `range` and `roam` are the "training" and "greybox" technical
 * scenes the PRD already lists under the sandbox; both were built and neither
 * had an entry point, so the picker exposes work that already existed rather
 * than adding scope.
 */

export const GAME_MODE = {
  /** The existing sandbox: live bots on both teams, scored. */
  DEATHMATCH: "deathmatch",
  /** Stationary targets. Nothing moves, nothing shoots back. */
  RANGE: "range",
  /** The empty yard. */
  ROAM: "roam",
} as const;

export type GameMode = (typeof GAME_MODE)[keyof typeof GAME_MODE];

export interface GameModeInfo {
  readonly id: GameMode;
  readonly name: string;
  /** One line on the gate. Says what the player will actually meet. */
  readonly blurb: string;
}

export const GAME_MODES: readonly GameModeInfo[] = [
  {
    id: GAME_MODE.DEATHMATCH,
    name: "Team Deathmatch",
    blurb: "Four Directorate against you and three Nightcell. They flank, shoot back and throw.",
  },
  {
    id: GAME_MODE.RANGE,
    name: "Firing Range",
    blurb: "Stationary targets. Nothing returns fire — for learning the rifle and the grenade arc.",
  },
  {
    id: GAME_MODE.ROAM,
    name: "Free Roam",
    blurb: "The yard, empty. Movement and level geometry with nothing shooting at you.",
  },
];

export const DEFAULT_GAME_MODE: GameMode = GAME_MODE.DEATHMATCH;

/** Storage key for the last mode chosen, so the gate reopens where you left it. */
const STORAGE_KEY = "nc7.mode";

function isGameMode(value: string | null): value is GameMode {
  return GAME_MODES.some((mode) => mode.id === value);
}

/**
 * Which mode to preselect.
 *
 * `?mode=` is checked first so a link can open a specific scene — useful for
 * a bug report or a capture — and the remembered choice second. Note this is a
 * *different* `mode` parameter from `access.ts`'s: that one selects who may
 * play (demo, campaign, multiplayer), this one selects what is in the yard.
 * They never collide because the access values are not mode ids, and an
 * unrecognised value falls through to the default either way.
 */
export function preferredMode(search: string, storage?: Storage): GameMode {
  const requested = new URLSearchParams(search).get("mode");
  if (isGameMode(requested)) return requested;

  try {
    const remembered = storage?.getItem(STORAGE_KEY) ?? null;
    if (isGameMode(remembered)) return remembered;
  } catch {
    // Private browsing and blocked storage both throw on access rather than
    // returning null. A forgotten preference is not worth failing a boot over.
  }

  return DEFAULT_GAME_MODE;
}

/** Remember the chosen mode. Failure here is never worth interrupting play. */
export function rememberMode(mode: GameMode, storage?: Storage): void {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    // As above.
  }
}

export function modeInfo(mode: GameMode): GameModeInfo {
  return GAME_MODES.find((entry) => entry.id === mode) ?? GAME_MODES[0]!;
}
