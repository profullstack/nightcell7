import { SIDE, type SideId } from "./ids";

/**
 * The people and institutions of Episode 1, as canon.
 *
 * Shared by the marketing site (the cast page and the dossiers) and the game
 * (the first-run briefing), so the two can never describe the same person
 * differently. Everything here comes from the Episode 1 story bible (PRD §7).
 *
 * **Spoiler rule.** This is public copy. It says who each person is and what
 * the player sees of them early, never what the campaigns reveal about them.
 * The site already publishes the shared timeline's opening hour, so Vale's
 * death at 01:16 is public; who authorised the cleanup, and what "Nightcell 7"
 * designates, are not, and nothing here gives them away.
 *
 * **Content rule** (docs/content-and-culture.md). No Farsi strings: that
 * content is pending native review. Nationality never equals enemy; the
 * Directorate is written as an institution with competent, sympathetic people
 * in it, and Daryan is not a villain.
 */

export const FACTION = {
  NIGHTCELL: "nightcell",
  DIRECTORATE: "directorate",
  ORISON: "orison",
  VERIFICATION: "verification",
} as const;
export type FactionId = (typeof FACTION)[keyof typeof FACTION];

export interface Faction {
  readonly id: FactionId;
  readonly name: string;
  readonly summary: string;
}

export const FACTIONS: readonly Faction[] = [
  {
    id: FACTION.NIGHTCELL,
    name: "Nightcell Program",
    summary:
      "A compartmented, American-led multinational special-activities structure. Officially it does not exist, which is what makes it useful to the people who run it, and dangerous to the people inside it.",
  },
  {
    id: FACTION.DIRECTORATE,
    name: "Security Directorate",
    summary:
      "A fictional Iranian security service, and not a monolith. Some of its officers act on orders that have been poisoned, some hunt the protagonists, and some quietly work to stop the escalation.",
  },
  {
    id: FACTION.ORISON,
    name: "Orison Strategic",
    summary:
      "A multinational defense, intelligence, logistics and data contractor, and the operational center of the conspiracy. Orison profits from emergency contracts, destroyed evidence and a wider war.",
  },
  {
    id: FACTION.VERIFICATION,
    name: "International Verification Mission",
    summary:
      "The small multinational mission monitoring a fragile de-escalation agreement. Most of its people know nothing about the plot. They are its intended victims.",
  },
];

export interface CastMember {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly faction: FactionId;
  /** Which campaign the player mostly meets them in; both when they cross. */
  readonly seenIn: SideId | "both";
  readonly summary: string;
}

/** The supporting cast. The two protagonists have their own dossiers. */
export const SUPPORTING_CAST: readonly CastMember[] = [
  {
    id: "vale",
    name: "Jonas Vale",
    role: "Rook's handler",
    faction: FACTION.NIGHTCELL,
    seenIn: "both",
    summary:
      "The only person in the theater who knows who Rook really is. Vale carries the first physical piece of MIRAGE to the meeting at Kaviran, and Orison reaches him before he can hand it over. His last words are a warning about the signal. Leila hears a fragment of it on an intercepted channel, without knowing whose voice it is.",
  },
  {
    id: "vey",
    name: "Director Mara Vey",
    role: "Nightcell authority",
    faction: FACTION.NIGHTCELL,
    seenIn: SIDE.ROOK,
    summary:
      "Rook's command voice. Vey's orders arrive over the radio, and they are always calm. She is certain that Leila is part of the plot. Whether she is right about that, or about anything else, is one of the questions the campaigns exist to answer.",
  },
  {
    id: "daryan",
    name: "Colonel Arman Daryan",
    role: "Leila's commanding officer",
    faction: FACTION.DIRECTORATE,
    seenIn: SIDE.LEILA,
    summary:
      "Leila's superior in the Directorate. He orders Rook's capture on evidence that looks conclusive, and as the night goes on his orders begin to contradict each other. Daryan is a professional being handed a lie, not a villain, and the player is never told what to make of him too early.",
  },
  {
    id: "kade",
    name: "Silas Kade",
    role: "Orison tactical director",
    faction: FACTION.ORISON,
    seenIn: "both",
    summary:
      "Runs Orison's field teams and the cleanup that follows MIRAGE. To Kade a war is a supply chain with casualties in it, and he manages it the same way. Both protagonists end up in his way, and each campaign sees him from a different side.",
  },
];

export const MIRAGE = {
  name: "MIRAGE",
  summary:
    "A fictional system that manufactures battlefield attribution: forged transponder identities, altered command logs, manipulated sensor footage and synthetic voice orders. MIRAGE does not need to win a fight. It only needs each side to believe the other fired first.",
} as const;

/** The people around each protagonist, for their dossier. Same shape per side. */
export interface Circle {
  readonly answersTo: string;
  readonly crosses: readonly string[];
}

export const CIRCLES: Readonly<Record<SideId, Circle>> = {
  [SIDE.ROOK]: { answersTo: "vey", crosses: ["vale", "kade"] },
  [SIDE.LEILA]: { answersTo: "daryan", crosses: ["vale", "kade"] },
};

export function castMember(id: string): CastMember {
  const member = SUPPORTING_CAST.find((m) => m.id === id);
  if (!member) throw new Error(`unknown cast member: ${id}`);
  return member;
}

export function faction(id: FactionId): Faction {
  const found = FACTIONS.find((f) => f.id === id);
  if (!found) throw new Error(`unknown faction: ${id}`);
  return found;
}
