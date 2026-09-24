import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@nightcell7/multiplayer-sim";
import CATALOGUE from "./comms-lines.json";
import {
  CommsDirector,
  TIMING,
  ZONE,
  captionFor,
  linesFor,
  takesOf,
  zoneOf,
  type CommsFighter,
  type CommsSnapshot,
} from "./comms";
import { CHARACTER, CHARACTERS, SIDE, type CharacterId, type SideId } from "./loadout";

const NC = TEAM_IDS.NIGHTCELL;
const DIR = TEAM_IDS.DIRECTORATE;

/** A deterministic `random` so the tests do not depend on luck. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const at = (x: number, z: number, y = 0) => ({ x, y, z });
function fighter(team: number, position = at(0, 50), alive = true, isLocal = false): CommsFighter {
  return { team, position, alive, isLocal };
}
function snap(
  fighters: CommsFighter[],
  scores: Record<number, number> = { 0: 0, 1: 0 },
): CommsSnapshot {
  return { fighters, scores };
}

/** A director that has already sent the squad in, so tests start mid-match. */
function deployed(side: SideId = SIDE.NIGHTCELL, character: CharacterId = CHARACTER.ROOK) {
  const director = new CommsDirector(side, character, seeded());
  director.observe(0, snap([]), []);
  return director;
}

describe("the yard's callout areas", () => {
  it("names the lanes, the raised routes and the centre", () => {
    expect(zoneOf(at(-28, 0, 7))).toBe(ZONE.WEST_CATWALK);
    expect(zoneOf(at(-28, 0))).toBe(ZONE.PIPE_RACK);
    expect(zoneOf(at(27, 0, 6.4))).toBe(ZONE.GANTRY);
    expect(zoneOf(at(26, 28))).toBe(ZONE.TANK_ROW);
    expect(zoneOf(at(0, 0, 2.6))).toBe(ZONE.HARDPOINT);
    expect(zoneOf(at(5, -17))).toBe(ZONE.NORTH_CONTAINERS);
    expect(zoneOf(at(-5, 17))).toBe(ZONE.SOUTH_CONTAINERS);
    expect(zoneOf(at(0, -50))).toBe(ZONE.NORTH_GATE);
    expect(zoneOf(at(0, 50))).toBe(ZONE.YARD_GATE);
    expect(zoneOf(at(15, 25))).toBe(ZONE.OPEN);
  });
});

