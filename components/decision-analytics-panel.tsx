"use client";

import { useEffect, useMemo, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { chipLabel } from "@/lib/chip-plan";
import {
  loadDecisionAnalytics,
  DECISION_ANALYTICS_NOTE,
  type DecisionAnalytics,
} from "@/lib/decision-analytics";
import { horizonLabel, type Horizon } from "@/lib/team-state";
import type { PlayerRow } from "@/components/gameweek-review-panel";
import { signed } from "@/lib/utils";
import { HorizonControl } from "@/components/horizon-control";

function nameOf(players: Map<number, PlayerRow>, element: number): string {
  return players.get(element)?.web_name ?? `#${element}`;
}

const CARD =
  "self-start rounded-lg border border-zinc-200 bg-card p-4 dark:border-purple-900/40";

/** A signed points figure that keeps its sign visible — never a bare number.
 *  Uses a real minus sign, matching the − the surrounding copy uses for its
 *  own operators; a hyphen next to one reads as a different character. */

/**
 * The season's rank arc.
 *
 * Overall rank is lower-is-better, so the y axis is inverted: the line rises
 * as the rank improves, which is the direction a reader expects "going up" to
 * mean. That inversion is the entire reason this is a picture rather than
 * another column on the table below it — see DECISION_ANALYTICS_NOTE on the
 * two competing percentile conventions in this codebase.
 */
function RankArc({ points }: { points: Array<{ event: number; overallRank: number | null }> }) {
  const usable = points.filter(
    (p): p is { event: number; overallRank: number } => p.overallRank !== null,
  );
  if (usable.length < 2) return null;

  const W = 320;
  const H = 64;
  const PAD = 4;
  const ranks = usable.map((p) => p.overallRank);
  const best = Math.min(...ranks);
  const worst = Math.max(...ranks);
  const span = worst - best || 1;

  const xy = usable.map((p, i) => {
    const x = PAD + (i * (W - PAD * 2)) / (usable.length - 1);
    // Inverted: the best (lowest) rank sits at the top.
    const y = PAD + ((p.overallRank - best) / span) * (H - PAD * 2);
    return { ...p, x, y };
  });
  const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-16 w-full"
        role="img"
        aria-label={`Overall rank from gameweek ${xy[0].event} to ${xy[xy.length - 1].event}, best ${fmt(best)}, worst ${fmt(worst)}. Higher on the chart is a better rank.`}
      >
        {/* chart-1, not primary: the CTA colour on a static data mark dilutes
            the buttons it is supposed to distinguish. PercentileBar already
            moved for this reason; the arc was missed. */}
        <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" />
        {xy.map((p) => (
          <circle key={p.event} cx={p.x} cy={p.y} r="2.5" fill="var(--chart-1)" />
        ))}
      </svg>
      <p className="mt-1 flex justify-between text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        <span>GW{xy[0].event}</span>
        {/* "lower is better" is true of the rank number and the opposite of
            what the rising line appears to say (DSI-120). Describe the chart,
            since the chart is what is being read. */}
        <span>
          best {fmt(best)} · worst {fmt(worst)} · the line rises as your rank improves
        </span>
        <span>GW{xy[xy.length - 1].event}</span>
      </p>
    </div>
  );
}

/**
 * Season-wide analytics over decisions already made — the DSI-66 half of
 * Sprint 17 that needs no model trust.
 *
 * Sits above `/team`'s "This Season" table rather than inside its gameweek
 * selector: every figure here spans the season, so putting it under a
 * per-gameweek picker would say it was scoped to one. The rank arc is
 * deliberately a chart, not a fourth copy of the table's Overall Rank column.
 */
