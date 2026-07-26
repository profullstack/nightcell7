"use client";

import Image from "next/image";
import { useState } from "react";
import { Lightbox, type LightboxShot } from "./lightbox";

/**
 * Clickable variants of the section plate and capture strip.
 *
 * The homepage gallery was made zoomable first and these were left behind, so
 * a reader on /episodes/false-dawn, /press or /multiplayer got thumbnails they
 * could not open — the detail in a 2560-wide capture is exactly what those
 * pages are trying to show. Every published frame is now openable from
 * wherever it appears.
 *
 * Each surface owns its own `Lightbox` and passes only the shots it displays,
 * so the arrow keys step through what the reader can actually see on that page
 * rather than jumping to a frame from somewhere else.
 */

export function ClickablePlate({
  shot,
  label,
  width,
  height,
}: {
  shot: LightboxShot;
  label: string;
  width: number;
  height: number;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <figure className="plate">
      <button
        type="button"
        className="gallery__zoom"
        onClick={() => setOpen(0)}
        aria-label={`View full size: ${shot.caption}`}
      >
        <Image
          src={`/media/yard/${shot.file}`}
          alt={shot.caption}
          width={width}
          height={height}
          sizes="(min-width: 1100px) 1100px, 100vw"
        />
        <span className="gallery__expand" aria-hidden="true">
          Expand
        </span>
      </button>
      <figcaption>
        <span className="plate__label">{label}</span>
        {shot.caption}
      </figcaption>
      <Lightbox shots={[shot]} index={open} onClose={() => setOpen(null)} onNavigate={setOpen} />
    </figure>
  );
}

export function ClickableStrip({
  shots,
  width,
  height,
}: {
  shots: readonly LightboxShot[];
  width: number;
  height: number;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      <ul className="strip">
        {shots.map((shot, i) => (
          <li key={shot.name}>
            <figure>
              <button
                type="button"
                className="gallery__zoom"
                onClick={() => setOpen(i)}
                aria-label={`View full size: ${shot.caption}`}
              >
                <Image
                  src={`/media/yard/${shot.file}`}
                  alt={shot.caption}
                  width={width}
                  height={height}
                  sizes="(min-width: 900px) 33vw, 100vw"
                />
                <span className="gallery__expand" aria-hidden="true">
                  Expand
                </span>
              </button>
              <figcaption>{shot.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <Lightbox shots={shots} index={open} onClose={() => setOpen(null)} onNavigate={setOpen} />
    </>
  );
}
