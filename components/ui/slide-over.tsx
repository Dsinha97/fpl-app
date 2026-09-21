"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useDismissablePopover } from "@/components/ui/use-anchored-panel";

/**
 * A dockable panel over a dimmed backdrop.
 *
 * Sprint 33 — this existed already, inlined inside `MobileNav`
 * (`components/nav-links.tsx`), which was the only true slide-over in the
 * app. Merging `/compare` into `/players` needed a second one on the other
 * edge, and the choice was to copy forty-odd lines or to lift the original.
 * One implementation (CLAUDE.md), so: lifted, and `MobileNav` now renders
 * through it too.
 *
 * Dismissal is the app-wide `useDismissablePopover` convention — outside
 * mousedown plus Escape — with the backdrop carrying its own click handler,
 * because a click on it is "outside the panel" while still being inside the
 * subtree the hook watches.
 */
export function SlideOver({
  open,
  onClose,
  side = "right",
  label,
  width = "min(28rem, 92vw)",
  maxHeight = "min(70vh, 32rem)",
  fullHeight = false,
  triggerRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Which edge the panel docks to. Dock it to the edge its trigger sits on:
   *  a tap and its result at opposite ends of a phone screen reads as two
   *  unrelated events.
   *
   *  `"bottom"` is the phone sheet: it rises from the thumb zone rather than
   *  from an edge the hand is nowhere near, which is why /builder's slot
   *  picker uses it below `sm`. It sizes to its content up to a cap instead
   *  of filling the viewport, so the pitch stays visible behind it and you
   *  can see which slot you are filling. */
  side?: "left" | "right" | "bottom";
  /** Accessible name for the dialog. */
  label: string;
  /** Any CSS width. The default keeps a phone's remaining page visible.
   *  Ignored for `side="bottom"`, which is always full-width. */
  width?: string;
  /** Max height for `side="bottom"`. Content shorter than this shrinks the sheet. */
  maxHeight?: string;
  /**
   * `side="bottom"` only: fill the screen instead of sizing to content.
   *
   * The default cap exists so /builder's slot picker leaves the pitch
   * visible behind it — you need to see which slot you are filling. A full
   * profile has no such backdrop to preserve and several screens of content,
   * so capping it at 70vh would nest a scroller inside a scroller.
   *
   * Uses `100dvh`, never `100vh`: on a phone `100vh` is the viewport with
   * the URL bar hidden, so a bottom-pinned action bar sits below the fold
   * until the user scrolls.
   */
  fullHeight?: boolean;
  /** The control that opens this, so clicking it to *close* isn't also
   *  treated as an outside-click that closes it first. */
  triggerRef?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useDismissablePopover(open, onClose, triggerRef ? [panel, triggerRef] : [panel]);

  // A background that scrolls behind an open panel is disorienting, and on a
  // phone it is very easy to catch page content instead of the panel.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const bottom = side === "bottom";
  const edge = bottom
    ? `inset-x-0 bottom-0 border-t border-zinc-200 dark:border-purple-800/50${fullHeight ? "" : " rounded-t-2xl"}`
    : side === "right"
      ? "inset-y-0 right-0 border-l border-zinc-200 dark:border-purple-800/50"
      : "inset-y-0 left-0 border-r border-zinc-200 dark:border-purple-800/50";

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/40" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={bottom ? (fullHeight ? { height: "100dvh" } : { maxHeight }) : { width }}
        // The sheet's entry follows References/Components/panel-reveal.md —
        // translate + fade + a cross-blur on one duration, so a short travel
        // still reads as a full open. `motion-reduce` drops it entirely.
        //
        // Deliberately NO fill-mode. With `both`, an animation that never runs
        // (a backgrounded tab, a paused compositor) leaves the element pinned
        // at its `from` frame — translated 40% down and fully transparent,
        // i.e. an open sheet nobody can see or reach. Without a fill mode the
        // resting style *is* the final state, so the worst case is that the
        // sheet simply appears rather than rises. Motion should never be load-
        // bearing for whether a control is usable.
        className={`fixed z-50 flex flex-col overflow-y-auto overscroll-contain bg-white p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-2xl dark:bg-surface-3 ${edge} ${
          bottom
            ? "motion-safe:[animation:sheet-rise_var(--duration-slower)_var(--ease-slide)]"
            : side === "right"
              ? "motion-safe:[animation:panel-slide-right_var(--duration-slower)_var(--ease-slide)]"
              : "motion-safe:[animation:panel-slide-left_var(--duration-slower)_var(--ease-slide)]"
        }`}
      >
        {bottom && (
          // A grab handle, because a sheet that can be dismissed should look
          // like one. Decorative: dismissal is the backdrop, Escape, or the
          // panel's own close control.
          <span
            aria-hidden
            className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-border"
          />
        )}
        {children}
      </div>
    </>
  );
}
