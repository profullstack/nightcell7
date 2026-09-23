import type { Metadata } from "next";
import {
  FACTIONS,
  MIRAGE,
  SIDE,
  SUPPORTING_CAST,
  faction,
  type SideId,
} from "@nightcell7/game-core";
import { LeilaSigil, RookSigil } from "../art";
import { PLAYABLE, Portrait, playHref } from "../portraits";

export const metadata: Metadata = {
  title: "Cast",
  description:
    "The people and institutions of NIGHTCELL 7: FALSE DAWN. Two protagonists, the people around them, and the four factions caught in one manufactured night.",
};

/**
 * The cast.
 *
 * Everything on this page comes from `@nightcell7/game-core`'s cast module, the
 * same data the game's briefing reads, so the site and the game cannot describe
 * a person differently. It is spoiler-safe by the same rule the home page's
 * timeline follows: who these people are and what the player sees of them
 * early, never what the campaigns reveal.
 *
 * The protagonists are shown as a matched pair, same card, same length of
 * copy, in the same order the home page uses: PRD §14.3 requires that neither
 * side look richer or more heroic than the other.
 */

const PROTAGONISTS: ReadonlyArray<{
  side: SideId;
  name: string;
  route: string;
  line: string;
  dossier: string;
  Sigil: typeof RookSigil;
}> = [
  {
    side: SIDE.ROOK,
    name: "Rook",
    route: "Nightcell",
    line: "An American deep-cover operative, eighteen months inside Orison's logistics network, working for a program that officially does not exist. Speaks sparingly.",
    dossier: "Rook dossier",
    Sigil: RookSigil,
  },
  {
    side: SIDE.LEILA,
    name: "Leila Farzan",
    route: "Countersignal",
    line: "An Iranian counterintelligence officer who noticed that a set of classified signatures are impossible. Skeptical, exact, and hunting the one operative who is trying to stop the same attack.",
    dossier: "Leila dossier",
    Sigil: LeilaSigil,
  },
];

function seenInLabel(seenIn: SideId | "both"): string {
  if (seenIn === "both") return "Both campaigns";
  return seenIn === SIDE.ROOK ? "Rook's campaign" : "Leila's campaign";
}

export default function CastPage() {
  return (
    <>
      <section className="section" style={{ borderTop: "none" }}>
        <div className="shell">
          <p className="section__label">Cast</p>
          <h2>Two people, one manufactured night.</h2>
          <p className="lede">
            Each campaign is one person&rsquo;s night, told from inside their institution. The
            people below are who they answer to, who they meet, and who is working against both of
            them. Pick who to be: four of them can be deployed in the free demo today.
          </p>

          <div className="split">
            {PROTAGONISTS.map(({ side, name, route, line, dossier, Sigil }) => (
              <article className={`side side--${side} side--portrait`} key={side}>
                <a className="side__art" href={`/characters/${side}`} tabIndex={-1}>
                  <Portrait id={side} name={name} className="side__portrait" priority />
                </a>
                <Sigil className="side__sigil" />
                <p className="side__route">{route}</p>
                <h3>{name}</h3>
                <p>{line}</p>
                <div className="side__actions">
                  <a className="button button--primary" href={playHref(side)}>
                    Play as {name.split(" ")[0]}
                  </a>
                  <a className="button button--ghost" href={`/characters/${side}`}>
                    {dossier}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <p className="section__label">Around them</p>
          <h2>The people in the way.</h2>
          <p className="lede">
            Nobody here is decoration. Each of them changes what one of the protagonists believes,
            and none of them is who either side assumes at the start.
          </p>

          <div className="split">
            {SUPPORTING_CAST.map((member) => (
              <article className="side side--cast side--portrait" key={member.id} id={member.id}>
                <div className="side__art">
                  <Portrait id={member.id} name={member.name} className="side__portrait" />
                </div>
                <p className="side__route">{faction(member.faction).name}</p>
                <h3>{member.name}</h3>
                <p>{member.summary}</p>
                <dl>
                  <dt>Role</dt>
                  <dd>{member.role}</dd>
                  <dt>Met in</dt>
                  <dd>{seenInLabel(member.seenIn)}</dd>
                  <dt>In the yard</dt>
                  <dd>{PLAYABLE.has(member.id) ? "Playable" : "Not an operator"}</dd>
                </dl>
                {PLAYABLE.has(member.id) ? (
                  <div className="side__actions">
                    <a className="button button--ghost" href={playHref(member.id)}>
                      Play as {member.name.split(" ").at(-1)}
                    </a>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <p className="section__label">Institutions</p>
          <h2>Four factions. One of them wants the war.</h2>

          <div className="split">
            {FACTIONS.map((entry) => (
              <article className="side side--cast" key={entry.id} id={entry.id}>
                <p className="side__route">Faction</p>
                <h3>{entry.name}</h3>
                <p>{entry.summary}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <p className="section__label">The system</p>
          <h2>{MIRAGE.name}</h2>
          <p className="lede">{MIRAGE.summary}</p>
          <p className="gallery__note">
            NIGHTCELL 7 is fiction. Its organisations, facilities, operations and characters are
            invented, and it does not depict any real government, military operation or current
            event. MIRAGE is deliberately fictional and describes no real technique.
          </p>
        </div>
      </section>
    </>
  );
}
