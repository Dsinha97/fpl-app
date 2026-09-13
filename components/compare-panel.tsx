"use client";

import { useMemo } from "react";
import { DataCell, DataHeadCell, DataRow } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { FixtureCell } from "@/components/fdr-badge";
import { FdrLegendContent, InfoTooltip } from "@/components/info-tooltip";
import { Badge } from "@/components/ui/badge";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import {
  comparePlayers,
  COMPARISON_MODEL_NOTE,
  fixtureScore,
  RISK_MODEL_NOTE,
  riskScore,
  valuePerMillion,
  XDC_MODEL_NOTE,
  type ScoredPlayer,
} from "@/lib/scoring";
import { ModelNote } from "@/components/ui/model-note";
import { horizonLabel, horizonLength, type Horizon } from "@/lib/team-state";
import { fullName } from "@/lib/player-search";

/**
 * The head-to-head metric table plus the weighted ranking — everything
 * `/compare` was, minus the page around it.
 *
 * Sprint 33 lifted this out of `app/compare/page.tsx` so it could render as a
 * panel on `/players`. The two pages already fetched the same five tables for
 * the same gameweek and drew the same horizon control; the only thing the
 * link between them carried was a list of ids, so the horizon you had just
 * set was thrown away on the way over.
 *
 * Deliberately stateless. Everything it needs is a prop, which is what makes
 * it equally at home in a slide-over and on a page of its own.
 */

/** Higher is better for every metric except risk and price. */
type Direction = "high" | "low";

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

/** Positions the defensive-contribution threshold can ever apply to — see XDC_MODEL_NOTE. */
const XDC_POSITIONS = new Set([2, 3]);

/** The subset of a `players` row this table reads. Both call sites select a
 *  superset of it, so neither has to model the panel's needs separately. */
export interface ComparePlayerRow {
  id: number;
  web_name: string;
  first_name: string | null;
  second_name: string | null;
  known_name: string | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
  penalties_order: number | null;
  direct_freekicks_order: number | null;
  corners_and_indirect_freekicks_order: number | null;
  total_points: number | null;
  bonus: number | null;
  form: number | null;
  defensive_contribution: number | null;
}

export interface CompareFixture {
  event: number;
  opponent_short_name: string;
  is_home: boolean;
  fdr: number;
}

/**
 * Best value in a row, for highlighting. `contested` is true whenever more
 * than one player shares the best value (or fewer than two have one at all) —
 * a tie should read as "no clear winner", not as every tied cell quietly
 * claiming the win.
 */
function winnerOf(
  values: (number | null)[],
  dir: Direction,
): { best: number | null; contested: boolean } {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return { best: null, contested: true };
  const best = dir === "high" ? Math.max(...nums) : Math.min(...nums);
  const holders = nums.filter((v) => v === best).length;
  return { best, contested: holders > 1 };
}