describe("the catalogue", () => {
  const sides = [SIDE.NIGHTCELL, SIDE.DIRECTORATE] as const;

  it("has every line the director can say, on both sides, with a clip for each", () => {
    const needed = [
      "order_move_out",
      "order_push_hardpoint",
      "order_push_west",
      "order_push_east",
      "order_hold_hardpoint",
      "order_fall_back",
      "order_catwalk",
      "order_gantry",
      "order_last_one",
      "order_good_work",
      "order_back_in",
      ...Object.values(ZONE).flatMap((z) => [`contact_${z}_a`, `contact_${z}_b`]),
      ...["enemy_down_a", "enemy_down_b", "enemy_down_c", "man_down_a", "man_down_b"],
      ...["operator_down_a", "operator_down_b", "nice_shot_a", "nice_shot_b", "nice_shot_c"],
      ...["grenade_a", "grenade_b"],
    ];
    for (const side of sides) {
      const have = new Set(linesFor(side));
      for (const id of needed) expect(have.has(id), `${side}/${id}`).toBe(true);
      for (const id of have) {
        const clip = new URL(`../public/audio/comms/${side}/${id}.mp3`, import.meta.url);
        expect(existsSync(clip), `${side}/${id}.mp3`).toBe(true);
      }
    }
  });

  it("records enough takes that the net does not repeat itself", () => {
    for (const side of sides) {
      for (const zone of Object.values(ZONE)) {
        expect(takesOf(side, `contact_${zone}`).length, `${side} ${zone}`).toBeGreaterThanOrEqual(
          4,
        );
      }
      for (const base of ["enemy_down", "nice_shot"]) {
        expect(takesOf(side, base).length, `${side} ${base}`).toBeGreaterThanOrEqual(6);
      }
      for (const base of ["man_down", "operator_down", "grenade"]) {
        expect(takesOf(side, base).length, `${side} ${base}`).toBeGreaterThanOrEqual(4);
      }
      for (const base of [
        "order_push_hardpoint",
        "order_fall_back",
        "order_move_out",
        "order_back_in",
      ]) {
        expect(takesOf(side, base).length, `${side} ${base}`).toBeGreaterThanOrEqual(2);
      }
      expect(
        linesFor(side).filter((id) => id.startsWith("chatter_")).length,
      ).toBeGreaterThanOrEqual(28);
    }
  });

  it("has a callsign for every character on their own side", () => {
    for (const character of CHARACTERS) {
      expect(linesFor(character.side)).toContain(`callsign_${character.id}`);
    }
  });

  it("gives both sides the same shape of net", () => {
    const [a, b] = sides.map((side) =>
      linesFor(side)
        .filter((id) => !id.startsWith("callsign_"))
        .sort(),
    );
    expect(a).toEqual(b);
  });

  it("ships no Farsi and nothing but English text (native review is pending)", () => {
    for (const side of sides) {
      for (const id of linesFor(side)) {
        const text = (CATALOGUE.lines[side] as Record<string, { text: string }>)[id]!.text;
        expect(text, `${side}/${id}`).toMatch(/^[\x20-\x7e]+$/);
      }
    }
  });
});

