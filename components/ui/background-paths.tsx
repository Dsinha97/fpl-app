/**
 * The drifting line field behind the landing hero.
 *
 * Adapted from References/Components/hero.md, with the framer-motion
 * dependency removed. The reference animates 72 paths through
 * `motion.path` + `pathLength`/`pathOffset`; the same effect is
 * `stroke-dasharray`/`stroke-dashoffset` on a plain `<path>`, which the
 * browser composites without a JS animation loop. Pulling in ~50KB of
 * animation runtime for one decorative background on a static export was not
 * a good trade, and the CSS version gets `prefers-reduced-motion` for free
 * rather than needing it bolted on.
 *
 * Two further departures from the reference:
 *
 * - Stroke colour is `currentColor` over the brand tokens rather than the
 *   reference's slate ramp, so the field reads as purple in light and green
 *   in dark instead of importing a third palette.
 * - No gradient-filled text. The August 2026 audit response explicitly
 *   recorded "no gradients" as a property of this app worth keeping, and a
 *   gradient wordmark would contradict the solid one in `components/brand`.
 *
 * Decorative only: `aria-hidden`, `pointer-events-none`, and nothing in here
 * carries meaning that is not also in the text above it.
 */
function FloatingPaths({ position }: { position: number }) {
  const paths = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    d:
      `M-${380 - i * 5 * position} -${189 + i * 6}` +
      `C-${380 - i * 5 * position} -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ` +
      `${152 - i * 5 * position} ${343 - i * 6}` +
      `C${616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${875 - i * 6} ` +
      `${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.05,
    opacity: 0.08 + i * 0.012,
    // Spread the loop lengths so the field never pulses in unison. Derived
    // from the index rather than Math.random() so server and client render
    // the same markup — the reference's random duration would hydrate-mismatch.
    duration: 26 + (i % 7) * 4,
    delay: -(i * 1.7),
  }));

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <svg
        className="h-full w-full text-purple-900 dark:text-primary"
        viewBox="0 0 696 316"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        {paths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            stroke="currentColor"
            strokeWidth={p.width}
            strokeOpacity={p.opacity}
            pathLength={1}
            className="[stroke-dasharray:0.35_0.65] motion-reduce:[stroke-dasharray:none] motion-safe:[animation:bg-path-drift_linear_infinite]"
            style={{ animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }}
          />
        ))}
      </svg>
    </div>
  );
}

export function BackgroundPaths() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
      {/* Fades the field out behind the copy so the text never competes with a
          stroke crossing it. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--background)_15%,transparent_70%)]" />
    </div>
  );
}
