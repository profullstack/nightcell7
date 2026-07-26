"use client";

import Image from "next/image";
import { useState } from "react";
import { Lightbox, type LightboxShot } from "./lightbox";
import { captureSrc } from "./capture-src";

/**
 * The capture gallery, with every frame openable full-screen.
 *
 * Split out as a client component because the lightbox needs state; the
 * surrounding page and the capture manifest stay on the server, so no shot
 * data is duplicated and the grid still renders without JavaScript — the
 * thumbnails are plain `next/image`, and only the zoom needs the client.
 */
export function ClickableGallery({
  shots,
  width,
  height,
}: {
  shots: readonly LightboxShot[];
  width: number;
  height: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [lead, ...rest] = shots;
  if (!lead) return null;

  return (
    <div className="gallery">
      <figure className="gallery__lead">
        <button
          type="button"
          className="gallery__zoom"
          onClick={() => setOpen(0)}
          aria-label={`View full size: ${lead.caption}`}
        >
          <Image
            src={captureSrc(lead.file)}
            alt={lead.caption}
            width={width}
            height={height}
            sizes="(min-width: 1100px) 1100px, 100vw"
            priority={false}
          />
          <span className="gallery__expand" aria-hidden="true">
            Expand
          </span>
        </button>
        <figcaption>
          <span className="gallery__index">01</span>
          {lead.caption}
        </figcaption>
      </figure>

      <ul className="gallery__grid">
        {rest.map((shot, i) => (
          <li key={shot.name}>
            <figure>
              <button
                type="button"
                className="gallery__zoom"
                onClick={() => setOpen(i + 1)}
                aria-label={`View full size: ${shot.caption}`}
              >
                <Image
                  src={captureSrc(shot.file)}
                  alt={shot.caption}
                  width={width}
                  height={height}
                  sizes="(min-width: 900px) 33vw, 100vw"
                />
                <span className="gallery__expand" aria-hidden="true">
                  Expand
                </span>
              </button>
              <figcaption>
                <span className="gallery__index">{String(i + 2).padStart(2, "0")}</span>
                {shot.caption}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>

      <Lightbox shots={shots} index={open} onClose={() => setOpen(null)} onNavigate={setOpen} />
    </div>
  );
}
