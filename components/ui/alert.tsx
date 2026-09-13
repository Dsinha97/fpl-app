import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { semanticAlert, type SemanticStatus } from "@/lib/semantic-colors";

/**
 * A bounded callout: icon, optional title, body.
 *
 * The app had 15-25 hand-built copies of the same three classes
 * (`border-amber-300 bg-amber-50 …` and its dark twin), and several places
 * where a warning was not a container at all but a long string of bright
 * yellow text — which reads as an unhandled debug log rather than a warning
 * (DSI-120's squad-discrepancy line, DSI-127's standings banner). This is the
 * one implementation, over the `--*-surface` / `--*-border` / `--*-foreground`
 * token trio `lib/semantic-colors.ts` already resolves.
 *
 * `tone="info"` is the neutral case — a disclosure that is not a warning.
 * Anything model-shaped that qualifies a specific number belongs in
 * `ModelNote` instead, anchored to that number, not in a banner above it.
 */
export type AlertTone = SemanticStatus | "info";

const GLYPH: Record<AlertTone, string> = {
  positive: "✓",
  warning: "⚠",
  negative: "✕",
  info: "ℹ",
};

const INFO_CLASS = "border border-border bg-card-supporting text-card-supporting-foreground";

export function Alert({
  tone = "info",
  title,
  children,
  className,
  icon,
  compact = false,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Overrides the default glyph; pass `null` for no icon at all. */
  icon?: ReactNode | null;
  /** Single-line density, for a strip that sits above a table rather than beside it. */
  compact?: boolean;
}) {
  const glyph = icon === undefined ? GLYPH[tone] : icon;
  return (
    <div
      role={tone === "negative" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg text-xs leading-relaxed",
        compact ? "px-2.5 py-1.5" : "p-3",
        tone === "info" ? INFO_CLASS : semanticAlert(tone),
        className,
      )}
    >
      {glyph !== null && (
        <span aria-hidden className="mt-px shrink-0 text-sm leading-none">
          {glyph}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
      </div>
    </div>
  );
}
