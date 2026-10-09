"use client";

import { useState, type ReactNode } from "react";
import { useAnchoredPanel, useDismissablePopover } from "@/components/ui/use-anchored-panel";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { SM, useMinWidth } from "@/components/ui/use-viewport";

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
 *
 * Sprint 42 — below `sm` the panel is a bottom sheet instead: filtering is a
 * secondary task, a 26rem popover anchored top-left is out of thumb reach, and
 * its wrapped row of selects and pills was the widest thing on the page. The
 * sheet stacks the same controls (callers style them `max-sm:w-full`) and
 * closes with a 44px "Show results" button. Same children, same state — the
 * surface changes, not the filter.
 */
export function FilterDisclosure({
  children,
  activeCount,
  label = "Filters",
}: {
  children: ReactNode;
  activeCount: number;
  /** The sheet's heading and accessible name on a phone. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wide = useMinWidth(SM);
  // The anchored popover only exists at `sm`+; below it the sheet owns `open`.
  const popoverOpen = open && wide;
  const { triggerRef, panelRef, coords } = useAnchoredPanel<HTMLButtonElement, HTMLDivElement>(popoverOpen);

  useDismissablePopover(popoverOpen, () => setOpen(false), [triggerRef, panelRef]);

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        className="flex min-h-11 min-w-[5.5rem] shrink-0 sm:min-h-0 items-center justify-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted"
      >
        {open ? "Filter −" : `Filter ${activeCount > 0 ? `(${activeCount})` : "+"}`}
      </button>

      {popoverOpen && (
        <div
          ref={panelRef}
          role="dialog"
          style={coords ? { top: coords.top, left: coords.left } : { top: -9999, left: -9999 }}
          // Same enter treatment as TapToReveal's panel (components/info-tooltip.tsx)
          // — one shared popover pattern, not two.
          className="fixed z-30 w-[calc(100vw-1rem)] max-w-[26rem] origin-top-left scale-100 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground opacity-100 shadow-lg transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none starting:scale-95 starting:opacity-0 dark:shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
        >
          {children}
        </div>
      )}

      {!wide && (
        <SlideOver
          open={open}
          onClose={() => setOpen(false)}
          side="bottom"
          label={label}
          triggerRef={triggerRef}
          maxHeight="min(85dvh, 44rem)"
        >
          <div className="flex min-h-0 flex-col">
            <h2 className="px-2 pb-3 text-lg font-semibold">
              {label}
              {activeCount > 0 && (
                <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                  {activeCount} active
                </span>
              )}
            </h2>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3 text-base">{children}</div>
            <div className="border-t border-zinc-200 px-2 pt-3 dark:border-purple-900/40">
              <Button type="button" size="md" className="min-h-11 w-full" onClick={() => setOpen(false)}>
                Show results
              </Button>
            </div>
          </div>
        </SlideOver>
      )}
    </div>
  );
}
