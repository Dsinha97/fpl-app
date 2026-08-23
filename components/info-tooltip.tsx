"use client";

import { useState, type ReactNode } from "react";
import { useAnchoredPanel, useDismissablePopover } from "@/components/ui/use-anchored-panel";

/**
 * The click-toggle disclosure primitive underneath `InfoTooltip` below,
 * generalised to take an arbitrary trigger instead of always drawing its own
 * "?" circle. Sprint 19 built `InfoTooltip` for that "?" case; the
 * accessibility follow-on it named and deferred is every native `title=`
 * that carries reasoning found nowhere else (badges, dotted-underline stat
 * labels, small inline notes) — those need the exact same touch/keyboard
 * behaviour on a trigger that isn't a "?" button. This is the one popover
 * implementation both share, rather than a second hand-copy of the
 * open/close/outside-click/Escape logic per call site.
 *
 * Positioning (both axes, clamped to the viewport) comes from
 * `useAnchoredPanel` — the same hook `FilterDisclosure` uses — rather than a
 * second hand-rolled version. The earlier version here only flipped
 * vertically and never clamped horizontally, which let a `w-72` panel
 * anchored near the right edge of a narrow screen (e.g. the `FT ?` tooltip
 * in the sticky context bar) run off the viewport.
 */
export function TapToReveal({
  trigger,
  children,
  label,
  align = "left",
  triggerClassName = "",
  wrapperClassName = "relative inline-flex align-middle",
}: {
  trigger: ReactNode;
  children: ReactNode;
  label: string;
  align?: "left" | "right";
  triggerClassName?: string;
  /** Overrides the outer wrapper's display — a trigger meant to sit on its
   * own line (e.g. `RateBand`, previously a `block` span) needs `relative
   * block`, not the default `inline-flex`. */
  wrapperClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, panelRef, coords } = useAnchoredPanel<HTMLButtonElement, HTMLSpanElement>(
    open,
    { align },
  );

  useDismissablePopover(open, () => setOpen(false), [triggerRef, panelRef]);

  return (
    <span className={wrapperClassName}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        // `relative` + an absolutely-positioned, invisible `before` pseudo-
        // element extends the *hit* area without touching layout or the
        // visible size of `trigger` — every one of these triggers (the "?"
        // circle, badge pills, dotted-underline stat labels) is well under
        // a 44px touch target otherwise. The neighbours these sit beside in
        // practice (AvailabilityBadge/RoleBadges on /players, grid-separated
        // stat cells on manager-profile-card) are static, non-interactive
        // spans, not other buttons, so a 10px halo has nothing to steal a
        // click from.
        className={`relative before:absolute before:-inset-2.5 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${triggerClassName}`}
      >
        {trigger}
      </button>

      {open && (
        <span
          ref={panelRef}
          role="dialog"
          style={coords ? { top: coords.top, left: coords.left } : { top: -9999, left: -9999 }}
          className="fixed z-30 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-3 text-left text-xs font-normal leading-relaxed text-zinc-700 shadow-lg dark:text-zinc-300"
        >
          {children}
        </span>
      )}
    </span>
  );
}

/**
 * A "?" affordance that opens a small explanatory panel.
 *
 * Click-toggled rather than hover-only so it works on touch, closes on Escape
 * and on outside click, and is reachable by keyboard.
 */
export function InfoTooltip({
  children,
  label = "What do these colours mean?",
  align = "left",
}: {
  children: ReactNode;
  label?: string;
  align?: "left" | "right";
}) {
  return (
    <TapToReveal
      label={label}
      align={align}
      triggerClassName="flex h-4 w-4 items-center justify-center rounded-full border border-zinc-400 text-[10px] font-bold text-zinc-500 transition-colors hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:border-primary dark:hover:text-primary"
      trigger="?"
    >
      {children}
    </TapToReveal>
  );
}

/** Shared explanation of the fixture colour + ring encoding. */
export function FdrLegendContent() {
  return (
    <>
      <p className="font-semibold text-zinc-900 dark:text-zinc-100">Reading a fixture</p>
      <p className="mt-1.5">
        <span className="font-medium">Fill colour</span> is the difficulty rating, dark green
        (easiest) through yellow to dark red (hardest).
      </p>
      <p className="mt-1.5">
        <span className="font-medium">Ring colour</span> is the venue — a{" "}
        <span className="font-semibold text-green-600 dark:text-green-400">green ring</span> means
        playing at home, a{" "}
        <span className="font-semibold text-red-600 dark:text-red-400">red ring</span> means away.
      </p>
      <p className="mt-1.5">
        The text is the opponent&apos;s three-letter code. Hover any fixture for the gameweek,
        venue, and difficulty in words.
      </p>
      <p className="mt-1.5 text-zinc-500 dark:text-zinc-400">
        Ratings currently come from the official FPL difficulty scale; a custom analytical rating
        arrives once teams have played matches.
      </p>
    </>
  );
}
