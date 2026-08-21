"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import { layoutFromLineup, PitchView } from "@/components/pitch-view";
import type { PlayerData, UpcomingFixture } from "@/components/player-card";
import { PANEL_MAX_HEIGHT, PANEL_WIDTH, PlayerDetail } from "@/components/player-detail";
import {
  CAPTAIN_MODEL_NOTE,
  optimiseLineup,
  type LineupCandidate,
} from "@/lib/lineup";
import { projectionAtEvent } from "@/lib/transfer-optimizer";
import { cloneDraft, deleteDraft, listDrafts, resolveRequestedDraft, saveDraft } from "@/lib/drafts";
import { loadSeasonContext } from "@/lib/season-context";
import { loadSquadHeadlines, type NewsHeadline } from "@/lib/news-feed";
import {
  addPlayer,
  blockedReason,
  computeProjection,
  DEFAULT_RULES,
  emptyTeamState,
  removePlayer,
  setCaptain,
  setViceCaptain,
  sameSquadState,
  validateSquad,
  xpAt,
  HORIZONS,
  horizonLabel,
  horizonLength,
  seasonHorizonNote,
  type Horizon,
  type HorizonXp,
  type PlayerMeta,
  type SquadRules,
  type TeamState,
} from "@/lib/team-state";
import {
  optimizeSquad,
  RISK_LABELS,
  STRATEGY_LABELS,
  suggestArmband,
  type OptimizerPlayer,
  type RiskLevel,
  type Strategy,
} from "@/lib/optimizer";
import {
  availabilityFromStatus,
  findReplacements,
  MINUTES_FLOOR,
  REPLACEMENT_MODEL_NOTE,
  replacementLegality,
  RISK_MODEL_NOTE,
  riskScore,
  type Replacement,
  type ScoredPlayer,
} from "@/lib/scoring";
import {
  DEFAULT_GEM_CUTS,
  detectGems,
  GEM_ARCHETYPE_LABELS,
  GEMS_MODEL_NOTE,
  type GemArchetype,
  type GemCandidate,
} from "@/lib/hidden-gems";
import { squadBudget, totalSpend } from "@/lib/squad-budget";
import { GemBadge } from "@/components/gem-badge";
import { InfoTooltip } from "@/components/info-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { CaptainBadge, ViceCaptainBadge } from "@/components/armband";
import { fullName } from "@/lib/player-search";
import { ActionMenu } from "@/components/ui/action-menu";
import { ValueSlider } from "@/components/ui/range-slider";
import { FilterDisclosure } from "@/components/ui/filter-disclosure";
import { tacticalSummary, toTacticalProfile, type PlManagerRow } from "@/lib/tactical-profile";
import { benchBoostAt, tripleCaptainAt } from "@/lib/chips";
import {
  defaultPlayerFilters,
  matchesFilters,
  PlayerFilters,
  type PlayerFilterState,
} from "@/components/player-filters";

interface PlayerRow {
  id: number;
  code: number;
  web_name: string;
  first_name: string | null;
  second_name: string | null;
  known_name: string | null;
  team_id: number;
  team_code: number | null;
  element_type: number;
  now_cost: number | null;
  selected_by_percent: number | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
  penalties_order: number | null;
  direct_freekicks_order: number | null;
  corners_and_indirect_freekicks_order: number | null;
  points_per_game: number | null;
  total_points: number | null;
  bonus: number | null;
  form: number | null;
  defensive_contribution: number | null;
}

interface XpRow {
  player_id: number;
  xp_1: number | null;
  xp_3: number | null;
  xp_5: number | null;
  xp_total: number | null;
  xp_8: number | null;
  xp_19: number | null;
  xp_1_lower: number | null;
  xp_3_lower: number | null;
  xp_5_lower: number | null;
  xp_8_lower: number | null;
  xp_19_lower: number | null;
  xp_total_lower: number | null;
  xp_5_upper: number | null;
  reliability: "high" | "medium" | "low" | null;
  prior_weight: number | null;
}

interface PredictionRow {
  player_id: number;
  expected_minutes: number | null;
  start_probability: number | null;
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

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
const PAGE_SIZE = 10;
/** Replacement finder result-count choices. 10 is the default — the spec's number. */
const REPLACEMENT_LIMITS = [5, 10, 20] as const;
/** The API caps every response at 1000 rows regardless of `.limit()` — see /transfers' PAGE_ROWS. */
const PAGE_ROWS = 1000;

/**
 * Hard cap on the player detail panel's fixture ticker, whatever the horizon.
 *
 * The panel is a compact anchored popover with a fixed `PANEL_MAX_HEIGHT`, not a
 * schedule page — `/fixtures` already exists for the full run. So the ticker
 * follows the selected horizon up to this many fixtures and then stops, which
 * matters now that "Season" reaches the whole 38-gameweek season.
 */
const MAX_TICKER_GWS = 8;
/** Fallback when `player_xp_horizons` has no rows yet — matches `generate-predictions`' own floor. */
const FALLBACK_SEASON_WINDOW = 8;

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

type SortKey = "xp5" | "xp1" | "price" | "ownership";

export default function BuilderPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [teamShort, setTeamShort] = useState<Map<number, string>>(new Map());
  /** Sprint 12.5 — one-line club tactical summary per team, context only. */
  const [tacticalByTeam, setTacticalByTeam] = useState<Map<number, string>>(new Map());
  const [xp, setXp] = useState<Map<number, XpRow>>(new Map());
  const [upcoming, setUpcoming] = useState<Map<number, UpcomingFixture[]>>(new Map());
  const [predictions, setPredictions] = useState<Map<number, PredictionRow>>(new Map());
  const [rateProfile, setRateProfile] = useState<Map<number, RateProfileRow>>(new Map());
  const [rules, setRules] = useState<SquadRules>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The real "season" prediction window — from `player_xp_horizons`, not hardcoded. */
  const [seasonWindow, setSeasonWindow] = useState(FALLBACK_SEASON_WINDOW);

  const [team, setTeam] = useState<TeamState>(() => emptyTeamState(DEFAULT_RULES));
  const [drafts, setDrafts] = useState<TeamState[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  /**
   * One-slot undo for destructive optimiser runs. The saved draft on disk is
   * only rewritten on Save, so restoring this returns exactly what was there.
   */
  const [previousTeam, setPreviousTeam] = useState<TeamState | null>(null);
  /**
   * The draft as it exists on disk, for "reset to saved" and for greying out
   * Save when nothing has changed. Null until a draft has been saved once.
   */
  const [savedTeam, setSavedTeam] = useState<TeamState | null>(null);

  /**
   * Declared up here (rather than beside the finder's other filter state,
   * further down) because the players-list `filtered` memo needs it to
   * switch into replace mode — showing only legal targets for this slot
   * instead of the free pool.
   */
  const [replaceFor, setReplaceFor] = useState<number | null>(null);

  /**
   * Filter state, or null until the pool has loaded and the real price
   * bounds are known — deliberately not defaulted to a hardcoded 40–150,
   * since prices move during a season and a bound invented here would start
   * silently excluding players the moment the most expensive one rose past
   * it. Seeded from `priceBounds` the first time it resolves, below.
   */
  const [filters, setFilters] = useState<PlayerFilterState | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("xp5");
  const [page, setPage] = useState(0);

  const [horizon, setHorizon] = useState<Horizon>(5);
  const [strategy, setStrategy] = useState<Strategy>("max_points");
  const [risk, setRisk] = useState<RiskLevel>("medium");
  const [optimizeNote, setOptimizeNote] = useState<string | null>(null);
  const [optimizerRunning, setOptimizerRunning] = useState(false);

  /** Season and next gameweek, kept for the lazy per-gameweek series fetch below. */
  const [season, setSeason] = useState<string | null>(null);
  const [nextEvent, setNextEvent] = useState<number | null>(null);
  /** first_event/last_event from `player_xp_horizons` — the real predicted window, for the GW planning dropdown. */
  const [seasonRange, setSeasonRange] = useState<{ first: number; last: number } | null>(null);
  /**
   * The gameweek the "Gameweek lineup" panel plans for. Null means "not
   * touched yet" — the panel falls back to `nextEvent`, without an effect
   * that would have to synchronise two pieces of state derived from one
   * async load.
   */
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);

  // ------------------------------------------------------------- load

