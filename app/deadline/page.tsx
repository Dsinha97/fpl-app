"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { InfoTooltip } from "@/components/info-tooltip";
import { AvailabilityBadge } from "@/components/player-status-icons";
import { TransferPlan } from "@/components/transfer-plan";
import { useAuth } from "@/components/auth-provider";
import { layoutFromLineup, PitchView, type SquadLayout } from "@/components/pitch-view";
import type { PlayerData } from "@/components/player-card";
import { listDrafts, resolveRequestedDraft, saveDraft } from "@/lib/drafts";
import { ChipPlanEditor } from "@/components/chip-plan-editor";
import { TransferPath } from "@/components/transfer-path";
import { planTransferPath, type TransferPathResult } from "@/lib/transfer-path";
import { chipContextFor, validateChipPlan, type ChipDefinitionRow } from "@/lib/chip-plan";
import { loadSeasonContext, type SeasonContext } from "@/lib/season-context";
import {
  HORIZONS,
  horizonLabel,
  horizonLength,
  seasonHorizonNote,
  validateSquad,
  type ChipPlan,
  type Horizon,
  type HorizonXp,
  type PlayerMeta,
  type TeamState,
  type ValidationResult,
} from "@/lib/team-state";
import { availabilityFromStatus, type ScoredPlayer } from "@/lib/scoring";
import { IMPORTED_SQUAD_NOTE } from "@/lib/fpl-squad";
import {
  CAPTAIN_MODEL_NOTE,
  optimiseLineup,
  type LineupResult,
} from "@/lib/lineup";
import {
  benchBoostAt,
  candidatesAt,
  CHIP_LABELS,
  tripleCaptainAt,
  type ChipValuation,
  type EventPrediction,
  type PredAt,
} from "@/lib/chips";
import {
  DEFAULT_DECISION_MARGIN,
  optimizeTransfers,
  type OptimizerResult,
  type WildcardWindow,
  type XpByEvent,
} from "@/lib/transfer-optimizer";
import { MAX_FREE_TRANSFERS, TRANSFER_MODEL_NOTE } from "@/lib/transfers";
import { ago, describe, type FeedRow } from "@/lib/change-feed";

