"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { InfoTooltip } from "@/components/info-tooltip";
import { chipLabel } from "@/lib/chip-plan";
import {
  loadFinishedEvents,
  loadGameweekReview,
  REVIEW_MODEL_NOTE,
  type GameweekReview,
} from "@/lib/gameweek-review";

interface PlayerRow {
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

export default function ReviewPage() {
  const { loading: authLoading, entryId: linkedEntryId } = useAuth();
  const [entryId, setEntryId] = useState<number | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const [events, setEvents] = useState<number[]>([]);
  const [event, setEvent] = useState<number | null>(null);
  const [players, setPlayers] = useState<Map<number, PlayerRow>>(new Map());
  const [review, setReview] = useState<GameweekReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `entryId === null` — that's a genuine "no manager
  // connected" outcome, not just "still resolving". Without this flag the
  // two are indistinguishable and a signed-out visitor with no saved
  // localStorage id gets stuck on "Loading…" forever.
  const [entryResolved, setEntryResolved] = useState(false);

  // Resolve the entry to review — signed-in claim wins, else the same
  // localStorage id every other page falls back to (CLAUDE.md: one
  // implementation of "which manager" — see app/team/page.tsx's identical
  // auto-connect order).
  useEffect(() => {
    if (authLoading) return;
    if (linkedEntryId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntryId(linkedEntryId);
      setEntryResolved(true);
      return;
    }
    const stored = typeof window !== "undefined" ? localStorage.getItem("fpl_manager_id") : null;
    setEntryId(stored ? Number(stored) : null);
    setEntryResolved(true);
  }, [authLoading, linkedEntryId]);

  // Season + which gameweeks are finished, once — the picker's own options.
  useEffect(() => {
    (async () => {
      try {
        const { data: gw, error: gwError } = await supabase
          .from("gameweeks")
          .select("season")
          .eq("is_next", true)
          .limit(1)
          .maybeSingle();
        if (gwError) throw new Error(gwError.message);
        if (!gw) throw new Error("No upcoming gameweek found.");
        setSeason(gw.season);

        const finished = await loadFinishedEvents(gw.season);
        setEvents(finished);
        setEvent(finished[0] ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
  }, []);

  // Player metadata for the season — id/name/position/club only, what this
  // page's own lookups need.
  useEffect(() => {
    if (!season) return;
    (async () => {
      const { data, error: playersError } = await supabase
        .from("players")
        .select("id, web_name, element_type, team_id")
        .eq("season", season)
        .limit(1000);
      if (playersError) {
        setError(playersError.message);
        return;
      }
      setPlayers(
        new Map((data ?? []).map((r) => [r.id as number, r as PlayerRow])),
      );
    })();
  }, [season]);

  const elementTypeOf = useMemo(
    () => (id: number) => players.get(id)?.element_type,
    [players],
  );
  const teamIdOf = useMemo(
    () => (id: number) => players.get(id)?.team_id,
    [players],
  );

  useEffect(() => {
    if (!season || !entryId || event === null || players.size === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const result = await loadGameweekReview(season, entryId, event, elementTypeOf, teamIdOf);
        setReview(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [season, entryId, event, players, elementTypeOf, teamIdOf]);

  if (authLoading || !entryResolved) {
    // Still resolving auth/localStorage — avoid a flash of the "no squad" state.
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </main>
    );
  }

  if (entryId === null) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Review</h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          No manager connected yet. Connect your squad on{" "}
          <Link href="/team" className="underline hover:text-purple-700 dark:hover:text-primary">
            My Team
          </Link>{" "}
          first, then come back here to review a gameweek.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Review</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            What that decision actually cost, gameweek by gameweek.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <select
              value={event ?? ""}
              onChange={(e) => setEvent(Number(e.target.value))}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
            >
              {events.map((e) => (
                <option key={e} value={e}>
                  Gameweek {e}
                </option>
              ))}
            </select>
          )}
          <InfoTooltip label="About these figures">{REVIEW_MODEL_NOTE}</InfoTooltip>
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

      {!loading && !error && events.length === 0 && (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          No gameweek has finished yet this season — there is nothing to review.
        </p>
      )}

      {!loading && !error && events.length > 0 && !review && (
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
                  ({review.captain.pickedRaw} pts × 2)
                </p>
                {review.captain.handedOver && (
                  <p>
                    Handed to vice-captain:{" "}
                    <span className="font-medium">{nameOf(players, review.captain.effectiveElement)}</span>{" "}
                    ({review.captain.effectiveRaw} pts × 2) — the picked captain didn&apos;t feature
                  </p>
                )}
                <p>
                  Best available:{" "}
                  <span className="font-medium">{nameOf(players, review.captain.bestElement)}</span>{" "}
                  ({review.captain.bestRaw} pts)
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {review.captain.gap === 0
                    ? "The best possible captain call, in hindsight."
                    : `−${review.captain.gap} pts vs the best available captain — not an achievable call in the moment.`}
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
    </main>
  );
}
