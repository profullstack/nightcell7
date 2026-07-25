/**
 * Protocol and content versioning.
 *
 * PRD §18.5: every connection declares game build, protocol version and
 * content/map version. Incompatible gameplay clients must not share a room.
 *
 * Bump `PROTOCOL_VERSION` for ANY breaking change to the message set, the
 * input encoding, the room state schema or the simulation constants that
 * both sides must agree on. Additive, ignorable fields do not require a bump.
 */
export const PROTOCOL_VERSION = 1 as const;

/**
 * The oldest protocol a server process will still admit into a room.
 * A bounded compatibility window lets a deploy roll without kicking everyone,
 * but only while the gameplay contract is genuinely unchanged.
 */
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1 as const;

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
