"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { FixtureCell } from "@/components/fdr-badge";
import { FdrLegendContent, InfoTooltip } from "@/components/info-tooltip";
import { ConfidenceBadge, RateBand } from "@/components/confidence-badge";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import { GemBadge } from "@/components/gem-badge";
import { fullName } from "@/lib/player-search";
import { shortSeason } from "@/lib/utils";
import {
  availabilityFromStatus,
  MAX_COMPARE,
  valuePerMillion,
  XDC_MODEL_NOTE,
  type ScoredPlayer,
} from "@/lib/scoring";
import { DEFAULT_GEM_CUTS, detectGems, type GemCandidate } from "@/lib/hidden-gems";
import {
  defaultPlayerFilters,
  matchesFilters,
  PlayerFilters,
  type PlayerFilterState,
} from "@/components/player-filters";
import {
  HORIZONS,
  horizonLabel,
  horizonLength,
  seasonHorizonNote,
  type Horizon,
} from "@/lib/team-state";

interface PlayerRow {
  id: number;
  code: number;
  web_name: string;
  first_name: string | null;
  second_name: string | null;
  known_name: string | null;
  team_id: number;
  element_type: number;
  now_cost: number | null;
  selected_by_percent: number | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
  penalties_order: number | null;
  direct_freekicks_order: number | null;
  corners_and_indirect_freekicks_order: number | null;
  // Current-season totals — distinct from `HistoryRow` below, which is last
  // season's (player_season_history). Both are shown, clearly labelled, so
  // the two are never confused (CLAUDE.md: "say what the number means").
  total_points: number | null;
  goals_scored: number | null;
  assists: number | null;
  minutes: number | null;
  // Current-season expected numbers, accrued over the same games as the
  // fields above — distinct from `HistoryRow`'s last-season xG/xA and from
  // `PredictionRow`'s forward-looking per-fixture expected_minutes.
  expected_goals: number | null;
  expected_assists: number | null;
}

/** One row of `player_predictions` for the upcoming gameweek only — the
 * model's forward-looking minutes signal, not fetched here before this
 * column existed (see the removed `availabilityOf` fallback comment). */
interface PredictionRow {
  player_id: number;
  expected_minutes: number | null;
  start_probability: number | null;
}

interface HistoryRow {
  player_code: number;
  total_points: number | null;
  minutes: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
}

/** One row of `player_rate_profile` — see that migration for how it's derived. */
interface RateProfileRow {
  player_code: number;
  observed_minutes: number | null;
  dc90: number | null;
  cbit90: number | null;
  cbirt90: number | null;
  xgi90: number | null;
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
  xp_3: number | null;
  xp_5: number | null;
  xp_8: number | null;
  xp_19: number | null;
  xp_total: number | null;
  xp_1_lower: number | null;
  xp_1_upper: number | null;
  xp_3_lower: number | null;
  xp_3_upper: number | null;
  xp_5_lower: number | null;
  xp_5_upper: number | null;
  xp_8_lower: number | null;
  xp_8_upper: number | null;
  xp_19_lower: number | null;
  xp_19_upper: number | null;
  xp_total_lower: number | null;
  xp_total_upper: number | null;
  xdc_1: number | null;
  xdc_3: number | null;
  xdc_5: number | null;
  xdc_8: number | null;
  xdc_19: number | null;
  xdc_total: number | null;
  first_event: number | null;
  last_event: number | null;
  reliability: "high" | "medium" | "low" | null;
  prior_weight: number | null;
}

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
/** Positions the defensive-contribution threshold can ever apply to — see XDC_MODEL_NOTE. */
const XDC_POSITIONS = new Set([2, 3]);

type SortKey =
  | "price"
  | "ownership"
  | "points"
  | "xg"
  | "xa"
  | "xgCur"
  | "xaCur"
  | "xmins"
  | "run"
  | "xp1"
  | "xpH"
  | "xdc"
  | "value"
  | "gwPoints"
  | "goals"
  | "assists"
  | "minutes";

/** Fallback when `player_xp_horizons` has no rows yet — matches `generate-predictions`' own floor. */
const FALLBACK_SEASON_WINDOW = 8;