describe("the squad radio", () => {
  it("opens with command sending the squad in", () => {
    const director = new CommsDirector(SIDE.NIGHTCELL, CHARACTER.ROOK, seeded());
    const opening = director.observe(0, snap([]), []);
    expect(opening?.kind).toBe("order");
    expect(opening?.lines).toHaveLength(1);
    expect(opening?.lines[0]).toMatch(/^order_move_out(_v\d+)?$/);
  });

  it("calls a new contact by area, and does not repeat the area straight away", () => {
    const director = deployed();
    const squad = fighter(NC, at(-20, 10), true, true);
    const first = director.observe(5, snap([squad, fighter(DIR, at(-28, 0, 7))]), []);
    expect(first?.kind).toBe("callout");
    expect(first?.lines[0]).toMatch(/^contact_west_catwalk_[a-z]$/);

    // A second enemy appears on the same catwalk: same area, inside the cooldown.
    const again = director.observe(
      12,
      snap([squad, fighter(DIR, at(-28, 0, 7)), fighter(DIR, at(-29, 4, 7))]),
      [],
    );
    expect(again?.lines[0] ?? "").not.toMatch(/^contact_west_catwalk/);
  });

  it("does not call an enemy nobody on the squad could see", () => {
    const director = deployed();
    const t = director.observe(
      5,
      snap([fighter(NC, at(0, 50), true, true), fighter(DIR, at(0, -50))]),
      [],
    );
    expect(t?.lines[0] ?? "").not.toMatch(/^contact_/);
  });

  it("never keys up over a transmission that is still playing", () => {
    const director = deployed();
    const s = snap([fighter(NC, at(0, 20), true, true), fighter(DIR, at(0, 10))]);
    expect(director.observe(5, s, [], true)).toBeNull();
    expect(director.observe(5.1, s, [])).not.toBeNull();
  });

  it("addresses orders to the player by callsign, and broadcasts only to all", () => {
    const director = deployed(SIDE.DIRECTORATE, CHARACTER.LEILA);
    const s = snap([fighter(DIR, at(0, -50), true, true)]);
    const order = director.observe(TIMING.orderEvery[1] + 1, s, []);
    expect(order?.kind).toBe("order");
    expect(order?.lines[0]).toBe("callsign_leila");
    expect(captionFor(SIDE.DIRECTORATE, order!.lines).text).toMatch(/^Farzan, /);
  });

  it("holds when well ahead and falls back when well behind", () => {
    const ahead = deployed();
    const late = TIMING.orderEvery[1] + 1;
    const me = fighter(NC, at(0, 50), true, true);
    expect(ahead.observe(late, snap([me], { [NC]: 12, [DIR]: 3 }), [])?.lines[1]).toMatch(
      /^order_hold_hardpoint/,
    );
    const behind = deployed();
    expect(behind.observe(late, snap([me], { [NC]: 2, [DIR]: 9 }), [])?.lines[1]).toMatch(
      /^order_fall_back/,
    );
  });

  it("reacts to the player going down and coming back", () => {
    const director = deployed();
    const s = snap([fighter(NC, at(0, 50), false, true)]);
    const down = director.observe(5, s, [
      { type: "kill", victimTeam: NC, victimIsLocal: true, killerIsLocal: false },
    ]);
    expect(down?.lines[0]).toMatch(/^operator_down_/);
    const back = director.observe(10, s, [{ type: "local_respawn" }]);
    expect(back?.lines[0]).toBe("callsign_rook");
    expect(back?.lines[1]).toMatch(/^order_back_in(_v\d+)?$/);
  });

  it("shouts about an enemy grenade near the squad, not one of ours", () => {
    const director = deployed();
    const me = fighter(NC, at(0, 20), true, true);
    const ours = director.observe(5, snap([me]), [
      { type: "grenade", team: NC, position: at(0, 21) },
    ]);
    expect(ours?.lines[0] ?? "").not.toMatch(/^grenade/);
    const theirs = director.observe(9, snap([me]), [
      { type: "grenade", team: DIR, position: at(1, 22) },
    ]);
    expect(theirs?.lines[0]).toMatch(/^grenade_/);
  });

  it("calls the last enemy standing once", () => {
    const director = deployed();
    const me = fighter(NC, at(0, 50), true, true);
    const field = [me, fighter(DIR, at(0, -50)), fighter(DIR, at(5, -50), false)];
    expect(director.observe(5, snap(field), [])?.lines[1]).toMatch(/^order_last_one/);
    expect(director.observe(9, snap(field), [])?.lines[1] ?? "").not.toMatch(/^order_last_one/);
  });

  it("never plays the same take twice running, and uses every take", () => {
    const director = deployed();
    const me = fighter(NC, at(0, 50), true, true);
    const said: string[] = [];
    let t = 5;
    // Enemy kills, spaced past every cooldown, with random() fixed by the seed.
    for (let i = 0; i < 40; i += 1, t += TIMING.enemyDownCooldown + 1) {
      const next = director.observe(t, snap([me]), [
        { type: "kill", victimTeam: DIR, victimIsLocal: false, killerIsLocal: false },
      ]);
      if (next?.lines[0]?.startsWith("enemy_down")) said.push(next.lines[0]);
    }
    expect(said.length).toBeGreaterThan(8);
    for (let i = 1; i < said.length; i += 1) expect(said[i]).not.toBe(said[i - 1]);
    expect(new Set(said).size).toBe(takesOf(SIDE.NIGHTCELL, "enemy_down").length);
  });

  it("follows a chatter call with its answer", () => {
    const director = new CommsDirector(SIDE.NIGHTCELL, CHARACTER.ROOK, () => 0);
    director.observe(0, snap([]), []);
    // Quiet net, no orders due yet: chatter. With random() = 0 the first pick
    // is the lowest-numbered call, chatter_01; walk until a call with an answer.
    const said: string[] = [];
    for (let t = 1; t < 120; t += 0.5) {
      const next = director.observe(t, snap([]), []);
      if (next) said.push(next.lines.at(-1)!);
    }
    const call = said.indexOf("chatter_02");
    expect(call).toBeGreaterThanOrEqual(0);
    expect(said[call + 1]).toBe("chatter_03");
  });
});
