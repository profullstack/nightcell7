"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyButtonLabel } from "./copy-command-label";

/**
 * A shell command with a copy button.
 *
 * Every command we publish is meant to be run, and the install line is the
 * first thing a visitor does with this site. Selecting a `curl … | sh` by hand
 * is exactly the operation people get wrong — a dropped character in a piped
 * shell command is not a typo, it is an unpredictable command — so the button
 * is not a convenience, it is the accurate path.
 *
 * Accessibility is a launch gate here (PRD §22.6), which drives three choices:
 *
 *   - it is a real `<button type="button">`, so it is reachable and operable
 *     from the keyboard without any extra handlers;
 *   - the accessible name says *which* command it copies. /downloads renders
 *     thirty-five of these, and a page offering thirty-five buttons all named
 *     "Copy" is unusable when you are navigating by button list;
 *   - the result is announced through a live region rather than only by the
 *     label changing colour, so success is not conveyed by sight alone.
 */

const RESET_MS = 2000;

type CopyState = "idle" | "copied" | "failed";

/**
 * Put text on the clipboard, returning whether it actually happened.
 *
 * The async Clipboard API is the right path but it needs a secure context and
 * a permission that can be refused; a LAN preview over plain http has neither.
 * The legacy `execCommand` route is deprecated and still the only thing that
 * works there, so it stays as a fallback. When both fail we say so instead of
 * showing a success tick for a clipboard that was never written.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refused or unavailable — try the legacy path before giving up */
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // Off-screen but still selectable. `display: none` cannot be selected, and
    // a fixed position avoids scrolling the page to the element.
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export interface CopyCommandProps {
  /** Short description of what the command does ("Install", "Uninstall"). */
  label?: string;
  /** The command itself. Copied verbatim, including any comment lines. */
  command: string;
  /**
   * Noun phrase for the button's accessible name, when the visible label is a
   * sentence. "Copy Or install the desktop client command" is what you get
   * without it.
   */
  name?: string;
  /** Extra class on the wrapper, for pages that style their own block. */
  className?: string;
}

export function CopyCommand({ label, command, name, className }: CopyCommandProps) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A copy on an unmounting page must not leave a timer holding a setState.
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = useCallback(async () => {
    const ok = await writeToClipboard(command);
    setState(ok ? "copied" : "failed");
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), RESET_MS);
  }, [command]);

  const spoken = name ?? label;
  const announcement =
    state === "copied"
      ? `Copied ${spoken ? `${spoken} command` : "command"} to the clipboard`
      : state === "failed"
        ? "Could not copy — select the command and copy it manually"
        : "";

  return (
    <div className={className ? `command ${className}` : "command"}>
      {label ? <p className="command__label">{label}</p> : null}
      <div className="command__frame">
        <pre>
          <code>{command}</code>
        </pre>
        <button
          type="button"
          className="command__copy"
          data-state={state}
          onClick={copy}
          aria-label={copyButtonLabel(spoken, command)}
        >
          {/* Hidden from assistive tech: the button already has a fuller name
              from aria-label, and reading both would say everything twice. */}
          <span aria-hidden="true">
            {state === "copied" ? "Copied" : state === "failed" ? "Failed" : "Copy"}
          </span>
        </button>
      </div>
      <span className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
