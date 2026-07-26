/**
 * DIVIDED SIGNAL — vector art system.
 *
 * Every graphic on the marketing site is authored here as inline SVG. Three
 * reasons this is not an images folder:
 *
 *  - CLAUDE.md forbids Babylon on marketing routes, so nothing can be rendered
 *    from the game engine at request time.
 *  - CLAUDE.md forbids any public asset without provenance. Vector we author in
 *    the repository has trivially clean provenance and no licence question.
 *  - These marks have to recolour with the palette and stay sharp at hero
 *    scale, which rules out shipping rasters.
 *
 * The system has one idea: a signal crossing a meridian, arriving intact on one
 * side and corrupted on the other. Everything below is a restatement of it.
 */

/** Shared surveillance-bracket frame used to mark "this is a captured record". */
function Brackets({ inset = 2, stroke = "var(--dust-gold)" }: { inset?: number; stroke?: string }) {
  const a = inset;
  const b = 100 - inset;
  const len = 9;
  return (
    <g stroke={stroke} strokeWidth={1.1} fill="none" vectorEffect="non-scaling-stroke">
      <polyline points={`${a},${a + len} ${a},${a} ${a + len},${a}`} />
      <polyline points={`${b - len},${a} ${b},${a} ${b},${a + len}`} />
      <polyline points={`${a},${b - len} ${a},${b} ${a + len},${b}`} />
      <polyline points={`${b - len},${b} ${b},${b} ${b},${b - len}`} />
    </g>
  );
}

/**
 * Rook's sigil — Nightcell.
 *
 * A crenellated tower reduced to hard geometry, wrapped in a dashed outline:
 * the cover identity that is drawn around him and is about to be withdrawn.
 */
export function RookSigil({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Rook — Nightcell campaign sigil"
      focusable="false"
    >
      <Brackets stroke="color-mix(in srgb, var(--signal-red) 60%, transparent)" />

      {/* The cover story: present, provisional, dashed. */}
      <rect
        x={20}
        y={20}
        width={60}
        height={60}
        fill="none"
        stroke="color-mix(in srgb, var(--signal-red) 45%, transparent)"
        strokeWidth={1}
        strokeDasharray="4 4"
      />

      {/* Tower: crenellations, shaft, base. Nothing rounded anywhere. */}
      <path
        d="M32 40h8v-6h6v6h8v-6h6v6h8v10h-4v22h4v6H32v-6h4V50h-4V40Z"
        fill="var(--signal-red)"
      />

      {/* The meridian this campaign is read against. */}
      <line x1={50} y1={12} x2={50} y2={88} stroke="var(--bone-100)" strokeWidth={0.8} />
    </svg>
  );
}

/**
 * Leila's sigil — Countersignal.
 *
 * Reception arcs converging on an axis, with a spectrum readout beneath. She is
 * listening correctly; the arc that reaches her is the one that has been
 * altered, so it arrives broken.
 */
