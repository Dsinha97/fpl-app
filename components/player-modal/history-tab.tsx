"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCell, StatGrid } from "@/components/player-modal/stat-cell";
import { loadPlayerSeasons, type SeasonLine } from "@/lib/player-profile";
import { shortSeason } from "@/lib/utils";
import type { PlayerData } from "@/components/player-card";

const money = (tenths: number | null | undefined) =>
  tenths === null || tenths === undefined ? "—" : `£${(tenths / 10).toFixed(1)}m`;

const compact = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

/**
 * Past seasons, newest first.
 *
 * Keyed on `player_code` rather than `id`, because FPL reassigns element ids
 * between seasons — an id-keyed history silently attributes one player's past
 * to another after a rollover.
 */
export function HistoryTab({ player }: { player: PlayerData }) {
  const [loaded, setLoaded] = useState<SeasonLine[] | null>(null);
  const code = player.code ?? null;

  // Derived, not stored: with no player code there is nothing to fetch, so
  // this is "resolved to empty" rather than a state write inside an effect.
  const seasons = code === null ? [] : loaded;

  useEffect(() => {
    if (code === null) return;
    let live = true;
    loadPlayerSeasons(code)
      .then((r) => live && setLoaded(r))
      .catch(() => live && setLoaded([]));
    return () => {
      live = false;
    };
  }, [code]);

  if (seasons === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (seasons.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No previous Premier League seasons on record for {player.web_name}.
        {code === null ? " (No player code available for this card.)" : ""}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {seasons.map((s) => {
        const change =
          s.start_cost !== null && s.end_cost !== null ? s.end_cost - s.start_cost : null;
        return (
          <section key={s.season_name} className="min-w-0">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {shortSeason(s.season_name)}
            </h3>
            <div className="flex min-w-0 flex-col gap-2">
              <StatGrid columns={3}>
                <StatCell label="Pts" value={s.total_points ?? "—"} emphasis />
                <StatCell label="Goals" value={s.goals_scored ?? "—"} />
                <StatCell label="Assists" value={s.assists ?? "—"} />
                <StatCell label="Minutes" value={compact(s.minutes)} />
                <StatCell label="Bonus" value={s.bonus ?? "—"} />
                <StatCell label="ICT" value={s.ict_index ?? "—"} />
              </StatGrid>
              <StatGrid columns={3}>
                <StatCell label="Start" value={money(s.start_cost)} />
                <StatCell label="End" value={money(s.end_cost)} />
                <StatCell
                  label="Change"
                  value={
                    change === null ? (
                      "—"
                    ) : (
                      <span
                        className={
                          change > 0
                            ? "text-emerald-600 dark:text-primary"
                            : change < 0
                              ? "text-red-600 dark:text-red-400"
                              : undefined
                        }
                      >
                        {change > 0 ? "+" : change < 0 ? "−" : ""}£
                        {(Math.abs(change) / 10).toFixed(1)}m
                      </span>
                    )
                  }
                />
              </StatGrid>
            </div>
          </section>
        );
      })}
    </div>
  );
}
