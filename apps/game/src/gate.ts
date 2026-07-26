import type { AccessDecision, PlayMode } from "./access";

/**
 * The screen shown when a mode is not available to this viewer.
 *
 * Deliberately not a modal over a running game: if the content is not
 * available we do not download or start it. Every gate offers a route back to
 * something playable rather than being a dead end.
 */
export function renderGate(
  root: HTMLElement,
  decision: Extract<AccessDecision, { allowed: false }>,
) {
  root.innerHTML = "";

  const panel = document.createElement("section");
  panel.className = "access-gate";
  panel.setAttribute("role", "alert");

  const eyebrow = document.createElement("p");
  eyebrow.className = "access-gate__eyebrow";
  eyebrow.textContent = "NIGHTCELL 7";

  const heading = document.createElement("h1");
  heading.textContent = decision.title;

  const detail = document.createElement("p");
  detail.className = "access-gate__detail";
  detail.textContent = decision.detail;

  const actions = document.createElement("div");
  actions.className = "access-gate__actions";
  for (const action of decision.actions) {
    const link = document.createElement("a");
    link.href = action.href;
    link.textContent = action.label;
    link.className = action.primary
      ? "access-gate__button access-gate__button--primary"
      : "access-gate__button";
    actions.append(link);
  }

  panel.append(eyebrow, heading, detail, actions);
  root.append(panel);
}

/** Announces which mode is running, so a demo is never mistaken for the full game. */
export function modeLabel(mode: PlayMode): string {
  switch (mode) {
    case "demo":
      return "DEMO";
    case "campaign":
      return "CAMPAIGN";
    case "multiplayer":
      return "MULTIPLAYER ALPHA";
    default:
      return "SANDBOX";
  }
}