/** Slider bounds in FPL's tenths-of-a-million units: £4.0m to £16.0m. */
const PRICE_MIN = 40;
const PRICE_MAX = 160;

const xpForHorizon = (x: XpRow | undefined, h: Horizon): number | null => {
  if (!x) return null;
  switch (h) {
    case 1: return x.xp_1;
    case 3: return x.xp_3;
    case 5: return x.xp_5;
    case 8: return x.xp_8;
    case 19: return x.xp_19;
    case "season": return x.xp_total;
  }
};

const xpBandForHorizon = (x: XpRow | undefined, h: Horizon): [number | null, number | null] => {
  if (!x) return [null, null];
  switch (h) {
    case 1: return [x.xp_1_lower, x.xp_1_upper];
    case 3: return [x.xp_3_lower, x.xp_3_upper];
    case 5: return [x.xp_5_lower, x.xp_5_upper];
    case 8: return [x.xp_8_lower, x.xp_8_upper];
    case 19: return [x.xp_19_lower, x.xp_19_upper];
    case "season": return [x.xp_total_lower, x.xp_total_upper];
  }
};

const xdcForHorizon = (x: XpRow | undefined, h: Horizon): number | null => {
  if (!x) return null;
  switch (h) {
    case 1: return x.xdc_1;
    case 3: return x.xdc_3;
    case 5: return x.xdc_5;
    case 8: return x.xdc_8;
    case 19: return x.xdc_19;
    case "season": return x.xdc_total;
  }
};

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [history, setHistory] = useState<Map<number, HistoryRow>>(new Map());
  const [teamShort, setTeamShort] = useState<Map<number, string>>(new Map());
  const [runs, setRuns] = useState<Map<number, RunCell[]>>(new Map());
  const [xp, setXp] = useState<Map<number, XpRow>>(new Map());
  const [rateProfile, setRateProfile] = useState<Map<number, RateProfileRow>>(new Map());
  const [predictions, setPredictions] = useState<Map<number, PredictionRow>>(new Map());
  const [historySeason, setHistorySeason] = useState<string>("");
  const [seasonWindow, setSeasonWindow] = useState(FALLBACK_SEASON_WINDOW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<PlayerFilterState>(() =>
    defaultPlayerFilters([PRICE_MIN, PRICE_MAX]),
  );
  const [horizon, setHorizon] = useState<Horizon>(5);
  const [sortKey, setSortKey] = useState<SortKey>("price");
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

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

        const [playersRes, teamsRes, fixturesRes, latestSeasonRes, rateProfileRes, predictionsRes] =
          await Promise.all([
            supabase
              .from("players")
              .select(
                // Single string literal: supabase-js parses this at the type level,
                // so concatenation would collapse the row type to an error type.
                "id, code, web_name, first_name, second_name, known_name, team_id, element_type, now_cost, selected_by_percent, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order, total_points, goals_scored, assists, minutes, expected_goals, expected_assists",
              )
              .eq("season", gw.season)
              .limit(1000),
            supabase.from("teams").select("id, short_name").eq("season", gw.season),
            // No upper event bound — the horizon control can reach "season", and
            // the fixture ticker slices client-side via horizonLength, same
            // pattern /compare already uses for the same reason.
            supabase
              .from("fixtures")
              .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
              .eq("season", gw.season)
              .gte("event", gw.id),
            supabase
              .from("player_season_history")
              .select("season_name")
              .order("season_name", { ascending: false })
              .limit(1)
              .maybeSingle(),
            // Not season-scoped — player_rate_profile is keyed by player_code
            // off the whole player_season_history table, same as the model's
            // own recency-weighted rates.
            supabase
              .from("player_rate_profile")
              .select("player_code, observed_minutes, dc90, cbit90, cbirt90, xgi90")
              .limit(1000),
            // The model's per-fixture minutes projection for the upcoming
            // gameweek — real per-player evidence, distinct from the status-
            // only availabilityFromStatus fallback this page used before.
            supabase
              .from("player_predictions")
              .select("player_id, expected_minutes, start_probability")
              .eq("season", gw.season)
              .eq("event", gw.id)
              .limit(1000),
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

        // Full remaining-season fixture run per team, sorted; sliced per-row
        // by the selected horizon at render time.
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
          .select(
            "player_id, xp_1, xp_3, xp_5, xp_8, xp_19, xp_total, xp_1_lower, xp_1_upper, xp_3_lower, xp_3_upper, xp_5_lower, xp_5_upper, xp_8_lower, xp_8_upper, xp_19_lower, xp_19_upper, xp_total_lower, xp_total_upper, xdc_1, xdc_3, xdc_5, xdc_8, xdc_19, xdc_total, first_event, last_event, reliability, prior_weight",
          )
          .eq("season", gw.season)
          .limit(1000);

        const xpList = (xpRows ?? []) as XpRow[];
        const rateProfileList = (rateProfileRes.data ?? []) as RateProfileRow[];
        const predictionList = (predictionsRes.data ?? []) as PredictionRow[];
        setPlayers((playersRes.data ?? []) as PlayerRow[]);
        setTeamShort(shorts);
        setRuns(runMap);
        setXp(new Map(xpList.map((r) => [r.player_id, r])));
        setHistory(new Map(historyRows.map((h) => [h.player_code, h])));
        setRateProfile(new Map(rateProfileList.map((r) => [r.player_code, r])));
        setPredictions(new Map(predictionList.map((r) => [r.player_id, r])));

        // first_event/last_event are constant across every row for one
        // season/model_version — any row gives the real prediction window.
        const first = xpList[0];
        if (first?.first_event != null && first?.last_event != null) {
          setSeasonWindow(first.last_event - first.first_event + 1);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const avgFdr = (teamId: number): number | null => {
    const cells = (runs.get(teamId) ?? []).slice(0, horizonLength(horizon, seasonWindow));
    if (cells.length === 0) return null;
    return cells.reduce((a, c) => a + c.fdr, 0) / cells.length;
  };

  /**
   * Availability from status/chance-of-playing, same formula
   * `app/builder/page.tsx`'s `availabilityOf` uses. Real per-fixture minutes
   * evidence (`start_probability`/`expected_minutes`, fetched into
   * `predictions` above) is wired into `toScoredPlayer` separately below;
   * every `ScoredPlayer` consumer already prefers `startProbability` over
   * this status-only figure via `startProbability ?? availability`.
   */
  const availabilityOf = (p: PlayerRow): number =>
    availabilityFromStatus(p.status, p.chance_of_playing_next_round);

  /** Builds the minimal ScoredPlayer this page can support (no start_probability — see `availabilityOf`). */
  const toScoredPlayer = (p: PlayerRow, x: XpRow | undefined): ScoredPlayer => ({
    id: p.id,
    webName: p.web_name,
    elementType: p.element_type,
    teamId: p.team_id,
    teamShort: teamShort.get(p.team_id) ?? null,
    price: p.now_cost ?? 0,
    ownership: p.selected_by_percent,
    pointsPerGame: null,
    xp: {
      1: x?.xp_1 ?? null,
      3: x?.xp_3 ?? null,
      5: x?.xp_5 ?? null,
      8: x?.xp_8 ?? null,
      19: x?.xp_19 ?? null,
      season: x?.xp_total ?? null,
    },
    reliability: x?.reliability ?? undefined,
    priorWeight: x?.prior_weight ?? null,
    expectedMinutes: predictions.get(p.id)?.expected_minutes ?? null,
    startProbability: predictions.get(p.id)?.start_probability ?? null,
    availability: availabilityOf(p),
    fdrRun: (runs.get(p.team_id) ?? []).map((c) => c.fdr),
  });

  /**
   * xP per £m for one row at the selected horizon. Delegates to
   * `valuePerMillion` (lib/scoring.ts) rather than recomputing
   * `xpH / (now_cost / 10)` independently — this file previously did that
   * twice (once for sorting, once for display), a second implementation of
   * a number the rest of the app already owns.
   */
  const valueOf = (p: PlayerRow, x: XpRow | undefined): number | null => {
    if (xpForHorizon(x, horizon) === null || !p.now_cost) return null;
    return valuePerMillion(toScoredPlayer(p, x), horizon);
  };

  /**
   * xG/xA columns used to show the season-to-date total under a "(N GW)"
   * label — accurate but not what the header claimed ("xG"/"xA" reads as
   * per-game everywhere else in football). Per-90 rather than per-gameweek:
   * unaffected by rotation/subs, the standard football rate. `null` below
   * 45 minutes — a 12-minute cameo with 1 xG reads 7.5 xG/90, which isn't a
   * real rate, it's noise.
   */
  const MIN_MINUTES_FOR_RATE = 45;
  const MIN_MINUTES_FOR_CONFIDENT_RATE = 180;
  const perNinety = (total: number | null, minutes: number | null): number | null => {
    if (total === null || minutes === null || minutes < MIN_MINUTES_FOR_RATE) return null;
    return (total / minutes) * 90;
  };

  const gemCandidates = useMemo<GemCandidate[]>(
    () =>
      players.map((p) => {
        const rp = rateProfile.get(p.code);
        return {
          player: toScoredPlayer(p, xp.get(p.id)),
          rates: {
            observedMinutes: rp?.observed_minutes ?? null,
            dc90: rp?.dc90 ?? null,
            positionDc90: p.element_type === 2 ? rp?.cbit90 ?? null : rp?.cbirt90 ?? null,
            xgi90: rp?.xgi90 ?? null,
          },
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [players, rateProfile, xp, teamShort, runs, predictions],
  );

  const gemsById = useMemo(() => {
    const verdicts = detectGems(gemCandidates, horizon, DEFAULT_GEM_CUTS, seasonWindow);
    return new Map(verdicts.map((v) => [v.playerId, v]));
  }, [gemCandidates, horizon, seasonWindow]);

  const visible = useMemo(() => {
    const rows = players.filter((p) => matchesFilters(p, filters, gemsById));

    const value = (p: PlayerRow): number => {
      const h = history.get(p.code);
      const x = xp.get(p.id);
      switch (sortKey) {
        case "xp1":
          return x?.xp_1 ?? -1;
        case "xpH":
          return xpForHorizon(x, horizon) ?? -1;
        case "xdc":
          return XDC_POSITIONS.has(p.element_type) ? (xdcForHorizon(x, horizon) ?? -1) : -1;
        case "value":
          return valueOf(p, x) ?? -1;
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
        case "xgCur":
          return perNinety(p.expected_goals, p.minutes) ?? -1;
        case "xaCur":
          return perNinety(p.expected_assists, p.minutes) ?? -1;
        case "xmins":
          return predictions.get(p.id)?.expected_minutes ?? -1;
        case "run":
          // Lower FDR is better, so invert for a consistent "desc = best" sort.
          return avgFdr(p.team_id) === null ? -99 : -avgFdr(p.team_id)!;
        case "gwPoints":
          return p.total_points ?? -1;
        case "goals":
          return p.goals_scored ?? -1;
        case "assists":
          return p.assists ?? -1;
        case "minutes":
          return p.minutes ?? -1;
      }
    };

    rows.sort((a, b) => (sortDesc ? value(b) - value(a) : value(a) - value(b)));
    return rows.slice(0, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, history, runs, xp, filters, sortKey, sortDesc, horizon, seasonWindow, gemsById, predictions]);

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
        className={`uppercase tracking-wide transition-colors hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-[#00FF87] ${
          sortKey === key ? "text-purple-800 dark:text-[#00FF87]" : ""
        }`}
      >
        {label}
        {sortKey === key ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  const teamOptions = [...teamShort.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_COMPARE) next.add(id);
      return next;
    });
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Player Explorer
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            xP = model-projected points (next gameweek, and over the horizon below) · xG/xA are
            per 90 minutes{" "}
            {historySeason ? `· stats from ${shortSeason(historySeason)}` : ""} · green ring = home · top 100 shown
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Horizon</span>
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              title={h === "season" ? seasonHorizonNote(seasonWindow) : undefined}
              className={`rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{seasonHorizonNote(seasonWindow)}</p>
      )}

      {/* Filters */}
      <div className="mt-4">
        <PlayerFilters
          value={filters}
          onChange={setFilters}
          teamOptions={teamOptions}
          priceBounds={[PRICE_MIN, PRICE_MAX]}
          positionOptions={POSITIONS}
        />
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading players…</p>}

      {!loading && !error && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-purple-900/40">
                {/* Sticky so the player being scanned stays visible while
                    scrolling the rest of a wide table horizontally on
                    mobile — the checkbox lives in this same cell (see the
                    body row below) rather than its own column, so there is
                    one sticky boundary to reason about, not two. */}
                <th className="sticky left-0 z-10 bg-white px-3 py-2 uppercase tracking-wide dark:bg-[#1E0234]">
                  Player
                </th>
                <th className="px-2 py-2 uppercase tracking-wide">Team</th>
                <th className="px-2 py-2 uppercase tracking-wide">Pos</th>
                {header("Price", "price")}
                {header("xP GW", "xp1")}
                {header(`xP ${horizonLabel(horizon)}`, "xpH")}
                {header("Pts", "gwPoints")}
                {header("G", "goals")}
                {header("A", "assists")}
                {header("Mins", "minutes")}
                {header(`xG/90`, "xgCur")}
                {header(`xA/90`, "xaCur")}
                {header("xMins", "xmins")}
                <th className="px-2 py-2">
                  <span className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        if (sortKey === "xdc") setSortDesc(!sortDesc);
                        else {
                          setSortKey("xdc");
                          setSortDesc(true);
                        }
                      }}
                      className={`uppercase tracking-wide transition-colors hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-[#00FF87] ${
                        sortKey === "xdc" ? "text-purple-800 dark:text-[#00FF87]" : ""
                      }`}
                    >
                      XD
                      {sortKey === "xdc" ? (sortDesc ? " ↓" : " ↑") : ""}
                    </button>
                    <InfoTooltip label="What is xDefcon?">
                      <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                        {XDC_MODEL_NOTE}
                      </p>
                    </InfoTooltip>
                  </span>
                </th>
                {header("xP/£m", "value")}
                {header("Own %", "ownership")}
                {header(`Pts ${historySeason ? shortSeason(historySeason) : "LY"}`, "points")}
                {header(`xG ${historySeason ? shortSeason(historySeason) : "LY"}`, "xg")}
                {header(`xA ${historySeason ? shortSeason(historySeason) : "LY"}`, "xa")}
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
                      className={`uppercase tracking-wide transition-colors hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-[#00FF87] ${
                        sortKey === "run" ? "text-purple-800 dark:text-[#00FF87]" : ""
                      }`}
                    >
                      Next {horizonLength(horizon, seasonWindow)}
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
                const x = xp.get(p.id);
                const run = (runs.get(p.team_id) ?? []).slice(0, horizonLength(horizon, seasonWindow));
                const [bandLower, bandUpper] = xpBandForHorizon(x, horizon);
                const isSelected = selected.has(p.id);
                const disableCheckbox = !isSelected && selected.size >= MAX_COMPARE;
                return (
                  <tr
                    key={p.id}
                    className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200"
                  >
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 dark:bg-[#1E0234]">
                      <span className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={disableCheckbox}
                          onChange={() => toggleSelected(p.id)}
                          aria-label={`Select ${p.web_name} to compare`}
                          className="h-4 w-4 shrink-0 accent-purple-700 disabled:cursor-not-allowed disabled:opacity-40 dark:accent-[#00FF87]"
                        />
                        <span className="font-medium" title={fullName(p) ?? undefined}>
                          {p.web_name}
                        </span>
                        <AvailabilityBadge
                          status={p.status}
                          chanceOfPlaying={p.chance_of_playing_next_round}
                          news={p.news}
                        />
                        <RoleBadges
                          penaltyOrder={p.penalties_order}
                          freeKickOrder={p.direct_freekicks_order}
                          cornerOrder={p.corners_and_indirect_freekicks_order}
                        />
                        <GemBadge verdict={gemsById.get(p.id)} />
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-zinc-500">{teamShort.get(p.team_id)}</td>
                    <td className="px-2 py-1.5 text-zinc-500">{POSITIONS[p.element_type]}</td>
                    <td className="px-2 py-1.5 tabular-nums">
                      £{((p.now_cost ?? 0) / 10).toFixed(1)}m
                    </td>
                    <td className="px-2 py-1.5 font-semibold tabular-nums text-purple-800 dark:text-[#00FF87]">
                      {x?.xp_1?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      <span className="flex items-center gap-1">
                        {xpForHorizon(x, horizon)?.toFixed(1) ?? "—"}
                        <ConfidenceBadge reliability={x?.reliability} priorWeight={x?.prior_weight} compact />
                      </span>
                      <RateBand lower={bandLower ?? undefined} upper={bandUpper ?? undefined} />
                    </td>
                    {/* Current season — the emphasised block (bold/accent), set
                        off from the muted last-season trio further right. */}
                    <td className="px-2 py-1.5 font-semibold tabular-nums text-purple-800 dark:text-[#00FF87]">
                      {p.total_points ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 font-semibold tabular-nums">{p.goals_scored ?? "—"}</td>
                    <td className="px-2 py-1.5 font-semibold tabular-nums">{p.assists ?? "—"}</td>
                    <td className="px-2 py-1.5 font-semibold tabular-nums">{p.minutes ?? "—"}</td>
                    {(() => {
                      const xgRate = perNinety(p.expected_goals, p.minutes);
                      const xaRate = perNinety(p.expected_assists, p.minutes);
                      // Dim + disclose the raw total under MIN_MINUTES_FOR_CONFIDENT_RATE — a
                      // rate from a handful of minutes is real but not yet a stable read.
                      const thin = (p.minutes ?? 0) < MIN_MINUTES_FOR_CONFIDENT_RATE;
                      return (
                        <>
                          <td
                            className={`px-2 py-1.5 tabular-nums ${thin ? "text-zinc-400" : ""}`}
                            title={
                              thin && p.expected_goals !== null
                                ? `${p.expected_goals.toFixed(2)} xG in ${p.minutes ?? 0} min`
                                : undefined
                            }
                          >
                            {xgRate?.toFixed(2) ?? "—"}
                          </td>
                          <td
                            className={`px-2 py-1.5 tabular-nums ${thin ? "text-zinc-400" : ""}`}
                            title={
                              thin && p.expected_assists !== null
                                ? `${p.expected_assists.toFixed(2)} xA in ${p.minutes ?? 0} min`
                                : undefined
                            }
                          >
                            {xaRate?.toFixed(2) ?? "—"}
                          </td>
                        </>
                      );
                    })()}
                    <td className="px-2 py-1.5 tabular-nums">
                      {predictions.get(p.id)?.expected_minutes?.toFixed(0) ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {XDC_POSITIONS.has(p.element_type)
                        ? xdcForHorizon(x, horizon)?.toFixed(2) ?? "—"
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {valueOf(p, x)?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {p.selected_by_percent !== null ? `${p.selected_by_percent}%` : "—"}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-zinc-500">{h?.total_points ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums text-zinc-500">{h?.expected_goals ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums text-zinc-500">{h?.expected_assists ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      {/* Wraps to at most 3 rows and grows sideways instead of
                          down — the table already scrolls horizontally, so a
                          19 GW or Season run just widens the scroll area
                          rather than pushing every row's height around. */}
                      <span className="grid w-max grid-flow-col grid-rows-3 gap-1.5">
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
                  <td colSpan={20} className="px-3 py-6 text-center text-zinc-500">
                    No players match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected.size >= 2 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-purple-900/40 dark:bg-[#1E0234]/95">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {selected.size} of {MAX_COMPARE} players selected
            </span>
            <span className="flex items-center gap-3">
              <button
                onClick={() => setSelected(new Set())}
                className="text-sm text-zinc-500 underline transition-colors hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-[#00FF87]"
              >
                Clear
              </button>
              <Link
                href={`/compare?ids=${[...selected].join(",")}`}
                className="rounded-md bg-purple-950 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-900 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e078]"
              >
                Compare {selected.size} players →
              </Link>
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
