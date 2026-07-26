import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SIDE, missionsForSide, type SideId } from "@nightcell7/game-core";
import { PageShell } from "../../_components/page-shell";
import { CapturePlate } from "../../gallery";

/**
 * Character dossiers.
 *
 * One route for both protagonists so neither can drift into being the better
 * presented one — PRD §14.3 requires that neither side look richer or more
 * heroic than the other.
 */

interface Dossier {
  side: SideId;
  name: string;
  route: string;
  role: string;
  accent: string;
  plate: string;
  summary: string;
  believes: string;
  discovers: string;
  strengths: string[];
  limitations: string[];
  kit: string[];
}

const DOSSIERS: Record<string, Dossier> = {
  rook: {
    side: SIDE.ROOK,
    name: "Rook",
    route: "Nightcell",
    role: "American deep-cover special-activities operative",
    accent: "var(--signal-red)",
    plate: "yard-approach",
    summary:
      "Eighteen months embedded in a defence contractor's logistics network, running under a cover identity for a programme his own government will never acknowledge.",
    believes: "That the mission is to expose Orison Strategic before it can manufacture a war.",
    discovers:
      "That the order to destroy the evidence came from his own side, and what the number in Nightcell 7 actually designates.",
    strengths: [
      "Quiet first contact — suppressed weapons and rear takedowns",
      "Alternate physical routes most personnel do not know exist",
      "Bypass tooling that opens doors nobody logged as opened",
    ],
    limitations: [
      "Almost every armed group in the theater is hostile to him",
      "Effectively no official access or backup",
      "Few safe places to resupply",
    ],
    kit: [
      "Suppressed P11 sidearm",
      "Suppressed C9 Kestrel carbine",
      "EMP puck",
      "Ghost Key bypass tool",
      "Night vision",
    ],
  },
  leila: {
    side: SIDE.LEILA,
    name: "Leila Farzan",
    route: "Countersignal",
    role: "Iranian counterintelligence officer, signals analyst and field investigator",
    accent: "var(--signal-cyan)",
    plate: "north-gate",
    summary:
      "A signals analyst who noticed that a set of classified telemetry signatures are impossible — the timing does not work, and someone competent wanted it to look like it did.",
    believes: "That the foreign operative she is hunting is the intrusion she has been tracking.",
    discovers:
      "That the evidence reaching her own command has been manufactured, and that the man she is hunting is trying to stop the same attack she is.",
    strengths: [
      "Authorised access to sites and systems Rook has to break into",
      "Camera and terminal analysis, and selective surveillance redirection",
      "Context on which signals are authentic and which are synthetic",
    ],
    limitations: [
      "The information she is given may itself be compromised",
      "Friendly personnel complicate every target decision",
      "Less suppression available early on",
    ],
    kit: [
      "Service P11 variant",
      "Regional service rifle",
      "Signal Tap",
      "Portable jammer",
      "Night vision",
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(DOSSIERS).map((side) => ({ side }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ side: string }>;
}): Promise<Metadata> {
  const { side } = await params;
  const dossier = DOSSIERS[side];
  if (!dossier) return { title: "Dossier" };
  return { title: `${dossier.name} — ${dossier.route}`, description: dossier.summary };
}

export default async function CharacterPage({ params }: { params: Promise<{ side: string }> }) {
  const { side } = await params;
  const dossier = DOSSIERS[side];
  if (!dossier) notFound();

  const missions = missionsForSide(dossier.side);

  return (
    <PageShell label={`${dossier.route} — dossier`} title={dossier.name} lede={dossier.role}>
      <CapturePlate name={dossier.plate} label={dossier.route} />

      <p>{dossier.summary}</p>

      <h3>What they believe</h3>
      <p>{dossier.believes}</p>

      <h3>What they find out</h3>
      <p>{dossier.discovers}</p>

      <h3>How they operate</h3>
      <ul>
        {dossier.strengths.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h3>What works against them</h3>
      <ul>
        {dossier.limitations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h3>Kit</h3>
      <ul>
        {dossier.kit.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h3>Missions</h3>
      <ol>
        {missions.map((mission) => (
          <li key={mission.id}>
            <strong>{mission.title}</strong> &mdash; {mission.entry}
          </li>
        ))}
      </ol>

      <p style={{ marginTop: "2.5rem" }}>
        <a
          className="button button--ghost"
          href={`/characters/${dossier.side === SIDE.ROOK ? "leila" : "rook"}`}
        >
          Read the other side
        </a>
      </p>
    </PageShell>
  );
}