export function ComparePanel({
  chosen,
  horizon,
  seasonWindow,
  xdcById,
  rowById,
  upcoming,
  onRemove,
}: {
  chosen: ScoredPlayer[];
  horizon: Horizon;
  seasonWindow: number;
  /** player_id → per-horizon xDefcon. Kept out of ScoredPlayer on purpose —
   *  only this table and /players' grid need it. */
  xdcById: Map<number, Record<Horizon, number | null>>;
  rowById: Map<number, ComparePlayerRow>;
  /** team_id → that team's upcoming fixtures, in event order. */
  upcoming: Map<number, CompareFixture[]>;
  onRemove: (id: number) => void;
}) {
  const ranked = useMemo(
    () => comparePlayers(chosen, horizon, seasonWindow),
    [chosen, horizon, seasonWindow],
  );

  const metricRows: {
    label: string;
    dir: Direction;
    value: (p: ScoredPlayer) => number | null;
    format: (v: number | null) => string;
    hint?: string;
  }[] = [
    {
      label: "Price",
      dir: "low",
      value: (p) => p.price,
      format: (v) => (v === null ? "—" : `£${(v / 10).toFixed(1)}m`),
    },
    {
      label: `xP · ${horizonLabel(horizon)}`,
      dir: "high",
      value: (p) => p.xp[horizon],
      format: (v) => (v === null ? "—" : v.toFixed(1)),
    },
    {
      label: "xP per £m",
      dir: "high",
      value: (p) => (p.xp[horizon] === null ? null : valuePerMillion(p, horizon)),
      format: (v) => (v === null ? "—" : v.toFixed(2)),
    },
    {
      label: "xDefcon",
      dir: "high",
      value: (p) =>
        XDC_POSITIONS.has(p.elementType) ? (xdcById.get(p.id)?.[horizon] ?? null) : null,
      format: (v) => (v === null ? "—" : v.toFixed(2)),
      hint: XDC_MODEL_NOTE,
    },
    {
      label: "Owned",
      dir: "high",
      value: (p) => p.ownership,
      format: (v) => (v === null ? "—" : `${v}%`),
    },
    {
      label: "Total pts",
      dir: "high",
      value: (p) => rowById.get(p.id)?.total_points ?? null,
      format: (v) => (v === null ? "—" : v.toString()),
    },
    {
      label: "Bonus pts",
      dir: "high",
      value: (p) => rowById.get(p.id)?.bonus ?? null,
      format: (v) => (v === null ? "—" : v.toString()),
    },
    {
      label: "Form",
      dir: "high",
      value: (p) => rowById.get(p.id)?.form ?? null,
      format: (v) => (v === null ? "—" : v.toFixed(1)),
      hint: "FPL's own 30-day rolling form figure. Now folded into the comparison score at 10% weight.",
    },
    {
      label: "DC actions",
      dir: "high",
      value: (p) => rowById.get(p.id)?.defensive_contribution ?? null,
      format: (v) => (v === null ? "—" : v.toString()),
      hint: "Raw defensive-contribution action count (clearances + blocks + interceptions + tackles, plus recoveries for MID/FWD) — not points. FPL only scores DC on crossing a positional threshold: 10 for defenders, 12 for midfielders.",
    },
    {
      label: "PPG (last season)",
      dir: "high",
      value: (p) => p.pointsPerGame,
      format: (v) => (v === null ? "—" : v.toFixed(1)),
      hint: "Points per game in the last completed season — a longer-run reference alongside this season's form.",
    },
    {
      label: "Expected minutes",
      dir: "high",
      value: (p) => p.expectedMinutes,
      format: (v) => (v === null ? "—" : Math.round(v).toString()),
    },
    {
      label: "Start probability",
      dir: "high",
      value: (p) => p.startProbability,
      format: (v) => (v === null ? "—" : `${Math.round(v * 100)}%`),
    },
    {
      label: "Fixture quality",
      dir: "high",
      value: (p) => fixtureScore(p, horizon, seasonWindow),
      format: (v) => (v === null ? "—" : `${Math.round(v * 100)}%`),
      hint: "Mean official FDR over the horizon, mapped so 100% is the kindest run",
    },
    {
      label: "Risk",
      dir: "low",
      value: (p) => riskScore(p, horizon, seasonWindow),
      format: (v) => (v === null ? "—" : v.toString()),
      hint: "0.35 rotation + 0.30 injury + 0.20 minutes uncertainty + 0.15 fixture variance — lower is better",
    },
  ];

  return (
    <>
      {/* ranking */}
      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Ranking over {horizonLabel(horizon)}
        
          <ModelNote label="How is this ranking calculated?" align="right">
            <span className="block">{COMPARISON_MODEL_NOTE}</span>
            <span className="block">{RISK_MODEL_NOTE}</span>
          </ModelNote>
        </h2>
        <ol className="mt-3 space-y-2">
          {ranked.map((r, i) => (
            <li
              key={r.player.id}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-purple-900/40 dark:bg-card"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {i + 1}. {r.player.webName}
                </span>
                <span
                  className="text-xs tabular-nums text-zinc-500"
                  title="Weighted comparison score"
                >
                  score {r.score.toFixed(3)}
                </span>
              </div>
              {/* Badges rather than coloured text with a ✓/! glyph in front
                  (DSI-126): a caution about a player's minutes reads as a flag
                  to weigh, not as a coloured sentence, and the badge's own
                  tone carries what the glyph was doing. */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {r.strengths.map((s) => (
                  <Badge key={s} tone="positive" variant="outline" size="sm" className="normal-case">
                    {s}
                  </Badge>
                ))}
                {r.weaknesses.map((w) => (
                  <Badge key={w} tone="warning" variant="outline" size="sm" className="normal-case">
                    {w}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ol>

      </section>

      {/* The verdict comes before the evidence: the ranking answers the
          question the table only supplies the working for, and a reader who
          wants the working scrolls past it. It used to sit under 16 metric
          rows, which on a phone meant the conclusion was off the fold. */}
      {/* min-w rather than table-fixed's percentage columns — on a phone
          viewport, four equal-percentage columns squeeze player names and
          numbers illegibly small instead of scrolling. Same overflow-x-auto +
          min-w + sticky-first-column pattern app/players/page.tsx uses. */}
      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <colgroup>
            <col style={{ width: "9rem" }} />
            {chosen.map((p) => (
              <col key={p.id} style={{ width: "8rem" }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-200 dark:border-purple-900/40">
              <DataHeadCell className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-card">
                Metric
              </DataHeadCell>
              {chosen.map((p) => {
                const row = rowById.get(p.id);
                return (
                  <DataHeadCell key={p.id} className="px-3 py-2 text-left">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="min-w-0 truncate font-semibold text-zinc-900 dark:text-zinc-100"
                        title={(row && fullName(row)) || p.webName}
                      >
                        {p.webName}
                      </span>
                      {row && (
                        <AvailabilityBadge
                          status={row.status}
                          chanceOfPlaying={row.chance_of_playing_next_round}
                          news={row.news}
                          size="w-3.5 h-3.5"
                        />
                      )}
                      <Button
                        onClick={() => onRemove(p.id)}
                        aria-label={`Remove ${p.webName}`}
                        variant="ghost"
                        size="icon-xs"
                        className="ml-auto shrink-0 text-zinc-400 hover:text-red-500"
                      >
                        ×
                      </Button>
                    </div>
                    <div className="text-xs font-normal text-zinc-500">
                      {p.teamShort} · {POSITIONS[p.elementType]}
                    </div>
                  </DataHeadCell>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((m) => {
              const values = chosen.map((p) => m.value(p));
              const { best, contested } = winnerOf(values, m.dir);
              return (
                <DataRow key={m.label} className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">
                  <DataHeadCell className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left text-xs font-medium text-zinc-500 dark:bg-card">
                    <span className="flex items-center gap-1">
                      {m.label}
                      {m.hint && <InfoTooltip label={m.hint}>{m.hint}</InfoTooltip>}
                    </span>
                  </DataHeadCell>
                  {chosen.map((p, i) => {
                    const v = values[i];
                    const isBest = best !== null && v === best && !contested;
                    const isTiedBest = best !== null && v === best && contested;
                    return (
                      <DataCell
                        key={p.id}
                        className={`px-3 py-1.5 tabular-nums ${
                          isBest
                            ? "font-bold text-purple-900 dark:text-primary"
                            : "text-zinc-800 dark:text-zinc-200"
                        }`}
                      >
                        {m.format(v)}
                        {/* The glyph follows the metric's own direction
                            (DSI-126). A ▲ beside the cheapest price said two
                            wrong things at once: that low is up, and that cheap
                            is better — price is a cost, not a performance
                            score. Low-is-best rows now point down and the
                            title names the superlative rather than implying
                            a winner. */}
                        {isBest && (
                          <span
                            className="ml-1 text-[10px]"
                            title={`${m.dir === "high" ? "Highest" : "Lowest"} ${m.label.toLowerCase()} of those compared`}
                          >
                            {m.dir === "high" ? "▲" : "▼"}
                          </span>
                        )}
                        {isTiedBest && (
                          <span className="ml-1 text-[10px]" title="Tied — no clear best">
                            –
                          </span>
                        )}
                      </DataCell>
                    );
                  })}
                </DataRow>
              );
            })}

            {/* set-piece roles — informational only, no winner to highlight */}
            <DataRow className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">
              <DataHeadCell className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:bg-card">
                Set pieces
              </DataHeadCell>
              {chosen.map((p) => {
                const row = rowById.get(p.id);
                const hasRole =
                  row &&
                  (row.penalties_order === 1 ||
                    row.direct_freekicks_order === 1 ||
                    row.corners_and_indirect_freekicks_order === 1);
                return (
                  <DataCell key={p.id} className="px-3 py-2">
                    {hasRole ? (
                      <RoleBadges
                        penaltyOrder={row.penalties_order}
                        freeKickOrder={row.direct_freekicks_order}
                        cornerOrder={row.corners_and_indirect_freekicks_order}
                        size="w-3.5 h-3.5"
                      />
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </DataCell>
                );
              })}
            </DataRow>

            {/* fixture runs */}
            <DataRow className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">
              <DataHeadCell className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:bg-card">
                <span className="flex items-center gap-1">
                  Fixtures
                  <InfoTooltip>
                    <FdrLegendContent />
                  </InfoTooltip>
                </span>
              </DataHeadCell>
              {chosen.map((p) => (
                <DataCell key={p.id} className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {(upcoming.get(p.teamId) ?? [])
                      .slice(0, horizonLength(horizon, seasonWindow))
                      .map((f) => (
                        <FixtureCell
                          key={f.event}
                          opponent={f.opponent_short_name}
                          home={f.is_home}
                          fdr={f.fdr}
                          gw={f.event}
                          team={p.teamShort ?? undefined}
                        />
                      ))}
                  </span>
                </DataCell>
              ))}
            </DataRow>
          </tbody>
        </table>
      </div>

    </>
  );
}