export function DecisionAnalyticsPanel({
  season,
  entryId,
  players,
}: {
  season: string;
  entryId: number;
  /** player id -> name lookup. `/team`'s own map is a superset. */
  players: Map<number, PlayerRow>;
}) {
  const [horizon, setHorizon] = useState<Horizon>(5);
  const [data, setData] = useState<DecisionAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const next = await loadDecisionAnalytics(season, entryId, horizon);
        if (!cancelled) setData(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season, entryId, horizon]);

  /**
   * How much of the chosen lookback actually has results behind it, summed
   * over the gameweeks transfers were made in. One window per group: every
   * transfer in a gameweek shares that gameweek's window.
   */
  const { scoredGws, windowGws } = useMemo(() => {
    let scored = 0;
    let total = 0;
    for (const g of data?.transfers.groups ?? []) {
      const first = g.transfers[0];
      if (!first) continue;
      scored += first.scoredGws;
      total += first.horizonGws;
    }
    return { scoredGws: scored, windowGws: total };
  }, [data]);

  const captainAccuracy = useMemo(() => {
    if (!data || data.captain.scored === 0) return null;
    return Math.round((data.captain.hits / data.captain.scored) * 100);
  }, [data]);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Decisions this season
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            What the calls you already made actually returned.
          </p>
        </div>
        {/* min-w-0 here too, not just inside HorizonControl. The control
            explains in its own source why it needs it — a flex item defaults
            to min-width:auto and refuses to shrink below its content — and
            that reasoning applies to every wrapper above it as well. Without
            it this row measured 406px inside a 375px viewport and scrolled
            the whole document sideways. */}
        <div className="flex min-w-0 items-center gap-2">
          {/* DSI-141: called "Transfer horizon", which borrows the word every other
              screen uses for a projection — this one measures the past. */}
          <HorizonControl value={horizon} onValueChange={setHorizon} label="Transfers lookback" />
          <InfoTooltip label="About these figures">{DECISION_ANALYTICS_NOTE}</InfoTooltip>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && !error && (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      )}

      {!loading && !error && !data && (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          No picks are recorded for this manager yet.
        </p>
      )}

      {!loading && !error && data && data.events.length === 0 && (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          No gameweek has been scored yet this season, so there is nothing to look back on.
        </p>
      )}

      {data && data.events.length > 0 && (
        <div className="starting:opacity-0 opacity-100 transition-opacity duration-base ease-emphasis motion-reduce:transition-none">
          {data.provisional && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
              Gameweek {data.events[data.events.length - 1]} is still being scored — those figures
              are provisional until bonus is confirmed.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-4">
            {/* ------------------------------------------------ captain */}
            <div className={`${CARD} w-full lg:w-[calc(50%-0.5rem)]`}>
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Captain
              </h3>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                Best of your XI in{" "}
                <span className="font-medium">
                  {data.captain.hits} of {data.captain.scored}
                </span>{" "}
                gameweeks
                {captainAccuracy !== null && (
                  <span className="text-zinc-500 dark:text-zinc-400"> ({captainAccuracy}%)</span>
                )}
                .
              </p>
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                Left on the table:{" "}
                <span className="font-medium tabular-nums">{data.captain.pointsLost} pts</span>
                {data.captain.handovers > 0 && (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {" "}
                    · vice took over {data.captain.handovers}×
                  </span>
                )}
              </p>
              <ul className="mt-3 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                {data.captain.perEvent.map((c) => (
                  <li key={c.event} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="w-10 shrink-0 tabular-nums">GW{c.event}</span>
                    <span>
                      {nameOf(players, c.effectiveElement)}{" "}
                      <span className="tabular-nums">
                        ({c.effectiveRaw} × {c.multiplier})
                      </span>
                      {c.handedOver && <span className="text-amber-600 dark:text-amber-400"> vice</span>}
                    </span>
                    {c.wasBest ? (
                      <span className="text-emerald-600 dark:text-primary">best call</span>
                    ) : (
                      <span>
                        −{c.gapEffective} vs {nameOf(players, c.bestElement)} ({c.bestRaw})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* ---------------------------------------------- transfers */}
            <div className={`${CARD} w-full lg:w-[calc(50%-0.5rem)]`}>
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Transfers
              </h3>
              {data.transfers.groups.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  No transfers recorded this season.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    Over {horizonLabel(data.transfers.horizon)}:{" "}
                    <span className="font-medium tabular-nums">{data.transfers.inPoints} in</span>{" "}
                    −{" "}
                    <span className="font-medium tabular-nums">{data.transfers.outPoints} out</span>{" "}
                    − <span className="font-medium tabular-nums">{data.transfers.hits} hit</span> ={" "}
                    <span className="font-medium tabular-nums">
                      {signed(data.transfers.inPoints - data.transfers.outPoints - data.transfers.hits, 0)}
                    </span>
                  </p>
                  {data.transfers.inProgress && (
                    /* DSI-141: the owner read two lookbacks returning the same
                       figure as a broken control. It is not — a window only
                       counts gameweeks that have been *scored*, so early in the
                       season 1 GW and 3 GW cover the same finished football.
                       The unchanged number was right and said nothing about why,
                       which is the defect. Now it states its own coverage. */
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="tabular-nums">{scoredGws}</span> of{" "}
                      <span className="tabular-nums">{windowGws}</span> gameweeks in these lookback
                      windows have been scored, so the verdicts are not final — and a longer
                      lookback cannot change them until more gameweeks finish.
                    </p>
                  )}
                  <ul className="mt-3 space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {data.transfers.groups.map((g) => (
                      <li key={g.event}>
                        <span className="tabular-nums">GW{g.event}</span>
                        {g.hit > 0 && <span> · {g.hit} pt hit</span>}
                        <ul className="mt-1 space-y-0.5 pl-4">
                          {g.transfers.map((o) => (
                            <li
                              key={`${o.row.elementOut}-${o.row.elementIn}-${o.row.transferTime ?? ""}`}
                              className="flex flex-wrap items-baseline gap-x-2"
                            >
                              <span>
                                {nameOf(players, o.row.elementOut)} → {nameOf(players, o.row.elementIn)}
                              </span>
                              <span className="tabular-nums">
                                {o.inPoints} in − {o.outPoints} out ={" "}
                                <span
                                  className={
                                    o.inPoints - o.outPoints >= 0
                                      ? "text-emerald-600 dark:text-primary"
                                      : "text-red-600 dark:text-red-400"
                                  }
                                >
                                  {signed(o.inPoints - o.outPoints, 0)}
                                </span>
                              </span>
                              {o.inProgress && (
                                <span className="text-zinc-400 dark:text-zinc-500">
                                  {o.scoredGws}/{o.horizonGws} GW scored
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {/* -------------------------------------------------- chips */}
            <div className={`${CARD} w-full lg:w-[calc(50%-0.5rem)]`}>
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Chips</h3>
              {data.chips.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  No chips played yet this season.
                </p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {data.chips.map((c) => (
                    <li key={c.event}>
                      <span className="font-medium">{chipLabel(c.chip) ?? c.chip}</span>{" "}
                      <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                        GW{c.event}
                      </span>
                      {c.earned !== null ? (
                        <span className="ml-2 tabular-nums text-emerald-600 dark:text-primary">
                          {signed(c.earned, 0)} pts
                        </span>
                      ) : (
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{c.why}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* --------------------------------------------------- rank */}
            <div className={`${CARD} w-full lg:w-[calc(50%-0.5rem)]`}>
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Rank progression
              </h3>
              <div className="mt-3">
                <RankArc points={data.rank} />
                {data.rank.filter((r) => r.overallRank !== null).length < 2 && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Two scored gameweeks are needed before there is an arc to draw.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
