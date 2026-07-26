import Image from "next/image";
import { SHARED_TIMELINE, SIDE } from "@nightcell7/game-core";
import { CATALOG, formatPrice } from "@nightcell7/entitlements";
import { HeroPlot, LeilaSigil, RookSigil, SignalCell } from "./art";
import { CopyCommand } from "./_components/copy-command";
import { CaptureGallery, heroCapture } from "./gallery";
import { captureSrc } from "./_components/capture-src";

/**
 * Home page (PRD §20.3).
 *
 * Section order is the PRD's, and the first job is the hook: a visitor must
 * understand "play either side" before they scroll (PRD §40).
 */
export default function HomePage() {
  const episode = CATALOG[0]!;
  const hero = heroCapture();

  return (
    <>
      <section className="hero">
        {/* Real in-engine frame, heavily scrimmed so it reads as atmosphere
            behind the type rather than competing with it. */}
        {hero ? (
          <div className="hero__plate" aria-hidden="true">
            <Image
              src={captureSrc(hero.file)}
              alt=""
              fill
              priority
              sizes="100vw"
              className="hero__plate-img"
            />
          </div>
        ) : null}
        <HeroPlot className="hero__plot" />

        <div className="shell">
          <h1>
            NIGHTCELL <span style={{ color: "var(--signal-red)" }}>7</span>
          </h1>
          <p className="episode-title">FALSE DAWN</p>
          <p className="tagline">The mission was deniable. So were you.</p>
          <p className="tagline" style={{ color: "var(--bone-100)" }}>
            Choose who you trust first. Play both sides to learn the truth.
          </p>

          <div className="cta-row">
            {/* Dominant CTA — never outranked by the storefront (PRD §21.6). */}
            <a className="button button--primary" href="/play?mode=demo">
              Play Free Demo
            </a>
            <a className="button button--commerce" href={`/checkout/${episode.episodeId}`}>
              Unlock False Dawn — {formatPrice(episode.unitAmount)}
            </a>
            <a className="button button--ghost" href="/multiplayer">
              Multiplayer Alpha — Free
            </a>
          </div>

          <div className="hero__install">
            <CopyCommand
              label="Or install the desktop client"
              name="desktop install"
              command="curl -fsSL https://nightcell7.com/install.sh | sh"
            />
            <p className="price-note">
              macOS and Linux · <a href="/downloads">Windows and package managers</a>
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <p className="section__label">Two perspectives</p>
          <h2>Same night. Different truth.</h2>
          <p className="lede">
            Every theater contains two opposing playable campaigns. Both are canon, they overlap in
            time, and each reinterprets the other. Start with whichever side you want.
          </p>

          <div className="split">
            <article className="side side--rook">
              <RookSigil className="side__sigil" />
              <p className="side__route">Rook Campaign — Nightcell</p>
              <h3>Rook</h3>
              <p>
                An American deep-cover operative eighteen months inside a contractor&rsquo;s
                logistics network. Rook believes the mission is to expose Orison Strategic. Rook is
                wrong about who authorized the cleanup.
              </p>
              <dl>
                <dt>Approach</dt>
                <dd>Suppressed weapons, physical bypass, alternate entry</dd>
                <dt>Pressure</dt>
                <dd>Almost every armed group is hostile</dd>
                <dt>Missions</dt>
                <dd>Dead Drop · Black Relay · False Dawn</dd>
              </dl>
              <a className="button button--ghost" href={`/characters/${SIDE.ROOK}`}>
                Rook dossier
              </a>
            </article>

            <article className="side side--leila">
              <LeilaSigil className="side__sigil" />
              <p className="side__route">Leila Campaign — Countersignal</p>
              <h3>Leila Farzan</h3>
              <p>
                An Iranian counterintelligence officer tracing impossible signatures in classified
                telemetry. She is competent, skeptical, and right about the anomaly &mdash; and the
                evidence reaching her command has been manufactured.
              </p>
              <dl>
                <dt>Approach</dt>
                <dd>Signal analysis, surveillance control, authorized routes</dd>
                <dt>Pressure</dt>
                <dd>Her own orders may be compromised</dd>
                <dt>Missions</dt>
                <dd>Counter-Signal · Broken Chain · First Light</dd>
              </dl>
              <a className="button button--ghost" href={`/characters/${SIDE.LEILA}`}>
                Leila dossier
              </a>
            </article>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <p className="section__label">One night, two records</p>
          <h2>The signal timeline</h2>
          <p className="lede">
            Both campaigns run through the same hours. Each protagonist witnesses part of it, and
            misreads part of it. Nothing below spoils the Complete Truth epilogue.
          </p>
          <div className="timeline">
            {SHARED_TIMELINE.slice(0, 8).map((event) => (
              <div className="timeline__row" data-witness={event.witness} key={event.at}>
                <span className="timeline__time">{event.at}</span>
                <span className="timeline__summary">{event.summary}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <p className="section__label">Ardavan Yard</p>
          <h2>Where the alpha is played.</h2>
          <p className="lede">
            The 6v6 multiplayer map: three lanes, two vertical routes, and no one-way geometry.
            Every frame below is captured in engine from the current build.
          </p>
          <CaptureGallery />
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <SignalCell className="section__mark" />
          <p className="section__label">One purchase</p>
          <h2>One theater. Two campaigns.</h2>
          <div className="price-block">
            <span className="price">{formatPrice(episode.unitAmount)}</span>
            <span className="price-note">
              No subscription · No battle pass · No loot boxes · No paid weapons
            </span>
          </div>
          <ul className="includes">
            <li>Both playable campaigns, roughly 60&ndash;90 minutes per side</li>
            <li>The Complete Truth epilogue, unlocked after you finish both</li>
            <li>Every supported platform on one purchase</li>
            <li>Offline single-player access</li>
            <li>Compatibility and bug-fix updates, no recurring charge</li>
          </ul>
          <div className="cta-row">
            <a className="button button--primary" href="/play?mode=demo">
              Play Free Demo First
            </a>
            <a className="button button--commerce" href={`/checkout/${episode.episodeId}`}>
              Buy with CoinPay
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
