/**
 * Accessible name for a copy button.
 *
 * Kept apart from the component so it can be tested without a DOM: the site
 * app has no component test setup, and this is the part with actual rules in
 * it. /downloads renders thirty-five copy buttons, so "Copy" alone would leave
 * a screen reader user with thirty-five identical entries in the button list.
 */

/** Beyond this the name stops being a label and becomes a recital. */
const MAX_COMMAND_CHARS = 60;

/**
 * Condense a command to one readable line.
 *
 * Multi-line blocks (a command plus a commented alternative) are announced by
 * their first line only, with the remainder signalled rather than read out.
 */
export function summarizeCommand(command: string, max = MAX_COMMAND_CHARS): string {
  const lines = command.trim().split("\n");
  const first = (lines[0] ?? "").trim();
  const clipped = first.length > max ? `${first.slice(0, max).trimEnd()}…` : first;
  return lines.length > 1 ? `${clipped}, and more` : clipped;
}

export function copyButtonLabel(label: string | undefined, command: string): string {
  const summary = summarizeCommand(command);
  if (!summary) return label ? `Copy ${label} command` : "Copy command";
  return label ? `Copy ${label} command: ${summary}` : `Copy command: ${summary}`;
}
