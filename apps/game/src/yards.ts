import {
  ARDAVAN_YARD,
  SAFFRON_FREIGHT,
  NACRE_RELAY,
  type CollisionMap,
} from "@nightcell7/multiplayer-sim";

export const YARDS = [
  {
    map: ARDAVAN_YARD,
    code: "01",
    color: "#69aebc",
    blurb: "Industrial night. Three lanes, pipe racks and elevated catwalks.",
  },
  {
    map: SAFFRON_FREIGHT,
    code: "02",
    color: "#e9aa51",
    blurb: "Amber freight stacks. Staggered crosscuts, close encounters and wide flanking routes.",
  },
  {
    map: NACRE_RELAY,
    code: "03",
    color: "#8ad9cb",
    blurb: "Ivory relay houses. Circle the compound or risk the open central plaza.",
  },
] as const;

export function preferredYard(search: string, storage?: Storage): CollisionMap {
  const params = new URLSearchParams(search);
  // Online rooms still use their server-selected competitive map.
  if (params.get("mode") === "multiplayer") return ARDAVAN_YARD;
  const requested = params.get("yard");
  if (requested !== null)
    return YARDS.find((yard) => yard.map.id === requested)?.map ?? ARDAVAN_YARD;
  try {
    return YARDS.find((yard) => yard.map.id === storage?.getItem("nc7.yard"))?.map ?? ARDAVAN_YARD;
  } catch {
    return ARDAVAN_YARD;
  }
}

export function rememberYard(id: string, storage?: Storage): void {
  try {
    storage?.setItem("nc7.yard", id);
  } catch {
    /* Storage is optional. */
  }
}
