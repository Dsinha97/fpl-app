"use client";

import { useState, type ReactNode } from "react";

const TIER_CLASS: Record<"primary" | "supporting", string> = {
  primary: "border-zinc-200 bg-card p-4 dark:border-purple-900/40",
  supporting: "border-zinc-200 bg-card-supporting p-3 dark:border-card-supporting-border",
};

const HEADING_CLASS: Record<"primary" | "supporting", string> = {
  primary: "text-sm font-semibold text-zinc-900 dark:text-zinc-100",
  supporting: "text-xs font-medium uppercase tracking-wide text-zinc-500",
};

export interface CollapsibleCardProps {
  title: string;
  /** One-line summary shown next to the title when collapsed — the essential detail without opening the card (e.g. planned chip windows, a changed-item count). */
  summary?: ReactNode;
  tier?: "primary" | "supporting";
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className={`${HEADING_CLASS[tier]} shrink-0`}>{title}</span>
        {summary && (
          <span className={`min-w-0 flex-1 text-xs text-zinc-500 ${open ? "" : "truncate"}`}>
            {summary}
          </span>
        )}
        <span
          aria-hidden="true"
          className={`shrink-0 text-zinc-500 transition-transform ${open ? "" : "rotate-180"}`}
        >
          ⌃
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
