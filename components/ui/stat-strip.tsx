"use client";

import type { ReactNode } from "react";
import { fdrClasses, fdrLabel, venueRing } from "@/lib/fdr";
import type { UpcomingFixture } from "@/components/player-card";

/**
 * Sprint 41 — where a screen's key numbers live, so they are not one more
 * cell in a grid of ten.
 *
 * - `HeroStat` is the one number a screen exists to answer, pinned to the
 *   top-right corner of its header (the FPL app puts price and its % change
 *   there). One per screen: two heroes is no hero.
 * - `StatStrip` is the supporting numbers, in one horizontal row divided by
 *   hairlines — a single axis, never a grid of nested cards. Five at most;
 *   anything past that belongs in the full profile.
 * - `FixtureRun` is the next few fixtures as difficulty-coloured pills, the
 *   other thing a manager scans before acting on a player.
 */

export function HeroStat({
  label,
  value,
  caption,
  title,
  align = "end",
  labelAddon,
}: {
  label: string;
  value: ReactNode;
  /** A line under the value — a qualifier or a confidence badge, never a second number of equal weight. */
  caption?: ReactNode;
  /** Hover/long-press explanation of what the number means. */
  title?: string;
  /** `end` pins it top-right of a header (the default); `center` is for a hero that owns its own row. */
  align?: "end" | "center";
  /** Sits beside the label — an `InfoTooltip` carrying what the number means. */
  labelAddon?: ReactNode;
}) {
  return (
    <div
      className={`flex shrink-0 flex-col ${align === "center" ? "items-center text-center" : "items-end text-right"}`}
      title={title}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
        {labelAddon}
      </span>
      <span
        className={`${align === "center" ? "text-5xl" : "text-3xl"} font-bold leading-none tabular-nums text-purple-800 dark:text-primary`}
      >
        {value}
      </span>
      {caption ? <span className="mt-1">{caption}</span> : null}
    </div>
  );
}

export interface StatStripItem {
  label: string;
  value: ReactNode;
  /** Colour the value with the accent — for the one supporting number that matters most. */
  accent?: boolean;
  title?: string;
}

export function StatStrip({ items }: { items: readonly StatStripItem[] }) {
  return (
    <dl
      className="grid divide-x divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-purple-900/50 dark:border-purple-900/50"
      // minmax(0,…) so a long value truncates inside its cell instead of
      // pushing the strip — and the page — sideways (DSI-138, DSI-141).
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0 px-1 py-2 text-center" title={item.title}>
          <dt className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            {item.label}
          </dt>
          <dd
            className={`truncate text-base font-semibold tabular-nums ${
              item.accent ? "text-purple-800 dark:text-primary" : "text-zinc-900 dark:text-zinc-100"
            }`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FixtureRun({ fixtures }: { fixtures: readonly UpcomingFixture[] }) {
  if (fixtures.length === 0) return null;
  return (
    <ol aria-label="Next fixtures" className="flex gap-1.5">
      {fixtures.map((f) => (
        <li
          key={`${f.event}-${f.opponent_short_name}`}
          title={`GW${f.event}: ${f.opponent_short_name} (${f.is_home ? "home" : "away"}) — ${fdrLabel(f.fdr)}`}
          className={`min-w-0 flex-1 rounded-lg px-1 py-1.5 text-center ${fdrClasses(f.fdr)} ${venueRing(f.is_home)}`}
        >
          <span className="block truncate text-xs font-semibold">
            {f.opponent_short_name} ({f.is_home ? "H" : "A"})
          </span>
          <span className="block text-[11px] opacity-80">GW{f.event}</span>
        </li>
      ))}
    </ol>
  );
}
