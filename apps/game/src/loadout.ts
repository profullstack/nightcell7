import { WEAPON, getWeapon, type WeaponId } from "@nightcell7/game-core";
import { TEAM_IDS } from "@nightcell7/multiplayer-sim";
import { SANDBOX_STAMINA_CAP } from "./sandbox-rules";
import type { ModelName } from "./assets";

/**
 * The operator the player deploys as, and the armory they buy from.
 *
 * Chosen on the deploy gate: character (and with it the side), armour class,
 * colour. Persisted
 * so the gate reopens as it was left. Pure data and pure functions, so the
 * numbers are testable without a renderer; the preview figure and the
 * purchase effects live where the scene and the simulation are.
 *
 * Credits are earned in the yard and spent here. Nothing is bought with
 * money: the multiplayer rules forbid paid weapons and pay-to-win, and the
 * sandbox is free while it is being built and tested.
 */

// ------------------------------------------------------------------- side

export const SIDE = {
  NIGHTCELL: "nightcell",
  DIRECTORATE: "directorate",
} as const;

export type SideId = (typeof SIDE)[keyof typeof SIDE];

export interface SideInfo {
  readonly id: SideId;
  readonly name: string;
  readonly blurb: string;
  readonly team: number;
}

export const SIDES: readonly SideInfo[] = [
  {
    id: SIDE.NIGHTCELL,
    name: "Nightcell",
    blurb: "Irregulars holding the south of the yard.",
    team: TEAM_IDS.NIGHTCELL,
  },
  {
    id: SIDE.DIRECTORATE,
    name: "Directorate",
    blurb: "Regulars holding the north.",
    team: TEAM_IDS.DIRECTORATE,
  },
];

export function sideTeam(side: SideId): number {
  return SIDES.find((entry) => entry.id === side)?.team ?? TEAM_IDS.NIGHTCELL;
}

// -------------------------------------------------------------- character

/**
 * Who the player deploys as. Picking a character picks their side: the yard
 * is Nightcell against the Directorate, so the playable cast is the people
 * from those two institutions who would be in a fight. Two a side, in the
 * same order, because PRD §14.3 requires that neither side be presented as
 * the richer or more heroic one. Director Vey and Silas Kade are on the
 * website's cast page but are not operators in the yard.
 *
 * `figure` is the model that stands on the gate; `portrait` is the painted
 * key art in `public/assets/portraits`, the same image the website's cast
 * page shows (docs/art/characters/manifest.json records how each was made).
 */
export const CHARACTER = {
  ROOK: "rook",
  VALE: "vale",
  LEILA: "leila",
  DARYAN: "daryan",
} as const;

export type CharacterId = (typeof CHARACTER)[keyof typeof CHARACTER];

export interface CharacterInfo {
  readonly id: CharacterId;
  readonly name: string;
  /** One line under the name on the gate card. */
  readonly role: string;
  readonly side: SideId;
  readonly figure: ModelName;
  readonly portrait: string;
}

export const CHARACTERS: readonly CharacterInfo[] = [
  {
    id: CHARACTER.ROOK,
    name: "Rook",
    role: "Deep-cover operative",
    side: SIDE.NIGHTCELL,
    figure: "m3_operator_nightcell",
    portrait: "rook.webp",
  },
  {
    id: CHARACTER.VALE,
    name: "Jonas Vale",
    role: "Rook's handler",
    side: SIDE.NIGHTCELL,
    figure: "m3_operator_nightcell",
    portrait: "vale.webp",
  },
  {
    id: CHARACTER.LEILA,
    name: "Leila Farzan",
    role: "Counterintelligence officer",
    side: SIDE.DIRECTORATE,
    figure: "m3_operator_directorate",
    portrait: "leila.webp",
  },
  {
    id: CHARACTER.DARYAN,
    name: "Col. Arman Daryan",
    role: "Leila's commanding officer",
    side: SIDE.DIRECTORATE,
    figure: "m3_operator_directorate",
    portrait: "daryan.webp",
  },
];

export function characterInfo(id: CharacterId): CharacterInfo {
  return CHARACTERS.find((entry) => entry.id === id) ?? CHARACTERS[0]!;
}

/** The character a side opens on: its protagonist. */
export function defaultCharacterFor(side: SideId): CharacterId {
  return side === SIDE.DIRECTORATE ? CHARACTER.LEILA : CHARACTER.ROOK;
}

// ------------------------------------------------------------------ armour

export const ARMOR_CLASS = {
  LIGHT: "light",
  STANDARD: "standard",
  HEAVY: "heavy",
} as const;

