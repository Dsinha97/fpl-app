"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { FixtureCell } from "@/components/fdr-badge";
import { FdrLegendContent, InfoTooltip } from "@/components/info-tooltip";
import { ConfidenceBadge, RateBand } from "@/components/confidence-badge";
import { Badge } from "@/components/ui/badge";
import { Pager } from "@/components/ui/pager";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import { GemBadge } from "@/components/gem-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SlideOver } from "@/components/ui/slide-over";
import { ComparePanel, type CompareFixture } from "@/components/compare-panel";
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
import { loadPriceProgress, PRICE_WATCH_MODEL_NOTE, type PriceProgress } from "@/lib/price-watch";
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
  // Read only by the compare panel (Sprint 33). points_per_game is last
  // completed season's; form is FPL's own 30-day rolling figure.
  points_per_game: number | null;
  bonus: number | null;
  form: number | null;
  defensive_contribution: number | null;
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
/**
 * Rows per page on the explorer.
 *
 * /builder's picker uses 10 because it lives in a 360px rail; this is a
 * full-width table, and the page previously showed 100 at once, so a small
 * page would read as a regression in density rather than as access to the
 * rest. 50 keeps the table dense and still makes all 657 reachable.
 */
const PAGE_SIZE = 50;

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
  const [priceProgress, setPriceProgress] = useState<Map<number, PriceProgress>>(new Map());
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
  /**
   * Ordered, not a Set: the compare panel's columns are laid out in
   * selection order, and a Set has no order to lay them out in. This was a
   * `Set<number>` while the only thing it did was build a `?ids=` query
   * string for a page that kept its own ordered list.
   */
  const [selected, setSelected] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [page, setPage] = useState(0);
  const compareTrigger = useRef<HTMLDivElement>(null);

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
                // Superset of what the grid and the compare panel each need — Sprint 33
                // merged /compare in here, and one select beats two pages
                // issuing near-identical ones a click apart.
                "id, code, web_name, first_name, second_name, known_name, team_id, element_type, now_cost, selected_by_percent, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order, total_points, goals_scored, assists, minutes, expected_goals, expected_assists, points_per_game, bonus, form, defensive_contribution",
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
        const playerRows = (playersRes.data ?? []) as PlayerRow[];
        setPlayers(playerRows);
        setTeamShort(shorts);
        setRuns(runMap);
        setXp(new Map(xpList.map((r) => [r.player_id, r])));
        setHistory(new Map(historyRows.map((h) => [h.player_code, h])));
        setRateProfile(new Map(rateProfileList.map((r) => [r.player_code, r])));
        setPredictions(new Map(predictionList.map((r) => [r.player_id, r])));
        // Price watch is loaded separately (not blocking first paint) — it's a
        // secondary signal, and loadPriceProgress needs the player codes we
        // just resolved.
        loadPriceProgress(gw.season, playerRows.map((p) => p.code))
          .then(setPriceProgress)
          .catch(() => setPriceProgress(new Map()));

        // Seed the comparison from ?ids= — what /compare used to do, so its
        // redirect stub and the builder's replacement-finder deep link both
        // still land somewhere useful. ?panel=compare opens it; ?ids= alone
        // just ticks the boxes, which is what a shared link usually wants.
        // window.location.search rather than useSearchParams: the static
        // export has no Suspense-boundary precedent, and /settings and
        // /fixtures already read their own query state this way.
        const params = new URLSearchParams(window.location.search);
        const byId = new Set(playerRows.map((r) => r.id));
        const seeded = (params.get("ids") ?? "")
          .split(",")
          .map(Number)
          .filter((n) => Number.isInteger(n) && byId.has(n))
          .slice(0, MAX_COMPARE);
        if (seeded.length > 0) {
          setSelected(seeded);
          if (params.get("panel") === "compare") setCompareOpen(true);
        }

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
    // Both fetched since Sprint 33, when the compare panel — which scores on
    // them — moved onto this page. `pointsPerGame` was null only because the
    // column wasn't in the select.
    pointsPerGame: p.points_per_game,
    form: p.form,
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

  const sorted = useMemo(() => {
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
    // Was `rows.slice(0, 100)` with no pager, so 557 of the 657 players were
    // simply unreachable on the page whose entire job is exploring them —
    // while /builder's picker, reading the same rows, could page to every one.
    // A cap with no way past it is a missing feature wearing a default's
    // clothes. Paged below instead.
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, history, runs, xp, filters, sortKey, sortDesc, horizon, seasonWindow, gemsById, predictions]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);


  /** Every sortable column here holds a number, so the header right-aligns to
   *  sit over its own decimals — a left-aligned label above a right-aligned
   *  column reads as two different columns (DSI-126, DSI-129 #4). */
  const header = (label: string, key: SortKey, note?: ReactNode) => (
    <th className="px-2 py-2 text-right">
      {/* Label first, then the "?" — these columns are right-aligned, so the
          affordance belongs on the outer edge where the eye lands, not wedged
          between the previous column and this one's name. */}
      <span className="flex items-center justify-end gap-1.5">
      <button
        onClick={() => {
          if (sortKey === key) setSortDesc(!sortDesc);
          else {
            setSortKey(key);
            setPage(0);
            setSortDesc(true);
          }
        }}
        className={`uppercase tracking-wide transition-colors hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-primary ${
          sortKey === key ? "text-purple-800 dark:text-primary" : ""
        }`}
      >
        {label}
        {sortKey === key ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
      {note && (
        <InfoTooltip label={`What is ${label}?`} align="right">
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{note}</p>
        </InfoTooltip>
      )}
      </span>
    </th>
  );

  const teamOptions = [...teamShort.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const toggleSelected = (id: number) => {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_COMPARE
          ? prev
          : [...prev, id],
    );
  };

  const removeSelected = useCallback(
    (id: number) => setSelected((prev) => prev.filter((x) => x !== id)),
    [],
  );

  // ------------------------------------------------------- compare panel
  //
  // Sprint 33 folded /compare in here. Everything below is a re-shape of
  // state this page already held: the panel needs no fetch of its own, which
  // is the point — the two pages were issuing near-identical queries for the
  // same gameweek one click apart, and the horizon you had just set was
  // thrown away crossing between them.

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  /** The selected rows as ScoredPlayers, in selection order. */
  const chosen = useMemo(
    () =>
      selected.flatMap((id) => {
        const row = playerById.get(id);
        return row ? [toScoredPlayer(row, xp.get(id))] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, playerById, xp, predictions, runs, teamShort],
  );

  /** Per-horizon xDefcon, the one number the panel needs that isn't on
   *  ScoredPlayer (see XDC_MODEL_NOTE — only this table and the grid use it). */
  const xdcById = useMemo(() => {
    const m = new Map<number, Record<Horizon, number | null>>();
    for (const id of selected) {
      const x = xp.get(id);
      m.set(id, {
        1: x?.xdc_1 ?? null,
        3: x?.xdc_3 ?? null,
        5: x?.xdc_5 ?? null,
        8: x?.xdc_8 ?? null,
        19: x?.xdc_19 ?? null,
        season: x?.xdc_total ?? null,
      });
    }
    return m;
  }, [selected, xp]);

  /** `runs` keyed and named the way the panel wants it — the same cells, not
   *  a second fetch. */
  const upcomingByTeam = useMemo(() => {
    const m = new Map<number, CompareFixture[]>();
    for (const [teamId, cells] of runs) {
      m.set(
        teamId,
        cells.map((c) => ({
          event: c.gw,
          opponent_short_name: c.opp,
          is_home: c.home,
          fdr: c.fdr,
        })),
      );
    }
    return m;
  }, [runs]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Player Explorer
          </h1>
          {/* DSI-126: this was a five-part definition list running across the
              page. Each definition now lives on the column it defines, where
              it is actually needed — and one of them ("green ring = home") had
              silently gone stale when the venue encoding changed, which is the
              failure mode of explaining a column somewhere other than at it. */}
          <p className="mt-1 text-sm text-zinc-500">
            {sorted.length} players
            {historySeason ? ` · season stats from ${shortSeason(historySeason)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Horizon</span>
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => {
                setHorizon(h);
                setPage(0);
              }}
              title={h === "season" ? seasonHorizonNote(seasonWindow) : undefined}
              className={`rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                horizon === h
                  ? "bg-purple-950 text-white dark:bg-primary dark:text-slate-950"
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
          onChange={(next) => {
            setFilters(next);
            // Changing what is listed returns to the first page — staying on
            // page 12 of a filter that now matches three players shows an
            // empty table.
            setPage(0);
          }}
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
      {loading && (
        <div className="mt-6 space-y-1.5" role="status" aria-label="Loading players">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {!loading && !error && (
        <>
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-card">
          <table className="w-full min-w-[56rem] text-sm">
            {/* NOT sticky, deliberately. `overflow-x-auto` on the wrapper above
                computes `overflow-y: auto` too, which makes that wrapper the
                vertical scroll container — and with no height cap it never
                scrolls, so `sticky top-0` has nothing to stick against and the
                header just leaves with the page. Making it work needs a
                max-height on the wrapper (see `DataTable`'s `maxHeight`), which
                turns this into an inner-scrolling table; that is a layout
                decision for the /players pass, not a class to sprinkle on. */}
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-purple-900/40">
                {/* Sticky so the player being scanned stays visible while
                    scrolling the rest of a wide table horizontally on
                    mobile — the checkbox lives in this same cell (see the
                    body row below) rather than its own column, so there is
                    one sticky boundary to reason about, not two. */}
                <th className="sticky left-0 z-10 bg-white px-3 py-2 uppercase tracking-wide dark:bg-card">
                  Player
                </th>
                <th className="px-2 py-2 uppercase tracking-wide">Team</th>
                <th className="px-2 py-2 uppercase tracking-wide">Pos</th>
                {header("Price", "price")}
                <th className="px-2 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className="uppercase tracking-wide">Price watch</span>
                    <InfoTooltip label="What is Price watch?">
                      <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                        {PRICE_WATCH_MODEL_NOTE}
                      </p>
                    </InfoTooltip>
                  </span>
                </th>
                {header("xP GW", "xp1", "Model-projected points for the next gameweek. The column beside it projects over the horizon selected above.")}
                {header(`xP ${horizonLabel(horizon)}`, "xpH")}
                {header("Pts", "gwPoints")}
                {header("G", "goals")}
                {header("A", "assists")}
                {header("Mins", "minutes")}
                {header(`xG/90`, "xgCur", "Expected goals per 90 minutes played this season — a rate, not a total, so a substitute is comparable to a starter. Dimmed below 450 minutes, where the rate is real but not yet stable.")}
                {header(`xA/90`, "xaCur", "Expected assists per 90 minutes played this season. Same rate basis and same thin-sample dimming as xG/90.")}
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
                      className={`uppercase tracking-wide transition-colors hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-primary ${
                        sortKey === "xdc" ? "text-purple-800 dark:text-primary" : ""
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
                      className={`uppercase tracking-wide transition-colors hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-primary ${
                        sortKey === "run" ? "text-purple-800 dark:text-primary" : ""
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
                const isSelected = selected.includes(p.id);
                const disableCheckbox = !isSelected && selected.length >= MAX_COMPARE;
                return (
                  <tr
                    key={p.id}
                    data-selected={isSelected || undefined}
                    // DSI-126: a checked row was distinguished only by the
                    // checkbox itself, which scrolls out of view the moment the
                    // wide table is panned sideways. A tint plus a left edge on
                    // the frozen cell keeps the selection visible from anywhere
                    // in the row.
                    className={`border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200 ${
                      isSelected
                        ? "bg-primary/[0.06] [&>td:first-child]:shadow-[inset_2px_0_0_0_var(--primary)]"
                        : ""
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 dark:bg-card">
                      <span className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={disableCheckbox}
                          onChange={() => toggleSelected(p.id)}
                          aria-label={`Select ${p.web_name} to compare`}
                          className="h-4 w-4 shrink-0 accent-purple-700 disabled:cursor-not-allowed disabled:opacity-40 dark:accent-primary"
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
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      £{((p.now_cost ?? 0) / 10).toFixed(1)}m
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs">
                      {(() => {
                        const pp = priceProgress.get(p.code);
                        // Was the literal word "unknown", which reads as an
                        // unhandled database null rather than as "no signal
                        // yet" (DSI-126). The column header's own tooltip
                        // already carries PRICE_WATCH_MODEL_NOTE, which is
                        // where the explanation belongs.
                        if (!pp || pp.verdict === "unknown") {
                          return <span className="text-muted-foreground">&mdash;</span>;
                        }
                        const pct = Math.round((pp.progress ?? 0) * 100);
                        if (pp.direction === "flat") {
                          return <span className="tabular-nums text-muted-foreground">{pct}%</span>;
                        }
                        return (
                          <Badge
                            tone={pp.direction === "rise" ? "positive" : "negative"}
                            size="sm"
                            className="tabular-nums"
                            title={`Price watch: ${pp.direction} — ${pct}% (${pp.verdict})`}
                          >
                            {pp.direction === "rise" ? "▲" : "▼"} {pct}%
                          </Badge>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-foreground">
                      {x?.xp_1?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span className="flex items-center justify-end gap-1">
                        {xpForHorizon(x, horizon)?.toFixed(1) ?? "—"}
                        <ConfidenceBadge reliability={x?.reliability} priorWeight={x?.prior_weight} compact />
                      </span>
                      <RateBand lower={bandLower ?? undefined} upper={bandUpper ?? undefined} />
                    </td>
                    {/* Current season — the emphasised block, set off from the
                        muted last-season trio further right. Emphasis is weight,
                        not the accent: --primary is reserved for actions and the
                        single top-tier winner (DSI-129 #1), and four columns of
                        it meant none of them stood out. */}
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-foreground">
                      {p.total_points ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{p.goals_scored ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{p.assists ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{p.minutes ?? "—"}</td>
                    {(() => {
                      const xgRate = perNinety(p.expected_goals, p.minutes);
                      const xaRate = perNinety(p.expected_assists, p.minutes);
                      // Dim + disclose the raw total under MIN_MINUTES_FOR_CONFIDENT_RATE — a
                      // rate from a handful of minutes is real but not yet a stable read.
                      const thin = (p.minutes ?? 0) < MIN_MINUTES_FOR_CONFIDENT_RATE;
                      return (
                        <>
                          <td
                            className={`px-2 py-1.5 text-right tabular-nums ${thin ? "text-zinc-400" : ""}`}
                            title={
                              thin && p.expected_goals !== null
                                ? `${p.expected_goals.toFixed(2)} xG in ${p.minutes ?? 0} min`
                                : undefined
                            }
                          >
                            {xgRate?.toFixed(2) ?? "—"}
                          </td>
                          <td
                            className={`px-2 py-1.5 text-right tabular-nums ${thin ? "text-zinc-400" : ""}`}
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
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {predictions.get(p.id)?.expected_minutes?.toFixed(0) ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {XDC_POSITIONS.has(p.element_type)
                        ? xdcForHorizon(x, horizon)?.toFixed(2) ?? "—"
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {valueOf(p, x)?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {p.selected_by_percent !== null ? `${p.selected_by_percent}%` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{h?.total_points ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{h?.expected_goals ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{h?.expected_assists ?? "—"}</td>
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
          {/* Outside the overflow-x wrapper on purpose: inside it, the pager
              scrolled sideways with the table and Prev/Page slid off-screen
              the moment anyone panned to the right-hand columns. */}
          <Pager
            page={safePage}
            pageCount={pageCount}
            onPageChange={setPage}
            total={sorted.length}
            noun="player"
          />
        </>
      )}

      {/* The bar that used to link to /compare now opens it in place. It
          shows from one selection rather than two, because "Compare" that
          appears only after a second checkbox reads as an unexplained
          state change; with one player the panel is a single-player
          profile, which is a legitimate thing to want. */}
      {selected.length >= 1 && (
        <div
          ref={compareTrigger}
          className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-purple-900/40 dark:bg-card/95"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {selected.length} of {MAX_COMPARE} players selected
            </span>
            <span className="flex items-center gap-3">
              <button
                onClick={() => setSelected([])}
                className="text-sm text-zinc-500 underline transition-colors hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-primary"
              >
                Clear
              </button>
              <button
                onClick={() => setCompareOpen((v) => !v)}
                aria-expanded={compareOpen}
                className="rounded-md bg-purple-950 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-primary dark:text-slate-950 dark:hover:bg-primary-hover"
              >
                {compareOpen ? "Hide comparison" : `Compare ${selected.length}`}
              </button>
            </span>
          </div>
        </div>
      )}

      <SlideOver
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        side="right"
        label="Player comparison"
        width="min(52rem, 96vw)"
        triggerRef={compareTrigger}
      >
        <div className="p-2">
          <div className="flex items-start justify-between gap-3 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                Comparison
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Best value per row is highlighted. Horizon follows the page — {horizonLabel(horizon)}.
              </p>
            </div>
            <button
              onClick={() => setCompareOpen(false)}
              aria-label="Close comparison"
              className="shrink-0 rounded-md px-2 py-1 text-xl leading-none text-zinc-500 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-purple-950/60"
            >
              ×
            </button>
          </div>

          {chosen.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">
              Tick players in the table to compare them. Nothing is selected.
            </p>
          ) : (
            <ComparePanel
              chosen={chosen}
              horizon={horizon}
              seasonWindow={seasonWindow}
              xdcById={xdcById}
              rowById={playerById}
              upcoming={upcomingByTeam}
              onRemove={removeSelected}
            />
          )}
        </div>
      </SlideOver>
    </main>
  );
}
