import type { Metadata } from "next";
import { MULTIPLAYER_MAP, TDM_RULES } from "@nightcell7/game-core";
import { CaptureStrip, CapturePlate, GreyboxNotice } from "../gallery";

export const metadata: Metadata = {
  title: "Multiplayer Alpha",
  description: "Free 6v6 Team Deathmatch. Server-authoritative. Cross-play. No pay-to-win.",
};

/** Live service data must come from the API and carry a timestamp (PRD §20.4). */
async function fetchStatus() {
  const origin = process.env.PUBLIC_ORIGIN ?? "http://localhost:8080";
  try {
    const response = await fetch(`${origin}/api/v1/multiplayer/status`, {
      // Never cache a service-status response that the page presents as current.
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default async function MultiplayerPage() {
  const status = await fetchStatus();

  return (
    <section className="section" style={{ borderTop: "none" }}>
      <div className="shell">
        <p className="section__label">
          <span className="tag tag--alpha">Alpha</span> <span className="tag tag--free">Free</span>
        </p>
        <h2>One battlefield. Two factions. The server decides what happened.</h2>
        <p className="lede">
          6v6 Team Deathmatch on Ardavan Yard, built from Episode 1 architecture. Free to any
          verified account &mdash; you do not need to own an episode to play it.
        </p>

        <CapturePlate name="west-catwalk" label="Ardavan Yard" />

        <dl className="status-grid">
          <div className="status-cell">
            <dt>Mode</dt>
            <dd>
              {TDM_RULES.teamSize}v{TDM_RULES.teamSize} Team Deathmatch
            </dd>
          </div>
          <div className="status-cell">
            <dt>Map</dt>
            <dd>Ardavan Yard</dd>
          </div>
          <div className="status-cell">
            <dt>Score limit</dt>
            <dd>{TDM_RULES.scoreLimit}</dd>
          </div>
          <div className="status-cell">
            <dt>Service</dt>
            <dd style={{ color: status ? "var(--success)" : "var(--warning)" }}>
              {status ? "Available" : "Unknown"}
            </dd>
          </div>
        </dl>

        {status?.observedAt ? (
          <p className="price-note" style={{ marginTop: "1rem" }}>
            Status observed {String(status.observedAt)}
          </p>
        ) : (
          <p className="price-note" style={{ marginTop: "1rem" }}>
            Live service status is unavailable right now. See <a href="/status">/status</a>.
          </p>
        )}

        <div className="cta-row">
          <a
            className="button button--primary"
            href={`/play?mode=multiplayer&map=${MULTIPLAYER_MAP.ARDAVAN_YARD}`}
          >
            Play Now
          </a>
          <a className="button button--ghost" href="/community-guidelines">
            Community Guidelines
          </a>
        </div>

        <h3 style={{ marginTop: "4rem" }}>The map</h3>
        <p className="lede">
          Three lanes with cross-links, two vertical routes, and protected spawns at either end.
          Every frame below is the geometry the server actually simulates.
        </p>
        <CaptureStrip names={["tank-row", "central-hardpoint", "north-gate"]} />
        <GreyboxNotice />

        <h3 style={{ marginTop: "4rem" }}>How it works</h3>
        <ul className="includes">
          <li>Cross-play across browser, installed PWA, Windows, macOS and Linux</li>
          <li>Quick Match, or a private code for a match with people you know</li>
          <li>
            Bots fill empty seats so a match can start at low population &mdash; they are labelled
            as bots and never counted as players
          </li>
          <li>Faction preference is honoured when it does not unbalance the teams</li>
          <li>
            Both factions have mechanically equivalent loadouts. Nothing affecting gameplay can be
            purchased.
          </li>
          <li>Reconnect within 20 seconds and your seat is still there</li>
        </ul>

        <h3 style={{ marginTop: "4rem" }}>Known alpha limitations</h3>
        <ul className="includes">
          <li>One mode and one map</li>
          <li>No ranked play, skill rating, clans or tournaments</li>
          <li>
            No voice or free-form text chat &mdash; a fixed set of pings and quick messages only
          </li>
          <li>No spectator mode or downloadable replays</li>
          <li>A single production region at launch</li>
        </ul>

        <p className="lede">
          A verified email is required to play online. That requirement exists for abuse prevention,
          reconnect identity, match records and moderation &mdash; not to sell you anything.
        </p>
      </div>
    </section>
  );
}
