"use client";

// Sprint 29.1 — mini-league effective ownership. The engine
// (lib/ownership.ts) and the pipeline (supabase/functions/sync-league-picks)
// both shipped in Sprint 10's exact slice; docs/roadmap.md records honestly
// that nothing rendered them and sync-league-picks had never once been
// invoked from the app. This page is that wiring — no new maths.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase/client";
import { InfoTooltip } from "@/components/info-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { ManagerLeagues, type ManagerLeagueRow } from "@/components/manager-leagues";
import {
  loadLeagueEntryPicks,
  loadLeagueStandings,
  syncLeaguePicks,
  type LeagueStandingRow,
} from "@/lib/leagues";
import {
  computeLeagueOwnership,
  differentialScore,
  rankGain,
  OWNERSHIP_MODEL_NOTE,
  UPSIDE_MODEL_NOTE,
  type PlayerOwnership,
} from "@/lib/ownership";

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

const card = "rounded-lg border border-zinc-200 bg-card p-4 dark:border-purple-900/40";
const cardSupporting =
  "rounded-lg border border-zinc-200 bg-card-supporting p-3 dark:border-card-supporting-border";

interface PlayerMeta {
  webName: string;
  teamShort: string;
  elementType: number;
  nowCost: number;
  xp1: number | null;
  expectedMinutes: number | null;
  startProbability: number | null;
  availability: number;
}