  useEffect(() => {
    (async () => {
      try {
        const ctx = await loadSeasonContext();
        setSeason(ctx.season);
        setNextEvent(ctx.nextEvent);
        const gw = { season: ctx.season, id: ctx.nextEvent };

        const [playersRes, teamsRes, xpRes, fixturesRes, predsRes, tacticalRes, rateProfileRes] =
          await Promise.all([
            supabase
              .from("players")
              .select(
                "id, code, web_name, first_name, second_name, known_name, team_id, team_code, element_type, now_cost, selected_by_percent, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order, points_per_game, total_points, bonus, form, defensive_contribution",
              )
              .eq("season", gw.season)
              .limit(1000),
            supabase.from("teams").select("id, short_name, tactical_manager_id").eq("season", gw.season),
            supabase
              .from("player_xp_horizons")
              // One string literal, never concatenated: `+` collapses the row
              // type to GenericStringError.
              .select(
                "player_id, xp_1, xp_3, xp_5, xp_8, xp_19, xp_total, xp_1_lower, xp_3_lower, xp_5_lower, xp_8_lower, xp_19_lower, xp_total_lower, xp_5_upper, reliability, prior_weight, first_event, last_event",
              )
              .eq("season", gw.season)
              .limit(1000),
            // No upper bound: a season has at most 380 fixtures total, and the
            // real "season" window (seasonWindow, below) is however many the
            // model actually predicted. Fetching the full remaining season
            // lets fdrRun (risk/fixture scoring) see past DISPLAY_GWS's
            // three-fixture ticker, which only slices the display field.
            supabase
              .from("fixtures")
              .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
              .eq("season", gw.season)
              .gte("event", gw.id)
              .order("event"),
            supabase
              .from("player_predictions")
              .select("player_id, expected_minutes, start_probability")
              .eq("season", gw.season)
              .eq("event", gw.id)
              .limit(1000),
            // Sprint 12.5 — club tactical profiles, disclosed context only.
            supabase
              .from("pl_managers")
              .select(
                "manager_key, name, current_club, preferred_formation, buildup_style, pressing_intensity, source_file, tactical_traits, modifiers",
              )
              .eq("season", gw.season),
            // Hidden Gems (Sprint 15.5) — not season-scoped, keyed by player_code.
            supabase
              .from("player_rate_profile")
              .select("player_code, observed_minutes, dc90, cbit90, cbirt90, xgi90")
              .limit(1000),
          ]);
        if (playersRes.error) throw new Error(playersRes.error.message);
        if (teamsRes.error) throw new Error(teamsRes.error.message);

        const shorts = new Map(
          (teamsRes.data ?? []).map((t) => [t.id as number, t.short_name as string]),
        );

        // Sprint 12.5 — resolve each team's manager profile into one summary
        // line, disclosed context shown in the player detail panel.
        const profileByManagerKey = new Map(
          ((tacticalRes.data ?? []) as PlManagerRow[]).map((r) => [r.manager_key, toTacticalProfile(r)]),
        );
        const tactical = new Map<number, string>();
        for (const t of teamsRes.data ?? []) {
          const managerKey = t.tactical_manager_id as string | null;
          const profile = managerKey ? profileByManagerKey.get(managerKey) : undefined;
          if (profile) tactical.set(t.id as number, tacticalSummary(profile));
        }
        setTacticalByTeam(tactical);

        // Squad rules come from the database, never hardcoded — FPL has
        // changed budget and squad size between seasons.
        const loadedRules: SquadRules = ctx.rules;

        // Upcoming fixtures per club, for the whole remaining season — the
        // first feeds the pitch card, the first DISPLAY_GWS the detail
        // panel's ticker (sliced in toPlayerData below), and the full run
        // feeds risk/fixture scoring via fdrRun. Ordered by event, so index
        // 0 is next.
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

        setPlayers((playersRes.data ?? []) as PlayerRow[]);
        setTeamShort(shorts);
        setXp(new Map(((xpRes.data ?? []) as XpRow[]).map((r) => [r.player_id, r])));
        // first_event/last_event are constant across every row for one
        // season + model version, so any row gives the real window.
        const horizonsFirstRow = (xpRes.data ?? [])[0] as
          | { first_event: number | null; last_event: number | null }
          | undefined;
        setSeasonWindow(
          horizonsFirstRow?.first_event != null && horizonsFirstRow?.last_event != null
            ? horizonsFirstRow.last_event - horizonsFirstRow.first_event + 1
            : FALLBACK_SEASON_WINDOW,
        );
        setSeasonRange(
          horizonsFirstRow?.first_event != null && horizonsFirstRow?.last_event != null
            ? { first: horizonsFirstRow.first_event, last: horizonsFirstRow.last_event }
            : null,
        );
        setUpcoming(fixtures);
        setPredictions(
          new Map(((predsRes.data ?? []) as PredictionRow[]).map((r) => [r.player_id, r])),
        );
        setRateProfile(
          new Map(((rateProfileRes.data ?? []) as RateProfileRow[]).map((r) => [r.player_code, r])),
        );
        setRules(loadedRules);

        const existing = listDrafts();
        setDrafts(existing);

        // Scenario Lab links here with ?draft=<id>; fall back to the most
        // recently saved draft when the id is absent or stale.
        const requested = resolveRequestedDraft(existing, window.location.search);
        const initial = requested ?? emptyTeamState(loadedRules);
        setTeam(initial);
        // Anything that came out of storage is by definition already saved.
        setSavedTeam(existing.some((d) => d.draftId === initial.draftId) ? initial : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --------------------------------------------------------- lookups

  const rowById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const metaById = useMemo(() => {
    const m = new Map<number, PlayerMeta>();
    for (const p of players) {
      m.set(p.id, {
        id: p.id,
        elementType: p.element_type,
        teamId: p.team_id,
        nowCost: p.now_cost ?? 0,
        webName: p.web_name,
      });
    }
    return m;
  }, [players]);

  const lookup = useCallback((id: number) => metaById.get(id), [metaById]);

  const xpOf = useCallback(
    (id: number): HorizonXp | undefined => {
      const r = xp.get(id);
      if (!r) return undefined;
      return { xp1: r.xp_1, xp3: r.xp_3, xp5: r.xp_5, xp8: r.xp_8, xp19: r.xp_19, xpSeason: r.xp_total };
    },
    [xp],
  );

  const availabilityOf = useCallback(
    (id: number): number => {
      const p = rowById.get(id);
      if (!p) return 0;
      return availabilityFromStatus(p.status, p.chance_of_playing_next_round);
    },
    [rowById],
  );

  const isPenaltyTaker = useCallback(
    (id: number): boolean => rowById.get(id)?.penalties_order === 1,
    [rowById],
  );

  // ------------------------------------------- gameweek planning (Sprint 15.7)

  /** Raw per-fixture rows, keyed by player then event — a double gameweek is two entries. */
  interface SquadEventRow {
    xp: number;
    expectedMinutes: number | null;
    startProbability: number | null;
    fdr: number | null;
    opponentTeam: number | null;
    wasHome: boolean | null;
  }

  const squadIds = useMemo(
    () => [...new Set(team.players.map((p) => p.playerId))].sort((a, b) => a - b),
    [team.players],
  );
  /** A stable primitive key, so the fetch below only re-runs when the picks actually change. */
  const squadKey = squadIds.join(",");

  // Confident RSS headlines (Sprint 20) for the squad, one query shared via
  // lib/news-feed.ts rather than a second copy of /team's fetch.
  const [headlinesByCode, setHeadlinesByCode] = useState<Map<number, NewsHeadline[]>>(new Map());
  useEffect(() => {
    const codes = squadIds.map((id) => rowById.get(id)?.code).filter((c): c is number => c !== undefined);
    if (codes.length === 0) return;
    loadSquadHeadlines(supabase, codes).then(setHeadlinesByCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadKey, rowById]);

  const [squadEventRows, setSquadEventRows] = useState<Map<number, Map<number, SquadEventRow[]>>>(
    new Map(),
  );

  useEffect(() => {
    // No reset to an empty map on the early-return branch: an emptied squad
    // (e.g. "New draft") renders no picks, so stale rows for players no
    // longer on the pitch are simply never looked up — nothing reads them.
    if (!season || nextEvent === null || squadIds.length === 0) return;
    let cancelled = false;
    (async () => {
      // 15 players x ~38 gameweeks is at most ~570 fixture rows, comfortably
      // under the API's 1000-row cap — unlike the pool-wide series above,
      // this needs no .range() paging.
      const { data, error } = await supabase
        .from("player_predictions")
        .select("player_id, event, xp, expected_minutes, start_probability, opponent_team, was_home, fdr")
        .eq("season", season)
        .in("player_id", squadIds)
        .gte("event", nextEvent);
      if (error || cancelled) return;
      const rows = new Map<number, Map<number, SquadEventRow[]>>();
      for (const r of data ?? []) {
        const id = r.player_id as number;
        const event = r.event as number;
        let byEvent = rows.get(id);
        if (!byEvent) rows.set(id, (byEvent = new Map()));
        const list = byEvent.get(event);
        const row: SquadEventRow = {
          xp: Number(r.xp ?? 0),
          expectedMinutes: r.expected_minutes as number | null,
          startProbability: r.start_probability as number | null,
          fdr: r.fdr as number | null,
          opponentTeam: r.opponent_team as number | null,
          wasHome: r.was_home as boolean | null,
        };
        if (list) list.push(row);
        else byEvent.set(event, [row]);
      }
      if (!cancelled) setSquadEventRows(rows);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, nextEvent, squadKey]);

  /**
   * One player-gameweek's aggregated shape for the squad — the single source
   * the gameweek lineup panel, the pitch cards, and the cheap-chip checks all
   * read from, so they cannot disagree about what a future gameweek looks
   * like. A double gameweek's xP and expected minutes sum (both are
   * genuinely earned twice); start probability takes the max (only one start
   * is needed to justify picking the player); fdr is the mean of the two
   * fixtures; opponents join. A gameweek absent from this map is a blank —
   * deliberately not represented as a zero-valued entry, so the UI can tell
   * "no fixture" from "a fixture worth nothing" apart.
   */
  const squadEventAgg = useMemo(() => {
    const out = new Map<
      number,
      Map<
        number,
        {
          xp: number;
          expectedMinutes: number | null;
          startProbability: number | null;
          fdr: number | null;
          opponent: string | null;
          isHome: boolean | null;
        }
      >
    >();
    for (const [playerId, byEvent] of squadEventRows) {
      const outByEvent = new Map<
        number,
        {
          xp: number;
          expectedMinutes: number | null;
          startProbability: number | null;
          fdr: number | null;
          opponent: string | null;
          isHome: boolean | null;
        }
      >();
      for (const [event, rows] of byEvent) {
        let xp = 0;
        let minutes = 0;
        let hasMinutes = false;
        let startProbability: number | null = null;
        let fdrSum = 0;
        let fdrCount = 0;
        const opponents: string[] = [];
        for (const r of rows) {
          xp += r.xp;
          if (r.expectedMinutes !== null) {
            minutes += r.expectedMinutes;
            hasMinutes = true;
          }
          if (r.startProbability !== null) {
            startProbability =
              startProbability === null ? r.startProbability : Math.max(startProbability, r.startProbability);
          }
          if (r.fdr !== null) {
            fdrSum += r.fdr;
            fdrCount++;
          }
          opponents.push(r.opponentTeam !== null ? (teamShort.get(r.opponentTeam) ?? "?") : "?");
        }
        outByEvent.set(event, {
          xp,
          expectedMinutes: hasMinutes ? minutes : null,
          startProbability,
          fdr: fdrCount > 0 ? fdrSum / fdrCount : null,
          opponent: opponents.length > 0 ? opponents.join(", ") : null,
          isHome: rows[0]?.wasHome ?? null,
        });
      }
      out.set(playerId, outByEvent);
    }
    return out;
  }, [squadEventRows, teamShort]);

  /** Squad-scoped xP-only view of `squadEventAgg`, for `projectionAtEvent`'s `seriesOf`. */
  const squadXpSeries = useMemo(() => {
    const out = new Map<number, Map<number, number>>();
    for (const [id, byEvent] of squadEventAgg) {
      const m = new Map<number, number>();
      for (const [event, agg] of byEvent) m.set(event, agg.xp);
      out.set(id, m);
    }
    return out;
  }, [squadEventAgg]);

  const squadXpSeriesOf = useCallback((id: number) => squadXpSeries.get(id), [squadXpSeries]);

  /** The gameweek the planning panel shows — defaults to next, once known. */
  const effectiveEvent = selectedEvent ?? nextEvent;

  /** A `predAt` over the squad's own per-event data, for the cheap-chip checks below. */
  const squadPredAt = useCallback(
    (id: number, event: number) => {
      const agg = squadEventAgg.get(id)?.get(event);
      return {
        expectedMinutes: agg?.expectedMinutes ?? null,
        startProbability: agg?.startProbability ?? null,
        availability: availabilityOf(id),
        fdr: agg?.fdr ?? null,
        xp: agg?.xp ?? null,
      };
    },
    [squadEventAgg, availabilityOf],
  );

  /**
   * Bench Boost / Triple Captain for the selected planning gameweek — Free
   * Hit and Wildcard are not offered here: both are full-squad rebuilds over
   * the search `/chips` already runs, and re-running that on every builder
   * edit would make the page unusable.
   */
  const cheapChips = useMemo(() => {
    if (effectiveEvent === null || team.players.length !== rules.squadSize) return null;
    return {
      bboost: benchBoostAt(team.players, effectiveEvent, squadPredAt, lookup, isPenaltyTaker),
      threeXC: tripleCaptainAt(team, effectiveEvent, squadPredAt, availabilityOf, lookup, isPenaltyTaker),
    };
  }, [effectiveEvent, team, rules.squadSize, squadPredAt, lookup, isPenaltyTaker, availabilityOf]);

  const validation = useMemo(() => validateSquad(team, rules, lookup), [team, rules, lookup]);

  /** Projection at the selected horizon, plus next-GW for the lineup panel. */
  const projection = useMemo(
    () =>
      computeProjection(team.players, xpOf, availabilityOf, team.captain, team.viceCaptain, horizon),
    [team.players, team.captain, team.viceCaptain, xpOf, availabilityOf, horizon],
  );

  const projectionGw = useMemo(
    () => computeProjection(team.players, xpOf, availabilityOf, team.captain, team.viceCaptain, 1),
    [team.players, team.captain, team.viceCaptain, xpOf, availabilityOf],
  );

  /** Projection for the gameweek lineup panel's selected event — walks forward with `effectiveEvent`. */
  const eventProjection = useMemo(() => {
    if (effectiveEvent === null) return null;
    return projectionAtEvent(
      team.players,
      squadXpSeriesOf,
      availabilityOf,
      team.captain,
      team.viceCaptain,
      effectiveEvent,
    );
  }, [team.players, team.captain, team.viceCaptain, squadXpSeriesOf, availabilityOf, effectiveEvent]);

  const optimizerPool = useMemo<OptimizerPlayer[]>(
    () =>
      players.map((p) => {
        const r = xp.get(p.id);
        return {
          id: p.id,
          elementType: p.element_type,
          teamId: p.team_id,
          price: p.now_cost ?? 0,
          xp: {
            1: r?.xp_1 ?? null,
            3: r?.xp_3 ?? null,
            5: r?.xp_5 ?? null,
            8: r?.xp_8 ?? null,
            19: r?.xp_19 ?? null,
            season: r?.xp_total ?? null,
          },
          // Lets the Risk control price uncertainty: Low optimises this bottom
          // edge, so a squad is not quietly filled with prior-based punts.
          xpLower: {
            1: r?.xp_1_lower ?? null,
            3: r?.xp_3_lower ?? null,
            5: r?.xp_5_lower ?? null,
            8: r?.xp_8_lower ?? null,
            19: r?.xp_19_lower ?? null,
            season: r?.xp_total_lower ?? null,
          },
          reliability: r?.reliability ?? undefined,
          ownership: p.selected_by_percent,
          status: p.status,
          chanceNextRound: p.chance_of_playing_next_round,
        };
      }),
    [players, xp],
  );

  // --------------------------------------------------------- actions

  const persist = (next: TeamState) => {
    setTeam(next);
    setSaved(null);
  };

  /** Switching or creating a draft invalidates the undo slot. */
  const switchTeam = (next: TeamState, isStored = false) => {
    setTeam(next);
    setSaved(null);
    setPreviousTeam(null);
    setOptimizeNote(null);
    setSavedTeam(isStored ? next : null);
  };

  const onSave = () => {
    const stored = saveDraft(team);
    setTeam(stored);
    setDrafts(listDrafts());
    setSaved(`Saved ${new Date(stored.updatedAt).toLocaleTimeString()}`);
    setPreviousTeam(null);
    setSavedTeam(stored);
  };

  /**
   * Unsaved changes. A draft that has never been saved counts as dirty only
   * once it holds a player, so an empty "New draft" does not offer to save
   * nothing.
   */
  const isDirty =
    savedTeam === null ? team.players.length > 0 : !sameSquadState(team, savedTeam);

  const onResetToSaved = () => {
    if (savedTeam === null) return;
    setTeam(savedTeam);
    setPreviousTeam(null);
    setOptimizeNote(null);
    setSaved("Reset to the last saved squad");
  };

  // Was a plain synchronous call from onClick with no busy state and no
  // disabling of the trigger buttons, so a double-click on "Rebuild" ran the
  // knapsack search twice in quick succession (Sprint 19, Stage 3). Gated the
  // same way as the deadline optimiser: guard against re-entry, disable the
  // triggers while running, and yield one frame via setTimeout(0) so the
  // "Optimising…" label can actually paint before the search blocks the
  // thread.
  const runOptimizer = (clearFirst: boolean) => {
    if (optimizerRunning) return;
    setOptimizerRunning(true);
    // Snapshot before touching anything, so a rebuild is always reversible.
    setPreviousTeam(team);

    setTimeout(() => {
      const base = clearFirst
        ? { ...team, players: [], captain: null, viceCaptain: null, startingXI: [], benchOrder: [] }
        : team;

      const result = optimizeSquad({
        pool: optimizerPool,
        rules,
        locked: base.players,
        horizon,
        strategy,
        risk,
      });

      if (result.error) {
        setOptimizeNote(result.error);
        setPreviousTeam(null);
        setOptimizerRunning(false);
        return;
      }

      const poolById = new Map(optimizerPool.map((p) => [p.id, p]));
      const armband = suggestArmband(result.picks, poolById, horizon);

      persist({
        ...base,
        players: result.picks,
        strategy,
        captain: base.captain ?? armband.captain,
        viceCaptain: base.viceCaptain ?? armband.vice,
      });

      setOptimizeNote(
        `Filled ${result.filled} slot${result.filled === 1 ? "" : "s"}` +
          (result.lowReliability > 0
            ? ` · ${result.lowReliability} projected mostly from a position/price prior`
            : ""),
      );
      setOptimizerRunning(false);
    }, 0);
  };

  // -------------------------------------------------------- filtering

  /** The pool's real price bounds, which drive the slider's own min/max. */
  const priceBounds = useMemo<[number, number] | null>(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of players) {
      const cost = p.now_cost;
      if (cost === null || cost === undefined) continue;
      if (cost < lo) lo = cost;
      if (cost > hi) hi = cost;
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
  }, [players]);

  /**
   * `filters` stays null until touched; render and filtering both fall back
   * to a fresh default seeded from the pool's real price bounds. The first
   * actual edit sets `filters` to a concrete object via `onChange`, so this
   * needs no effect to "initialize" state derived from other state.
   */
  const resolvedFilters = filters ?? (priceBounds ? defaultPlayerFilters(priceBounds) : null);

  // ------------------------------------------------- Sprint 4 candidates
  //
  // Moved up from beside the lineup/replacement code below so `gemsById` is
  // available to the picker's own filtering, which now includes special
  // options (gem archetype, set-piece role) alongside search/team/price.

  const scoredById = useMemo(() => {
    const m = new Map<number, ScoredPlayer>();
    for (const p of players) {
      const r = xp.get(p.id);
      m.set(p.id, {
        id: p.id,
        webName: p.web_name,
        elementType: p.element_type,
        teamId: p.team_id,
        teamShort: teamShort.get(p.team_id) ?? null,
        price: p.now_cost ?? 0,
        ownership: p.selected_by_percent,
        pointsPerGame: p.points_per_game,
        xp: {
            1: r?.xp_1 ?? null,
            3: r?.xp_3 ?? null,
            5: r?.xp_5 ?? null,
            8: r?.xp_8 ?? null,
            19: r?.xp_19 ?? null,
            season: r?.xp_total ?? null,
          },
        xpLower: {
            1: r?.xp_1_lower ?? null,
            3: r?.xp_3_lower ?? null,
            5: r?.xp_5_lower ?? null,
            8: r?.xp_8_lower ?? null,
            19: r?.xp_19_lower ?? null,
            season: r?.xp_total_lower ?? null,
          },
        reliability: r?.reliability ?? undefined,
        priorWeight: r?.prior_weight ?? null,
        expectedMinutes: predictions.get(p.id)?.expected_minutes ?? null,
        startProbability: predictions.get(p.id)?.start_probability ?? null,
        availability: availabilityOf(p.id),
        fdrRun: (upcoming.get(p.team_id) ?? []).map((f) => f.fdr),
      });
    }
    return m;
  }, [players, xp, teamShort, predictions, upcoming, availabilityOf]);

  // Hidden Gems (Sprint 15.5) — computed once over the whole pool, same
  // `scoredById` every other ranking here uses, joined to `player_rate_profile`
  // via each row's `code`.
  const gemCandidates = useMemo<GemCandidate[]>(
    () =>
      players.flatMap((p) => {
        const player = scoredById.get(p.id);
        if (!player) return [];
        const rp = rateProfile.get(p.code);
        return [
          {
            player,
            rates: {
              observedMinutes: rp?.observed_minutes ?? null,
              dc90: rp?.dc90 ?? null,
              positionDc90: p.element_type === 2 ? rp?.cbit90 ?? null : rp?.cbirt90 ?? null,
              xgi90: rp?.xgi90 ?? null,
            },
          },
        ];
      }),
    [players, scoredById, rateProfile],
  );

  const gemsById = useMemo(() => {
    const verdicts = detectGems(gemCandidates, horizon, DEFAULT_GEM_CUTS, seasonWindow);
    return new Map(verdicts.map((v) => [v.playerId, v]));
  }, [gemCandidates, horizon, seasonWindow]);

  /**
   * While replacing a squad player, the players list below the finder should
   * let you pick the replacement yourself instead of only offering the
   * ranked top-N — narrowed to the same legal, affordable, club-legal set
   * `findReplacements` computes. Reuses `replacementLegality` rather than
   * restating position/budget/club-cap checks a second time.
   */
  const replaceEligibility = useMemo(() => {
    if (replaceFor === null) return null;
    const target = metaById.get(replaceFor);
    if (!target) return null;
    return replacementLegality(
      { id: target.id, elementType: target.elementType, price: target.nowCost },
      team,
      rules,
      lookup,
    );
  }, [replaceFor, metaById, team, rules, lookup]);

  /**
   * The stable "n legal targets" count for the banner — deliberately not
   * `filtered.length`, which also reflects the user's own search/team/price
   * narrowing on top and would make the number wobble as they type.
   */
  const eligibleCount = useMemo(() => {
    if (!replaceEligibility) return 0;
    return players.filter((p) =>
      replaceEligibility.isEligible({
        id: p.id,
        elementType: p.element_type,
        price: p.now_cost ?? 0,
        teamId: p.team_id,
      }),
    ).length;
  }, [players, replaceEligibility]);

  const filtered = useMemo(() => {
    if (!resolvedFilters) return [];
    const rows = players.filter((p) => {
      if (
        replaceEligibility &&
        !replaceEligibility.isEligible({
          id: p.id,
          elementType: p.element_type,
          price: p.now_cost ?? 0,
          teamId: p.team_id,
        })
      ) {
        return false;
      }
      return matchesFilters(p, resolvedFilters, gemsById);
    });

    const value = (p: PlayerRow) => {
      switch (sortKey) {
        case "xp5":
          return xp.get(p.id)?.xp_5 ?? -1;
        case "xp1":
          return xp.get(p.id)?.xp_1 ?? -1;
        case "price":
          return p.now_cost ?? -1;
        case "ownership":
          return p.selected_by_percent ?? -1;
      }
    };

    return rows.sort((a, b) => value(b) - value(a));
  }, [players, xp, resolvedFilters, sortKey, replaceEligibility, gemsById]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  /** Any filter change invalidates the current page index. */
  const changeFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };

  /**
   * Any pool player in the shape the pitch card and detail panel want. Shared
   * so the picker and the pitch show identical information.
   *
   * `event`, when given, switches the card to the squad's own per-gameweek
   * data (`squadEventAgg`) instead of the page horizon — only `squadCards`
   * passes it, since `squadEventAgg` is squad-scoped and every other caller
   * (the picker, pool-wide) stays on the horizon-based figures.
   */
  const toPlayerData = useCallback(
    (row: PlayerRow, event?: number): PlayerData => {
      const fixtures = upcoming.get(row.team_id) ?? [];
      const pred = predictions.get(row.id);
      const agg = event !== undefined ? squadEventAgg.get(row.id)?.get(event) : undefined;
      return {
        id: row.id,
        web_name: row.web_name,
        team_code: row.team_code,
        element_type: row.element_type,
        now_cost: row.now_cost ?? 0,
        expected_points: event !== undefined ? (agg?.xp ?? null) : xpAt(xpOf(row.id), horizon),
        status: row.status,
        chance_of_playing_next_round: row.chance_of_playing_next_round,
        is_captain: team.captain === row.id,
        is_vice_captain: team.viceCaptain === row.id,
        is_penalty_taker: row.penalties_order === 1,
        is_freekick_taker: row.direct_freekicks_order === 1,
        is_corner_taker: row.corners_and_indirect_freekicks_order === 1,
        next_fixture:
          event !== undefined
            ? agg
              ? {
                  opponent_short_name: agg.opponent ?? "—",
                  is_home: agg.isHome ?? true,
                  fdr: agg.fdr ?? 3,
                }
              : null
            : fixtures[0]
              ? {
                  opponent_short_name: fixtures[0].opponent_short_name,
                  is_home: fixtures[0].is_home,
                  fdr: fixtures[0].fdr,
                }
              : null,

        team_short: teamShort.get(row.team_id) ?? null,
        news: row.news,
        ownership: row.selected_by_percent,
        xp5: xp.get(row.id)?.xp_5 ?? null,
        expected_minutes: event !== undefined ? (agg?.expectedMinutes ?? null) : (pred?.expected_minutes ?? null),
        start_probability: event !== undefined ? (agg?.startProbability ?? null) : (pred?.start_probability ?? null),
        system: tacticalByTeam.get(row.team_id) ?? null,
        season_total_points: row.total_points,
        season_bonus: row.bonus,
        dc_actions: row.defensive_contribution,
        form: row.form,
        reliability: xp.get(row.id)?.reliability ?? undefined,
        prior_weight: xp.get(row.id)?.prior_weight ?? null,
        rate_lower: xp.get(row.id)?.xp_5_lower ?? null,
        rate_upper: xp.get(row.id)?.xp_5_upper ?? null,
        // The detail panel renders every entry in `upcoming` with no
        // truncation of its own, so the ticker's display length is sliced
        // here — `fixtures` itself (and fdrRun below) carries the whole
        // remaining season for risk/fixture scoring. The length follows the
        // page's horizon so the ticker shows the run the numbers beside it
        // were computed over, capped at MAX_TICKER_GWS.
        upcoming: fixtures.slice(0, Math.min(MAX_TICKER_GWS, horizonLength(horizon, seasonWindow))),
        headlines: headlinesByCode.get(row.code),
      };
    },
    [
      upcoming,
      predictions,
      xpOf,
      xp,
      horizon,
      seasonWindow,
      team.captain,
      team.viceCaptain,
      teamShort,
      tacticalByTeam,
      squadEventAgg,
      headlinesByCode,
    ],
  );

  const squadCards = useMemo<PlayerData[]>(
    () =>
      team.players.flatMap((pick) => {
        const row = rowById.get(pick.playerId);
        return row && effectiveEvent !== null ? [toPlayerData(row, effectiveEvent)] : [];
      }),
    [team.players, rowById, toPlayerData, effectiveEvent],
  );

  // ------------------------------------------------------ Sprint 3 lineup

  const lineup = useMemo(() => {
    if (team.players.length !== rules.squadSize || effectiveEvent === null) return null;

    const candidates: LineupCandidate[] = team.players.flatMap((pick) => {
      const row = rowById.get(pick.playerId);
      if (!row) return [];
      const agg = squadEventAgg.get(row.id)?.get(effectiveEvent);
      return [
        {
          playerId: row.id,
          elementType: row.element_type,
          webName: row.web_name,
          // A blank gameweek has no row at all — the same "no entry" the
          // optimiser already treats as zero, not a real xp: null missing
          // projection.
          xp: agg?.xp ?? null,
          expectedMinutes: agg?.expectedMinutes ?? null,
          startProbability: agg?.startProbability ?? null,
          availability: availabilityOf(row.id),
          fdr: agg?.fdr ?? null,
          opponent: agg?.opponent ?? null,
          isPenaltyTaker: row.penalties_order === 1,
        },
      ];
    });

    return optimiseLineup(candidates);
  }, [team.players, rules.squadSize, rowById, squadEventAgg, effectiveEvent, availabilityOf]);

  const budget = useMemo(
    () => squadBudget(team, rules, lookup, [...metaById.values()], lineup),
    [team, rules, lookup, metaById, lineup],
  );

  const applyLineup = () => {
    if (!lineup) return;
    persist({
      ...team,
      startingXI: lineup.starters,
      benchOrder: lineup.bench,
      captain: lineup.captain?.playerId ?? team.captain,
      viceCaptain: lineup.vice?.playerId ?? team.viceCaptain,
    });
  };

  /** Whether the stored lineup already equals the recommendation. */
  const lineupApplied = useMemo(() => {
    if (!lineup) return false;
    const same = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    return (
      same(team.startingXI, lineup.starters) &&
      same(team.benchOrder, lineup.bench) &&
      team.captain === (lineup.captain?.playerId ?? null) &&
      team.viceCaptain === (lineup.vice?.playerId ?? null)
    );
  }, [team.startingXI, team.benchOrder, team.captain, team.viceCaptain, lineup]);

  /**
   * The finder is conditionally mounted (`replaceFor !== null`), so it does
   * not exist in the DOM at the moment "Replace" is clicked — the scroll has
   * to happen from an effect keyed on replaceFor, once the panel has
   * rendered, not from the click handler itself. Below `lg` the page is a
   * single column with the pitch, lineup and optimiser cards all above this
   * panel, so on a phone tapping Replace previously looked like nothing had
   * happened until you scrolled several screens down to find it.
   */
  const replacePanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (replaceFor !== null) {
      replacePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [replaceFor]);
  /** The position filter as it stood before a replace locked it, restored by `stopReplacing`. */
  const preReplacePosition = useRef<number | null>(null);

  /**
   * Every "Replace" click goes through this instead of setReplaceFor
   * directly, so entering replace mode also locks the players-list position
   * filter to the outgoing player's position (the eligibility check already
   * enforces this; the control is locked too so it doesn't imply a filter it
   * no longer governs) and resets to page 1, matching every other filter
   * change — all in the same event, rather than a setState-in-effect chain.
   */
  const startReplacing = (id: number) => {
    setReplaceFor(id);
    const target = metaById.get(id);
    if (target && resolvedFilters) {
      preReplacePosition.current = resolvedFilters.position;
      setFilters({ ...resolvedFilters, position: target.elementType });
    }
    setPage(0);
  };

  /**
   * The one way out of replace mode, whether by Cancel or a completed swap —
   * un-locks the position filter back to whatever it was before, rather than
   * leaving it pinned to the outgoing player's position (which used to read
   * as a filter the user never chose, surfacing as a phantom "Filter (1)").
   */
  const stopReplacing = () => {
    setReplaceFor(null);
    if (preReplacePosition.current !== null) {
      const restore = preReplacePosition.current;
      preReplacePosition.current = null;
      setFilters((f) => (f ? { ...f, position: restore } : f));
    }
  };
  /** Replacement finder filters — each defaults to today's hardcoded value. */
  const [replaceLimit, setReplaceLimit] = useState<(typeof REPLACEMENT_LIMITS)[number]>(5);
  const [minStartOverride, setMinStartOverride] = useState(MINUTES_FLOOR);
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [replaceArchetype, setReplaceArchetype] = useState<GemArchetype | 0>(0);
  /** null = no cap beyond what selling the outgoing player affords. */
  const [maxPriceOverride, setMaxPriceOverride] = useState<number | null>(null);

  /**
   * Per-gameweek xP, keyed by player id then event — SquadBalance needs the
   * whole squad's week-by-week shape, not just the horizon total each
   * player already carries. Loaded lazily, only when the replacement panel
   * is first opened: at a 19-gameweek window this is ~11 paged requests
   * (the same PAGE_ROWS pattern /transfers already uses), which is too much
   * to pay on every builder load for a feature most visits never open.
   */
  const [seriesById, setSeriesById] = useState<Map<number, Map<number, number>> | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  // A ref, not state: it must not participate in the effect's own dependency
  // array. seriesLoading is reactive state set *inside* this effect, so if it
  // were also a dependency, setSeriesLoading(true) would retrigger the
  // effect, whose cleanup cancels the very fetch it just started — leaving
  // seriesLoading stuck true and seriesById stuck null forever. This ref
  // guards against a duplicate fetch without being part of that loop.
  const seriesLoadStarted = useRef(false);

  useEffect(() => {
    if (replaceFor === null || seriesById !== null || seriesLoadStarted.current || !season || nextEvent === null) {
      return;
    }
    seriesLoadStarted.current = true;
    let cancelled = false;
    (async () => {
      setSeriesLoading(true);
      const series = new Map<number, Map<number, number>>();
      for (let from = 0; ; from += PAGE_ROWS) {
        const { data: page, error } = await supabase
          .from("player_predictions")
          .select("player_id, event, xp")
          .eq("season", season)
          .gte("event", nextEvent)
          .order("player_id")
          .order("event")
          .range(from, from + PAGE_ROWS - 1);
        if (error || cancelled) break;
        for (const r of page ?? []) {
          const id = r.player_id as number;
          const event = r.event as number;
          let byEvent = series.get(id);
          if (!byEvent) series.set(id, (byEvent = new Map()));
          // Accumulate, don't overwrite: a double gameweek is two rows with
          // the same event, and it is genuinely worth both — this is the
          // same bug a squad's per-event series must not carry, below.
          byEvent.set(event, (byEvent.get(event) ?? 0) + Number(r.xp ?? 0));
        }
        if ((page?.length ?? 0) < PAGE_ROWS) break;
      }
      if (!cancelled) {
        setSeriesById(series);
        setSeriesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [replaceFor, seriesById, season, nextEvent]);

  /** Detail panel for a picker row, anchored to that row. */
  const [pickerDetail, setPickerDetail] = useState<{
    id: number;
    top: number;
    left: number;
  } | null>(null);
  const pickerCard = useRef<HTMLDivElement>(null);
  const closingPicker = useRef<number | null>(null);

  const closePickerDetail = useCallback(() => {
    closingPicker.current = pickerDetail?.id ?? null;
    setPickerDetail(null);
    setTimeout(() => {
      closingPicker.current = null;
    }, 0);
  }, [pickerDetail]);

  /**
   * Float the panel to the left of the picker column, level with the clicked
   * row. Viewport coordinates, so it never covers the list it came from.
   */
  const openPickerDetail = (row: PlayerRow, anchor: HTMLElement) => {
    if (closingPicker.current === row.id) return;
    const wrap = pickerCard.current;
    if (!wrap) return;

    const a = anchor.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();

    // Prefer the gutter to the left; fall back to the right on narrow screens.
    const leftGutter = w.left - PANEL_WIDTH - 8;
    const left = leftGutter >= 8 ? leftGutter : Math.max(8, w.right - PANEL_WIDTH - 8);

    const top = Math.max(
      8,
      Math.min(a.top - 24, window.innerHeight - PANEL_MAX_HEIGHT - 8),
    );

    setPickerDetail({ id: row.id, top, left });
  };

  /** What selling the outgoing player would leave to spend — the slider's ceiling. */
  const replaceAffordable = useMemo(() => {
    if (replaceFor === null) return 0;
    const target = scoredById.get(replaceFor);
    if (!target) return 0;
    const outgoing = team.players.find((p) => p.playerId === replaceFor);
    const spent = totalSpend(team.players);
    return team.budget - spent + (outgoing?.purchasePrice ?? target.price);
  }, [replaceFor, scoredById, team]);

  const replacements = useMemo<Replacement[]>(() => {
    if (replaceFor === null) return [];
    const target = scoredById.get(replaceFor);
    if (!target) return [];

    const squadBalance =
      seriesById && nextEvent !== null
        ? {
            seriesOf: (id: number) => seriesById.get(id),
            squadPlayerIds: team.players.map((p) => p.playerId),
            windowEvents: Array.from(
              { length: horizonLength(horizon, seasonWindow) },
              (_, i) => nextEvent + i,
            ),
          }
        : undefined;

    const archetypeIds =
      replaceArchetype !== 0
        ? new Set(
            [...gemsById.values()].filter((v) => v.archetype === replaceArchetype).map((v) => v.playerId),
          )
        : undefined;

    return findReplacements(
      target,
      [...scoredById.values()],
      team,
      rules,
      lookup,
      horizon,
      replaceLimit,
      {
        minStartProbability: minStartOverride,
        includeUnavailable,
        maxPrice: maxPriceOverride ?? undefined,
        seasonWindow,
        squadBalance,
        archetypeIds,
        reversibility: true,
      },
    );
  }, [
    replaceFor,
    scoredById,
    team,
    rules,
    lookup,
    horizon,
    replaceLimit,
    replaceArchetype,
    gemsById,
    minStartOverride,
    includeUnavailable,
    maxPriceOverride,
    seasonWindow,
    seriesById,
    nextEvent,
  ]);

  /** Everything the picker's detail panel needs, resolved outside of render. */
  const pickerPanel = useMemo(() => {
    if (!pickerDetail) return null;
    const row = rowById.get(pickerDetail.id);
    const meta = metaById.get(pickerDetail.id);
    if (!row || !meta) return null;
    return {
      player: toPlayerData(row),
      top: pickerDetail.top,
      left: pickerDetail.left,
      owned: team.players.some((p) => p.playerId === pickerDetail.id),
      // In replace mode this row only exists because replaceEligibility
      // already passed it, same reasoning as the picker table's own reason.
      addDisabledReason: replaceFor !== null ? null : blockedReason(team, rules, meta, lookup),
    };
  }, [pickerDetail, rowById, metaById, toPlayerData, team, rules, lookup, replaceFor]);

  /** Swap in one action so the squad is never transiently illegal. */
  const doSwap = (outId: number, incoming: PlayerMeta) => {
    persist(addPlayer(removePlayer(team, outId), incoming));
    stopReplacing();
  };

  // ------------------------------------------------------------- view

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <p role="status" className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading player pool…
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      </main>
    );
  }

  const captainName =
    team.captain !== null ? (rowById.get(team.captain)?.web_name ?? "—") : null;
  const viceName =
    team.viceCaptain !== null ? (rowById.get(team.viceCaptain)?.web_name ?? "—") : null;

  const chip = (ok: boolean, label: string) => (
    <span
      key={label}
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
        ok
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-[#00FF87]"
          : "bg-zinc-100 text-zinc-500 dark:bg-[#2A0A45] dark:text-zinc-400"
      }`}
    >
      {ok ? "✓" : "○"} {label}
    </span>
  );

  const pitchHeader = (
    <div className="space-y-2">
      {/* Budget */}
      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-zinc-500">
            {money(validation.spent)} of {money(rules.totalSpend)} · {team.players.length}/
            {rules.squadSize} players
          </span>
          <span
            className={`font-semibold tabular-nums ${
              validation.overBudget
                ? "text-red-600 dark:text-red-400"
                : "text-zinc-900 dark:text-zinc-100"
            }`}
          >
            {money(validation.budgetRemaining)} left
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-[#2A0A45]">
          <div
            className={`h-full rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none ${
              validation.overBudget ? "bg-red-500" : "bg-purple-800 dark:bg-[#00FF87]"
            }`}
            style={{ width: `${Math.min(100, (validation.spent / rules.totalSpend) * 100)}%` }}
          />
        </div>
        {budget.splitKnown && (
          <div className="mt-1 flex items-baseline justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>
              XI {money(budget.xiSpend!)} · bench {money(budget.benchSpend!)}
              {budget.benchSurplus! > 0 && (
                <>
                  {" "}
                  <span className="text-amber-700 dark:text-amber-400">
                    (£{(budget.benchSurplus! / 10).toFixed(1)}m above the cheapest legal bench)
                  </span>
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Requirements. Collapsed once everything passes — the detail only
          matters while something is still missing. */}
      <details open={!validation.isLegal} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px]">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold ${
              validation.isLegal
                ? "bg-emerald-600 text-white dark:bg-[#00FF87] dark:text-slate-950"
                : "bg-zinc-200 text-zinc-600 dark:bg-purple-900/60 dark:text-zinc-300"
            }`}
          >
            {validation.isLegal ? "✓ Legal squad" : "Incomplete squad"}
          </span>
          <span className="text-zinc-500">
            {team.players.length}/{rules.squadSize} · {money(validation.budgetRemaining)} left
          </span>
          <span className="ml-auto text-zinc-400 group-open:hidden">show requirements ▾</span>
          <span className="ml-auto hidden text-zinc-400 group-open:inline">hide ▴</span>
        </summary>

        <div className="mt-2 flex flex-wrap gap-1">
          {validation.positions.map((p) =>
            chip(p.filled === p.required, `${POSITIONS[p.elementType]} ${p.filled}/${p.required}`),
          )}
          {chip(!validation.overBudget, "Budget")}
          {chip(
            validation.clubsValid,
            validation.clubBreaches.length > 0
              ? `Club limit: ${validation.clubBreaches
                  .map((b) => `${teamShort.get(b.teamId) ?? b.teamId} ${b.count}`)
                  .join(", ")}`
              : `≤${rules.teamLimit}/club`,
          )}
          {chip(validation.hasCaptain, "Captain")}
          {chip(validation.hasViceCaptain, "Vice")}
        </div>
      </details>
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Team Builder
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Build or optimise a squad and project it with the xP model. Drafts are saved in this
            browser.
          </p>
        </div>

        {/* drafts bar */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* Page-level horizon: drives the projection, the picker, and the
              optimiser. The XI/captain panel stays on the next gameweek. */}
          <span className="flex items-center gap-1 rounded-md border border-zinc-300 px-1.5 py-1 dark:border-purple-800/50">
            <span className="text-xs text-zinc-500">Horizon</span>
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                title={h === "season" ? seasonHorizonNote(seasonWindow) : undefined}
                aria-pressed={horizon === h}
                className={`rounded px-1.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  horizon === h
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {horizonLabel(h)}
              </button>
            ))}
          </span>

          {drafts.length > 0 && (
            <select
              value={team.draftId}
              aria-label="Squad"
              onChange={(e) => {
                const found = drafts.find((d) => d.draftId === e.target.value);
                if (!found) return;
                // Switching drafts discards any unsaved edits to the current
                // one with no way back — the one navigation this page can't
                // let happen silently.
                if (
                  isDirty &&
                  !window.confirm(
                    `Switch to "${found.name}"? Unsaved changes to "${team.name}" will be lost.`,
                  )
                ) {
                  return;
                }
                switchTeam(found, true);
              }}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
            >
              {drafts.every((d) => d.draftId !== team.draftId) && (
                <option value={team.draftId}>{team.name} (unsaved)</option>
              )}
              {drafts.map((d) => (
                <option key={d.draftId} value={d.draftId}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={team.name}
            onChange={(e) => persist({ ...team, name: e.target.value })}
            aria-label="Draft name"
            className="w-36 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus:border-[#00FF87]"
          />
          <ActionMenu
            primaryLabel="Save"
            onPrimary={onSave}
            primaryDisabled={!isDirty}
            primaryDisabledReason="No unsaved changes"
            menuLabel="Draft actions"
            items={[
              // Only offered once there is a saved state to return to.
              ...(savedTeam !== null
                ? [
                    {
                      label: "Reset to saved",
                      onSelect: onResetToSaved,
                      disabled: !isDirty,
                      disabledReason: "No unsaved changes",
                      description: "Discard changes since the last save",
                    },
                  ]
                : []),
              {
                label: "New",
                onSelect: () => switchTeam(emptyTeamState(rules)),
                description: isDirty ? "Unsaved changes will be lost" : undefined,
              },
              {
                label: "Clone",
                onSelect: () => {
                  const copy = cloneDraft(team);
                  setTeam(copy);
                  setSavedTeam(copy);
                  setDrafts(listDrafts());
                  setSaved("Cloned");
                },
                description: "Save a copy and switch to it",
              },
              {
                label: "Delete",
                onSelect: () => {
                  deleteDraft(team.draftId);
                  const rest = listDrafts();
                  setDrafts(rest);
                  switchTeam(rest[0] ?? emptyTeamState(rules), rest.length > 0);
                },
                danger: true,
                confirm: true,
                description: "Permanently removes this draft",
              },
            ]}
          />
          {saved && (
            <span role="status" className="text-xs text-zinc-500">
              {saved}
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ============================================ pitch column */}
        <section className="min-w-0 space-y-4">
          {/* prominent xP panel */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <div
                  className="text-xs uppercase tracking-wide text-zinc-500"
                  title={horizon === "season" ? seasonHorizonNote(seasonWindow) : undefined}
                >
                  {horizon === "season"
                    ? "Projected · rest of season*"
                    : `Projected · next ${horizon} GW${horizon === 1 ? "" : "s"}`}
                </div>
                <div className="text-4xl font-extrabold tabular-nums text-purple-900 dark:text-[#00FF87]">
                  {projection.total.toFixed(1)}
                </div>
              </div>
              {horizon !== 1 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Next GW</div>
                  <div className="text-3xl font-bold tabular-nums text-purple-800 dark:text-[#00FF87]/80">
                    {projectionGw.total.toFixed(1)}
                  </div>
                </div>
              )}
              <div className="ml-auto text-right text-xs text-zinc-500">
                {/* Keyed on whether a captain is set, not on the bonus being
                    positive — captaining a player the model declined to
                    project gives a 0.0 bonus, which is informative rather
                    than a sign that nobody wears the armband. */}
                {team.captain !== null ? (
                  <div className="flex items-center justify-end gap-2">
                    <CaptainBadge className="h-6 w-6" />
                    <span>
                      <span className="font-semibold text-purple-800 dark:text-[#00FF87]">
                        +{projection.captainBonus.toFixed(1)}
                      </span>{" "}
                      armband bonus{captainName ? ` · ${captainName}` : ""}
                    </span>
                  </div>
                ) : (
                  <p>Pick a captain to add the armband bonus</p>
                )}
                {viceName && (
                  <div className="mt-1 flex items-center justify-end gap-2">
                    <ViceCaptainBadge className="h-5 w-5" />
                    <span>{viceName}</span>
                  </div>
                )}
                {projection.missing > 0 && (
                  <p className="mt-1 text-amber-700 dark:text-amber-400">
                    {projection.missing} pick{projection.missing === 1 ? "" : "s"} without an xP
                    projection
                  </p>
                )}
              </div>
            </div>
            {horizon === "season" && (
              <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] leading-relaxed text-amber-700 dark:border-purple-900/40 dark:text-amber-400">
                * {seasonHorizonNote(seasonWindow)}
              </p>
            )}
            {cheapChips && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-100 pt-2.5 text-xs dark:border-purple-900/40">
                <span className="text-zinc-500">
                  GW{effectiveEvent} chips
                </span>
                <span
                  title={cheapChips.bboost.explanation.join(" ")}
                  className="cursor-help text-zinc-700 dark:text-zinc-300"
                >
                  Bench Boost{" "}
                  <span className="font-semibold tabular-nums text-purple-800 dark:text-[#00FF87]">
                    {cheapChips.bboost.gain >= 0 ? "+" : ""}
                    {cheapChips.bboost.gain.toFixed(1)}
                  </span>
                </span>
                <span
                  title={cheapChips.threeXC.explanation.join(" ")}
                  className="cursor-help text-zinc-700 dark:text-zinc-300"
                >
                  Triple Captain{" "}
                  <span className="font-semibold tabular-nums text-purple-800 dark:text-[#00FF87]">
                    {cheapChips.threeXC.gain >= 0 ? "+" : ""}
                    {cheapChips.threeXC.gain.toFixed(1)}
                  </span>
                </span>
                <Link
                  href={`/chips?draft=${team.draftId}`}
                  className="ml-auto text-purple-700 underline-offset-2 hover:underline dark:text-[#00FF87]"
                >
                  Free Hit &amp; Wildcard schedule →
                </Link>
              </div>
            )}
          </div>

          <PitchView
            squad={squadCards}
            quota={rules.positionQuota}
            layout={lineup ? layoutFromLineup(lineup) : null}
            header={pitchHeader}
            onSetCaptain={(id) => persist(setCaptain(team, id))}
            onSetVice={(id) => persist(setViceCaptain(team, id))}
            onRemove={(id) => persist(removePlayer(team, id))}
            onFindReplacement={startReplacing}
          />
        </section>

        {/* ========================================== selector column */}
        <section className="min-w-0 space-y-4">
          {/* Sprint 3/15.7: lineup + armband recommendation, walkable by gameweek */}
          {lineup && effectiveEvent !== null && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Gameweek lineup
                  <select
                    value={effectiveEvent}
                    onChange={(e) => setSelectedEvent(Number(e.target.value))}
                    aria-label="Planning gameweek"
                    className="rounded border border-input bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-zinc-300"
                  >
                    {(nextEvent !== null
                      ? Array.from(
                          { length: (seasonRange?.last ?? nextEvent) - nextEvent + 1 },
                          (_, i) => nextEvent + i,
                        )
                      : []
                    ).map((g) => (
                      <option key={g} value={g}>
                        GW{g}
                        {g === nextEvent ? " (next)" : ""}
                      </option>
                    ))}
                  </select>
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    if (!lineupApplied) applyLineup();
                  }}
                  aria-disabled={lineupApplied}
                  title={
                    lineupApplied
                      ? "XI and armband already match the recommendation"
                      : `Apply the recommended XI, bench order, and armband for GW${effectiveEvent}`
                  }
                  className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                >
                  {lineupApplied ? "Applied" : `Apply GW${effectiveEvent} XI & armband`}
                </button>
              </div>

              {effectiveEvent !== nextEvent && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                  Planning view for a future gameweek — this is a projection, not the lineup you
                  submit this week. Blank fixtures show as blank, never a silent zero.
                </p>
              )}

              {/* team projection */}
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {[
                  ["Formation", lineup.formation],
                  ["Starting XI", `${lineup.startersXp.toFixed(1)} xP`],
                  ["Bench (raw)", `${lineup.benchXp.toFixed(1)} xP`],
                  ["Bench via auto-subs", `${lineup.benchExpectedContribution.toFixed(1)} xP`],
                  ["Armband bonus", `${(eventProjection?.captainBonus ?? 0).toFixed(1)} xP`],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {value}
                    </dd>
                  </div>
                ))}
                <div className="col-span-2 mt-1 flex justify-between gap-2 border-t border-zinc-100 pt-1.5 dark:border-purple-900/40">
                  <dt className="font-medium text-zinc-600 dark:text-zinc-300">
                    Overall projection
                  </dt>
                  <dd className="font-bold tabular-nums text-purple-900 dark:text-[#00FF87]">
                    {(
                      lineup.startersXp +
                      lineup.benchExpectedContribution +
                      (eventProjection?.captainBonus ?? 0)
                    ).toFixed(1)}{" "}
                    xP
                  </dd>
                </div>
              </dl>

              {/* captain */}
              {lineup.captain && (
                <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-purple-900/40">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">
                      Recommended captain
                    </span>
                    <span
                      className="text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300"
                      title="Minutes certainty x availability x margin over the runner-up"
                    >
                      {Math.round(lineup.captain.confidence * 100)}% confidence
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-1.5">
                      <CaptainBadge className="h-6 w-6" />
                      <span className="text-base font-bold text-purple-900 dark:text-[#00FF87]">
                        {lineup.captain.webName}
                      </span>
                    </span>
                    {lineup.vice && (
                      <span className="flex items-center gap-1.5">
                        <ViceCaptainBadge className="h-5 w-5" />
                        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          {lineup.vice.webName}
                        </span>
                      </span>
                    )}
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                    {lineup.captain.reasons.map((r) => (
                      <li key={r}>✓ {r}</li>
                    ))}
                    {lineup.captain.caveats.map((c) => (
                      <li key={c} className="text-amber-700 dark:text-amber-400">
                        ! {c}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">
                    {CAPTAIN_MODEL_NOTE}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* optimizer */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Optimise squad
            </h2>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-zinc-500">Strategy</span>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as Strategy)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
                >
                  {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-zinc-500">Risk</span>
                <select
                  value={risk}
                  onChange={(e) => setRisk(e.target.value as RiskLevel)}
                  title={RISK_LABELS[risk]}
                  className="rounded-md border border-input bg-surface-3 px-2 py-1.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {Object.entries(RISK_LABELS).map(([k, v]) => (
                    <option key={k} value={k} title={v}>
                      {k[0].toUpperCase() + k.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => runOptimizer(false)}
                disabled={optimizerRunning}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {optimizerRunning && <Spinner />}
                {optimizerRunning ? "Optimising…" : "Fill remaining"}
              </button>
              <button
                type="button"
                onClick={() => runOptimizer(true)}
                disabled={optimizerRunning}
                className="flex items-center justify-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {optimizerRunning && <Spinner />}
                {optimizerRunning ? "Optimising…" : "Rebuild"}
              </button>
            </div>
            <div className="mt-2 flex items-start justify-between gap-2 text-[11px]">
              <p className="text-zinc-500">
                {optimizeNote ??
                  `Optimising over ${horizonLabel(horizon)} — “Fill remaining” keeps your picks, “Rebuild” starts empty.`}
              </p>
              {/* One-slot undo: the saved draft is untouched until Save, so
                  this restores exactly what a rebuild replaced. */}
              {previousTeam && (
                <button
                  type="button"
                  onClick={() => {
                    setTeam(previousTeam);
                    setPreviousTeam(null);
                    setOptimizeNote("Reverted to the previous squad");
                  }}
                  className="shrink-0 rounded border border-input px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  ↩ Revert
                </button>
              )}
            </div>
          </div>

          {/* replacement finder */}
          {replaceFor !== null && (
            <div
              ref={replacePanelRef}
              className="scroll-mt-4 rounded-xl border border-purple-300 bg-card p-4 dark:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Replace {scoredById.get(replaceFor)?.webName}{" "}
                  <span className="font-normal normal-case text-zinc-400">
                    · {horizonLabel(horizon)}
                  </span>
                </h2>
                <div className="flex shrink-0 items-center gap-2">
                  {replacements.length > 0 && (
                    <Link
                      href={`/compare?ids=${[replaceFor, ...replacements.slice(0, 3).map((r) => r.player.id)].join(",")}`}
                      className="rounded text-xs font-medium text-purple-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-primary"
                    >
                      Compare all
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => stopReplacing()}
                    aria-label="Close"
                    className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-purple-950/60"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* filters — collapsed behind Filter +, each defaults to the panel's prior fixed behaviour */}
              <div className="mt-3">
                <FilterDisclosure
                  activeCount={
                    (minStartOverride !== MINUTES_FLOOR ? 1 : 0) +
                    (includeUnavailable ? 1 : 0) +
                    (maxPriceOverride !== null ? 1 : 0) +
                    (replaceArchetype !== 0 ? 1 : 0) +
                    (replaceLimit !== 5 ? 1 : 0)
                  }
                >
                  <div className="flex flex-wrap items-end gap-x-5 gap-y-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <label className="flex items-center gap-2">
                      <span className="tabular-nums">
                        Min start {Math.round(minStartOverride * 100)}%
                      </span>
                      <ValueSlider
                        value={minStartOverride}
                        onValueChange={setMinStartOverride}
                        min={0}
                        max={1}
                        step={0.05}
                        label="Minimum start probability"
                        className={includeUnavailable ? "opacity-40" : undefined}
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="tabular-nums">
                        Max £{((maxPriceOverride ?? replaceAffordable) / 10).toFixed(1)}m
                      </span>
                      <ValueSlider
                        value={maxPriceOverride ?? replaceAffordable}
                        onValueChange={setMaxPriceOverride}
                        min={0}
                        max={Math.max(replaceAffordable, 1)}
                        step={5}
                        label="Maximum price"
                      />
                      {maxPriceOverride !== null && (
                        <button
                          type="button"
                          onClick={() => setMaxPriceOverride(null)}
                          className="rounded text-purple-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-primary"
                        >
                          reset
                        </button>
                      )}
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={includeUnavailable}
                        onChange={(e) => setIncludeUnavailable(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-zinc-300 text-purple-700 focus-visible:ring-2 focus-visible:ring-purple-500 dark:border-purple-800/50 dark:text-[#00FF87]"
                      />
                      Include below the minutes floor
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span>Show</span>
                      {REPLACEMENT_LIMITS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setReplaceLimit(n)}
                          aria-pressed={replaceLimit === n}
                          className={`rounded px-1.5 py-0.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            replaceLimit === n
                              ? "bg-primary text-primary-foreground"
                              : "border border-input hover:bg-muted"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-1.5">
                      <span>Archetype</span>
                      <select
                        value={replaceArchetype}
                        onChange={(e) =>
                          setReplaceArchetype(e.target.value === "0" ? 0 : (e.target.value as GemArchetype))
                        }
                        className="rounded border border-input bg-surface-3 px-1.5 py-0.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value={0}>Any</option>
                        {(Object.entries(GEM_ARCHETYPE_LABELS) as [GemArchetype, string][]).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <InfoTooltip label="What is a Hidden Gem?" align="right">
                        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                          {GEMS_MODEL_NOTE}
                        </p>
                      </InfoTooltip>
                    </label>
                  </div>
                </FilterDisclosure>
              </div>

              {replacements.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-500">
                  No legal, affordable candidate is available for this slot.
                </p>
              ) : (
                <>
                  {/* Don't let a ranked list imply these are upgrades when the
                      best of them is still worse than what you have. */}
                  {replacements[0].teamFit <= 0 && (
                    <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      Nothing available improves on this pick — the closest alternatives are shown
                      below.
                    </p>
                  )}
                  <ul className="mt-2 space-y-1.5">
                    {replacements.map((r) => (
                      <li
                        key={r.player.id}
                        className="flex items-start justify-between gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-xs dark:border-purple-900/40"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-100">
                            {r.player.webName}
                            <span className="font-normal text-zinc-500">
                              {r.player.teamShort} · £{(r.player.price / 10).toFixed(1)}m
                            </span>
                            <GemBadge verdict={gemsById.get(r.player.id)} />
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-500">
                            {r.rationale.join(" · ")}
                          </p>
                          <p className="mt-0.5 text-[10px] tabular-nums text-zinc-400">
                            xP {r.xpDelta >= 0 ? "+" : ""}
                            {r.xpDelta.toFixed(1)} · risk {r.riskDelta >= 0 ? "+" : ""}
                            {r.riskDelta} · fit {r.teamFit.toFixed(1)}
                            {r.exitRoutes !== undefined && (
                              <>
                                {" "}
                                ·{" "}
                                <span title="Other legal candidates at this position after this swap — an exit route, not a ranking factor.">
                                  {r.exitRoutes} exit route{r.exitRoutes === 1 ? "" : "s"}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const meta = metaById.get(r.player.id);
                            if (meta) doSwap(replaceFor, meta);
                          }}
                          className="shrink-0 rounded bg-primary px-2 py-1 font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Swap
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {seriesLoading && (
                <p className="mt-2 text-[10px] text-zinc-400">
                  Loading the week-by-week signal for SquadBalance…
                </p>
              )}
              <details className="group mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] text-zinc-500">
                  <span>How TeamFit is scored</span>
                  <span className="text-zinc-400 group-open:hidden">▸</span>
                  <span className="hidden text-zinc-400 group-open:inline">▾</span>
                </summary>
                <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-400">
                  {REPLACEMENT_MODEL_NOTE}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">
                  {RISK_MODEL_NOTE}
                </p>
              </details>
            </div>
          )}

          {/* player search */}
          <div
            ref={pickerCard}
            className="relative rounded-xl border border-zinc-200 bg-card p-3 dark:border-purple-900/40"
          >
            {replaceEligibility && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-purple-50 px-2.5 py-1.5 text-xs text-purple-900 dark:bg-purple-950/50 dark:text-purple-200">
                <span>
                  Replacing <strong>{metaById.get(replaceFor!)?.webName}</strong> — {eligibleCount}{" "}
                  legal target{eligibleCount === 1 ? "" : "s"}, max{" "}
                  £{(replaceEligibility.priceCeiling / 10).toFixed(1)}m
                </span>
                <button
                  type="button"
                  onClick={() => stopReplacing()}
                  className="shrink-0 rounded font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Cancel
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-start gap-2 text-xs">
              {resolvedFilters && priceBounds && (
                <PlayerFilters
                  value={resolvedFilters}
                  onChange={changeFilter(setFilters)}
                  teamOptions={[...teamShort.entries()].sort((a, b) => a[1].localeCompare(b[1]))}
                  priceBounds={priceBounds}
                  positionOptions={POSITIONS}
                  lockedPosition={replaceFor !== null ? resolvedFilters.position : undefined}
                />
              )}
              <select
                value={sortKey}
                onChange={(e) => changeFilter(setSortKey)(e.target.value as SortKey)}
                aria-label="Sort by"
                className="rounded-md border border-zinc-300 bg-white px-1.5 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
              >
                <option value="xp5">xP 5</option>
                <option value="xp1">xP GW</option>
                <option value="price">Price</option>
                <option value="ownership">Owned</option>
              </select>
            </div>

            <div className="mt-2 overflow-x-auto">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col />
                  <col className="w-11" />
                  <col className="w-14" />
                  <col className="w-10" />
                  <col className="w-9" />
                </colgroup>
                <thead>
                  <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                    <th className="py-1.5 pl-1">Player</th>
                    <th className="py-1.5">£</th>
                    <th className="py-1.5">{horizonLabel(horizon)}</th>
                    <th className="py-1.5">
                      <span className="inline-flex items-center gap-1">
                        Risk
                        <InfoTooltip label="How is Risk scored?">
                          <p className="text-xs leading-relaxed">{RISK_MODEL_NOTE}</p>
                        </InfoTooltip>
                      </span>
                    </th>
                    <th className="py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const meta = metaById.get(p.id)!;
                    // In replace mode `visible` is already narrowed to legal
                    // targets by replaceEligibility, so there is nothing left
                    // for blockedReason to block on — it would otherwise
                    // always say "squad full", since the outgoing player's
                    // slot hasn't been freed yet.
                    const reason = replaceFor !== null ? null : blockedReason(team, rules, meta, lookup);
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200"
                      >
                        <td className="py-1 pl-1">
                          <button
                            type="button"
                            onClick={(e) => openPickerDetail(p, e.currentTarget)}
                            className="block max-w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={`Details for ${p.web_name}`}
                          >
                            <span className="flex min-w-0 items-center gap-1">
                              <span
                                className="min-w-0 truncate font-medium underline-offset-2 hover:underline"
                                title={p.web_name}
                              >
                                {p.web_name}
                              </span>
                              <AvailabilityBadge
                                status={p.status}
                                chanceOfPlaying={p.chance_of_playing_next_round}
                                news={p.news}
                                size="w-3.5 h-3.5"
                              />
                              <RoleBadges
                                penaltyOrder={p.penalties_order}
                                freeKickOrder={p.direct_freekicks_order}
                                cornerOrder={p.corners_and_indirect_freekicks_order}
                                size="w-3.5 h-3.5"
                              />
                            </span>
                            <span className="block truncate text-[10px] text-zinc-500">
                              {teamShort.get(p.team_id)} · {POSITIONS[p.element_type]}
                              {/* Full name, so a hit on a hidden field doesn't look like a bug. */}
                              {fullName(p) ? ` · ${fullName(p)}` : ""}
                            </span>
                          </button>
                        </td>
                        <td className="py-1 tabular-nums">{((p.now_cost ?? 0) / 10).toFixed(1)}</td>
                        <td className="py-1 font-semibold tabular-nums text-purple-800 dark:text-primary">
                          {xpAt(xpOf(p.id), horizon)?.toFixed(1) ?? "—"}
                        </td>
                        <td className="py-1 tabular-nums text-zinc-500">
                          {scoredById.has(p.id)
                            ? riskScore(scoredById.get(p.id)!, horizon, seasonWindow)
                            : "—"}
                        </td>
                        <td className="py-1 pr-1 text-right">
                          <button
                            type="button"
                            disabled={reason !== null}
                            title={reason ?? (replaceFor !== null ? `Swap in ${p.web_name}` : `Add ${p.web_name}`)}
                            onClick={() => {
                              if (replaceFor !== null) doSwap(replaceFor, meta);
                              else persist(addPlayer(team, meta));
                            }}
                            className="rounded border border-input px-1.5 py-0.5 font-medium transition-colors hover:border-purple-700 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 dark:hover:border-primary dark:hover:text-primary"
                          >
                            {replaceFor !== null ? "⇄" : "+"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-zinc-500">
                        {replaceFor !== null && eligibleCount === 0
                          ? `No legal replacement for ${metaById.get(replaceFor)?.webName ?? "this player"} at £${(replaceEligibility!.priceCeiling / 10).toFixed(1)}m or less.`
                          : "No players match these filters."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* pager */}
            <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 text-xs dark:border-purple-900/30">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="rounded border border-input px-2 py-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
              >
                ‹ Prev
              </button>
              <span className="text-zinc-500">
                Page {safePage + 1} of {pageCount} · {filtered.length} player
                {filtered.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="rounded border border-input px-2 py-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
              >
                Next ›
              </button>
            </div>

            {/* Same detail panel the pitch uses, anchored to the picker row.
                Actions differ by context: pool players get Add and Find
                replacement, squad players the armband controls. */}
            {pickerPanel && (
              <PlayerDetail
                player={pickerPanel.player}
                top={pickerPanel.top}
                left={pickerPanel.left}
                fixed
                onClose={closePickerDetail}
                onSetCaptain={(id) => persist(setCaptain(team, id))}
                onSetVice={(id) => persist(setViceCaptain(team, id))}
                onRemove={(id) => persist(removePlayer(team, id))}
                owned={pickerPanel.owned}
                addDisabledReason={pickerPanel.addDisabledReason}
                addLabel={replaceFor !== null ? "Swap in" : "Add to squad"}
                onAdd={(id) => {
                  const m = metaById.get(id);
                  if (!m) return;
                  if (replaceFor !== null) doSwap(replaceFor, m);
                  else persist(addPlayer(team, m));
                  closePickerDetail();
                }}
                onFindReplacement={(id) => {
                  startReplacing(id);
                  closePickerDetail();
                }}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
