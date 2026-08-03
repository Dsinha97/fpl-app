"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FixtureCell } from "@/components/fdr-badge";
import { FdrLegendContent, InfoTooltip } from "@/components/info-tooltip";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import { supabase } from "@/lib/supabase/client";
import {
  comparePlayers,
  COMPARISON_MODEL_NOTE,
  RISK_MODEL_NOTE,
  fixtureScore,
  riskScore,
  valuePerMillion,
  type ScoredPlayer,
} from "@/lib/scoring";
import {
  HORIZONS,
  horizonLabel,
  horizonLength,
  SEASON_HORIZON_NOTE,
  type Horizon,
} from "@/lib/team-state";
import { fullName, matchesPlayerQuery } from "@/lib/player-search";

interface PlayerRow {
  id: number;
  web_name: string;
  first_name: string | null;
  second_name: string | null;
  known_name: string | null;
  team_id: number;
  element_type: number;
  now_cost: number | null;
  selected_by_percent: number | null;
  points_per_game: number | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
  penalties_order: number | null;
  direct_freekicks_order: number | null;
  corners_and_indirect_freekicks_order: number | null;
}

interface UpcomingFixture {
  event: number;
  opponent_short_name: string;
  is_home: boolean;
  fdr: number;
}

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

const MAX_COMPARE = 4;
const FIXTURE_GWS = 8;

/** Higher is better for every metric except risk and price. */
type Direction = "high" | "low";

