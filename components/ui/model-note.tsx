"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { InfoTooltip, TapToReveal } from "@/components/info-tooltip";

/**
 * The disclosure that travels with a number.
 *
 * There are 26 `*_NOTE` / `*_MODEL_NOTE` constants in `lib/`, and before this
 * they rendered three different ways: eight already inside `InfoTooltip`, the
 * rest as bare footnote paragraphs under at least three different typography
 * strings, or interpolated into prose. The audit (DSI-129) asked for all of
 * them to become tooltips; CLAUDE.md requires that a dropped or qualified term
 * be surfaced *next to the number it qualifies*. Both hold at once only if the
 * tooltip is anchored to the figure rather than parked in a section header —
 * which is what this component is for, and why `ModelNote` takes the note as
 * content and expects to be rendered inline beside its value.
 *
 * It never decides whether a note applies. The `lib/` constant is still the
 * single source of the sentence; this only decides how it is shown.
 */
export function ModelNote({
  children,
  label = "How is this calculated?",
  align = "left",
  className,
}: {
  /** The note text — pass the `lib/` constant, do not retype it. */
  children: ReactNode;
  /** Accessible name for the trigger. Name the quantity, not the component. */
  label?: string;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <span className={cn("inline-flex align-middle", className)}>
      <InfoTooltip label={label} align={align}>
        <div className="space-y-1.5 text-xs leading-relaxed">{children}</div>
      </InfoTooltip>
    </span>
  );
}

/**
 * The same disclosure, hung off a word rather than a "?" circle — for a column
 * header or a stat label that should carry its own explanation without adding
 * a second glyph to an already-dense row.
 *
 * The dotted underline is the signifier, and it is only ever drawn here: the
 * audit found dotted underlines on `/scenarios` metric labels that were not
 * interactive at all, which is a false affordance. If a label has this
 * underline it opens something.
 */
export function AnnotatedLabel({
  children,
  note,
  label,
  align = "left",
  className,
}: {
  children: ReactNode;
  note: ReactNode;
  label: string;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <TapToReveal
      label={label}
      align={align}
      triggerClassName={cn(
        "cursor-help underline decoration-dotted decoration-from-font underline-offset-2",
        className,
      )}
      trigger={children}
    >
      <div className="space-y-1.5 text-xs leading-relaxed">{note}</div>
    </TapToReveal>
  );
}
