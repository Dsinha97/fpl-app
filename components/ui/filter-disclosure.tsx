"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
 */
export function FilterDisclosure({
  children,
  activeCount,
}: {
  children: ReactNode;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
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
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[5.5rem] shrink-0 items-center justify-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:bg-purple-950/60"
      >
        {open ? "Filter −" : `Filter ${activeCount > 0 ? `(${activeCount})` : "+"}`}
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-full z-30 mt-2 w-max max-w-[min(85vw,34rem)] rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-purple-800/50 dark:bg-[#2A0A45]"
        >
          {children}
        </div>
      )}
    </div>
  );
}
