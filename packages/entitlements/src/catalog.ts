import { z } from "zod";
import { EPISODE, MISSION, type EpisodeId } from "@nightcell7/game-core";

/**
 * Server-controlled catalog (PRD §24.6).
 *
 * The catalog is the price authority. The client never submits an amount, and
 * `resolvePrice` is the only way an order gets one.
 */

export const catalogEntrySchema = z.object({
  episodeId: z.string().min(1),
  title: z.string().min(1),
  currency: z.literal("USD"),
  /** Minor units. 999 = $9.99. */
  unitAmount: z.number().int().positive(),
  coinpayProductId: z.string().min(1),
  status: z.enum(["available", "coming_soon", "unavailable"]),
  includes: z.array(z.string()).min(1),
  taxCode: z.string().min(1),
});

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

/** Launch price (PRD §5.2). One purchase, both campaigns, every platform. */
export const EPISODE_PRICE_USD_CENTS = 999;

export const CATALOG: readonly CatalogEntry[] = [
  {
    episodeId: EPISODE.FALSE_DAWN,
    title: "False Dawn",
    currency: "USD",
    unitAmount: EPISODE_PRICE_USD_CENTS,
    coinpayProductId: "episode_false_dawn",
    status: "available",
    includes: ["rook-campaign", "leila-campaign", MISSION.COMPLETE_TRUTH],
    // Digital product classification; jurisdiction handling sits on the order.
    taxCode: "digital-game-download",
  },
];

export function findCatalogEntry(episodeId: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.episodeId === episodeId);
}

export type PriceResolution =
  | { ok: true; entry: CatalogEntry; unitAmount: number; currency: "USD" }
  | { ok: false; reason: "unknown_episode" | "not_purchasable" };

/**
 * The single place an order's amount comes from.
 *
 * Note the absence of any caller-supplied amount parameter: there is no code
 * path that lets a client influence what is charged (PRD §24.1).
 */
export function resolvePrice(episodeId: string): PriceResolution {
  const entry = findCatalogEntry(episodeId);
  if (!entry) return { ok: false, reason: "unknown_episode" };
  if (entry.status !== "available") return { ok: false, reason: "not_purchasable" };
  return { ok: true, entry, unitAmount: entry.unitAmount, currency: entry.currency };
}

/** Display helper shared by the site and the in-game store. */
export function formatPrice(unitAmount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(unitAmount / 100);
}

export function isEpisodeId(value: string): value is EpisodeId {
  return CATALOG.some((entry) => entry.episodeId === value);
}
