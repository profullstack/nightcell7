/**
 * Protocol and content versioning.
 *
 * PRD §18.5: every connection declares game build, protocol version and
 * content/map version. Incompatible gameplay clients must not share a room.
 *
 * Bump `PROTOCOL_VERSION` for ANY breaking change to the message set, the
 * input encoding, the room state schema or the simulation constants that
 * both sides must agree on. Additive, ignorable fields do not require a bump.
 *
 * Version 2 adds grenades: two server messages, a carried count in the room
 * state, and a damage source that exists on one side of the version line and
 * not the other. The message channel (`CLIENT_MESSAGE.THROW_GRENADE`) already
 * existed in v1 and did nothing, which is exactly why the *behaviour*, not the
 * message set, is what makes this breaking.
 */
export const PROTOCOL_VERSION = 2 as const;

/**
 * The oldest protocol a server process will still admit into a room.
 * A bounded compatibility window lets a deploy roll without kicking everyone,
 * but only while the gameplay contract is genuinely unchanged.
 *
 * Raised to 2 with grenades. A v1 client can neither throw one nor render one,
 * but would still take blast damage from players who can — so the window is
 * deliberately closed rather than left open for a smoother deploy. An
 * unwinnable match is worse than a reconnect.
 */
export const MIN_SUPPORTED_PROTOCOL_VERSION = 2 as const;

/**
 * Content version covers the gameplay-relevant map data: collision geometry,
 * spawn points and weapon tuning. It is deliberately separate from the visual
 * asset pack version — art can ship without invalidating a match.
 */
export const CONTENT_VERSION = "1.0.0" as const;

export interface BuildIdentity {
  /** Human-facing build string, e.g. "0.1.0+2026.07.25.1". */
  readonly buildVersion: string;
  readonly protocolVersion: number;
  readonly contentVersion: string;
  readonly platform: ClientPlatform;
}

export const CLIENT_PLATFORMS = ["web", "pwa", "windows", "macos", "linux"] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export function isProtocolCompatible(clientProtocol: number): boolean {
  return (
    Number.isInteger(clientProtocol) &&
    clientProtocol >= MIN_SUPPORTED_PROTOCOL_VERSION &&
    clientProtocol <= PROTOCOL_VERSION
  );
}

export function isContentCompatible(clientContent: string): boolean {
  return clientContent === CONTENT_VERSION;
}