export function LeilaSigil({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Leila Farzan — Countersignal campaign sigil"
      focusable="false"
    >
      <Brackets stroke="color-mix(in srgb, var(--signal-cyan) 60%, transparent)" />

      <g fill="none" stroke="var(--signal-cyan)" strokeWidth={2.4} strokeLinecap="butt">
        <path d="M50 68a16 16 0 0 0-13-25" />
        <path d="M50 68a27 27 0 0 0-22-42" opacity={0.72} />
        {/* The corrupted return path. */}
        <path d="M50 68a38 38 0 0 0-31-59" opacity={0.5} strokeDasharray="7 5" />
      </g>

      <circle cx={50} cy={68} r={3.4} fill="var(--signal-cyan)" />
      <line x1={50} y1={12} x2={50} y2={88} stroke="var(--bone-100)" strokeWidth={0.8} />

      {/* Spectrum readout: the telemetry she is working from. */}
      <g fill="color-mix(in srgb, var(--signal-cyan) 75%, transparent)">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect
            key={i}
            x={56 + i * 4}
            y={80 - (i % 3) * 4 - 4}
            width={2.2}
            height={(i % 3) * 4 + 4}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * The wordmark cell — the same mark as the app icon, at display scale.
 * Used as a section divider and in the hero.
 */
export function SignalCell({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 64"
      className={className}
      role="img"
      aria-label="NIGHTCELL 7 divided-signal mark"
      focusable="false"
    >
      <rect x={12} y={12} width={46} height={40} fill="var(--signal-red)" fillOpacity={0.9} />
      <rect x={62} y={12} width={46} height={40} fill="var(--signal-cyan)" fillOpacity={0.9} />
      <rect x={59.4} y={4} width={1.2} height={56} fill="var(--bone-100)" />
      <path
        d="M12 32h14l6-12 8 24 6-12h12"
        fill="none"
        stroke="var(--ink-950)"
        strokeWidth={2.6}
        strokeLinecap="square"
      />
      <path
        d="M66 32h8l4-8 6 16 4-8h12"
        fill="none"
        stroke="var(--ink-950)"
        strokeWidth={2.6}
        strokeLinecap="square"
        strokeDasharray="5 3"
      />
    </svg>
  );
}

/**
 * Hero backdrop.
 *
 * A wide surveillance plot: grid, sweep arcs, and two traces that diverge at
 * the meridian. Sits behind the hero type at low opacity so it reads as
 * atmosphere rather than decoration. Purely decorative, so it is hidden from
 * assistive technology.
 */
export function HeroPlot({ className }: { className?: string }) {
  const ticks = Array.from({ length: 25 }, (_, i) => i * 40);
  return (
    <svg
      viewBox="0 0 960 540"
      className={className}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="fade-red" x1="0" x2="1">
          <stop offset="0" stopColor="var(--signal-red)" stopOpacity="0" />
          <stop offset="0.55" stopColor="var(--signal-red)" stopOpacity="0.75" />
          <stop offset="1" stopColor="var(--signal-red)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fade-cyan" x1="0" x2="1">
          <stop offset="0" stopColor="var(--signal-cyan)" stopOpacity="0" />
          <stop offset="0.45" stopColor="var(--signal-cyan)" stopOpacity="0.75" />
          <stop offset="1" stopColor="var(--signal-cyan)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Measurement grid. */}
      <g stroke="var(--bone-300)" strokeOpacity={0.07} strokeWidth={1}>
        {ticks.map((x) => (
          <line key={`v${x}`} x1={x} y1={0} x2={x} y2={540} />
        ))}
        {ticks.slice(0, 14).map((y) => (
          <line key={`h${y}`} x1={0} y1={y} x2={960} y2={y} />
        ))}
      </g>

      {/* Range arcs, centred on the meridian. */}
      <g fill="none" stroke="var(--bone-300)" strokeOpacity={0.12}>
        {[120, 220, 320, 420].map((r) => (
          <circle key={r} cx={480} cy={540} r={r} />
        ))}
      </g>

      {/* Two records of the same night, agreeing until they do not. */}
      <path
        d="M0 300 L120 300 L150 250 L190 340 L230 268 L300 268 L340 300 L420 300 L480 300"
        fill="none"
        stroke="url(#fade-red)"
        strokeWidth={2}
      />
      <path
        d="M480 300 L560 300 L600 232 L640 372 L690 268 L760 268 L800 316 L960 316"
        fill="none"
        stroke="url(#fade-cyan)"
        strokeWidth={2}
        strokeDasharray="6 5"
      />

      {/* The meridian. */}
      <line x1={480} y1={40} x2={480} y2={500} stroke="var(--bone-300)" strokeOpacity={0.35} />
      <rect
        x={472}
        y={292}
        width={16}
        height={16}
        fill="none"
        stroke="var(--bone-100)"
        strokeOpacity={0.5}
      />
    </svg>
  );
}