export default function ComparePage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [rowById, setRowById] = useState<Map<number, PlayerRow>>(new Map());
  const [scored, setScored] = useState<Map<number, ScoredPlayer>>(new Map());
  const [upcoming, setUpcoming] = useState<Map<number, UpcomingFixture[]>>(new Map());
  const [teamShort, setTeamShort] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<number[]>([]);
  const [horizon, setHorizon] = useState<Horizon>(5);
  const [search, setSearch] = useState("");

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

        const [playersRes, teamsRes, xpRes, predsRes, fixturesRes] = await Promise.all([
          supabase
            .from("players")
            .select(
              "id, web_name, first_name, second_name, known_name, team_id, element_type, now_cost, selected_by_percent, points_per_game, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order",
            )
            .eq("season", gw.season)
            .limit(1000),
          supabase.from("teams").select("id, short_name").eq("season", gw.season),
          supabase
            .from("player_xp_horizons")
            .select("player_id, xp_1, xp_3, xp_5, xp_8, xp_total")
            .eq("season", gw.season)
            .limit(1000),
          supabase
            .from("player_predictions")
            .select("player_id, expected_minutes, start_probability")
            .eq("season", gw.season)
            .eq("event", gw.id)
            .limit(1000),
          supabase
            .from("fixtures")
            .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
            .eq("season", gw.season)
            .gte("event", gw.id)
            .lte("event", gw.id + FIXTURE_GWS - 1)
            .order("event"),
        ]);
        if (playersRes.error) throw new Error(playersRes.error.message);

        const shorts = new Map(
          (teamsRes.data ?? []).map((t) => [t.id as number, t.short_name as string]),
        );

        const fixtures = new Map<number, UpcomingFixture[]>();
        const push = (teamId: number, f: UpcomingFixture) => {
          const list = fixtures.get(teamId);
          if (list) list.push(f);
          else fixtures.set(teamId, [f]);
        };
        for (const f of fixturesRes.data ?? []) {
          push(f.team_h as number, {
            event: f.event as number,
            opponent_short_name: shorts.get(f.team_a as number) ?? "?",
            is_home: true,
            fdr: (f.team_h_difficulty as number | null) ?? 3,
          });
          push(f.team_a as number, {
            event: f.event as number,
            opponent_short_name: shorts.get(f.team_h as number) ?? "?",
            is_home: false,
            fdr: (f.team_a_difficulty as number | null) ?? 3,
          });
        }

        const xpById = new Map(
          (xpRes.data ?? []).map((r) => [r.player_id as number, r as Record<string, number | null>]),
        );
        const predById = new Map(
          (predsRes.data ?? []).map((r) => [
            r.player_id as number,
            r as { expected_minutes: number | null; start_probability: number | null },
          ]),
        );

        const rows = (playersRes.data ?? []) as PlayerRow[];
        const scoredMap = new Map<number, ScoredPlayer>();
        for (const p of rows) {
          const x = xpById.get(p.id);
          const pred = predById.get(p.id);
          const availability =
            p.chance_of_playing_next_round !== null
              ? Math.max(0, Math.min(1, p.chance_of_playing_next_round / 100))
              : p.status === "a"
                ? 1
                : 0;
          scoredMap.set(p.id, {
            id: p.id,
            webName: p.web_name,
            elementType: p.element_type,
            teamId: p.team_id,
            teamShort: shorts.get(p.team_id) ?? null,
            price: p.now_cost ?? 0,
            ownership: p.selected_by_percent,
            pointsPerGame: p.points_per_game,
            xp: {
              1: x?.xp_1 ?? null,
              3: x?.xp_3 ?? null,
              5: x?.xp_5 ?? null,
              8: x?.xp_8 ?? null,
              season: x?.xp_total ?? null,
            },
            expectedMinutes: pred?.expected_minutes ?? null,
            startProbability: pred?.start_probability ?? null,
            availability,
            fdrRun: (fixtures.get(p.team_id) ?? []).map((f) => f.fdr),
          });
        }

        setPlayers(rows);
        setRowById(new Map(rows.map((p) => [p.id, p])));
        setScored(scoredMap);
        setUpcoming(fixtures);
        setTeamShort(shorts);

        // Seed from ?ids= so the builder can deep-link a target plus candidates.
        const ids = new URLSearchParams(window.location.search)
          .get("ids")
          ?.split(",")
          .map(Number)
          .filter((n) => Number.isInteger(n) && scoredMap.has(n))
          .slice(0, MAX_COMPARE);
        if (ids && ids.length > 0) setSelected(ids);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const chosen = useMemo(
    () => selected.flatMap((id) => (scored.has(id) ? [scored.get(id)!] : [])),
    [selected, scored],
  );

  const ranked = useMemo(() => comparePlayers(chosen, horizon), [chosen, horizon]);

  const add = useCallback(
    (id: number) => {
      setSelected((prev) =>
        prev.includes(id) || prev.length >= MAX_COMPARE ? prev : [...prev, id],
      );
      setSearch("");
    },
    [],
  );

  const suggestions = useMemo(() => {
    const q = search.trim();
    if (q.length < 2) return [];
    return players
      .filter((p) => matchesPlayerQuery(p, q) && !selected.includes(p.id))
      .slice(0, 8);
  }, [search, players, selected]);

  /** Best value in a row, for highlighting. */
  const bestOf = (values: (number | null)[], dir: Direction): number | null => {
    const nums = values.filter((v): v is number => v !== null);
    if (nums.length === 0) return null;
    return dir === "high" ? Math.max(...nums) : Math.min(...nums);
  };

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
      label: "Owned",
      dir: "high",
      value: (p) => p.ownership,
      format: (v) => (v === null ? "—" : `${v}%`),
    },
    {
      label: "PPG (last season)",
      dir: "high",
      value: (p) => p.pointsPerGame,
      format: (v) => (v === null ? "—" : v.toFixed(1)),
      hint: "Points per game in the last completed season — shown because FPL zeroes form pre-season",
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
      value: (p) => fixtureScore(p, horizon),
      format: (v) => (v === null ? "—" : `${Math.round(v * 100)}%`),
      hint: "Mean official FDR over the horizon, mapped so 100% is the kindest run",
    },
    {
      label: "Risk",
      dir: "low",
      value: (p) => riskScore(p, horizon),
      format: (v) => (v === null ? "—" : v.toString()),
      hint: "0.35 rotation + 0.30 injury + 0.20 minutes uncertainty + 0.15 fixture variance — lower is better",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Player Comparison
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Compare up to {MAX_COMPARE} players across a planning horizon. Best value per row is
            highlighted.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Horizon</span>
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              title={h === "season" ? SEASON_HORIZON_NOTE : undefined}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                horizon === h
                  ? "bg-purple-950 text-white dark:bg-[#00FF87] dark:text-slate-950"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:bg-purple-950/60"
              }`}
            >
              {horizonLabel(h)}
            </button>
          ))}
        </div>
      </div>

      {horizon === "season" && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{SEASON_HORIZON_NOTE}</p>
      )}

      {/* picker */}
      <div className="relative mt-4 max-w-sm">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            selected.length >= MAX_COMPARE
              ? `Remove one to add another (max ${MAX_COMPARE})`
              : "Add a player…"
          }
          disabled={selected.length >= MAX_COMPARE}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-purple-700 disabled:opacity-50 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus:border-[#00FF87]"
        />
        {suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-purple-800/50 dark:bg-[#2A0A45]">
            {suggestions.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => add(p.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-zinc-800 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-purple-950/60"
                >
                  <span className="min-w-0 truncate">
                    {p.web_name}
                    {/* Full name, so a hit on a hidden field doesn't look like a bug. */}
                    {fullName(p) && (
                      <span className="ml-1.5 text-xs text-zinc-500">{fullName(p)}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {teamShort.get(p.team_id)} · {POSITIONS[p.element_type]} · £
                    {((p.now_cost ?? 0) / 10).toFixed(1)}m
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading player pool…</p>}

      {!loading && !error && chosen.length === 0 && (
        <p className="mt-16 text-center text-sm text-zinc-500">
          Search above to add players, or open this page from the builder&apos;s replacement finder.
        </p>
      )}

      {!loading && chosen.length > 0 && (
        <>
          {/* metric table */}
          <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-purple-900/40">
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-zinc-500">
                    Metric
                  </th>
                  {chosen.map((p) => {
                    const row = rowById.get(p.id);
                    return (
                      <th key={p.id} className="px-3 py-2 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {p.webName}
                          </span>
                          {row && (
                            <>
                              <AvailabilityBadge
                                status={row.status}
                                chanceOfPlaying={row.chance_of_playing_next_round}
                                news={row.news}
                                size="w-3.5 h-3.5"
                              />
                              <RoleBadges
                                penaltyOrder={row.penalties_order}
                                freeKickOrder={row.direct_freekicks_order}
                                cornerOrder={row.corners_and_indirect_freekicks_order}
                                size="w-3.5 h-3.5"
                              />
                            </>
                          )}
                          <button
                            onClick={() => setSelected((s) => s.filter((id) => id !== p.id))}
                            aria-label={`Remove ${p.webName}`}
                            className="ml-auto text-zinc-400 transition-colors hover:text-red-500"
                          >
                            ×
                          </button>
                        </div>
                        <div className="text-xs font-normal text-zinc-500">
                          {p.teamShort} · {POSITIONS[p.elementType]}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {metricRows.map((m) => {
                  const values = chosen.map((p) => m.value(p));
                  const best = chosen.length > 1 ? bestOf(values, m.dir) : null;
                  return (
                    <tr
                      key={m.label}
                      className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30"
                    >
                      <th className="px-3 py-1.5 text-left text-xs font-medium text-zinc-500">
                        <span className="flex items-center gap-1">
                          {m.label}
                          {m.hint && <InfoTooltip label={m.hint}>{m.hint}</InfoTooltip>}
                        </span>
                      </th>
                      {chosen.map((p, i) => {
                        const v = values[i];
                        const isBest = best !== null && v === best;
                        return (
                          <td
                            key={p.id}
                            className={`px-3 py-1.5 tabular-nums ${
                              isBest
                                ? "font-bold text-purple-900 dark:text-[#00FF87]"
                                : "text-zinc-800 dark:text-zinc-200"
                            }`}
                          >
                            {m.format(v)}
                            {isBest && <span className="ml-1 text-[10px]">▲</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* fixture runs */}
                <tr className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">
                  <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">
                    <span className="flex items-center gap-1">
                      Fixtures
                      <InfoTooltip>
                        <FdrLegendContent />
                      </InfoTooltip>
                    </span>
                  </th>
                  {chosen.map((p) => (
                    <td key={p.id} className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {(upcoming.get(p.teamId) ?? []).slice(0, horizonLength(horizon)).map((f) => (
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
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* ranking */}
          <section className="mt-6">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Ranking over {horizon} gameweek{horizon === 1 ? "" : "s"}
            </h2>
            <ol className="mt-3 space-y-2">
              {ranked.map((r, i) => (
                <li
                  key={r.player.id}
                  className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-purple-900/40 dark:bg-[#1E0234]"
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
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                    {r.strengths.map((s) => (
                      <span key={s} className="text-emerald-700 dark:text-emerald-400">
                        ✓ {s}
                      </span>
                    ))}
                    {r.weaknesses.map((w) => (
                      <span key={w} className="text-amber-700 dark:text-amber-400">
                        ! {w}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
              {COMPARISON_MODEL_NOTE}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
              {RISK_MODEL_NOTE}
            </p>
          </section>
        </>
      )}
    </main>
  );
}