interface PlayerRow {
  id: number;
  code: number;
  web_name: string;
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

interface XpRow {
  player_id: number;
  xp_1: number | null;
  xp_3: number | null;
  xp_5: number | null;
  xp_8: number | null;
  xp_19: number | null;
  xp_total: number | null;
}

/** The API caps every response at 1000 rows however big `.limit()` asks — see CLAUDE.md. */
const PAGE_ROWS = 1000;

const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

const STATUS_SEVERITY: Record<string, number> = { s: 0, i: 0, u: 0, n: 0, d: 1, a: 2 };

function fmtCountdown(deadline: string, now: number): { text: string; passed: boolean } {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return { text: "Deadline has passed", passed: true };
  const totalSecs = Math.floor(ms / 1000);
  const days = Math.floor(totalSecs / 86_400);
  const hours = Math.floor((totalSecs % 86_400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const parts = [
    days > 0 ? `${days}d` : null,
    `${hours}h`,
    `${mins}m`,
    `${secs}s`,
  ].filter(Boolean);
  return { text: parts.join(" "), passed: false };
}

const card = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]";

interface NextFixture {
  opponent_short_name: string;
  is_home: boolean;
  fdr: number;
}

export default function DeadlinePage() {
  const router = useRouter();
  const { entryId, teamName, profileLoading } = useAuth();

  const [drafts, setDrafts] = useState<TeamState[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [teamMeta, setTeamMeta] = useState<Map<number, { code: number | null; short: string }>>(
    new Map(),
  );
  const [nextFixtureByTeam, setNextFixtureByTeam] = useState<Map<number, NextFixture>>(new Map());

  const [ctx, setCtx] = useState<SeasonContext | null>(null);
  /** Every chip's windows, both halves — /transfers loads the same way, for the chip plan editor. */
  const [chipDefinitions, setChipDefinitions] = useState<ChipDefinitionRow[]>([]);
  const [rowById, setRowById] = useState<Map<number, PlayerRow>>(new Map());
  const [xpById, setXpById] = useState<Map<number, XpRow>>(new Map());
  const [scoredById, setScoredById] = useState<Map<number, ScoredPlayer>>(new Map());
  const [predsByPlayer, setPredsByPlayer] = useState<Map<number, Map<number, EventPrediction>>>(
    new Map(),
  );
  const [wildcard, setWildcard] = useState<WildcardWindow>({ available: false, reason: null });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [horizon, setHorizon] = useState<Horizon>(5);
  const [freeTransfers, setFreeTransfers] = useState(1);
  const [decisionMargin, setDecisionMargin] = useState(DEFAULT_DECISION_MARGIN);
  const [transferResult, setTransferResult] = useState<OptimizerResult | null>(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [pathResult, setPathResult] = useState<TransferPathResult | null>(null);
  const [pathLoading, setPathLoading] = useState(false);

  const [feedRows, setFeedRows] = useState<FeedRow[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);

  const [now, setNow] = useState(() => Date.now());

  // -------------------------------------------------------------- squad source
  //
  // Drafts, exactly as /builder, /transfers and /chips resolve them — an
  // FPL-imported squad *is* a draft (state.source === "fpl"), and
  // manager_picks is empty by FPL's own design before the first deadline.
  //
  // Unlike those pages, this one is about the *real* team, so the fallback
  // prefers the linked manager's import over whichever draft was edited last
  // (see resolveRequestedDraft). The identity arrives asynchronously from
  // AuthProvider, so this re-resolves once it settles — but never after the
  // user has chosen a squad themselves, which `chosen` guards.
  const chosen = useRef(false);

  useEffect(() => {
    if (profileLoading) return;
    const list = listDrafts();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(list);
    if (chosen.current) return;
    const requested = resolveRequestedDraft(list, window.location.search, { entryId, teamName });
    setDraftId(requested?.draftId ?? null);
  }, [entryId, teamName, profileLoading]);

  const team = useMemo(() => drafts.find((d) => d.draftId === draftId) ?? null, [drafts, draftId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (team) setFreeTransfers(Math.min(MAX_FREE_TRANSFERS, Math.max(0, team.freeTransfers)));
  }, [team]);

  useEffect(() => {
    // A different squad invalidates the last transfer search.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTransferResult(null);
  }, [draftId]);

  // ------------------------------------------------------------------ countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // --------------------------------------------------------------------- data
  useEffect(() => {
    (async () => {
      try {
        const seasonCtx = await loadSeasonContext();
        setCtx(seasonCtx);

        const [playersRes, xpRes, chipsRes, fixturesRes, teamsRes] = await Promise.all([
          supabase
            .from("players")
            .select(
              // direct_freekicks_order / corners_and_indirect_freekicks_order
              // added for the squad pitch's role badges. One string literal —
              // concatenating collapses the row type (CLAUDE.md).
              "id, code, web_name, team_id, element_type, now_cost, selected_by_percent, points_per_game, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order",
            )
            .eq("season", seasonCtx.season)
            .limit(1000),
          supabase
            .from("player_xp_horizons")
            .select("player_id, xp_1, xp_3, xp_5, xp_8, xp_19, xp_total")
            .eq("season", seasonCtx.season)
            .limit(1000),
          supabase
            // Every chip, both season halves — same widening /transfers does,
            // for the chip plan editor.
            .from("chip_definitions")
            .select("name, start_event, stop_event")
            .eq("season", seasonCtx.season),
          supabase
            .from("fixtures")
            .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
            .eq("season", seasonCtx.season)
            .gte("event", seasonCtx.nextEvent)
            .order("event"),
          // Crests and kit graphics need the team *code*, and the fixture
          // ticker needs short names — neither is on the players row.
          supabase.from("teams").select("id, code, short_name").eq("season", seasonCtx.season),
        ]);
        if (playersRes.error) throw new Error(playersRes.error.message);

        const chipDefs: ChipDefinitionRow[] = (chipsRes.data ?? []).map((r) => ({
          name: r.name as string,
          startEvent: r.start_event as number,
          stopEvent: r.stop_event as number | null,
        }));
        setChipDefinitions(chipDefs);

        // Same real-window check /transfers uses — GW1 opens no wildcard.
        const windows = chipDefs.filter((w) => w.name === "wildcard");
        const open = windows.some(
          (w) => w.startEvent <= seasonCtx.nextEvent && seasonCtx.nextEvent <= (w.stopEvent ?? 38),
        );
        const nextOpen = windows
          .map((w) => w.startEvent)
          .filter((start) => start > seasonCtx.nextEvent)
          .sort((a, b) => a - b)[0];
        setWildcard({
          available: open,
          reason: open
            ? null
            : nextOpen !== undefined
              ? `Wildcard opens GW${nextOpen} — FPL doesn't allow it before then.`
              : "No wildcard window covers this gameweek",
        });

        const meta = new Map<number, { code: number | null; short: string }>();
        for (const t of teamsRes.data ?? []) {
          meta.set(t.id as number, {
            code: (t.code as number | null) ?? null,
            short: t.short_name as string,
          });
        }
        setTeamMeta(meta);

        const fdrRuns = new Map<number, number[]>();
        const nextFixtures = new Map<number, NextFixture>();
        for (const f of fixturesRes.data ?? []) {
          const push = (teamId: number, fdr: number) => {
            const list = fdrRuns.get(teamId);
            if (list) list.push(fdr);
            else fdrRuns.set(teamId, [fdr]);
          };
          const home = f.team_h as number;
          const away = f.team_a as number;
          const homeFdr = (f.team_h_difficulty as number | null) ?? 3;
          const awayFdr = (f.team_a_difficulty as number | null) ?? 3;
          push(home, homeFdr);
          push(away, awayFdr);

          // The deadline gameweek's own fixture, for the pitch cards' ticker.
          // Fixtures come back ordered by event, so the first one seen per team
          // is the earliest — a double gameweek keeps the earlier kickoff.
          if (f.event === seasonCtx.nextEvent) {
            if (!nextFixtures.has(home)) {
              nextFixtures.set(home, {
                opponent_short_name: meta.get(away)?.short ?? "—",
                is_home: true,
                fdr: homeFdr,
              });
            }
            if (!nextFixtures.has(away)) {
              nextFixtures.set(away, {
                opponent_short_name: meta.get(home)?.short ?? "—",
                is_home: false,
                fdr: awayFdr,
              });
            }
          }
        }
        setNextFixtureByTeam(nextFixtures);

        // Paged deliberately — see PAGE_ROWS. One fetch serves both the
        // per-gameweek candidate maths (candidatesAt / optimiseLineup / chip
        // valuations) and the transfer optimizer's per-event xP series, so
        // there is only one place this is read from.
        const preds = new Map<number, Map<number, EventPrediction>>();
        for (let from = 0; ; from += PAGE_ROWS) {
          const { data: page, error: pageError } = await supabase
            .from("player_predictions")
            .select("player_id, event, expected_minutes, start_probability, availability, fdr, xp")
            .eq("season", seasonCtx.season)
            .gte("event", seasonCtx.nextEvent)
            .order("player_id")
            .order("event")
            .range(from, from + PAGE_ROWS - 1);
          if (pageError) throw new Error(pageError.message);
          for (const r of page ?? []) {
            const id = r.player_id as number;
            let byEvent = preds.get(id);
            if (!byEvent) preds.set(id, (byEvent = new Map()));
            byEvent.set(r.event as number, {
              expectedMinutes: r.expected_minutes as number | null,
              startProbability: r.start_probability as number | null,
              availability: (r.availability as number | null) ?? 0,
              fdr: r.fdr as number | null,
              xp: r.xp as number | null,
            });
          }
          if ((page?.length ?? 0) < PAGE_ROWS) break;
        }
        setPredsByPlayer(preds);

        const rows = (playersRes.data ?? []) as PlayerRow[];
        setRowById(new Map(rows.map((p) => [p.id, p])));
        const xpMap = new Map((xpRes.data ?? []).map((r) => [r.player_id as number, r as XpRow]));
        setXpById(xpMap);

        const scored = new Map<number, ScoredPlayer>();
        for (const p of rows) {
          const x = xpMap.get(p.id);
          const pred = preds.get(p.id)?.get(seasonCtx.nextEvent);
          scored.set(p.id, {
            id: p.id,
            webName: p.web_name,
            elementType: p.element_type,
            teamId: p.team_id,
            teamShort: null,
            price: p.now_cost ?? 0,
            ownership: p.selected_by_percent,
            pointsPerGame: p.points_per_game,
            xp: {
              1: x?.xp_1 ?? null,
              3: x?.xp_3 ?? null,
              5: x?.xp_5 ?? null,
              8: x?.xp_8 ?? null,
              19: x?.xp_19 ?? null,
              season: x?.xp_total ?? null,
            },
            expectedMinutes: pred?.expectedMinutes ?? null,
            startProbability: pred?.startProbability ?? null,
            availability: availabilityFromStatus(p.status, p.chance_of_playing_next_round),
            fdrRun: fdrRuns.get(p.team_id) ?? [],
          });
        }
        setScoredById(scored);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ------------------------------------------------------------- price/news
  //
  // change_feed already unions price rises/falls, status, news and fixture
  // changes with lag() — no new detection logic, filtered to this squad only.
  useEffect(() => {
    if (!team || rowById.size === 0) return;
    const codes = team.players
      .map((p) => rowById.get(p.playerId)?.code)
      .filter((c): c is number => c !== undefined);
    if (codes.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFeedRows([]);
      return;
    }
    (async () => {
      setFeedLoading(true);
      const { data } = await supabase
        .from("change_feed")
        .select("*")
        .in("player_code", codes)
        .order("observed_at", { ascending: false })
        .limit(100);
      setFeedRows((data ?? []) as FeedRow[]);
      setFeedLoading(false);
    })();
  }, [team, rowById]);

  // ---------------------------------------------------------------- helpers

  const lookup = useCallback(
    (id: number): PlayerMeta | undefined => {
      const p = rowById.get(id);
      if (!p) return undefined;
      return { id: p.id, elementType: p.element_type, teamId: p.team_id, nowCost: p.now_cost ?? 0, webName: p.web_name };
    },
    [rowById],
  );

  const isPenaltyTaker = useCallback(
    (id: number) => rowById.get(id)?.penalties_order === 1,
    [rowById],
  );

  const availabilityOf = useCallback(
    (id: number) => scoredById.get(id)?.availability ?? 0,
    [scoredById],
  );

  const predAt: PredAt = useCallback(
    (playerId: number, event: number) => predsByPlayer.get(playerId)?.get(event),
    [predsByPlayer],
  );

  const xpOf = useCallback(
    (id: number): HorizonXp | undefined => {
      const r = xpById.get(id);
      if (!r) return undefined;
      return { xp1: r.xp_1, xp3: r.xp_3, xp5: r.xp_5, xp8: r.xp_8, xp19: r.xp_19, xpSeason: r.xp_total };
    },
    [xpById],
  );

  const seriesOf = useCallback(
    (id: number): XpByEvent | undefined => {
      const byEvent = predsByPlayer.get(id);
      if (!byEvent) return undefined;
      const series: XpByEvent = new Map();
      for (const [event, pred] of byEvent) series.set(event, pred.xp ?? 0);
      return series;
    },
    [predsByPlayer],
  );

  // ------------------------------------------------------------- squad checks

  const validation: ValidationResult | null = useMemo(() => {
    if (!team || !ctx) return null;
    return validateSquad(team, ctx.rules, lookup);
  }, [team, ctx, lookup]);

  const alerts = useMemo(() => {
    if (!team) return [];
    return team.players
      .map((p) => rowById.get(p.playerId))
      .filter((p): p is PlayerRow => p !== undefined)
      .filter((p) => p.status !== "a" || (p.chance_of_playing_next_round ?? 100) < 100)
      .sort(
        (a, b) =>
          (STATUS_SEVERITY[a.status ?? "a"] ?? 2) - (STATUS_SEVERITY[b.status ?? "a"] ?? 2) ||
          (a.chance_of_playing_next_round ?? 100) - (b.chance_of_playing_next_round ?? 100),
      );
  }, [team, rowById]);

  const lineup: LineupResult | null = useMemo(() => {
    if (!team || !ctx || predsByPlayer.size === 0) return null;
    const candidates = candidatesAt(team.players, ctx.nextEvent, predAt, lookup, isPenaltyTaker);
    return optimiseLineup(candidates);
  }, [team, ctx, predsByPlayer, predAt, lookup, isPenaltyTaker]);

  // ------------------------------------------------------------- squad pitch
  //
  // Cards for the read-only pitch. Same field mapping as /builder's
  // toPlayerData, built from this page's own already-loaded rows rather than
  // lifted out of it — that one closes over the builder's horizon, per-event
  // aggregates and tactical profiles, none of which exist here.
  const squadCards: PlayerData[] = useMemo(() => {
    if (!team || !ctx) return [];
    return team.players.flatMap((p) => {
      const row = rowById.get(p.playerId);
      if (!row) return [];
      const pred = predAt(row.id, ctx.nextEvent);
      return [
        {
          id: row.id,
          web_name: row.web_name,
          team_code: teamMeta.get(row.team_id)?.code ?? null,
          element_type: row.element_type,
          now_cost: row.now_cost ?? 0,
          // The deadline gameweek's xP, matching the gameweek this whole page
          // is about — not a multi-week horizon figure.
          expected_points: pred?.xp ?? null,
          value_note: `Expected points in ${ctx.gameweekName}`,
          status: row.status,
          chance_of_playing_next_round: row.chance_of_playing_next_round,
          is_captain: team.captain === row.id,
          is_vice_captain: team.viceCaptain === row.id,
          is_penalty_taker: row.penalties_order === 1,
          is_freekick_taker: row.direct_freekicks_order === 1,
          is_corner_taker: row.corners_and_indirect_freekicks_order === 1,
          next_fixture: nextFixtureByTeam.get(row.team_id) ?? null,
          team_short: teamMeta.get(row.team_id)?.short ?? null,
          news: row.news,
          ownership: row.selected_by_percent,
          xp5: xpById.get(row.id)?.xp_5 ?? null,
          expected_minutes: pred?.expectedMinutes ?? null,
          start_probability: pred?.startProbability ?? null,
        },
      ];
    });
  }, [team, ctx, rowById, predAt, teamMeta, nextFixtureByTeam, xpById]);

  /**
   * The pitch shows the XI **you entered**, not the optimiser's. The Captain &
   * starting XI section below already says what the model would change, and
   * blending the recommendation into the picture of your own squad would make
   * it impossible to see which is which. When no XI has been set, the model's
   * is shown and labelled as such.
   */
  const squadLayout: SquadLayout | null = useMemo(() => {
    if (!team || !ctx) return null;
    if (!lineup) return null;

    const xiSet = new Set(team.startingXI);
    const usable =
      team.startingXI.length === 11 &&
      team.benchOrder.length === team.players.length - 11 &&
      team.players.every((p) => xiSet.has(p.playerId) || team.benchOrder.includes(p.playerId));
    if (!usable) return layoutFromLineup(lineup);

    const typeOf = (id: number) => rowById.get(id)?.element_type;
    const count = (type: number) =>
      team.startingXI.filter((id) => typeOf(id) === type).length;
    const xiXp = team.startingXI.reduce((sum, id) => sum + (predAt(id, ctx.nextEvent)?.xp ?? 0), 0);

    return {
      starters: team.startingXI,
      bench: team.benchOrder,
      formation: `${count(2)}-${count(3)}-${count(4)}`,
      // Auto-sub probabilities belong to the model's own bench order; this is
      // yours, so the strip carries the xP of the XI on screen instead.
      subProbability: new Map(),
      benchSummary: `your XI ${xiXp.toFixed(1)} xP`,
    };
  }, [team, ctx, lineup, rowById, predAt]);

  const captainDiff = useMemo(() => {
    if (!team || !lineup?.captain || !ctx) return null;
    if (team.captain === lineup.captain.playerId) return null;
    const currentXp = team.captain !== null ? (predAt(team.captain, ctx.nextEvent)?.xp ?? null) : null;
    const recommendedXp = predAt(lineup.captain.playerId, ctx.nextEvent)?.xp ?? null;
    return {
      currentName: team.captain !== null ? lookup(team.captain)?.webName ?? "No captain set" : "No captain set",
      currentXp,
      recommendedName: lineup.captain.webName,
      recommendedXp,
      gain: currentXp !== null && recommendedXp !== null ? recommendedXp - currentXp : null,
    };
  }, [team, lineup, ctx, predAt, lookup]);

  const xiDiff = useMemo(() => {
    if (!team || !lineup || team.startingXI.length === 0) return null;
    const recommendedSet = new Set(lineup.starters);
    const currentSet = new Set(team.startingXI);
    const bringIn = lineup.starters.filter((id) => !currentSet.has(id));
    const benchInstead = team.startingXI.filter((id) => !recommendedSet.has(id));
    if (bringIn.length === 0 && benchInstead.length === 0) return null;
    return { bringIn, benchInstead };
  }, [team, lineup]);

  const benchBoost: ChipValuation | null = useMemo(() => {
    if (!team || !ctx || predsByPlayer.size === 0) return null;
    return benchBoostAt(team.players, ctx.nextEvent, predAt, lookup, isPenaltyTaker);
  }, [team, ctx, predsByPlayer, predAt, lookup, isPenaltyTaker]);

  const tripleCaptain: ChipValuation | null = useMemo(() => {
    if (!team || !ctx || predsByPlayer.size === 0) return null;
    return tripleCaptainAt(team, ctx.nextEvent, predAt, availabilityOf, lookup, isPenaltyTaker);
  }, [team, ctx, predsByPlayer, predAt, availabilityOf, lookup, isPenaltyTaker]);

  /** The chip plan's usable entries, resolved into the two things the simulator can act on within this horizon window. */
  /** The chip plan's legal entries — shared by the deadline optimiser (window-bounded below) and the forward path (which resolves its own window per gameweek). */
  const chipPlanUsable = useMemo(() => {
    if (!team || !ctx) return [];
    return validateChipPlan(team.chipPlan, chipDefinitions, ctx.nextEvent, ctx.windowEnd, team.activeChip).usable;
  }, [team, chipDefinitions, ctx]);

  const chipContext = useMemo(() => {
    if (!ctx) return null;
    const toEvent = ctx.nextEvent + horizonLength(horizon, ctx.seasonWindow) - 1;
    return chipContextFor(chipPlanUsable, ctx.nextEvent, toEvent);
  }, [chipPlanUsable, ctx, horizon]);

  // ------------------------------------------------------- transfer optimiser
  //
  // ~1,875 simulateTransfers calls (BEAM_WIDTH 8 + FUNDER_WIDTH 4, MAX_BASKET 3,
  // CANDIDATES_PER_SLOT 5) — never on load, only behind this button.
  const runTransferOptimizer = useCallback(() => {
    if (!team || !ctx || scoredById.size === 0) return;
    setTransferLoading(true);
    setTimeout(() => {
      const pool = [...scoredById.values()];
      const result = optimizeTransfers({
        team,
        pool,
        scoredById,
        lookup,
        xpOf,
        availabilityOf,
        isPenaltyTaker,
        seriesOf,
        rules: ctx.rules,
        horizon,
        freeTransfers,
        event: ctx.nextEvent,
        wildcard,
        decisionMargin,
        chip: chipContext ?? undefined,
        predAt,
      });
      setTransferResult(result);
      setTransferLoading(false);
    }, 0);
  }, [
    team,
    ctx,
    scoredById,
    lookup,
    xpOf,
    availabilityOf,
    isPenaltyTaker,
    seriesOf,
    horizon,
    freeTransfers,
    wildcard,
    decisionMargin,
    chipContext,
    predAt,
  ]);

  /** Forward multi-gameweek path — same "never eager" gating as the deadline optimiser above. */
  const runTransferPath = useCallback(() => {
    if (!team || !ctx || scoredById.size === 0) return;
    setPathLoading(true);
    setTimeout(() => {
      const pool = [...scoredById.values()];
      const result = planTransferPath({
        team,
        pool,
        scoredById,
        lookup,
        xpOf,
        availabilityOf,
        isPenaltyTaker,
        seriesOf,
        predAt,
        rules: ctx.rules,
        freeTransfers,
        event: ctx.nextEvent,
        windowEnd: ctx.windowEnd,
        plan: chipPlanUsable,
        wildcard,
      });
      setPathResult(result);
      setPathLoading(false);
    }, 0);
  }, [team, ctx, scoredById, lookup, xpOf, availabilityOf, isPenaltyTaker, seriesOf, predAt, freeTransfers, chipPlanUsable, wildcard]);

  const countdown = ctx ? fmtCountdown(ctx.deadlineTime, now) : null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Deadline Hub
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Everything to decide before the deadline, in one place.
          </p>
        </div>
        {drafts.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            Squad
            <select
              value={draftId ?? ""}
              onChange={(e) => {
                chosen.current = true;
                setDraftId(e.target.value);
              }}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
            >
              {drafts.map((d) => (
                <option key={d.draftId} value={d.draftId}>
                  {/* Marked, so the default this page picks is visible rather
                      than mysterious when several squads are saved. */}
                  {d.name}
                  {d.source === "fpl" ? " · imported" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading…</p>}

      {!loading && drafts.length === 0 && (
        <div className={`mt-6 ${card} text-center`}>
          <p className="text-sm text-zinc-500">
            No saved squads yet. Build one in the{" "}
            <Link href="/builder" className="font-medium text-purple-700 underline-offset-2 hover:underline dark:text-[#00FF87]">
              Team Builder
            </Link>{" "}
            or paste your real squad in{" "}
            <Link href="/settings/?tab=import" className="font-medium text-purple-700 underline-offset-2 hover:underline dark:text-[#00FF87]">
              Settings → Import squad
            </Link>
            .
          </p>
        </div>
      )}

      {!loading && team && ctx && (
        <>
          {/* ------------------------------------------------------ countdown */}
          <section className={`mt-6 ${card}`}>
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {ctx.gameweekName} deadline
            </h2>
            <p
              className={`mt-1 text-3xl font-bold tabular-nums ${
                countdown?.passed
                  ? "text-red-700 dark:text-red-400"
                  : "text-purple-900 dark:text-[#00FF87]"
              }`}
            >
              {countdown?.text}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {new Date(ctx.deadlineTime).toLocaleString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {team.source === "fpl" && (
              <p className="mt-2 text-xs text-zinc-500">
                <InfoTooltip label="About this imported squad">{IMPORTED_SQUAD_NOTE}</InfoTooltip>{" "}
                Imported from your real FPL team.
              </p>
            )}
          </section>

          {/* ---------------------------------------------------------- squad */}
          <section className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Squad — {ctx.gameweekName}
              </h2>
              <Link
                href={`/builder/?draft=${team.draftId}`}
                className="text-xs font-medium text-purple-700 underline-offset-2 hover:underline dark:text-[#00FF87]"
              >
                Edit in Builder →
              </Link>
            </div>
            {/* Read-only: no armband or remove handlers, so the detail panel
                opens as information only. Editing stays in /builder. */}
            <PitchView
              squad={squadCards}
              quota={ctx.rules.positionQuota}
              layout={squadLayout}
            />
            <p className="mt-2 text-xs text-zinc-500">
              {team.name}
              {team.source === "fpl" ? " · imported from FPL" : ""}
              {squadLayout && team.startingXI.length !== 11
                ? " · showing the model's XI — you haven't set one"
                : ""}
            </p>
          </section>

          {/* ------------------------------------------------------ readiness */}
          {validation && (
            <section className={`mt-5 ${card}`}>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Squad readiness</h2>
              {validation.isLegal ? (
                <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  This squad is legal and ready to enter.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {!validation.squadFull && (
                    <li className="text-amber-700 dark:text-amber-400">
                      {team.players.length} of {ctx.rules.squadSize} players selected —{" "}
                      <Link href={`/builder/?draft=${team.draftId}`} className="underline-offset-2 hover:underline">
                        fill the squad
                      </Link>
                      .
                    </li>
                  )}
                  {validation.positions
                    .filter((p) => p.filled !== p.required)
                    .map((p) => (
                      <li key={p.elementType} className="text-amber-700 dark:text-amber-400">
                        {p.filled} of {p.required} required at position {p.elementType} —{" "}
                        <Link href={`/builder/?draft=${team.draftId}`} className="underline-offset-2 hover:underline">
                          fix in Builder
                        </Link>
                        .
                      </li>
                    ))}
                  {validation.clubBreaches.map((b) => (
                    <li key={b.teamId} className="text-amber-700 dark:text-amber-400">
                      {b.count} players from one club exceed the {ctx.rules.teamLimit}-per-club limit.
                    </li>
                  ))}
                  {validation.overBudget && (
                    <li className="text-amber-700 dark:text-amber-400">
                      Over budget by £{(-validation.budgetRemaining / 10).toFixed(1)}m.
                    </li>
                  )}
                  {!validation.hasCaptain && (
                    <li className="text-amber-700 dark:text-amber-400">No captain set.</li>
                  )}
                  {!validation.hasViceCaptain && (
                    <li className="text-amber-700 dark:text-amber-400">No vice-captain set.</li>
                  )}
                </ul>
              )}
            </section>
          )}

          {/* --------------------------------------------------- availability */}
          <section className={`mt-5 ${card}`}>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Availability</h2>
            {alerts.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                Nothing flagged — every player in this squad is fully available.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {alerts.map((p) => (
                  <li key={p.id} className="flex items-start gap-2 text-sm">
                    <AvailabilityBadge status={p.status} chanceOfPlaying={p.chance_of_playing_next_round} news={p.news} />
                    <span>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">{p.web_name}</span>
                      {p.news && <span className="ml-1.5 text-zinc-500">{p.news}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* -------------------------------------------------- captain & XI */}
          <section className={`mt-5 ${card}`}>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Captain &amp; starting XI — GW{ctx.nextEvent}
              </h2>
              <InfoTooltip label="About the captain model">{CAPTAIN_MODEL_NOTE}</InfoTooltip>
            </div>
            {!lineup ? (
              <p className="mt-2 text-sm text-zinc-500">Not enough data to recommend a lineup yet.</p>
            ) : (
              <>
                <p className="mt-2 text-sm">
                  Formation <span className="font-medium">{lineup.formation}</span> ·{" "}
                  {lineup.startersXp.toFixed(1)} xP starting XI
                </p>
                <p className="mt-1 text-sm">
                  Recommended captain:{" "}
                  <span className="font-semibold text-purple-900 dark:text-[#00FF87]">
                    {lineup.captain?.webName ?? "—"}
                  </span>
                  {lineup.captain && (
                    <span className="ml-1.5 text-xs text-zinc-500">
                      {Math.round(lineup.captain.confidence * 100)}% confidence
                    </span>
                  )}
                  {lineup.vice && (
                    <span className="ml-2 text-xs text-zinc-500">Vice: {lineup.vice.webName}</span>
                  )}
                </p>
                {lineup.captain && lineup.captain.reasons.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
                    {lineup.captain.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}

                {captainDiff && (
                  <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                    Your draft has <span className="font-medium">{captainDiff.currentName}</span> captained
                    {captainDiff.gain !== null ? (
                      <>
                        {" "}
                        ({(captainDiff.currentXp ?? 0).toFixed(1)} xP) vs{" "}
                        <span className="font-medium">{captainDiff.recommendedName}</span> (
                        {(captainDiff.recommendedXp ?? 0).toFixed(1)} xP) = {signed(captainDiff.gain)}.
                      </>
                    ) : (
                      <> — the model recommends {captainDiff.recommendedName} instead.</>
                    )}
                  </p>
                )}

                {xiDiff && (
                  <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                    {xiDiff.bringIn.length > 0 && (
                      <>Bring in: {xiDiff.bringIn.map((id) => lookup(id)?.webName ?? id).join(", ")}. </>
                    )}
                    {xiDiff.benchInstead.length > 0 && (
                      <>Bench: {xiDiff.benchInstead.map((id) => lookup(id)?.webName ?? id).join(", ")}.</>
                    )}
                  </p>
                )}
              </>
            )}
          </section>

          {/* --------------------------------------------------- chip plan */}
          <ChipPlanEditor
            plan={team.chipPlan}
            chipDefinitions={chipDefinitions}
            nextEvent={ctx.nextEvent}
            lastEvent={ctx.windowEnd}
            activeChip={team.activeChip}
            onChange={(next: ChipPlan) => {
              saveDraft({ ...team, chipPlan: next });
              setDrafts(listDrafts());
            }}
          />

          {/* -------------------------------------------------------- chips */}
          <section className={`mt-5 ${card}`}>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Chip call — GW{ctx.nextEvent}
            </h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[benchBoost, tripleCaptain].map((v) =>
                v ? (
                  <div key={v.chip} className="rounded-md border border-zinc-200 px-3 py-2 dark:border-purple-900/40">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {CHIP_LABELS[v.chip]}
                      </span>
                      {v.blocked === null && (
                        <span
                          className={`text-sm font-bold tabular-nums ${
                            v.gain > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"
                          }`}
                        >
                          {signed(v.gain)}
                        </span>
                      )}
                    </div>
                    {v.blocked ? (
                      <p className="mt-1 text-xs text-zinc-500">{v.blocked}</p>
                    ) : (
                      v.explanation.map((line) => (
                        <p key={line} className="mt-1 text-xs text-zinc-500">
                          {line}
                        </p>
                      ))
                    )}
                  </div>
                ) : null,
              )}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              This gameweek only —{" "}
              <Link href={`/chips/?draft=${team.draftId}`} className="underline-offset-2 hover:underline">
                see the full season schedule
              </Link>
              .
            </p>
          </section>

          {/* ---------------------------------------------------- transfers */}
          <section className={`mt-5 ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Transfer call</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <div className="flex gap-1.5">
                  {HORIZONS.map((h) => (
                    <button
                      key={h}
                      onClick={() => setHorizon(h)}
                      title={h === "season" ? seasonHorizonNote(ctx.seasonWindow) : undefined}
                      className={`rounded-md px-2 py-1 text-xs transition-colors ${
                        horizon === h
                          ? "bg-purple-950 text-white dark:bg-[#00FF87] dark:text-slate-950"
                          : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:bg-purple-950/60"
                      }`}
                    >
                      {horizonLabel(h)}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                  Free transfers
                  <select
                    value={freeTransfers}
                    onChange={(e) => setFreeTransfers(Number(e.target.value))}
                    className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
                  >
                    {Array.from({ length: MAX_FREE_TRANSFERS + 1 }, (_, i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </label>
                <InfoTooltip label="About the transfer model">{TRANSFER_MODEL_NOTE}</InfoTooltip>
                <button
                  onClick={runTransferOptimizer}
                  disabled={transferLoading || team.players.length !== ctx.rules.squadSize}
                  className="rounded-md bg-purple-950 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e078]"
                >
                  {transferLoading ? "Searching…" : "Run optimiser"}
                </button>
              </div>
            </div>
            {team.players.length !== ctx.rules.squadSize && (
              <p className="mt-2 text-sm text-zinc-500">Complete the squad first to evaluate transfers.</p>
            )}
            {!transferResult && team.players.length === ctx.rules.squadSize && !transferLoading && (
              <p className="mt-2 text-sm text-zinc-500">
                Runs roughly 1,875 simulations — click &ldquo;Run optimiser&rdquo; when ready.
              </p>
            )}
          </section>

          {transferResult && (
            <TransferPlan
              result={transferResult}
              horizon={horizon}
              event={ctx.nextEvent}
              decisionMargin={decisionMargin}
              onDecisionMarginChange={setDecisionMargin}
              onLoad={() => router.push(`/transfers/?draft=${team.draftId}`)}
              loadedSignature={null}
              loading={transferLoading}
            />
          )}

          {team.players.length === ctx.rules.squadSize && (
            <TransferPath
              result={pathResult}
              loading={pathLoading}
              onRun={runTransferPath}
              hasChipPlan={chipPlanUsable.length > 0}
            />
          )}

          {/* ------------------------------------------------- price & news */}
          <section className={`mt-5 ${card}`}>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Price &amp; news watch</h2>
            {feedLoading && <p className="mt-2 text-sm text-zinc-500">Loading…</p>}
            {!feedLoading && feedRows.length === 0 && (
              <p className="mt-2 text-sm text-zinc-500">Nothing has changed for this squad recently.</p>
            )}
            {!feedLoading && feedRows.length > 0 && (
              <ul className="mt-2 divide-y divide-zinc-100 dark:divide-purple-900/30">
                {feedRows.slice(0, 20).map((row, i) => {
                  const { icon, text } = describe(row);
                  return (
                    <li key={i} className="flex items-start gap-2 py-2 text-sm">
                      <span aria-hidden="true">{icon}</span>
                      <span className="min-w-0 flex-1">
                        {row.web_name && <span className="font-medium">{row.web_name}</span>} {text}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400">{ago(row.observed_at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              <Link href="/changes" className="underline-offset-2 hover:underline">
                See every change, not just this squad
              </Link>
              .
            </p>
          </section>
        </>
      )}
    </main>
  );
}
