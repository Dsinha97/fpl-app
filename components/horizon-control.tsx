"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { HORIZONS, horizonLabel, type Horizon } from "@/lib/team-state";

/**
 * The page-level horizon picker.
 *
 * Five screens had five takes on the same control — `/builder` a bordered pill
 * strip with a `--primary` fill, `/players` and `/scenarios` a `bg-purple-950`
 * variant, `/transfers` a third border treatment, and the decision-analytics
 * panel a plain `<select>` — while `/fixtures`' fixture-window switcher and
 * `/deadline` had already moved to `SegmentedControl`. Same function, four
 * different affordances. This makes the FDR switcher the one shape.
 *
 * `radio` semantics, not `tabs`: the horizon is a *parameter* that re-scores
 * what is already on screen, not a control that swaps one panel for another.
 *
 * `Horizon` is `1 | 3 | 5 | 8 | 19 | "season"`, so it can't be a segment value
 * directly — the string round-trip lives here once rather than at each call
 * site, which is also where the "season" special case belongs (CLAUDE.md:
 * anything doing arithmetic on a horizon goes through `horizonLength`).
 */
export function HorizonControl({
  value,
  onValueChange,
  label = "Horizon",
  showLabel = true,
  size = "sm",
  className,
}: {
  value: Horizon;
  onValueChange: (h: Horizon) => void;
  /** Accessible name; also the visible caption unless `showLabel` is false. */
  label?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {showLabel && <span className="text-xs text-zinc-500">{label}</span>}
      <SegmentedControl
        label={label}
        semantics="radio"
        size={size}
        value={String(value)}
        onValueChange={(v) => onValueChange(v === "season" ? "season" : (Number(v) as Horizon))}
        options={HORIZONS.map((h) => ({ value: String(h), label: horizonLabel(h) }))}
      />
    </div>
  );
}
