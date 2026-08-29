"use client";

import { useState, type ReactNode } from "react";
import { ExpandToggle } from "@/components/ui/expand-toggle";

const TIER_CLASS: Record<Tier, string> = {
  primary: "border-zinc-200 bg-card p-4 dark:border-purple-900/40",
  supporting: "border-zinc-200 bg-card-supporting p-3 dark:border-card-supporting-border",
  // Sprint 23 — the warning-style callout /chips used for its fixture-flatness
  // note, previously a bespoke copy of this exact disclosure shape that
  // couldn't reuse CollapsibleCard because there was nowhere for its amber
  // colouring to go.
  amber: "border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40",
  // A *section* contains cards — it must not draw a second frame around them.
  // No border, no padding, no rounding: the only thing it contributes is the
  // header row and the collapse behaviour. Inheriting `primary`'s `p-4` would
  // also eat 32px of the page's `max-w-5xl`, which the 360px rails inside
  // /deadline's two grids cannot spare at exactly `lg`.
  section: "border-transparent p-0",
};

const HEADING_CLASS: Record<Tier, string> = {
  primary: "text-sm font-semibold text-zinc-900 dark:text-zinc-100",
  supporting: "text-xs font-medium uppercase tracking-wide text-zinc-500",
  amber: "text-xs font-medium text-amber-800 dark:text-amber-300",
  section: "text-base font-semibold text-zinc-950 dark:text-zinc-50",
};

type Tier = "primary" | "supporting" | "amber" | "section";

export interface CollapsibleCardProps {
  title: string;
  /** One-line summary shown next to the title when collapsed — the essential detail without opening the card (e.g. planned chip windows, a changed-item count). */
  summary?: ReactNode;
  tier?: Tier;
  /** Uncontrolled initial state. Ignored when `open` is supplied. */
  defaultOpen?: boolean;
  /** Controlled open state. Supply this *and* `onOpenChange` when the page needs to drive the card from state that arrives after mount. */
  open?: boolean;
  /** Fires on every header click with the state the card is moving to. Always fires, controlled or not. */
  onOpenChange?: (open: boolean) => void;
  /** Margin/positioning only — the caller controls spacing in its own rhythm, same as every other card on the page. */
  className?: string;
  children: ReactNode;
}

/**
 * A card that collapses to its title + a one-line summary. Extracted from the
 * two bespoke copies of this exact shape (app/chips/page.tsx's fixture-flatness
 * note, components/transfer-plan.tsx's collapse) rather than writing a third —
 * see docs/wiki/design-system.md's note that they were never consolidated.
 *
 * Uncontrolled by default. Pass `open` + `onOpenChange` to drive it from the
 * page instead — /deadline needs this because which of its two sections starts
 * expanded depends on whether a gameweek is in play, and that probe only
 * resolves *after* first paint (a `defaultOpen` captured at mount would always
 * be the pre-season answer), then flips again mid-session at the final whistle.
 */
export function CollapsibleCard({
  title,
  summary,
  tier = "primary",
  defaultOpen = false,
  open,
  onOpenChange,
  className = "",
  children,
}: CollapsibleCardProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  // A section's body opens instantly; a card's animates. Two reasons, both
  // measured rather than assumed:
  //
  //  - Clipping. PitchView renders PlayerDetail as `position: absolute`
  //    (components/player-detail.tsx), so an `overflow-hidden` ancestor cuts
  //    the popover off. An open section therefore must not clip — and the
  //    obvious fix (clip while animating, then switch to `overflow-visible`
  //    on `onTransitionEnd`) does not work: Chrome resolves an interpolating
  //    `fr` track in an indefinite-height grid to 0px throughout, never fires
  //    a `transitionend` for `grid-template-rows`, and the body would stay
  //    clipped forever.
  //  - Scale. A card body is a list or a note. A section body is most of a
  //    page — sliding ~1,000px of squad, chip and transfer UI open over
  //    300ms is not a nicety, it is a lurch.
  //
  // Card tiers keep exactly the Sprint 24 behaviour, untouched.
  const animated = tier !== "section";

  const toggle = () => {
    const next = !isOpen;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div
      className={`rounded-lg border ${
        // A section has no border or rounding to clip against, and clipping it
        // would defeat the `settled` logic below.
        tier === "section" ? "" : "overflow-hidden"
      } ${TIER_CLASS[tier]} ${className}`}
    >
      {/* `group` — lets the decorative `ExpandToggle` below preview its
          hover colour when the row (not just the circle) is hovered, same
          as a standalone toggle button would for itself. One `<button>` for
          the whole row rather than a nested toggle button: a button inside a
          button is invalid HTML and throws a hydration error (see
          `ExpandToggle`'s own note). */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="group flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className={`${HEADING_CLASS[tier]} shrink-0`}>{title}</span>
        {summary && (
          <span className={`min-w-0 flex-1 text-xs text-zinc-500 ${isOpen ? "" : "truncate"}`}>
            {summary}
          </span>
        )}
        <ExpandToggle expanded={isOpen} interactive={false} />
      </button>
      {/* CSS Grid 0fr→1fr rather than mount/unmount — a GPU-friendly height
          animation with no dependency and no need to know the content's
          real height up front (Sprint 24). The body still renders while
          collapsed (height-zero, clipped), so anything that used to skip work
          while `{open && …}` was false now runs always — which is load-bearing
          for /deadline, whose collapsed summaries read state the collapsed
          body's own effects keep fresh. `inert` keeps that always-rendered
          body out of the tab order and the a11y tree. */}
      <div
        className={
          animated
            ? `grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`
            : isOpen
              ? ""
              : "grid grid-rows-[0fr]"
        }
      >
        <div className={animated || !isOpen ? "overflow-hidden" : ""} inert={!isOpen}>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
