"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import { CountryFlag, flagCode, SeasonsBadge, TeamCrest } from "@/components/identity";

/** Separator between identity badges in the profile line. */
const Dot = () => <span className="text-zinc-300 dark:text-purple-700">•</span>;

// ---------------------------------------------------------------- types

interface ManagerRow {
  entry_id: number;
  team_name: string | null;
  first_name: string | null;
  last_name: string | null;
  region_name: string | null;
  region_iso: string | null;
  favourite_team: number | null;
  years_active: number | null;
  summary_overall_points: number | null;
  summary_overall_rank: number | null;
  summary_event_points: number | null;
  last_deadline_bank: number | null;
  last_deadline_value: number | null;
  synced_at: string;
}

interface SeasonRow {
  season_name: string;
  total_points: number | null;
  rank: number | null;
  rank_percentage: number | null;
}

interface GwRow {
  event: number;
  points: number | null;
  total_points: number | null;
  overall_rank: number | null;
  bank: number | null;
  value: number | null;
  points_on_bench: number | null;
  active_chip: string | null;
}

interface PickRow {
  event: number;
  position: number;
  element: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

interface PlayerRow {
  id: number;
  web_name: string | null;
  now_cost: number | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
  penalties_order: number | null;
  direct_freekicks_order: number | null;
  corners_and_indirect_freekicks_order: number | null;
  element_type: number;
  team_id: number;
}

interface NextGw {
  season: string;
  name: string;
  deadline_time: string;
}

interface TeamData {
  manager: ManagerRow;
  seasons: SeasonRow[];
  gwHistory: GwRow[];
  picks: PickRow[];
  players: Map<number, PlayerRow>;
  teamNames: Map<number, string>;
  teamMeta: Map<number, { code: number | null; short: string }>;
  nextGw: NextGw | null;
}

// -------------------------------------------------------------- helpers

const fmtMoney = (tenths: number | null | undefined, fallback = "—") =>
  tenths === null || tenths === undefined ? fallback : `£${(tenths / 10).toFixed(1)}m`;

const fmtNum = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString();

function fmtCountdown(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return "passed";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${days}d ${hours}h`;
}

const POSITION_LABELS: Record<number, string> = {
  1: "Goalkeepers",
  2: "Defenders",
  3: "Midfielders",
  4: "Forwards",
};

// ----------------------------------------------------------------- page

export default function TeamPage() {
  const [inputId, setInputId] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TeamData | null>(null);

  const connect = useCallback(async (entryId: number) => {
    setInputId(String(entryId));
    setLoading(true);
    setError(null);

    try {
      // 1. Ask the Edge Function to pull fresh data from FPL into Supabase.
      const { error: fnError } = await supabase.functions.invoke("sync-manager", {
        body: { entry_id: entryId },
      });

      if (fnError) {
        if (fnError instanceof FunctionsHttpError) {
          const body = await fnError.context.json().catch(() => null);
          throw new Error(body?.error ?? "sync failed");
        }
        throw fnError;
      }

      // 2. Read everything back from Supabase.
      const [managerRes, seasonsRes, gwRes, nextGwRes] = await Promise.all([
        supabase.from("managers").select("*").eq("entry_id", entryId).single(),
        supabase
          .from("manager_season_history")
          .select("season_name, total_points, rank, rank_percentage")
          .eq("entry_id", entryId)
          .order("season_name", { ascending: false }),
        supabase
          .from("manager_gameweek_history")
          .select("event, points, total_points, overall_rank, bank, value, points_on_bench, active_chip")
          .eq("entry_id", entryId)
          .order("event"),
        supabase
          .from("gameweeks")
          .select("season, name, deadline_time")
          .eq("is_next", true)
          .limit(1)
          .maybeSingle(),
      ]);

      if (managerRes.error) throw new Error(managerRes.error.message);
      const manager = managerRes.data as ManagerRow;
      const nextGw = (nextGwRes.data as NextGw | null) ?? null;

      // 3. Latest gameweek's picks, if any exist yet.
      const { data: allPicks } = await supabase
        .from("manager_picks")
        .select("event, position, element, multiplier, is_captain, is_vice_captain")
        .eq("entry_id", entryId)
        .order("event", { ascending: false })
        .order("position");

      const latestEvent = allPicks?.[0]?.event;
      const picks = (allPicks ?? []).filter((p) => p.event === latestEvent);

      // 4. Resolve player and team names for the squad + favourite team.
      const players = new Map<number, PlayerRow>();
      const teamNames = new Map<number, string>();
      const teamMeta = new Map<number, { code: number | null; short: string }>();

      if (nextGw) {
        const ids = picks.map((p) => p.element);
        if (ids.length > 0) {
          const { data: playerRows } = await supabase
            .from("players")
            .select(
              "id, web_name, now_cost, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order, element_type, team_id",
            )
            .eq("season", nextGw.season)
            .in("id", ids);
          for (const p of playerRows ?? []) players.set(p.id, p as PlayerRow);
        }

        const { data: teamRows } = await supabase
          .from("teams")
          .select("id, name, code, short_name")
          .eq("season", nextGw.season);
        for (const t of teamRows ?? []) {
          teamNames.set(t.id, t.name);
          teamMeta.set(t.id, { code: t.code ?? null, short: t.short_name });
        }
      }

      setData({
        manager,
        seasons: (seasonsRes.data as SeasonRow[]) ?? [],
        gwHistory: (gwRes.data as GwRow[]) ?? [],
        picks,
        players,
        teamNames,
        teamMeta,
        nextGw,
      });
      setSavedId(entryId);
      localStorage.setItem("fpl_manager_id", String(entryId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Restore the persisted Manager ID and auto-connect on first mount.
    // localStorage is only readable client-side, so an effect is the right
    // place despite the set-state-in-effect lint preference.
    const stored = localStorage.getItem("fpl_manager_id");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) void connect(Number(stored));
  }, [connect]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const id = Number(inputId.trim());
    if (Number.isInteger(id) && id > 0) void connect(id);
    else setError("Enter your numeric FPL Manager ID (from your team page URL).");
  };

  const m = data?.manager;
  const seasonStarted = (data?.gwHistory.length ?? 0) > 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      {/* ------------------------------------------------ connect form */}
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
        <label htmlFor="manager-id" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          FPL Manager ID
        </label>
        <input
          id="manager-id"
          value={inputId}
          onChange={(e) => setInputId(e.target.value)}
          inputMode="numeric"
          placeholder="e.g. 1234567"
          className="w-40 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus:border-[#00FF87]"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-purple-950 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-800 disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
        >
          {loading ? "Syncing…" : savedId ? "Refresh" : "Connect"}
        </button>
        <span className="text-xs text-zinc-500">
          Find it in your team&apos;s URL on fantasy.premierleague.com
        </span>
      </form>

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {m && (
        <>
          {/* ------------------------------------------------- profile */}
          <section className="mt-8">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {m.team_name ?? `Entry ${m.entry_id}`}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="font-semibold text-zinc-900 dark:text-white">
                {[m.first_name, m.last_name].filter(Boolean).join(" ")}
              </span>

              {m.region_name && flagCode(m.region_iso) && (
                <>
                  <Dot />
                  <span
                    className="flex items-center gap-1.5"
                    title={m.region_name}
                  >
                    <CountryFlag
                      regionIso={m.region_iso}
                      countryName={m.region_name}
                      className="h-4 w-6"
                    />
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-purple-300">
                      {m.region_name}
                    </span>
                  </span>
                </>
              )}

              {m.favourite_team !== null && data?.teamNames.get(m.favourite_team) && (
                <>
                  <Dot />
                  <span
                    className="flex items-center gap-1.5"
                    title={`Supports ${data.teamNames.get(m.favourite_team)}`}
                  >
                    <TeamCrest
                      teamCode={data.teamMeta.get(m.favourite_team)?.code ?? null}
                      shortName={data.teamMeta.get(m.favourite_team)?.short ?? null}
                      className="h-6 w-5"
                    />
                    <span className="text-xs font-semibold text-zinc-600 dark:text-purple-300">
                      {data.teamNames.get(m.favourite_team)}
                    </span>
                  </span>
                </>
              )}

              {m.years_active !== null && m.years_active > 0 && (
                <>
                  <Dot />
                  <span className="flex items-center gap-1.5">
                    <SeasonsBadge seasons={m.years_active} className="h-6 w-6" />
                    <span className="text-xs font-semibold text-zinc-600 dark:text-purple-300">
                      {m.years_active} season{m.years_active === 1 ? "" : "s"}
                    </span>
                  </span>
                </>
              )}
            </div>
          </section>

          {/* --------------------------------------------------- tiles */}
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              {
                label: "Team Value",
                value: fmtMoney(m.last_deadline_value, seasonStarted ? "—" : "£100.0m"),
              },
              {
                label: "In the Bank",
                value: fmtMoney(m.last_deadline_bank, seasonStarted ? "—" : "£0.0m"),
              },
              { label: "Overall Points", value: fmtNum(m.summary_overall_points) },
              { label: "Overall Rank", value: fmtNum(m.summary_overall_rank) },
              { label: "GW Points", value: fmtNum(m.summary_event_points) },
              {
                label: data?.nextGw ? `${data.nextGw.name} Deadline` : "Next Deadline",
                value: data?.nextGw ? fmtCountdown(data.nextGw.deadline_time) : "—",
              },
            ].map((tile) => (
              <div
                key={tile.label}
                className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-purple-900/40 dark:bg-[#1E0234]"
              >
                <div className="text-xs text-zinc-500">{tile.label}</div>
                <div className="mt-1 text-lg font-semibold text-purple-900 dark:text-[#00FF87]">
                  {tile.value}
                </div>
              </div>
            ))}
          </section>

          {/* --------------------------------------------------- squad */}
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Squad</h2>
            {data && data.picks.length > 0 ? (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {[1, 2, 3, 4].map((type) => {
                  const rows = data.picks.filter(
                    (p) => data.players.get(p.element)?.element_type === type,
                  );
                  if (rows.length === 0) return null;
                  return (
                    <div
                      key={type}
                      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]"
                    >
                      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        {POSITION_LABELS[type]}
                      </h3>
                      <ul className="mt-2 space-y-1.5">
                        {rows.map((p) => {
                          const player = data.players.get(p.element);
                          const bench = p.position >= 12;
                          return (
                            <li
                              key={p.position}
                              className={`flex items-center justify-between text-sm ${
                                bench ? "text-zinc-400" : "text-zinc-800 dark:text-zinc-200"
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                {player?.web_name ?? `#${p.element}`}
                                <AvailabilityBadge
                                  status={player?.status}
                                  chanceOfPlaying={player?.chance_of_playing_next_round}
                                  news={player?.news}
                                />
                                <RoleBadges
                                  penaltyOrder={player?.penalties_order}
                                  freeKickOrder={player?.direct_freekicks_order}
                                  cornerOrder={player?.corners_and_indirect_freekicks_order}
                                />
                                {p.is_captain && (
                                  <span className="rounded bg-purple-950 px-1 text-xs font-bold text-white dark:bg-[#00FF87] dark:text-slate-950">
                                    C
                                  </span>
                                )}
                                {p.is_vice_captain && (
                                  <span className="rounded border border-purple-700 px-1 text-xs font-bold text-purple-800 dark:border-[#00FF87]/60 dark:text-[#00FF87]">
                                    V
                                  </span>
                                )}
                                {bench && <span className="text-xs">(bench)</span>}
                              </span>
                              <span className="tabular-nums text-zinc-500">
                                {fmtMoney(player?.now_cost)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500 dark:border-purple-800/50 dark:bg-[#1E0234]">
                Squad picks are published by FPL after the first deadline
                {data?.nextGw
                  ? ` — ${data.nextGw.name} locks ${new Date(
                      data.nextGw.deadline_time,
                    ).toLocaleString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : ""}
                . Your team will appear here automatically once the season starts.
              </p>
            )}
          </section>

          {/* ---------------------------------------- gameweek history */}
          {seasonStarted && data && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                This Season
              </h2>
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                      <th className="px-3 py-2">GW</th>
                      <th className="px-3 py-2">Points</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2">Overall Rank</th>
                      <th className="px-3 py-2">Bench</th>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2">Chip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.gwHistory.map((g) => (
                      <tr
                        key={g.event}
                        className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200"
                      >
                        <td className="px-3 py-2 tabular-nums">{g.event}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtNum(g.points)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtNum(g.total_points)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtNum(g.overall_rank)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtNum(g.points_on_bench)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtMoney(g.value)}</td>
                        <td className="px-3 py-2">{g.active_chip ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* -------------------------------------------- past seasons */}
          {data && data.seasons.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                Past Seasons
              </h2>
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                      <th className="px-3 py-2">Season</th>
                      <th className="px-3 py-2">Points</th>
                      <th className="px-3 py-2">Rank</th>
                      <th className="px-3 py-2">Percentile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.seasons.map((s) => (
                      <tr
                        key={s.season_name}
                        className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200"
                      >
                        <td className="px-3 py-2">{s.season_name}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtNum(s.total_points)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtNum(s.rank)}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {s.rank_percentage !== null ? `Top ${s.rank_percentage}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="mt-8 text-xs text-zinc-400">
            Last synced {new Date(m.synced_at).toLocaleString()} · read-only via the official FPL
            API · Manager ID {m.entry_id}
          </p>
        </>
      )}

      {!m && !loading && !error && (
        <div className="mt-16 text-center text-sm text-zinc-500">
          <p className="text-base font-medium text-zinc-700 dark:text-zinc-300">
            Connect your FPL team
          </p>
          <p className="mt-2">
            Enter your Manager ID above — it&apos;s the number in the URL when you view your
            points page on the FPL site: <br />
            <code className="mt-1 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-[#2A0A45]">
              fantasy.premierleague.com/entry/<b>1234567</b>/event/1
            </code>
          </p>
        </div>
      )}
    </main>
  );
}