export type ArmorClassId = (typeof ARMOR_CLASS)[keyof typeof ARMOR_CLASS];

export interface ArmorClassInfo {
  readonly id: ArmorClassId;
  readonly name: string;
  readonly blurb: string;
  /** Armour on deploy and on every redeploy. */
  readonly armor: number;
  /** Added to starting stamina. Plates are heavy; stamina pays for them. */
  readonly staminaBonus: number;
}

export const ARMOR_CLASSES: readonly ArmorClassInfo[] = [
  {
    id: ARMOR_CLASS.LIGHT,
    name: "Light",
    blurb: "Soft armour only. +25 stamina.",
    armor: 20,
    staminaBonus: 25,
  },
  {
    id: ARMOR_CLASS.STANDARD,
    name: "Standard",
    blurb: "Plate carrier, front and back.",
    armor: 50,
    staminaBonus: 0,
  },
  {
    id: ARMOR_CLASS.HEAVY,
    name: "Heavy",
    blurb: "Full plates and side panels. −25 stamina.",
    armor: 100,
    staminaBonus: -25,
  },
];

export function armorClassInfo(id: ArmorClassId): ArmorClassInfo {
  return ARMOR_CLASSES.find((entry) => entry.id === id) ?? ARMOR_CLASSES[1]!;
}

// ------------------------------------------------------------------ colour

export interface ColorInfo {
  readonly id: string;
  readonly name: string;
  /** Webbing and plate: the small, saturated identifier. Hex. */
  readonly band: string;
  /** Uniform cloth: the large, desaturated one. Hex. */
  readonly cloth: string;
}

export const COLORS: readonly ColorInfo[] = [
  { id: "signal", name: "Signal", band: "#1ac0f2", cloth: "#6b8599" },
  { id: "olive", name: "Olive", band: "#9bc23a", cloth: "#5c6b47" },
  { id: "sand", name: "Sand", band: "#e6b25a", cloth: "#9b8a6a" },
  { id: "ember", name: "Ember", band: "#ff4b1f", cloth: "#7a5a4c" },
  { id: "slate", name: "Slate", band: "#c8d0d8", cloth: "#4a5259" },
];

export function colorInfo(id: string): ColorInfo {
  return COLORS.find((entry) => entry.id === id) ?? COLORS[0]!;
}

// ----------------------------------------------------------------- loadout

export interface Loadout {
  readonly character: CharacterId;
  /** Always the character's side; kept on the loadout because rosters key on it. */
  readonly side: SideId;
  readonly armor: ArmorClassId;
  readonly color: string;
}

export const DEFAULT_LOADOUT: Loadout = {
  character: CHARACTER.ROOK,
  side: SIDE.NIGHTCELL,
  armor: ARMOR_CLASS.STANDARD,
  color: "signal",
};

const LOADOUT_KEY = "nc7.loadout";

function isSide(value: unknown): value is SideId {
  return SIDES.some((entry) => entry.id === value);
}
function isCharacter(value: unknown): value is CharacterId {
  return CHARACTERS.some((entry) => entry.id === value);
}
function isArmorClass(value: unknown): value is ArmorClassId {
  return ARMOR_CLASSES.some((entry) => entry.id === value);
}
function isColor(value: unknown): value is string {
  return COLORS.some((entry) => entry.id === value);
}

/**
 * The loadout to deploy with. The character comes from, in order: `?character=`
 * in the URL (the website's "Play as" links), `?side=` (that side's
 * protagonist; a link can open a specific faction for a capture or a bug
 * report), the remembered character, a remembered side from before characters
 * existed, and the default. The side always follows the character. Every other
 * field is validated on its own, so a stale or hand-edited entry falls back
 * one field at a time.
 */
export function preferredLoadout(search: string, storage?: Storage): Loadout {
  let stored: Partial<Record<keyof Loadout, unknown>> = {};
  try {
    const raw = storage?.getItem(LOADOUT_KEY) ?? null;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") stored = parsed as typeof stored;
    }
  } catch {
    // Blocked storage or a corrupt entry: neither is worth failing a boot over.
  }
  const query = new URLSearchParams(search);
  const requestedCharacter = query.get("character");
  const requestedSide = query.get("side");
  const character = isCharacter(requestedCharacter)
    ? requestedCharacter
    : isSide(requestedSide)
      ? defaultCharacterFor(requestedSide)
      : isCharacter(stored.character)
        ? stored.character
        : isSide(stored.side)
          ? defaultCharacterFor(stored.side)
          : DEFAULT_LOADOUT.character;
  return {
    character,
    side: characterInfo(character).side,
    armor: isArmorClass(stored.armor) ? stored.armor : DEFAULT_LOADOUT.armor,
    color: isColor(stored.color) ? stored.color : DEFAULT_LOADOUT.color,
  };
}

