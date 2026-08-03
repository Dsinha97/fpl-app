"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FixtureCell } from "@/components/fdr-badge";
import { FdrLegendContent, InfoTooltip } from "@/components/info-tooltip";

interface PlayerRow {
  id: number;
  code: number;
  web_name: string;
  team_id: number;
  element_type: number;
  now_cost: number | null;
  selected_by_percent: number | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
  penalties_order: number | null;
}

interface HistoryRow {
  player_code: number;
  total_points: number | null;
  minutes: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
}

interface RunCell {
  gw: number;
  opp: string;
  home: boolean;
  fdr: number;
}

interface XpRow {
  player_id: number;
  xp_1: number | null;
  xp_6: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not in squad",
};

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

type SortKey = "price" | "ownership" | "points" | "xg" | "xa" | "run" | "xp1" | "xp6" | "value";

const RUN_LENGTH = 5;

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [history, setHistory] = useState<Map<number, HistoryRow>>(new Map());
  const [teamShort, setTeamShort] = useState<Map<number, string>>(new Map());
  const [runs, setRuns] = useState<Map<number, RunCell[]>>(new Map());
  const [xp, setXp] = useState<Map<number, XpRow>>(new Map());
  const [historySeason, setHistorySeason] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<number | 0>(0);
  const [teamFilter, setTeamFilter] = useState<number | 0>(0);
  const [maxPrice, setMaxPrice] = useState<number>(160);
  const [sortKey, setSortKey] = useState<SortKey>("price");
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: gw, error: gwError } = await supabase
          .from("gameweeks")
          .select("season, id")
          .eq("is_next", true)
          .limit(1)
          .maybeSingle();
        if (gwError) throw new Error(gwError.message);
        if (!gw) throw new Error("No upcoming gameweek found.");

        const [playersRes, teamsRes, fixturesRes, latestSeasonRes] = await Promise.all([
          supabase
            .from("players")
            .select(
              "id, code, web_name, team_id, element_type, now_cost, selected_by_percent, status, news, chance_of_playing_next_round, penalties_order",
            )
            .eq("season", gw.season)
            .limit(1000),
          supabase.from("teams").select("id, short_name").eq("season", gw.season),
          supabase
            .from("fixtures")
            .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
            .eq("season", gw.season)
            .gte("event", gw.id)
            .lte("event", gw.id + RUN_LENGTH - 1),
          supabase
            .from("player_season_history")
            .select("season_name")
            .order("season_name", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (playersRes.error) throw new Error(playersRes.error.message);
        if (teamsRes.error) throw new Error(teamsRes.error.message);
        if (fixturesRes.error) throw new Error(fixturesRes.error.message);

        const latestSeason = latestSeasonRes.data?.season_name as string | undefined;
        let historyRows: HistoryRow[] = [];
        if (latestSeason) {
          const { data } = await supabase
            .from("player_season_history")
            .select("player_code, total_points, minutes, expected_goals, expected_assists")
            .eq("season_name", latestSeason)
            .limit(1000);
          historyRows = (data ?? []) as HistoryRow[];
          setHistorySeason(latestSeason);
        }

        const shorts = new Map<number, string>(
          (teamsRes.data ?? []).map((t) => [t.id as number, t.short_name as string]),
        );

        // Next-N fixture run per team.
        const runMap = new Map<number, RunCell[]>();
        for (const f of fixturesRes.data ?? []) {
          const add = (teamId: number, cell: RunCell) => {
            if (!runMap.has(teamId)) runMap.set(teamId, []);
            runMap.get(teamId)!.push(cell);
          };
          add(f.team_h as number, {
            gw: f.event as number,
            opp: shorts.get(f.team_a as number) ?? "?",
            home: true,
            fdr: (f.team_h_difficulty as number | null) ?? 3,
          });
          add(f.team_a as number, {
            gw: f.event as number,
            opp: shorts.get(f.team_h as number) ?? "?",
            home: false,
            fdr: (f.team_a_difficulty as number | null) ?? 3,
          });
        }
        for (const cells of runMap.values()) cells.sort((a, b) => a.gw - b.gw);

        const { data: xpRows } = await supabase
          .from("player_xp_horizons")
          .select("player_id, xp_1, xp_6")
          .eq("season", gw.season)
          .limit(1000);

        setPlayers((playersRes.data ?? []) as PlayerRow[]);
        setTeamShort(shorts);
        setRuns(runMap);
        setXp(new Map(((xpRows ?? []) as XpRow[]).map((r) => [r.player_id, r])));
        setHistory(new Map(historyRows.map((h) => [h.player_code, h])));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const avgFdr = (teamId: number): number | null => {
    const cells = runs.get(teamId);
    if (!cells || cells.length === 0) return null;
    return cells.reduce((a, c) => a + c.fdr, 0) / cells.length;
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    const rows = players.filter((p) => {
      if (q && !p.web_name.toLowerCase().includes(q)) return false;
      if (position !== 0 && p.element_type !== position) return false;
      if (teamFilter !== 0 && p.team_id !== teamFilter) return false;
      if ((p.now_cost ?? 0) > maxPrice) return false;
      return true;
    });

    const value = (p: PlayerRow): number => {
      const h = history.get(p.code);
      const x = xp.get(p.id);
      switch (sortKey) {
        case "xp1":
          return x?.xp_1 ?? -1;
        case "xp6":
          return x?.xp_6 ?? -1;
        case "value":
          // Points per million over the 6-gameweek horizon.
          return x?.xp_6 && p.now_cost ? (x.xp_6 / (p.now_cost / 10)) : -1;
        case "price":
          return p.now_cost ?? -1;
        case "ownership":
          return p.selected_by_percent ?? -1;
        case "points":
          return h?.total_points ?? -1;
        case "xg":
          return h?.expected_goals ?? -1;
        case "xa":
          return h?.expected_assists ?? -1;
        case "run":
          // Lower FDR is better, so invert for a consistent "desc = best" sort.
          return avgFdr(p.team_id) === null ? -99 : -avgFdr(p.team_id)!;
      }
    };

    rows.sort((a, b) => (sortDesc ? value(b) - value(a) : value(a) - value(b)));
    return rows.slice(0, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, history, runs, xp, search, position, teamFilter, maxPrice, sortKey, sortDesc]);

  const header = (label: string, key: SortKey) => (
    <th className="px-2 py-2">
      <button
        onClick={() => {
          if (sortKey === key) setSortDesc(!sortDesc);
          else {
            setSortKey(key);
            setSortDesc(true);
          }
        }}
        className={`uppercase tracking-wide transition-colors hover:text-purple-700 dark:hover:text-[#00FF87] ${
          sortKey === key ? "text-purple-800 dark:text-[#00FF87]" : ""
        }`}
      >
        {label}
        {sortKey === key ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  const teamOptions = [...teamShort.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Player Explorer
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        xP = model-projected points (next gameweek, and next 6){" "}
        {historySeason ? `· stats from ${historySeason}` : ""} · fixture run = next {RUN_LENGTH}{" "}
        gameweeks, green ring = home · top 100 shown
      </p>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search player…"
          className="w-44 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-zinc-900 outline-none focus:border-purple-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <select
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value={0}>All positions</option>
          {Object.entries(POSITIONS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(Number(e.target.value))}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value={0}>All teams</option>
          {teamOptions.map(([id, short]) => (
            <option key={id} value={id}>
              {short}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
          Max £{(maxPrice / 10).toFixed(1)}m
          <input
            type="range"
            min={40}
            max={160}
            step={5}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="accent-purple-800 dark:accent-[#00FF87]"
          />
        </label>
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading players…</p>}

      {!loading && !error && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2 uppercase tracking-wide">Player</th>
                <th className="px-2 py-2 uppercase tracking-wide">Team</th>
                <th className="px-2 py-2 uppercase tracking-wide">Pos</th>
                {header("Price", "price")}
                {header("xP GW", "xp1")}
                {header("xP 6", "xp6")}
                {header("xP/£m", "value")}
                {header("Own %", "ownership")}
                {header("Pts", "points")}
                {header("xG", "xg")}
                {header("xA", "xa")}
                <th className="px-2 py-2">
                  <span className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        if (sortKey === "run") setSortDesc(!sortDesc);
                        else {
                          setSortKey("run");
                          setSortDesc(true);
                        }
                      }}
                      className={`uppercase tracking-wide transition-colors hover:text-purple-700 dark:hover:text-[#00FF87] ${
                        sortKey === "run" ? "text-purple-800 dark:text-[#00FF87]" : ""
                      }`}
                    >
                      Next {RUN_LENGTH}
                      {sortKey === "run" ? (sortDesc ? " ↓" : " ↑") : ""}
                    </button>
                    <InfoTooltip align="right">
                      <FdrLegendContent />
                    </InfoTooltip>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const h = history.get(p.code);
                const run = runs.get(p.team_id) ?? [];
                const statusLabel = STATUS_LABEL[p.status ?? "a"] ?? p.status;
                return (
                  <tr
                    key={p.id}
                    className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-zinc-900 dark:text-zinc-200"
                  >
                    <td className="px-3 py-1.5">
                      <span className="font-medium">{p.web_name}</span>
                      {p.status && p.status !== "a" && (
                        <span
                          title={`${statusLabel}${p.news ? ` — ${p.news}` : ""}`}
                          className={`ml-1.5 rounded px-1 text-xs font-bold ${
                            p.status === "d"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                          }`}
                        >
                          {p.status === "d"
                            ? `${p.chance_of_playing_next_round ?? "?"}%`
                            : p.status.toUpperCase()}
                        </span>
                      )}
                      {p.penalties_order === 1 && (
                        <span
                          title="First-choice penalty taker"
                          className="ml-1.5 rounded bg-purple-100 px-1 text-xs font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                        >
                          P
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-zinc-500">{teamShort.get(p.team_id)}</td>
                    <td className="px-2 py-1.5 text-zinc-500">{POSITIONS[p.element_type]}</td>
                    <td className="px-2 py-1.5 tabular-nums">
                      £{((p.now_cost ?? 0) / 10).toFixed(1)}m
                    </td>
                    <td className="px-2 py-1.5 font-semibold tabular-nums text-purple-800 dark:text-[#00FF87]">
                      {xp.get(p.id)?.xp_1?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {xp.get(p.id)?.xp_6?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {(() => {
                        const x = xp.get(p.id)?.xp_6;
                        return x && p.now_cost ? (x / (p.now_cost / 10)).toFixed(2) : "—";
                      })()}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {p.selected_by_percent !== null ? `${p.selected_by_percent}%` : "—"}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{h?.total_points ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{h?.expected_goals ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{h?.expected_assists ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <span className="flex gap-1.5">
                        {run.map((c, i) => (
                          <FixtureCell
                            key={i}
                            opponent={c.opp}
                            home={c.home}
                            fdr={c.fdr}
                            gw={c.gw}
                            team={teamShort.get(p.team_id)}
                          />
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-zinc-500">
                    No players match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
