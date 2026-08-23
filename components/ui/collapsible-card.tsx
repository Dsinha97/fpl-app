"use client";

import { useState, type ReactNode } from "react";
import { ExpandToggle } from "@/components/ui/expand-toggle";

const TIER_CLASS: Record<"primary" | "supporting" | "amber", string> = {
  primary: "border-zinc-200 bg-card p-4 dark:border-purple-900/40",
  supporting: "border-zinc-200 bg-card-supporting p-3 dark:border-card-supporting-border",
  // Sprint 23 — the warning-style callout /chips used for its fixture-flatness
  // note, previously a bespoke copy of this exact disclosure shape that
  // couldn't reuse CollapsibleCard because there was nowhere for its amber
  // colouring to go.
  amber: "border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40",
};

const HEADING_CLASS: Record<"primary" | "supporting" | "amber", string> = {
  primary: "text-sm font-semibold text-zinc-900 dark:text-zinc-100",
  supporting: "text-xs font-medium uppercase tracking-wide text-zinc-500",
  amber: "text-xs font-medium text-amber-800 dark:text-amber-300",
};

export interface CollapsibleCardProps {
  title: string;
  /** One-line summary shown next to the title when collapsed — the essential detail without opening the card (e.g. planned chip windows, a changed-item count). */
  summary?: ReactNode;
  tier?: "primary" | "supporting" | "amber";
  defaultOpen?: boolean;
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
 * Uncontrolled: each card owns its own open state. If a page ever needs to
 * read or drive it externally, lift the state then — no caller does yet.
 */
export function CollapsibleCard({
  title,
  summary,
  tier = "primary",
  defaultOpen = false,
  className = "",
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`overflow-hidden rounded-lg border ${TIER_CLASS[tier]} ${className}`}>
      {/* `group` — lets the decorative `ExpandToggle` below preview its
          hover colour when the row (not just the circle) is hovered, same
          as a standalone toggle button would for itself. One `<button>` for
          the whole row rather than a nested toggle button: a button inside a
          button is invalid HTML and throws a hydration error (see
          `ExpandToggle`'s own note). */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className={`${HEADING_CLASS[tier]} shrink-0`}>{title}</span>
        {summary && (
          <span className={`min-w-0 flex-1 text-xs text-zinc-500 ${open ? "" : "truncate"}`}>
            {summary}
          </span>
        )}
        <ExpandToggle expanded={open} interactive={false} />
      </button>
      {/* CSS Grid 0fr→1fr rather than mount/unmount — a GPU-friendly height
          animation with no dependency and no need to know the content's
          real height up front (Sprint 24). The body still renders while
          collapsed (height-zero, clipped by `overflow-hidden`), so anything
          that used to skip work while `{open && …}` was false now runs
          always — none of this component's own callers do that kind of
          work in `children`, but a future one should check. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