/** A loadout as that character: the side comes with them. */
export function withCharacter(loadout: Loadout, character: CharacterId): Loadout {
  return { ...loadout, character, side: characterInfo(character).side };
}

export function rememberLoadout(loadout: Loadout, storage?: Storage): void {
  try {
    storage?.setItem(LOADOUT_KEY, JSON.stringify(loadout));
  } catch {
    // As above.
  }
}

// ----------------------------------------------------------------- credits

/** A first visit can afford a weapon and a resupply, not the whole rack. */
export const CREDITS_START = 1000;
export const CREDITS_PER_KILL = 100;
export const CREDITS_PER_PACK = 25;

const CREDITS_KEY = "nc7.credits";

export function loadCredits(storage?: Storage): number {
  try {
    const raw = storage?.getItem(CREDITS_KEY) ?? null;
    const value = raw === null ? NaN : Number(raw);
    if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  } catch {
    // Blocked storage: start fresh.
  }
  return CREDITS_START;
}

export function saveCredits(credits: number, storage?: Storage): void {
  try {
    storage?.setItem(CREDITS_KEY, String(Math.max(0, Math.floor(credits))));
  } catch {
    // As above.
  }
}

// ------------------------------------------------------------------ armory

export const ARMORY_ITEM = {
  AMMO: "ammo",
  MEDKIT: "medkit",
  PLATES: "plates",
  CONDITIONING: "conditioning",
  C9: "c9",
  P11: "p11",
  B4: "b4",
  M9: "m9",
} as const;

export type ArmoryItemId = (typeof ARMORY_ITEM)[keyof typeof ARMORY_ITEM];

export interface ArmoryItem {
  readonly id: ArmoryItemId;
  readonly name: string;
  readonly blurb: string;
  readonly price: number;
  /** For a weapon: which one. Bought weapons come with a full issue of ammo. */
  readonly weapon?: WeaponId;
}

export const ARMORY: readonly ArmoryItem[] = [
  {
    id: ARMORY_ITEM.AMMO,
    name: "Resupply",
    blurb: "Every magazine and reserve filled to issue.",
    price: 100,
  },
  {
    id: ARMORY_ITEM.MEDKIT,
    name: "Medkit",
    blurb: "Health back to full stamina.",
    price: 100,
  },
  {
    id: ARMORY_ITEM.PLATES,
    name: "Fresh plates",
    blurb: "Armour to 100.",
    price: 150,
  },
  {
    id: ARMORY_ITEM.CONDITIONING,
    name: "Conditioning",
    blurb: `+25 stamina, up to ${SANDBOX_STAMINA_CAP}.`,
    price: 250,
  },
  {
    id: ARMORY_ITEM.C9,
    name: getWeapon(WEAPON.C9_KESTREL).displayName,
    blurb: "Rifle. A slot, or reserve ammunition if carried.",
    price: 300,
    weapon: WEAPON.C9_KESTREL,
  },
  {
    id: ARMORY_ITEM.P11,
    name: getWeapon(WEAPON.P11).displayName,
    blurb: "Sidearm. A slot, or reserve ammunition if carried.",
    price: 150,
    weapon: WEAPON.P11,
  },
  {
    id: ARMORY_ITEM.B4,
    name: getWeapon(WEAPON.B4_BREACHER).displayName,
    blurb: "Shotgun. A slot, or reserve ammunition if carried.",
    price: 400,
    weapon: WEAPON.B4_BREACHER,
  },
  {
    id: ARMORY_ITEM.M9,
    name: getWeapon(WEAPON.M9_HAMMERFALL).displayName,
    blurb: "Rocket launcher. One tube, a long reload, and a blast.",
    // The dearest thing in the armory by a distance. Credits are earned at
    // +100 a kill, so this is roughly eight kills: it should be the shot you
    // save up for, not the one you open with.
    price: 800,
    weapon: WEAPON.M9_HAMMERFALL,
  },
];

export function armoryItem(id: ArmoryItemId): ArmoryItem | undefined {
  return ARMORY.find((entry) => entry.id === id);
}

export function affordable(credits: number, item: ArmoryItem): boolean {
  return credits >= item.price;
}
