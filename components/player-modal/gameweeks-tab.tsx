"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ModelNote } from "@/components/ui/model-note";
import { Skeleton } from "@/components/ui/skeleton";
import { loadPlayerGameweeks, type GameweekLine } from "@/lib/player-profile";
import {
  loadScoringRules,
  breakdownFor,
  SCORING_MODEL_NOTE,
  type PositionShort,
  type ScoringRules,
} from "@/lib/fpl-scoring-rules";
import type { PlayerData } from "@/components/player-card";

/**
 * Every gameweek this player has played, newest first, each row expanding
 * into the per-stat points breakdown.
 *
 * The breakdown is derived — FPL only itemises the live gameweek — so it is
 * reconciled against the stored total and any difference shows as an
 * "Unattributed" row. See lib/fpl-scoring-rules.ts.
 */
export function GameweeksTab({
  player,
  season,
  teamShortById,
  positionShort,
}: {
  player: PlayerData;
  season: string;
  teamShortById: Map<number, string>;
  positionShort: string;
}) {
  const [lines, setLines] = useState<GameweekLine[] | null>(null);
  const [rules, setRules] = useState<ScoringRules | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadPlayerGameweeks(season, player.id)
      .then((r) => live && setLines(r))
      .catch(() => live && setLines([]));
    loadScoringRules(season)
      .then((r) => live && setRules(r))
      .catch(() => live && setRules(null));
    return () => {
      live = false;
    };
  }, [season, player.id]);

  if (lines === null) {
    return (
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No gameweeks recorded for {player.web_name} this season yet.
      </p>
    );
  }

  const rows = [...lines].reverse();

  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
        Tap a gameweek for the points breakdown.
      </p>

      {/*
        `min-w-0` on the scroller AND on every ancestor up to the dialog, or
        the child's own overflow never engages and the page scrolls sideways
        instead (DSI-138, DSI-141).
      */}
      <div className="min-w-0 overflow-x-auto">
        <div className="min-w-0">
          {/* Header */}
          <div className="grid min-w-0 items-center gap-2 border-b border-zinc-200 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 [grid-template-columns:2.5rem_minmax(0,1fr)_3.5rem_2.5rem_1.25rem] dark:border-purple-900/60 dark:text-zinc-400">
            <span>GW</span>
            <span>Opponent</span>
            <span className="text-right">Score</span>
            <span className="text-right">Pts</span>
            <span />
          </div>

          {rows.map((line) => {
            const key = `${line.event}-${line.fixture}`;
            const isOpen = expanded === key;
            const opponent = teamShortById.get(line.opponent_team) ?? "—";
            const score =
              line.team_h_score === null || line.team_a_score === null
                ? "—"
                : line.was_home
                  ? `${line.team_h_score}–${line.team_a_score}`
                  : `${line.team_a_score}–${line.team_h_score}`;

            return (
              <div key={key} className="min-w-0 border-b border-zinc-100 last:border-0 dark:border-purple-900/40">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : key)}
                  aria-expanded={isOpen}
                  // Long-press on a phone selects the label text without
                  // this; content elsewhere in the card stays selectable.
                  className="grid w-full min-w-0 items-center gap-2 px-2 py-2 text-left text-xs [grid-template-columns:2.5rem_minmax(0,1fr)_3.5rem_2.5rem_1.25rem] [touch-action:manipulation] [user-select:none] hover:bg-zinc-50 dark:hover:bg-purple-950/40"
                >
                  <span className="tabular-nums font-medium">{line.event}</span>
                  <span className="min-w-0 truncate">
                    {opponent} <span className="text-zinc-400">({line.was_home ? "H" : "A"})</span>
                  </span>
                  <span className="truncate text-right tabular-nums text-zinc-500 dark:text-zinc-400">{score}</span>
                  <span className="text-right tabular-nums font-semibold">{line.total_points}</span>
                  <ChevronDown
                    aria-hidden
                    className={`size-3.5 text-zinc-400 transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {/*
                  `grid-template-rows: 0fr -> 1fr` rather than height:auto,
                  matching CollapsibleCard. An `auto` height cannot be
                  transitioned and jumps.
                */}
                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-[var(--duration-base)] ease-[var(--ease-emphasis)] motion-reduce:transition-none ${
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    {isOpen && rules && (
                      <div className="mx-2 mb-2 rounded-lg border border-zinc-200 p-2 dark:border-purple-900/60">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          Points breakdown
                        </p>
                        <table className="w-full min-w-0 text-xs">
                          <thead>
                            <tr className="text-[10px] uppercase tracking-wide text-zinc-400">
                              <th className="pb-1 text-left font-medium">Statistic</th>
                              <th className="pb-1 text-right font-medium">Value</th>
                              <th className="pb-1 text-right font-medium">Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {breakdownFor(line, positionShort as PositionShort, rules).map((b) => (
                              <tr
                                key={b.identifier}
                                className={b.identifier === "unattributed" ? "text-amber-600 dark:text-amber-400" : ""}
                              >
                                <td className="py-0.5 pr-2">{b.label}</td>
                                <td className="py-0.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                                  {b.value ?? "—"}
                                </td>
                                <td className="py-0.5 text-right tabular-nums font-medium">
                                  {b.points > 0 ? "+" : ""}
                                  {b.points}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ModelNote className="mt-3">{SCORING_MODEL_NOTE}</ModelNote>
    </div>
  );
}
