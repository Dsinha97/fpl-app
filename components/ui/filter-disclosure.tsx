"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * The one "Filter +" trigger-plus-floating-panel used by every filter strip
 * in the app (`components/player-filters.tsx`, the builder's replacement
 * panel). A `<details>` version of this shipped first and had two bugs: the
 * panel being in normal flow stretched the `<details>` element itself, which
 * a `flex-wrap` row then dropped onto its own line instead of leaving it
 * beside the search box; and there was no close-on-outside-click, harmless
 * inline but not once the panel floats over content below it. Both are the
 * same problem `InfoTooltip` (`components/info-tooltip.tsx`) already solved,
 * so this copies its controlled-open + outside-click/Escape pattern rather
 * than re-deriving it.
 *
 * Positioning is `fixed` and computed in absolute viewport coordinates from
 * the trigger's own `getBoundingClientRect()` — not an offset relative to a
 * wrapper element, which an earlier version used and which still overflowed
 * on real phones (the trigger sits well right of the screen's left edge on
 * a narrow filter row, and a relative offset compounds any rounding or
 * viewport-unit mismatch between what was measured and what actually
 * renders). Computing the left edge directly against `window.innerWidth`,
 * re-clamped on resize and reflow, is the version that cannot drift.
 */
export function FilterDisclosure({
  children,
  activeCount,
}: {
  children: ReactNode;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const reposition = () => {
      const t = trigger.current;
      const p = panel.current;
      if (!t || !p) return;
      const margin = 8;
      const tRect = t.getBoundingClientRect();
      const width = p.getBoundingClientRect().width;
      const maxLeft = window.innerWidth - margin - width;
      // A viewport narrower than the panel plus both margins has no legal
      // position — clamp to the left margin rather than let max < min invert.
      const left = Math.max(margin, Math.min(tRect.left, maxLeft));
      setCoords({ top: Math.round(tRect.bottom + 8), left: Math.round(left) });
    };

    // Two passes: fonts/webfonts can still be settling on first paint, which
    // changes the panel's measured width after the first layout pass.
    reposition();
    const raf = requestAnimationFrame(reposition);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[5.5rem] shrink-0 items-center justify-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:bg-purple-950/60"
      >
        {open ? "Filter −" : `Filter ${activeCount > 0 ? `(${activeCount})` : "+"}`}
      </button>

      {open && (
        <div
          ref={panel}
          role="dialog"
          style={coords ? { top: coords.top, left: coords.left } : { top: -9999, left: -9999 }}
          className="fixed z-30 w-[calc(100vw-1rem)] max-w-[26rem] rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-purple-800/50 dark:bg-[#2A0A45]"
        >
          {children}
        </div>
      )}
    </div>
  );
}
