"use client";

import { useState, type ReactNode } from "react";
import { useAnchoredPanel, useDismissablePopover } from "@/components/ui/use-anchored-panel";

/**
 * The one "Filter +" trigger-plus-floating-panel used by every filter strip
 * in the app (`components/player-filters.tsx`, the builder's replacement
 * panel). A `<details>` version of this shipped first and had two bugs: the
 * panel being in normal flow stretched the `<details>` element itself, which
 * a `flex-wrap` row then dropped onto its own line instead of leaving it
 * beside the search box; and there was no close-on-outside-click, harmless
 * inline but not once the panel floats over content below it.
 *
 * Positioning and dismissal both come from `useAnchoredPanel` /
 * `useDismissablePopover` (`components/ui/use-anchored-panel.ts`) — the same
 * pair `TapToReveal` (`components/info-tooltip.tsx`) uses, so there is one
 * implementation of "floating panel that stays on screen" rather than two
 * near-identical copies.
 */
export function FilterDisclosure({
  children,
  activeCount,
}: {
  children: ReactNode;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, panelRef, coords } = useAnchoredPanel<HTMLButtonElement, HTMLDivElement>(open);

  useDismissablePopover(open, () => setOpen(false), [triggerRef, panelRef]);

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[5.5rem] shrink-0 items-center justify-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted"
      >
        {open ? "Filter −" : `Filter ${activeCount > 0 ? `(${activeCount})` : "+"}`}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          style={coords ? { top: coords.top, left: coords.left } : { top: -9999, left: -9999 }}
          className="fixed z-30 w-[calc(100vw-1rem)] max-w-[26rem] rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}
