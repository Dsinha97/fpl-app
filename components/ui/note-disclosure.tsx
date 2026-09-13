"use client";

import { useState, type ReactNode } from "react";

/**
 * A methodology footnote, collapsed to one truncated line until asked for.
 *
 * These notes are the "say what the number means" rule made visible
 * (CLAUDE.md) — they are not optional and they must not be a tooltip, because
 * a tooltip is unreachable on a phone and invisible to anyone reading the
 * page rather than hovering it. But rendered in full they run to a paragraph
 * of 10px prose under every planner, which is what the screen looked like:
 * the explanation was longer than the thing it explained.
 *
 * So: the first line stays on screen — enough to know what the note is about
 * — and the rest is one click away. `components/transfer-plan.tsx` worked out
 * this shape for its own note; this is that code, lifted so /transfers and
 * the path planner stop being a second and third copy of it (CLAUDE.md's
 * "one quantity, one implementation").
 */
export function NoteDisclosure({
  children,
  className = "mt-3",
}: {
  children: ReactNode;
  /** Spacing only — the caller owns its own rhythm. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`overflow-hidden rounded-md border border-zinc-200 dark:border-purple-900/40 ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[10px] leading-relaxed text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span
          aria-hidden="true"
          className={`shrink-0 text-zinc-400 transition-transform ${open ? "" : "rotate-180"}`}
        >
          ⌃
        </span>
        <span className={`min-w-0 flex-1 ${open ? "" : "truncate"}`}>{children}</span>
      </button>
    </div>
  );
}
