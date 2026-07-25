import type { Metadata } from "next";
import { MISSION_SPECS, SIDE } from "@nightcell7/game-core";
import { CATALOG, formatPrice } from "@nightcell7/entitlements";

export const metadata: Metadata = {
  title: "Episode 1 — False Dawn",
  description: "One theater. Two campaigns. $9.99.",
};

export default function EpisodePage() {
  const episode = CATALOG[0]!;
  const rook = MISSION_SPECS.filter((m) => m.side === SIDE.ROOK && m.id !== "complete-truth");
  const leila = MISSION_SPECS.filter((m) => m.side === SIDE.LEILA);

  return (
    <section className="section" style={{ borderTop: "none" }}>
      <div className="shell">
        <p className="section__label">Episode 1 · Iran / Persian Gulf</p>
        <h2>False Dawn</h2>
        <p className="lede">
          A contractor named Orison Strategic has built a system that can manufacture battlefield
          attribution. Two nearly simultaneous attacks are planned, each engineered to look like the
          work of the other side. Two operatives, hunting each other on false evidence, have one
          night to stop them.
        </p>

        <div className="price-block">
          <span className="price">{formatPrice(episode.unitAmount)}</span>
          <span className="price-note">Both campaigns · Complete Truth · All platforms</span>
        </div>

        <div className="cta-row">
          <a className="button button--primary" href="/play?mode=demo">
            Play Free Demo
          </a>
          <a className="button button--commerce" href={`/checkout/${episode.episodeId}`}>
            Buy with CoinPay
          </a>
          <a className="button button--ghost" href="/refunds">
            Refund policy
          </a>
        </div>

        <div className="split">
          <article className="side side--rook">
            <p className="side__route">Rook Campaign</p>
            <h3>Nightcell</h3>
            {rook.map((mission) => (
              <p key={mission.id}>
                <strong>{mission.title}</strong> &mdash; {mission.entry}. ~
                {mission.targetRuntimeMinutes} min.
              </p>
            ))}
          </article>
          <article className="side side--leila">
            <p className="side__route">Leila Campaign</p>
            <h3>Countersignal</h3>
            {leila.map((mission) => (
              <p key={mission.id}>
                <strong>{mission.title}</strong> &mdash; {mission.entry}. ~
                {mission.targetRuntimeMinutes} min.
              </p>
            ))}
          </article>
        </div>

        <h3 style={{ marginTop: "4rem" }}>Content notes</h3>
        <ul className="includes">
          <li>Realistic firearm combat, injury and death; gore can be reduced in settings</li>
          <li>Flashing lights; flash reduction is available in settings</li>
          <li>Themes of state violence, deception and institutional betrayal</li>
          <li>English dialogue and subtitles; Farsi dialogue and signage with native review</li>
          <li>Both nations are portrayed with competent, sympathetic characters</li>
        </ul>
      </div>
    </section>
  );
}
