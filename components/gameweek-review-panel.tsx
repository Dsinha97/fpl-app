"use client";

import { useEffect, useMemo, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { chipLabel } from "@/lib/chip-plan";
import {
  loadGameweekReview,
  REVIEW_MODEL_NOTE,
  type GameweekReview,
} from "@/lib/gameweek-review";

/** The shape this panel reads. `/team`'s own player map is a superset. */
export interface PlayerRow {
  id: number;
  web_name: string | null;
  element_type: number;
  team_id: number;
}

function nameOf(players: Map<number, PlayerRow>, element: number): string {
  return players.get(element)?.web_name ?? `#${element}`;
}

/** FPL's own "top X%" convention, lower is better — see GwHistoryRow's doc comment. */
function fmtPercentileRank(p: number | null): string {
  if (p === null) return "—";
  return `top ${p}%`;
}

/**
 * One finished gameweek's post-mortem — points and rank movement, the captain
 * call, what the bench cost, and the transfers that led into it.
 *
 * Sprint 33 moved this off `/review` and onto `/team`, under the gameweek
 * selector. `/team`'s selector was already a past-gameweek view; `/review`
 * was the same question asked on a second page with a second event picker
 * that could disagree with the first. Now there is one picker, and this
 * renders beneath it whenever the selected gameweek is finished.
 *
 * Entry, season, event and player metadata all come in as props — the host
 * has resolved every one of them already, and `players` in particular saves
 * a duplicate 1000-row read of a map `/team` is holding anyway.
 */
export function GameweekReviewPanel({
  season,
  entryId,
  event,
  players,
}: {
  season: string;
  entryId: number;
  /** Must be a *finished* gameweek — the caller gates on that. */
  event: number;
  /** player id -> the four fields this panel's lookups need. */
  players: Map<number, PlayerRow>;
}) {
  const [review, setReview] = useState<GameweekReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const elementTypeOf = useMemo(() => (id: number) => players.get(id)?.element_type, [players]);
  const teamIdOf = useMemo(() => (id: number) => players.get(id)?.team_id, [players]);

  useEffect(() => {
    if (players.size === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    (async () => {
      try {
        setReview(await loadGameweekReview(season, entryId, event, elementTypeOf, teamIdOf));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [season, entryId, event, players, elementTypeOf, teamIdOf]);

  return (
    <section>
      {/* No event picker here — /team's gameweek selector is the one picker,
          and this only renders for a finished gameweek. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Review</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            What that decision actually cost.
          </p>
        </div>
        <InfoTooltip label="About these figures">{REVIEW_MODEL_NOTE}</InfoTooltip>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && !error && (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      )}

      {!loading && !error && !review && (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          No picks are recorded for this manager in gameweek {event}.
        </p>
      )}

      {review && (
        <div className="mt-6 flex flex-col gap-5">
          {/* 1. Points and rank movement */}
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Gameweek {review.event}
            </h2>
            {review.history ? (
              <>
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {review.history.points ?? "—"} pts
                  {review.history.eventTransfersCost ? (
                    <> − {review.history.eventTransfersCost} hit</>
                  ) : null}
                  {" "}· overall rank{" "}
                  {review.history.overallRank?.toLocaleString() ?? "—"}
                  {review.previousHistory?.overallRank != null &&
                  review.history.overallRank != null ? (
                    <span
                      className={
                        review.history.overallRank < review.previousHistory.overallRank
                          ? "text-green-700 dark:text-green-400"
                          : review.history.overallRank > review.previousHistory.overallRank
                          ? "text-red-700 dark:text-red-400"
                          : "text-zinc-500"
                      }
                    >
                      {" "}
                      (
                      {review.history.overallRank < review.previousHistory.overallRank ? "▲" : "▼"}{" "}
                      {Math.abs(
                        review.history.overallRank - review.previousHistory.overallRank,
                      ).toLocaleString()}
                      )
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {fmtPercentileRank(review.history.percentileRank)} of the field this gameweek
                  {review.history.activeChip ? ` · ${chipLabel(review.history.activeChip)} played` : ""}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                No manager_gameweek_history row synced for this event yet.
              </p>
            )}
          </section>

          {/* 2. Captain */}
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Captain</h2>
            {review.captain ? (
              <div className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                <p>
                  Picked: <span className="font-medium">{nameOf(players, review.captain.pickedElement)}</span>{" "}
                  ({review.captain.pickedRaw} pts × {review.captain.multiplier})
                </p>
                {review.captain.handedOver && (
                  <p>
                    Handed to vice-captain:{" "}
                    <span className="font-medium">{nameOf(players, review.captain.effectiveElement)}</span>{" "}
                    ({review.captain.effectiveRaw} pts × {review.captain.multiplier}) — the picked
                    captain didn&apos;t feature
                  </p>
                )}
                <p>
                  Best available:{" "}
                  <span className="font-medium">{nameOf(players, review.captain.bestElement)}</span>{" "}
                  ({review.captain.bestRaw} pts)
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {review.captain.wasBest
                    ? "The best possible captain call, in hindsight."
                    : `−${review.captain.gapEffective} pts vs the best available captain (${review.captain.gapRaw} raw × ${review.captain.multiplier - 1}) — not an achievable call in the moment.`}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No captain recorded.</p>
            )}
          </section>

          {/* 3. Bench */}
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Bench</h2>
            <div className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
              <p>Recovered by auto-subs (projected): {review.bench.recovered} pts</p>
              <p>Still stranded on the bench: {review.bench.stranded} pts</p>
              {review.bench.fplPointsOnBench !== null && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  FPL&apos;s own points_on_bench: {review.bench.fplPointsOnBench} — see the note above
                  for why this app&apos;s auto-sub projection can disagree.
                </p>
              )}
            </div>
          </section>

          {/* 4. Transfers */}
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Transfers</h2>
            {review.transfers.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {review.transfers.map((t, i) => (
                  <li key={i}>
                    {nameOf(players, t.elementOut)} → {nameOf(players, t.elementIn)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                No transfer records have synced for this manager yet (0 rows in manager_transfers) —
                this is not the same as &quot;no transfers were made&quot;, only that this app has no
                record of them.
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
