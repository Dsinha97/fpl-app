"use client";

import type { ReactNode } from "react";
import { BAND_LABELS, rankCaption, rankTooltip, type Rank } from "@/lib/player-ranks";

/**
 * The repeated unit of the profile's Overview tab: a label, a value, an
 * optional bar, and an optional caption saying where that value sits among
 * players of the same position.
 *
 * Every part below the value is optional and *absent* rather than blank when
 * it can't be said. A dash where a rank should be reads as a loading failure;
 * nothing at all reads as "this isn't rankable yet", which is the truth
 * pre-season and for thin cohorts. See lib/player-ranks.ts.
 */

/**
 * Bar fill, normalised to the cohort's 95th percentile by `rankOf`.
 *
 * Purely decorative — it repeats the value beside it and carries no
 * information the caption doesn't, so it is `aria-hidden` and screen readers
 * get the number and the caption instead of a meaningless progressbar.
 */
export function MiniBar({ fill, tone = "accent" }: { fill: number; tone?: "accent" | "muted" }) {
  return (
    <div
      aria-hidden="true"
      className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-purple-950/70"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-[var(--duration-base)] ease-[var(--ease-slide)] motion-reduce:transition-none ${
          tone === "accent" ? "bg-primary" : "bg-zinc-400 dark:bg-purple-600"
        }`}
        style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }}
      />
    </div>
  );
}

/** "#8 FWD" or a worded band, with the denominator in the tooltip. */
export function RankCaption({
  rank,
  positionShort,
  positionLong,
  mode = "rank",
}: {
  rank: Rank;
  positionShort: string;
  positionLong: string;
  /** `rank` for "#8 FWD"; `band` for "Average+" where a precise rank is noise. */
  mode?: "rank" | "band";
}) {
  const text = mode === "rank" ? rankCaption(rank, positionShort) : BAND_LABELS[rank.band];
  const tone =
    rank.band === "top" || rank.band === "above"
      ? "text-primary"
      : rank.band === "below"
        ? "text-zinc-400 dark:text-zinc-500"
        : "text-zinc-500 dark:text-zinc-400";

  return (
    <span className={`mt-1 block truncate text-[10px] font-medium ${tone}`} title={rankTooltip(rank, positionLong)}>
      {text}
    </span>
  );
}

export function StatCell({
  label,
  value,
  sub,
  rank,
  positionShort,
  positionLong,
  captionMode = "rank",
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  /** A second line under the value, for a unit or a qualifier. */
  sub?: ReactNode;
  /** Null hides the bar and the caption entirely — see the module note. */
  rank?: Rank | null;
  positionShort?: string;
  positionLong?: string;
  captionMode?: "rank" | "band";
  emphasis?: boolean;
}) {
  return (
    // `min-w-0` so a long value truncates inside the cell instead of forcing
    // the grid track wider than its `minmax(0,1fr)` allows.
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-purple-900/60 dark:bg-surface-2">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      {/* A div, not a p: `value` is a ReactNode and is a <Skeleton> (a div)
          while loading. A div inside a p is invalid HTML and React reports it
          as a hydration error. */}
      <div
        className={`mt-0.5 truncate tabular-nums font-bold text-zinc-900 dark:text-zinc-100 ${
          emphasis ? "text-xl" : "text-base"
        }`}
      >
        {value}
      </div>
      {sub ? <div className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">{sub}</div> : null}
      {rank ? <MiniBar fill={rank.fill} /> : null}
      {rank && positionShort && positionLong ? (
        <RankCaption
          rank={rank}
          positionShort={positionShort}
          positionLong={positionLong}
          mode={captionMode}
        />
      ) : null}
    </div>
  );
}

/** A titled group of cells. Tracks are `minmax(0,1fr)` at every breakpoint. */
export function StatGrid({
  label,
  children,
  columns = 3,
}: {
  label?: string;
  children: ReactNode;
  columns?: 2 | 3;
}) {
  return (
    <section className="min-w-0">
      {label ? (
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </h3>
      ) : null}
      {/*
        Explicit `minmax(0,…)` rather than Tailwind's `grid-cols-N`, and at
        *every* breakpoint, not just the largest. Grid items default to
        min-width:auto and refuse to shrink below their content, so a plain
        `1fr` track silently resolves to `max-content` and pushes the page
        sideways — the bug that cost DSI-138 and DSI-141. Two up on a phone,
        widening only where there is room.
      */}
      <div
        className={`grid min-w-0 gap-2 [grid-template-columns:repeat(2,minmax(0,1fr))] ${
          columns === 3
            ? "sm:[grid-template-columns:repeat(3,minmax(0,1fr))]"
            : "sm:[grid-template-columns:repeat(2,minmax(0,1fr))]"
        }`}
      >
        {children}
      </div>
    </section>
  );
}