export default function LeaguesPage() {
  const { user, loading: authLoading, entryId: linkedEntryId } = useAuth();
  const [entryId, setEntryId] = useState<number | null>(null);

  // Same resolution order /team uses: signed-in claimed entry wins, else the
  // localStorage id from a prior /team connect.
  useEffect(() => {
    if (authLoading) return;
    if (linkedEntryId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntryId(linkedEntryId);
      return;
    }
    const stored = localStorage.getItem("fpl_manager_id");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setEntryId(Number(stored));
  }, [authLoading, linkedEntryId, user]);

  const [leagues, setLeagues] = useState<ManagerLeagueRow[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState(true);
  const [season, setSeason] = useState<string>("");
  const [currentEvent, setCurrentEvent] = useState<number | null>(null);

  useEffect(() => {
    if (!entryId) return;
    (async () => {
      setLeaguesLoading(true);
      const [{ data: gw }, { data: rows }] = await Promise.all([
        supabase.from("gameweeks").select("season, id").eq("is_current", true).limit(1).maybeSingle(),
        supabase
          .from("manager_leagues")
          .select("league_id, name, league_type, entry_rank, entry_last_rank, rank_count")
          .eq("entry_id", entryId)
          .order("name"),
      ]);
      if (gw) {
        setSeason(gw.season as string);
        setCurrentEvent(gw.id as number);
      }
      setLeagues((rows ?? []) as ManagerLeagueRow[]);
      setLeaguesLoading(false);
    })();
  }, [entryId]);

  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null);
  const selectedLeague = leagues.find((l) => l.league_id === selectedLeagueId) ?? null;

  const [standings, setStandings] = useState<LeagueStandingRow[]>([]);
  const [ownership, setOwnership] = useState<Map<number, PlayerOwnership>>(new Map());
  const [myElements, setMyElements] = useState<Set<number>>(new Set());
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [players, setPlayers] = useState<Map<number, PlayerMeta>>(new Map());

  const loadLeagueData = useCallback(async () => {
    if (!selectedLeagueId || !season || !currentEvent) return;
    setDataLoading(true);
    setDataError(null);
    try {
      const standingRows = await loadLeagueStandings(season, selectedLeagueId);
      setStandings(standingRows);
      if (standingRows.length === 0) {
        setOwnership(new Map());
        return;
      }
      const picks = await loadLeagueEntryPicks(
        season,
        standingRows.map((s) => s.entryId),
        currentEvent,
      );
      setOwnership(computeLeagueOwnership(picks, standingRows.length));
      setMyElements(
        new Set(picks.filter((p) => p.entryId === entryId).map((p) => p.element)),
      );
    } catch (err) {
      setDataError(err instanceof Error ? err.message : String(err));
    } finally {
      setDataLoading(false);
    }
  }, [selectedLeagueId, season, currentEvent, entryId]);

  useEffect(() => {
    // loadLeagueData sets state itself (it's an async fetch, not a plain
    // synchronous setState-in-effect) — the lint rule can't see through the
    // callback boundary, same pattern as elsewhere in this codebase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLeagueData();
  }, [loadLeagueData]);

  // Player metadata for the EO table — xP1/minutes for the same event the
  // picks are for, so "differential" is comparing like with like.
  useEffect(() => {
    if (!season || !currentEvent) return;
    (async () => {
      const [playersRes, teamsRes, xpRes, predRes] = await Promise.all([
        supabase
          .from("players")
          .select("id, web_name, team_id, element_type, now_cost, status, chance_of_playing_next_round")
          .eq("season", season)
          .limit(1000),
        supabase.from("teams").select("id, short_name").eq("season", season),
        supabase.from("player_xp_horizons").select("player_id, xp_1").eq("season", season).limit(1000),
        supabase
          .from("player_predictions")
          .select("player_id, expected_minutes, start_probability")
          .eq("season", season)
          .eq("event", currentEvent)
          .limit(1000),
      ]);
      const shorts = new Map((teamsRes.data ?? []).map((t) => [t.id as number, t.short_name as string]));
      const xpById = new Map((xpRes.data ?? []).map((r) => [r.player_id as number, r.xp_1 as number | null]));
      const predById = new Map(
        (predRes.data ?? []).map((r) => [
          r.player_id as number,
          { m: r.expected_minutes as number | null, s: r.start_probability as number | null },
        ]),
      );
      const byId = new Map<number, PlayerMeta>();
      for (const p of playersRes.data ?? []) {
        const id = p.id as number;
        const pred = predById.get(id);
        const chance = p.chance_of_playing_next_round as number | null;
        const availability = chance !== null && chance !== undefined ? chance / 100 : p.status === "a" ? 1 : 0;
        byId.set(id, {
          webName: p.web_name as string,
          teamShort: shorts.get(p.team_id as number) ?? "—",
          elementType: p.element_type as number,
          nowCost: (p.now_cost as number | null) ?? 0,
          xp1: xpById.get(id) ?? null,
          expectedMinutes: pred?.m ?? null,
          startProbability: pred?.s ?? null,
          availability,
        });
      }
      setPlayers(byId);
    })();
  }, [season, currentEvent]);

  const handleSync = async () => {
    if (!selectedLeagueId || !currentEvent) return;
    setSyncing(true);
    setSyncMessage(null);
    const result = await syncLeaguePicks(selectedLeagueId, currentEvent);
    setSyncing(false);
    if (!result.ok) {
      setSyncMessage(`Sync failed: ${result.error}`);
      return;
    }
    setSyncMessage(
      `Synced ${result.entries} entries${result.capped ? " (capped)" : ""} — ${result.picksWritten} new, ${result.picksReused} already up to date${result.picksFailed ? `, ${result.picksFailed} failed` : ""}.`,
    );
    await loadLeagueData();
  };

  const eoRows = useMemo(() => {
    const rows = [...ownership.values()].map((o) => {
      const meta = players.get(o.element);
      const xp = meta?.xp1 ?? 0;
      const minutesProbability = meta?.startProbability ?? meta?.availability ?? 0;
      return {
        ...o,
        meta,
        differential: differentialScore(xp, o.eo, minutesProbability),
        rankGain: rankGain(xp, o.eo),
        youOwn: myElements.has(o.element),
      };
    });
    rows.sort((a, b) => b.eo - a.eo);
    return rows;
  }, [ownership, players, myElements]);

  if (authLoading) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Spinner />
      </main>
    );
  }

  if (!entryId) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">Leagues</h1>
        <p className="mt-4 text-sm text-zinc-500">
          Connect your FPL team on{" "}
          <a href="/team/" className="underline-offset-2 hover:underline">
            My Team
          </a>{" "}
          first — this page reads your classic leagues from there.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold">Leagues</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Real effective ownership for your mini-leagues — exact for the league, not the game.
      </p>

      <div className="mt-6">
        {leaguesLoading ? (
          <Spinner />
        ) : leagues.length === 0 ? (
          <p className={`${cardSupporting} text-sm text-zinc-500`}>
            No leagues found for this entry yet — leagues sync automatically when you connect on{" "}
            <a href="/team/" className="underline-offset-2 hover:underline">
              My Team
            </a>
            .
          </p>
        ) : (
          <ManagerLeagues leagues={leagues} onSelect={setSelectedLeagueId} selectedLeagueId={selectedLeagueId} />
        )}
      </div>

      {selectedLeagueId && (
        <section className={`${card} mt-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{selectedLeague?.name ?? `League ${selectedLeagueId}`}</h2>
              {currentEvent && (
                <p className="text-xs text-zinc-500">
                  Gameweek {currentEvent} picks
                  {selectedLeague?.rank_count
                    ? ` · top ${standings.length.toLocaleString()} of ${selectedLeague.rank_count.toLocaleString()} entries`
                    : standings.length > 0
                      ? ` · ${standings.length.toLocaleString()} entries`
                      : ""}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing && <Spinner className="h-3.5 w-3.5" />}
              {syncing ? "Syncing…" : "Sync this league"}
            </button>
          </div>

          {syncMessage && <p className="mt-2 text-xs text-zinc-500">{syncMessage}</p>}
          {dataError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{dataError}</p>}

          {dataLoading ? (
            <div className="mt-4">
              <Spinner />
            </div>
          ) : standings.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">
              This league&apos;s picks haven&apos;t been synced yet. Sync above to pull standings and every
              member&apos;s gameweek {currentEvent} picks — this can take a little while for a large league.
            </p>
          ) : eoRows.length === 0 ? (
            // Standings can be synced (from manager_leagues' own sync) without picks ever having
            // been pulled for this specific gameweek — a blank table with headers and no rows
            // reads as broken, not as "nothing to show yet" (CLAUDE.md: empty result sets say so).
            <p className="mt-4 text-sm text-zinc-500">
              Standings are in, but nobody&apos;s gameweek {currentEvent} picks have been synced yet.
              Sync above to pull every member&apos;s picks and compute effective ownership.
            </p>
          ) : (
            <>
              <p className="mt-3 text-xs text-zinc-500">
                <InfoTooltip label="What does effective ownership mean here?">
                  <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{OWNERSHIP_MODEL_NOTE}</p>
                </InfoTooltip>{" "}
                Effective ownership (EO) counts a captain twice and a bench pick zero — it can exceed 100% if
                several members captain the same player.{" "}
                <InfoTooltip label="What is Upside?">
                  <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{UPSIDE_MODEL_NOTE}</p>
                </InfoTooltip>
              </p>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                      <th className="py-2 pr-2">Player</th>
                      <th className="px-2 py-2">Team</th>
                      <th className="px-2 py-2">Pos</th>
                      <th className="px-2 py-2">Owners</th>
                      <th className="px-2 py-2">Own %</th>
                      <th className="px-2 py-2">Captains</th>
                      <th className="px-2 py-2">EO</th>
                      <th className="px-2 py-2">You?</th>
                      <th className="px-2 py-2">xP GW</th>
                      <th className="px-2 py-2">Differential</th>
                      <th className="px-2 py-2">Rank gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eoRows.map((row) => (
                      <tr
                        key={row.element}
                        className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200"
                      >
                        <td className="py-1.5 pr-2 font-medium">{row.meta?.webName ?? `#${row.element}`}</td>
                        <td className="px-2 py-1.5 text-zinc-500">{row.meta?.teamShort ?? "—"}</td>
                        <td className="px-2 py-1.5 text-zinc-500">
                          {row.meta ? POSITIONS[row.meta.elementType] : "—"}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {row.owners}/{standings.length}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{(row.ownershipPct * 100).toFixed(1)}%</td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {row.captains}
                          {row.tripleCaptains > 0 ? ` (+${row.tripleCaptains} TC)` : ""}
                        </td>
                        <td className="px-2 py-1.5 font-semibold tabular-nums text-purple-800 dark:text-primary">
                          {(row.eo * 100).toFixed(0)}%
                        </td>
                        <td className="px-2 py-1.5">{row.youOwn ? "✓" : ""}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.meta?.xp1?.toFixed(1) ?? "—"}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.differential.toFixed(1)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.rankGain.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
