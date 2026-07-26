"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { captureSrc } from "./capture-src";

/**
 * Fullscreen image viewer for the in-engine captures.
 *
 * These frames are 2560 wide and carry detail — corrugation, grating, weld
 * seams, the aggregate in the concrete — that is invisible in a 400 px grid
 * thumbnail. The point of this component is to let someone actually look at it.
 *
 * Accessibility is not optional here (PRD §22.6 makes WCAG 2.2 AA a launch
 * gate), so the overlay is a real modal dialog: focus moves into it, Escape
 * closes it, Tab is trapped, and focus returns to the thumbnail that opened it.
 * A div with an onClick would look identical and be unusable with a keyboard.
 *
 * Rendered through a portal onto `document.body`, which is not a detail. Sited
 * inline it lands inside whichever gallery opened it and inherits that
 * container's rules — `.gallery figcaption` is a two-column grid with a 2.5rem
 * index column, so the caption wrapped one word per line down a 40px strip. A
 * modal has no business inheriting layout from the thing that opened it, and a
 * portal also puts it above every stacking context on the page.
 */

export interface LightboxShot {
  readonly name: string;
  readonly caption: string;
  readonly file: string;
}

interface Props {
  shots: readonly LightboxShot[];
  /** Index to open at, or null when closed. */
  index: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const MAX_ZOOM = 4;

export function Lightbox({ shots, index, onClose, onNavigate }: Props) {
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  const open = index !== null;
  const shot = open ? shots[index] : undefined;

  // Reset the zoom whenever a different image is shown, otherwise the next
  // image inherits the last one's pan and appears to open half off-screen.
  useEffect(() => {
    setZoom(1);
    setOrigin({ x: 50, y: 50 });
  }, [index]);

  useEffect(() => {
    if (!open) return;

    opener.current = document.activeElement;
    dialogRef.current?.focus();

    // The page behind must not scroll while a modal is up.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  const step = useCallback(
    (delta: number) => {
      if (index === null) return;
      onNavigate((index + delta + shots.length) % shots.length);
    },
    [index, shots.length, onNavigate],
  );

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onClose();
          break;
        case "ArrowRight":
          event.preventDefault();
          step(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          step(-1);
          break;
        case "Tab": {
          // Trap focus: a modal that lets Tab wander into the page behind it
          // is a screen-reader trap in the other direction.
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            "button, [href], [tabindex]:not([tabindex='-1'])",
          );
          if (!focusable || focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) return;

          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
          break;
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, step]);

  if (!open || !shot) return null;

  /** Click to zoom toward the point clicked, click again to zoom back out. */
  function toggleZoom(event: React.MouseEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setOrigin({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
    setZoom((current) => (current > 1 ? 1 : 2.5));
  }

  function onWheel(event: React.WheelEvent<HTMLImageElement>) {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 2) return;
    event.preventDefault();
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(1, current - event.deltaY * 0.002)));
  }

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${shot.caption} — press Escape to close`}
      tabIndex={-1}
      ref={dialogRef}
      onClick={(event) => {
        // Only the backdrop closes; clicks on the figure are for zooming.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="lightbox__bar">
        <span className="lightbox__count">
          {index + 1} / {shots.length}
        </span>
        <span className="lightbox__hint">
          {zoom > 1 ? "Click image to zoom out" : "Click image to zoom"} &middot; &larr; &rarr; to
          browse &middot; Esc to close
        </span>
        <button className="lightbox__close" type="button" onClick={onClose} aria-label="Close">
          &times;
        </button>
      </div>

      <figure className="lightbox__figure">
        <div className="lightbox__frame">
          {/* Plain <img> rather than next/image: the optimiser cannot serve an
              arbitrary zoom crop, and at full-screen it would hand back the
              original file anyway. */}
          <img
            src={captureSrc(shot.file)}
            alt={shot.caption}
            onClick={toggleZoom}
            onWheel={onWheel}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: `${origin.x}% ${origin.y}%`,
              cursor: zoom > 1 ? "zoom-out" : "zoom-in",
            }}
            draggable={false}
          />
        </div>
        <figcaption>{shot.caption}</figcaption>
      </figure>

      <button
        className="lightbox__nav lightbox__nav--prev"
        type="button"
        onClick={() => step(-1)}
        aria-label="Previous image"
      >
        &lsaquo;
      </button>
      <button
        className="lightbox__nav lightbox__nav--next"
        type="button"
        onClick={() => step(1)}
        aria-label="Next image"
      >
        &rsaquo;
      </button>
    </div>,
    document.body,
  );
}
