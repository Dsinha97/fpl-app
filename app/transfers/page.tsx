"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { FdrLegendContent, InfoTooltip, TapToReveal } from "@/components/info-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { AvailabilityBadge } from "@/components/player-status-icons";
import { CaptainBadge, ViceCaptainBadge } from "@/components/armband";
import { listDrafts, resolveRequestedDraft, saveDraft } from "@/lib/drafts";
import { ChipTiming } from "@/components/chip-timing";
import { fullName, matchesPlayerQuery } from "@/lib/player-search";
import { loadPredictionSeries } from "@/lib/player-pool";
import {
  availabilityFromStatus,
  findReplacements,
  riskScore,
  RISK_MODEL_NOTE,
  xpFor,
  type ScoredPlayer,
} from "@/lib/scoring";
import {
  freeTransfersDisplay,
  MAX_FREE_TRANSFERS,
  simulateTransfers,
  TRANSFER_MODEL_NOTE,
  type TransferMove,
} from "@/lib/transfers";
import { DEFAULT_DECISION_MARGIN, type XpByEvent } from "@/lib/transfer-optimizer";
import { loadPriceProgress, PRICE_WATCH_MODEL_NOTE, type PriceProgress } from "@/lib/price-watch";
// `signatureOf` still lives in transfer-plan.tsx, which /deadline still uses
// for its own optimiser output. /transfers no longer renders TransferPlan —
// see the note on `TransferPath` for why the page now has one answer.
import { signatureOf } from "@/components/transfer-plan";
import { ChipPlanEditor } from "@/components/chip-plan-editor";
import { TransferPath } from "@/components/transfer-path";
import { planTransferPath, type TransferPathResult } from "@/lib/transfer-path";
import {
  chipContextFor,
  chipLabel,
  validateChipPlan,
  CHIP_KINDS,
  type ChipDefinitionRow,
  type ChipKind,
  type EventPrediction,
  type PlayedChip,
  type PredAt,
} from "@/lib/chip-plan";
import {
  DEFAULT_RULES,
  HORIZONS,
  horizonLabel,
  horizonLength,
  seasonHorizonNote,
  type ChipPlan,
  type Horizon,
  type HorizonXp,
  type PlayerMeta,
  type SquadRules,
  type TeamState,
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
  points_per_game: number | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
  penalties_order: number | null;
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

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
/** Fallback when `player_xp_horizons` has no rows yet — matches `generate-predictions`' own floor. */
const FALLBACK_SEASON_WINDOW = 8;
const CANDIDATES = 8;

/** Sprint 33 — /chips folded in here. Same `type Tab` idiom /fixtures and
 *  /settings already use. */
type TransfersTab = "transfers" | "chips";

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

export default function TransfersPage() {
  const [drafts, setDrafts] = useState<TeamState[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);

  // Sprint 33: /chips merged in here as a second tab. Read from
  // window.location.search rather than useSearchParams — the static export
  // has no Suspense-boundary precedent, and /settings and /fixtures already
  // read their own tab state this way.
  const [tab, setTab] = useState<TransfersTab>("transfers");
  const [rowById, setRowById] = useState<Map<number, PlayerRow>>(new Map());
  const [priceProgress, setPriceProgress] = useState<Map<number, PriceProgress>>(new Map());
  const [scoredById, setScoredById] = useState<Map<number, ScoredPlayer>>(new Map());
  const [xp, setXp] = useState<Map<number, XpRow>>(new Map());
  const [rules, setRules] = useState<SquadRules>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The real "season" prediction window — from `player_xp_horizons`, not hardcoded. */
  const [seasonWindow, setSeasonWindow] = useState(FALLBACK_SEASON_WINDOW);

  const [horizon, setHorizon] = useState<Horizon>(5);
  const [freeTransfers, setFreeTransfers] = useState(1);
  const [moves, setMoves] = useState<TransferMove[]>([]);
  /** Per-gameweek xP, which is what lets the plan price rolling a transfer. */
  const [seriesById, setSeriesById] = useState<Map<number, XpByEvent>>(new Map());
  const [nextEvent, setNextEvent] = useState<number | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  /** Chips FPL's own history already reports played this season, for the
   *  currently selected draft's entry — the chip plan editor can't offer to
   *  plan a chip that no longer exists to play. */
  const [playedChips, setPlayedChips] = useState<PlayedChip[]>([]);
  const [wildcard, setWildcard] = useState<{ available: boolean; reason: string | null }>({
    available: false,
    reason: null,
  });
  /** Every chip's windows, both halves — the chip plan editor needs the full set, not just wildcard's. */
  const [chipDefinitions, setChipDefinitions] = useState<ChipDefinitionRow[]>([]);
  /** Per-event predictions, for a chip plan's Bench Boost / Triple Captain bonus. */
  const [predsByPlayer, setPredsByPlayer] = useState<Map<number, Map<number, EventPrediction>>>(new Map());
  /**
   * Applies the manual basket as a Wildcard: every move is free, however many
   * are queued. Mirrors the trick `transfer-optimizer.ts`'s own wildcard
   * branch already uses internally (`freeTransfers: moves.length`) rather
   * than inventing a second way to waive the hit.
   */
  const [wildcardMode, setWildcardMode] = useState(false);
  const [decisionMargin, setDecisionMargin] = useState(DEFAULT_DECISION_MARGIN);
  /** The squad slot currently being filled, if any. */
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  /** Sprint 23: on mobile the picker renders inline below the table rather
   * than in the desktop aside (there's no room for a second column), so on
   * open it's scrolled into view rather than left for the owner to hunt for
   * below whichever row they tapped. */
  const mobilePickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pickingFor === null) return;
    mobilePickerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [pickingFor]);
  const [applied, setApplied] = useState<string | null>(null);
  const [pathResult, setPathResult] = useState<TransferPathResult | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathSignature, setPathSignature] = useState<string | null>(null);

  // Drafts live in localStorage, so they can only be read after mount — an
  // effect is the right place despite the set-state-in-effect lint preference.
  useEffect(() => {
    const list = listDrafts();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(list);
    // Other draft-aware pages can link here with ?draft=<id>; fall back to
    // the most recently saved draft when the id is absent or stale.
    const requested = resolveRequestedDraft(list, window.location.search);
    setDraftId(requested?.draftId ?? null);
    if (new URLSearchParams(window.location.search).get("tab") === "chips") setTab("chips");
  }, []);

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
        setNextEvent(gw.id);
        setSeason(gw.season);

        const [
          playersRes,
          teamsRes,
          typesRes,
          settingsRes,
          xpRes,
          fixturesRes,
          chipsRes,
        ] = await Promise.all([
            supabase
              .from("players")
              .select(
                "id, code, web_name, first_name, second_name, known_name, team_id, element_type, now_cost, selected_by_percent, points_per_game, status, news, chance_of_playing_next_round, penalties_order",
              )
              .eq("season", gw.season)
              .limit(1000),
            supabase.from("teams").select("id, short_name").eq("season", gw.season),
            supabase.from("element_types").select("id, squad_select").eq("season", gw.season),
            supabase
              .from("game_settings")
              .select("key, value")
              .eq("season", gw.season)
              .in("key", ["squad_total_spend", "squad_team_limit", "squad_squadsize"]),
            supabase
              .from("player_xp_horizons")
              .select("player_id, xp_1, xp_3, xp_5, xp_8, xp_19, xp_total, first_event, last_event")
              .eq("season", gw.season)
              .limit(1000),
            // No upper bound: a season has at most 380 fixtures total, and the
            // real "season" window (seasonWindow, below) is however many the
            // model actually predicted — a constant cap would silently
            // under-serve fixtureScore/riskScore the moment that window moves.
            supabase
              .from("fixtures")
              .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
              .eq("season", gw.season)
              .gte("event", gw.id)
              .order("event"),
            supabase
              // Every chip, both season halves — the chip plan editor needs the
              // full set; /chips loads the same way for the same reason.
              .from("chip_definitions")
              .select("name, chip_type, start_event, stop_event")
              .eq("season", gw.season),
          ]);
        if (playersRes.error) throw new Error(playersRes.error.message);
        if (teamsRes.error) throw new Error(teamsRes.error.message);

        const chipDefs: ChipDefinitionRow[] = (chipsRes.data ?? []).map((r) => ({
          name: r.name as string,
          startEvent: r.start_event as number,
          stopEvent: r.stop_event as number | null,
        }));
        setChipDefinitions(chipDefs);

        // The real chip windows, not an assumption: the first wildcard does not
        // open until GW2, so in GW1 the option must be shown as unavailable
        // rather than offered.
        const windows = chipDefs.filter((w) => w.name === "wildcard");
        const open = windows.some(
          (w) => w.startEvent <= gw.id && gw.id <= (w.stopEvent ?? 38),
        );
        const nextOpen = windows
          .map((w) => w.startEvent)
          .filter((start) => start > gw.id)
          .sort((a, b) => a - b)[0];
        setWildcard({
          available: open,
          reason: open
            ? null
            : nextOpen !== undefined
              ? `Wildcard opens GW${nextOpen} — FPL doesn't allow it before then.`
              : "No wildcard window covers this gameweek",
        });

        // `loadPredictionSeries` pages past the API's thousand-row cap
        // (concurrently, and memoised — see lib/player-pool.ts) and tracks
        // whatever window generate-predictions last ran without being told
        // it, same as the loop it replaces. Carries the columns /chips and
        // /deadline already fetch — expected_minutes, start_probability,
        // availability, fdr — so a chip plan's Bench Boost / Triple Captain
        // bonus can be valued per event here too.
        const seriesRows = await loadPredictionSeries(gw.season, gw.id);
        const series = new Map<number, XpByEvent>();
        const preds = new Map<number, Map<number, EventPrediction>>();
        for (const r of seriesRows) {
          let byEvent = series.get(r.playerId);
          if (!byEvent) series.set(r.playerId, (byEvent = new Map()));
          byEvent.set(r.event, Number(r.xp ?? 0));
          let predByEvent = preds.get(r.playerId);
          if (!predByEvent) preds.set(r.playerId, (predByEvent = new Map()));
          predByEvent.set(r.event, {
            expectedMinutes: r.expectedMinutes,
            startProbability: r.startProbability,
            availability: r.availability,
            fdr: r.fdr,
            xp: r.xp,
          });
        }
        setSeriesById(series);
        setPredsByPlayer(preds);

        const shorts = new Map(
          (teamsRes.data ?? []).map((t) => [t.id as number, t.short_name as string]),
        );

        const settings = new Map(
          (settingsRes.data ?? []).map((s) => [s.key as string, Number(s.value)]),
        );
        const quota: Record<number, number> = {};
        for (const t of typesRes.data ?? []) quota[t.id as number] = Number(t.squad_select ?? 0);
        setRules({
          totalSpend: settings.get("squad_total_spend") ?? DEFAULT_RULES.totalSpend,
          teamLimit: settings.get("squad_team_limit") ?? DEFAULT_RULES.teamLimit,
          squadSize: settings.get("squad_squadsize") ?? DEFAULT_RULES.squadSize,
          positionQuota: Object.keys(quota).length > 0 ? quota : DEFAULT_RULES.positionQuota,
        });

        const fdrRuns = new Map<number, number[]>();
        for (const f of fixturesRes.data ?? []) {
          const push = (teamId: number, fdr: number) => {
            const list = fdrRuns.get(teamId);
            if (list) list.push(fdr);
            else fdrRuns.set(teamId, [fdr]);
          };
          push(f.team_h as number, (f.team_h_difficulty as number | null) ?? 3);
          push(f.team_a as number, (f.team_a_difficulty as number | null) ?? 3);
        }

        const xpById = new Map(
          (xpRes.data ?? []).map((r) => [r.player_id as number, r as unknown as XpRow]),
        );
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
        const rows = (playersRes.data ?? []) as PlayerRow[];
        const scored = new Map<number, ScoredPlayer>();
        for (const p of rows) {
          const x = xpById.get(p.id);
          // Next event's row from the series already fetched above — used
          // to be a second, near-duplicate query for exactly this one event;
          // `preds` already carries it (`.gte("event", gw.id)` includes it).
          const pred = preds.get(p.id)?.get(gw.id);
          const availability = availabilityFromStatus(p.status, p.chance_of_playing_next_round);
          scored.set(p.id, {
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
              19: x?.xp_19 ?? null,
              season: x?.xp_total ?? null,
            },
            expectedMinutes: pred?.expectedMinutes ?? null,
            startProbability: pred?.startProbability ?? null,
            availability,
            fdrRun: fdrRuns.get(p.team_id) ?? [],
          });
        }

        setRowById(new Map(rows.map((p) => [p.id, p])));
        setScoredById(scored);
        setXp(xpById);
        // Secondary signal, loaded separately so it never blocks first paint.
        loadPriceProgress(gw.season, rows.map((p) => p.code))
          .then(setPriceProgress)
          .catch(() => setPriceProgress(new Map()));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const team = useMemo(
    () => drafts.find((d) => d.draftId === draftId) ?? null,
    [drafts, draftId],
  );

  useEffect(() => {
    if (!season || !team?.entryId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlayedChips([]);
      return;
    }
    (async () => {
      const { data, error: chipsError } = await supabase
        .from("manager_chips")
        .select("event, name")
        .eq("season", season)
        .eq("entry_id", team.entryId as number)
        .order("event");
      if (chipsError) return;
      setPlayedChips(
        (data ?? [])
          .filter((r) => CHIP_KINDS.includes(r.name as ChipKind))
          .map((r) => ({ chip: r.name as ChipKind, event: r.event as number })),
      );
    })();
  }, [season, team?.entryId]);

  useEffect(() => {
    // A different squad invalidates the basket.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMoves([]);
    setPickingFor(null);
    setApplied(null);
    setWildcardMode(false);
    setPathResult(null);
  }, [draftId]);

  useEffect(() => {
    if (team) {
      const ft = freeTransfersDisplay(team);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFreeTransfers(ft.kind === "unlimited" ? MAX_FREE_TRANSFERS : ft.n);
    }
  }, [team]);

  const lookup = useCallback(
    (id: number): PlayerMeta | undefined => {
      const p = rowById.get(id);
      if (!p) return undefined;
      return {
        id: p.id,
        elementType: p.element_type,
        teamId: p.team_id,
        nowCost: p.now_cost ?? 0,
        webName: p.web_name,
      };
    },
    [rowById],
  );

  const xpOf = useCallback(
    (id: number): HorizonXp | undefined => {
      const r = xp.get(id);
      if (!r) return undefined;
      return { xp1: r.xp_1, xp3: r.xp_3, xp5: r.xp_5, xp8: r.xp_8, xp19: r.xp_19, xpSeason: r.xp_total };
    },
    [xp],
  );

  const availabilityOf = useCallback(
    (id: number): number => scoredById.get(id)?.availability ?? 0,
    [scoredById],
  );

  const isPenaltyTaker = useCallback(
    (id: number): boolean => rowById.get(id)?.penalties_order === 1,
    [rowById],
  );

  const predAt: PredAt = useCallback(
    (playerId: number, event: number) => predsByPlayer.get(playerId)?.get(event),
    [predsByPlayer],
  );

  const seriesOf = useCallback(
    (id: number): XpByEvent | undefined => seriesById.get(id),
    [seriesById],
  );

  /** `seasonWindow` is `windowEnd - nextEvent + 1` (see the fetch above), so this recovers the real season-end gameweek without a second query. */
  const lastEvent = nextEvent !== null ? nextEvent + seasonWindow - 1 : null;

  /** The chip plan's legal entries — computed once, shared by the deadline optimiser (window-bounded below) and the forward path (which resolves its own window per gameweek). */
  const chipPlanUsable = useMemo(() => {
    if (!team || nextEvent === null || lastEvent === null) return [];
    return validateChipPlan(team.chipPlan, chipDefinitions, nextEvent, lastEvent, team.activeChip, playedChips)
      .usable;
  }, [team, chipDefinitions, nextEvent, lastEvent, playedChips]);

  /** The chip plan's usable entries, resolved into the two things the simulator can act on within this horizon window. */
  const chipContext = useMemo(() => {
    if (nextEvent === null) return null;
    const toEvent = nextEvent + horizonLength(horizon, seasonWindow) - 1;
    return chipContextFor(chipPlanUsable, nextEvent, toEvent);
  }, [chipPlanUsable, nextEvent, horizon, seasonWindow]);

  const simulation = useMemo(() => {
    if (!team || scoredById.size === 0) return null;
    return simulateTransfers({
      team,
      moves,
      // Wildcard mode waives the hit outright, whatever the real free-transfer
      // count is — the same trick the optimizer's own wildcard branch uses.
      freeTransfers: wildcardMode ? moves.length : freeTransfers,
      scoredById: scoredById,
      isPenaltyTaker,
      lookup,
      xpOf,
      availabilityOf,
      rules,
      horizon,
      chip: chipContext ? { context: chipContext, predAt, seriesOf } : undefined,
    });
  }, [
    team,
    moves,
    wildcardMode,
    freeTransfers,
    scoredById,
    isPenaltyTaker,
    lookup,
    xpOf,
    availabilityOf,
    rules,
    horizon,
    chipContext,
    predAt,
    seriesOf,
  ]);

  /**
   * The window check alone isn't enough — a draft that already has a
   * *different* chip active can't also play Wildcard, the same guard
   * `transfer-optimizer.ts`'s own wildcard branch applies.
   */
  const wildcardBlockedReason: string | null =
    !wildcard.available
      ? wildcard.reason
      : team && team.activeChip && team.activeChip !== "wildcard"
        ? `This draft already has the ${chipLabel(team.activeChip)} chip active.`
        : null;

  const pool = useMemo(() => [...scoredById.values()], [scoredById]);

  /**
   * The weekly decision: roll, spend, take a hit, or wildcard. This is a real
   * search over candidate baskets, not a lookup, so it used to run inside a
   * bare useMemo — freezing the tab on every keystroke that touched horizon,
   * free transfers, or the decision margin, with a `loading={plan === null}`
   * flag that was only ever true *before* the memo ran, never during it. Now
   * gated like `runTransferPath` below: button-triggered, one setTimeout(0)
   * to let the busy state paint, and a signature of the inputs that mattered
   * last time it ran so a changed input surfaces "re-run", not a stale
   * number silently presented as current.
   */
  const pathSignatureInputs = useMemo(
    () =>
      JSON.stringify({
        draftId: team?.draftId ?? null,
        playerIds: team ? team.players.map((p) => p.playerId).join(",") : null,
        horizon,
        freeTransfers,
        decisionMargin,
        nextEvent,
        lastEvent,
        wildcard,
        chipPlanUsable,
      }),
    [team, horizon, freeTransfers, decisionMargin, nextEvent, lastEvent, wildcard, chipPlanUsable],
  );
  const pathStale = pathResult !== null && pathSignature !== null && pathSignature !== pathSignatureInputs;
  const pathReady =
    !!team &&
    scoredById.size > 0 &&
    nextEvent !== null &&
    lastEvent !== null &&
    team.players.length === rules.squadSize;

  /** Forward multi-gameweek path — a bounded but real search, gated behind a button like `/deadline`'s optimiser. */
  const runTransferPath = useCallback(() => {
    if (!team || scoredById.size === 0 || nextEvent === null || lastEvent === null) return;
    setPathLoading(true);
    setTimeout(() => {
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
        rules,
        horizon,
        decisionMargin,
        freeTransfers,
        event: nextEvent,
        windowEnd: lastEvent,
        plan: chipPlanUsable,
        wildcard,
      });
      setPathResult(result);
      setPathSignature(pathSignatureInputs);
      setPathLoading(false);
    }, 0);
  }, [
    team,
    scoredById,
    nextEvent,
    lastEvent,
    pool,
    lookup,
    xpOf,
    availabilityOf,
    isPenaltyTaker,
    seriesOf,
    predAt,
    rules,
    horizon,
    decisionMargin,
    freeTransfers,
    chipPlanUsable,
    wildcard,
    pathSignatureInputs,
  ]);

  // Auto-run once, the first time the page has everything it needs — so
  // opening /transfers still answers without requiring a click, exactly as it
  // did when TransferPlan owned the headline. Every change after that surfaces
  // the "inputs changed" banner instead of silently re-running (Sprint 19,
  // Stage 3).
  useEffect(() => {
    if (!pathReady || pathResult !== null || pathLoading) return;
    const t = setTimeout(runTransferPath, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathReady]);

  /** Ranked candidates for the slot being filled, plus a free-text search. */
  const candidates = useMemo(() => {
    if (!team || pickingFor === null) return [];
    const target = scoredById.get(pickingFor);
    if (!target) return [];

    const q = search.trim();
    if (q.length >= 2) {
      const owned = new Set(team.players.map((p) => p.playerId));
      return [...scoredById.values()]
        .filter((c) => {
          const row = rowById.get(c.id);
          return (
            row !== undefined &&
            c.elementType === target.elementType &&
            !owned.has(c.id) &&
            matchesPlayerQuery(row, q)
          );
        })
        .sort((a, b) => xpFor(b, horizon) - xpFor(a, horizon))
        .slice(0, CANDIDATES)
        .map((player) => ({
          player,
          teamFit: null as number | null,
          rationale: [] as string[],
          exitRoutes: undefined as number | undefined,
        }));
    }

    return findReplacements(
      target,
      [...scoredById.values()],
      team,
      rules,
      lookup,
      horizon,
      CANDIDATES,
      { reversibility: true },
    ).map((r) => ({ player: r.player, teamFit: r.teamFit, rationale: r.rationale, exitRoutes: r.exitRoutes }));
  }, [team, pickingFor, scoredById, rowById, search, horizon, rules, lookup]);

  const addMove = (outId: number, inId: number) => {
    setMoves((prev) => [...prev.filter((m) => m.outId !== outId), { outId, inId }]);
    setPickingFor(null);
    setSearch("");
    // Starting a new basket makes the previous apply's confirmation stale.
    setApplied(null);
  };

  const applyAsNewDraft = () => {
    if (!simulation || !team || moves.length === 0) return;
    const count = simulation.cost.transfers;
    const copy: TeamState = {
      ...simulation.resultingTeam,
      draftId: crypto.randomUUID(),
      name: wildcardMode
        ? `${team.name} (Wildcard)`
        : `${team.name} +${count} transfer${count === 1 ? "" : "s"}`,
      // A wildcard spends the chip, not a free transfer — the count carried
      // into the new draft is unchanged from the original.
      freeTransfers: wildcardMode ? team.freeTransfers : simulation.resultingTeam.freeTransfers,
      activeChip: wildcardMode ? "wildcard" : simulation.resultingTeam.activeChip,
      createdAt: new Date().toISOString(),
    };
    saveDraft(copy);
    setDrafts(listDrafts());
    setApplied(`Saved as "${copy.name}" — the original draft is untouched.`);
    // The basket has been spent into the new draft; simulating against the
    // now-stale, already-applied moves would just restate what was just saved.
    setMoves([]);
    setPickingFor(null);
    setSearch("");
    setWildcardMode(false);
  };

  const movesByOut = useMemo(() => new Map(moves.map((m) => [m.outId, m])), [moves]);

  const handleChipPlanChange = (next: ChipPlan) => {
    if (!team) return;
    saveDraft({ ...team, chipPlan: next });
    setDrafts(listDrafts());
  };

  /**
   * Sprint 23: the picker used to render once, inline below the whole
   * table — "Replace" on any row opened a panel with no visual link to that
   * row, and off-screen entirely on mobile. Built once here and rendered
   * twice below (mobile inline, desktop in the aside) so both spots stay in
   * sync rather than risking two hand-copies drifting apart.
   */
  const pickerBody = pickingFor === null ? null : (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Replacing {scoredById.get(pickingFor)?.webName}
        </h3>
        <button
          type="button"
          onClick={() => setPickingFor(null)}
          aria-label="Cancel"
          className="rounded text-zinc-400 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-zinc-200"
        >
          ×
        </button>
      </div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search for a specific player…"
        className="mt-2 w-full rounded-md border border-input bg-surface-3 px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {candidates.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">
          {search.trim().length >= 2
            ? "No player of that position matches."
            : "Nothing available improves on this pick."}
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {candidates.map(({ player, teamFit, rationale, exitRoutes }) => (
            <li key={player.id}>
              {/*
                A real <button> here used to wrap the "N exit routes"
                TapToReveal trigger, itself a <button> — invalid HTML (a
                button can't contain a button) and a real React hydration
                error. This row is a div with its own role/keyboard handling
                instead; the TapToReveal's own click is stopped from
                bubbling (below) so opening the exit-routes tooltip doesn't
                also fire addMove.
              */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => addMove(pickingFor, player.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    addMove(pickingFor, player.id);
                  }
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:hover:bg-purple-950/60"
              >
                <span className="block min-w-0">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {player.webName}
                  </span>
                  <span className="ml-1.5 text-xs text-zinc-500">
                    {player.teamShort} · {money(player.price)}
                  </span>
                  {rationale.length > 0 && (
                    <span className="block text-[11px] text-zinc-500 break-words">
                      {rationale.join(" · ")}
                    </span>
                  )}
                  {exitRoutes !== undefined && (
                    <span
                      className="block"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <TapToReveal
                        label="What is an exit route?"
                        wrapperClassName="relative block"
                        triggerClassName="text-[10px] text-zinc-400"
                        trigger={`${exitRoutes} exit route${exitRoutes === 1 ? "" : "s"}`}
                      >
                        <p>
                          Other legal candidates at this position after this swap — an exit
                          route, not a ranking factor.
                        </p>
                      </TapToReveal>
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block tabular-nums font-semibold text-purple-800 dark:text-[#00FF87]">
                    {xpFor(player, horizon).toFixed(1)}
                  </span>
                  {teamFit !== null && (
                    <span
                      className={`block text-[10px] tabular-nums ${
                        teamFit > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-amber-700 dark:text-amber-400"
                      }`}
                    >
                      fit {signed(teamFit)}
                    </span>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const tabButton = (id: TransfersTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-current={tab === id ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tab === id
          ? "bg-purple-950 text-white dark:bg-emerald-950/60 dark:text-[#00FF87] dark:ring-1 dark:ring-[#00FF87]/40"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-purple-950/50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Transfer Simulator
            <InfoTooltip>
              <FdrLegendContent />
            </InfoTooltip>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Queue transfers against a saved draft and see what they buy after the hit.
          </p>
        </div>
        {tab === "transfers" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">Horizon</span>
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              title={h === "season" ? seasonHorizonNote(seasonWindow) : undefined}
              aria-pressed={horizon === h}
              className={`rounded-md border px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                horizon === h
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-input text-muted-foreground hover:bg-muted"
              }`}
            >
              {horizonLabel(h)}
            </button>
          ))}
        </div>
        )}
      </div>

      {tab === "transfers" && horizon === "season" && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{seasonHorizonNote(seasonWindow)}</p>
      )}

      {/* Sprint 33 — /chips merged in here. The Squad selector moved up out
          of the simulator's control row because both tabs plan the *same*
          draft: two selectors that can disagree is worse than one that
          can't, which is why ChipTiming takes the draft as a prop rather
          than resolving its own. */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-zinc-200 p-1 dark:border-purple-900/40">
          {tabButton("transfers", "Transfer path")}
          {tabButton("chips", "Chip timing")}
        </div>
        {drafts.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            Squad
            <select
              value={draftId ?? ""}
              onChange={(e) => setDraftId(e.target.value)}
              className="rounded-md border border-input bg-surface-3 px-2 py-1.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {drafts.map((d) => (
                <option key={d.draftId} value={d.draftId}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Mounted only while its tab is showing: the chip engine does its own
          player/prediction/fixture loads, and someone only planning
          transfers should not pay for them. */}
      {tab === "chips" && (
        <ChipTiming
          drafts={drafts}
          draftId={draftId}
          onDraftsChanged={() => setDrafts(listDrafts())}
          onShowTransferPath={() => setTab("transfers")}
        />
      )}

      {tab === "transfers" && (
      <>
      {/* controls */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <label
          className={`flex items-center gap-2 text-zinc-600 dark:text-zinc-400 ${wildcardMode ? "opacity-40" : ""}`}
        >
          Free transfers
          <select
            value={freeTransfers}
            onChange={(e) => {
              const n = Number(e.target.value);
              setFreeTransfers(n);
              // Persisted for the same reason /deadline's identical select
              // is: this used to be throwaway local state, so the sticky
              // ContextBar (and /deadline, My Team) never saw what was
              // picked here.
              if (team) {
                saveDraft({ ...team, freeTransfers: n });
                setDrafts(listDrafts());
              }
            }}
            disabled={wildcardMode}
            title={
              wildcardMode
                ? "Irrelevant in Wildcard mode — every move is free."
                : "FPL lets you bank up to five. Accrual is not modelled — set what you actually hold."
            }
            className="rounded-md border border-input bg-surface-3 px-2 py-1.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
          >
            {Array.from({ length: MAX_FREE_TRANSFERS + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`flex items-center gap-2 ${
            wildcardBlockedReason === null
              ? "text-zinc-600 dark:text-zinc-400"
              : "text-zinc-400 dark:text-zinc-600"
          }`}
          title={
            wildcardBlockedReason ??
            "Apply this basket with no points hit, however many players change — the same as playing the Wildcard chip."
          }
        >
          <input
            type="checkbox"
            checked={wildcardMode}
            disabled={wildcardBlockedReason !== null}
            onChange={(e) => setWildcardMode(e.target.checked)}
            className="disabled:cursor-not-allowed"
          />
          Apply as Wildcard (no hit)
        </label>
        {moves.length > 0 && (
          <button
            type="button"
            onClick={() => setMoves([])}
            className="rounded-md border border-input px-2.5 py-1 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear {moves.length} transfer{moves.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {team && lastEvent !== null && nextEvent !== null && (
        <ChipPlanEditor
          plan={team.chipPlan}
          chipDefinitions={chipDefinitions}
          nextEvent={nextEvent}
          lastEvent={lastEvent}
          activeChip={team.activeChip}
          playedChips={playedChips}
          onChange={handleChipPlanChange}
        />
      )}

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="mt-6 flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading player data…
        </p>
      )}

      {!loading && drafts.length === 0 && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-card p-6 text-center dark:border-purple-900/40">
          <p className="text-sm text-zinc-500">
            No saved squads yet. Build one in the{" "}
            <Link
              href="/builder"
              className="font-medium text-purple-700 underline-offset-2 hover:underline dark:text-[#00FF87]"
            >
              Team Builder
            </Link>{" "}
            first. Simulating against your real FPL squad needs the team sync that arrives with
            authentication — FPL does not publish picks until after the first deadline.
          </p>
        </div>
      )}

      {team && !loading && nextEvent !== null && team.players.length === rules.squadSize && (
        <TransferPath
          result={pathResult}
          loading={pathLoading}
          onRun={runTransferPath}
          hasChipPlan={chipPlanUsable.length > 0}
          horizon={horizon}
          stale={pathStale}
          decisionMargin={decisionMargin}
          onDecisionMarginChange={setDecisionMargin}
          signatureOf={signatureOf}
          loadedSignature={moves.length > 0 ? signatureOf(moves) : null}
          onLoad={(next) => {
            setMoves(next);
            setPickingFor(null);
            setSearch("");
            setApplied(null);
          }}
        />
      )}

      {team && !loading && team.players.length !== rules.squadSize && (
        <p className="mt-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          {team.name} has {team.players.length} of {rules.squadSize} players. The transfer plan needs
          a complete squad — a partial one has free slots to fill, not transfers to weigh.
        </p>
      )}

      {team && !loading && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* squad */}
          {/* min-w-0: a grid item defaults to min-width:auto, which would let
              the min-w-[34rem] table below stretch this section (and the
              page) wide instead of scrolling inside its own overflow-x-auto
              wrapper. */}
          {/* Supporting tier (Sprint 19, Stage 4a) — this is the browsing/basket
              mechanism, not the answer; the simulation result in the aside is. */}
          <section className="min-w-0 rounded-xl border border-zinc-200 bg-card-supporting p-3 dark:border-card-supporting-border">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {team.name} · {team.players.length} players
            </h2>
            <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                  <th className="sticky left-0 z-10 bg-card-supporting px-2 py-1.5">
                    Player
                  </th>
                  <th className="hidden px-2 py-1.5 sm:table-cell">Pos</th>
                  <th className="hidden px-2 py-1.5 sm:table-cell">Sell</th>
                  <th className="px-2 py-1.5">{horizonLabel(horizon)}</th>
                  <th className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1">
                      Risk
                      <InfoTooltip label="How is Risk scored?">
                        <p className="text-xs leading-relaxed">{RISK_MODEL_NOTE}</p>
                      </InfoTooltip>
                    </span>
                  </th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {team.players.map((pick) => {
                  const s = scoredById.get(pick.playerId);
                  const row = rowById.get(pick.playerId);
                  const move = movesByOut.get(pick.playerId);
                  const incoming = move ? scoredById.get(move.inId) : undefined;

                  return (
                    <tr
                      key={pick.playerId}
                      // A picker open in the aside (desktop) or below the
                      // table (mobile) is otherwise disconnected from the
                      // row that opened it — this ring is what survives a
                      // scroll and says "this one".
                      className={`border-b border-zinc-100 last:border-0 dark:border-purple-900/30 ${
                        pickingFor === pick.playerId
                          ? "bg-purple-50 ring-1 ring-inset ring-purple-300 dark:bg-purple-950/40 dark:ring-primary/50"
                          : move
                            ? "bg-amber-50/60 dark:bg-amber-950/20"
                            : ""
                      }`}
                    >
                      <td
                        className={`sticky left-0 z-10 px-2 py-1.5 ${
                          pickingFor === pick.playerId
                            ? "bg-purple-50 dark:bg-purple-950/40"
                            : move
                              ? "bg-amber-50 dark:bg-[#2a1f0a]"
                              : "bg-card-supporting"
                        }`}
                      >
                        <span className="flex max-w-[7.5rem] items-center gap-1.5 sm:max-w-none">
                          <span
                            className={`min-w-0 truncate ${
                              move
                                ? "text-zinc-400 line-through"
                                : "font-medium text-zinc-800 dark:text-zinc-200"
                            }`}
                            title={row ? (fullName(row) ?? undefined) : undefined}
                          >
                            {s?.webName ?? `#${pick.playerId}`}
                          </span>
                          {row && (
                            <AvailabilityBadge
                              status={row.status}
                              chanceOfPlaying={row.chance_of_playing_next_round}
                              news={row.news}
                              size="w-3.5 h-3.5"
                            />
                          )}
                          {team.captain === pick.playerId && (
                            <CaptainBadge className="h-4 w-4 shrink-0" />
                          )}
                          {team.viceCaptain === pick.playerId && (
                            <ViceCaptainBadge className="h-4 w-4 shrink-0" />
                          )}
                          {incoming && (
                            <span className="flex min-w-0 items-center gap-1 truncate text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              → {incoming.webName}
                              {(() => {
                                const inCode = rowById.get(move!.inId)?.code;
                                const pp = inCode !== undefined ? priceProgress.get(inCode) : undefined;
                                if (!pp || pp.verdict !== "likely tonight") return null;
                                return (
                                  <span
                                    className="shrink-0 text-amber-600 dark:text-amber-400"
                                    title={`Price watch: ${pp.direction} — ${Math.round((pp.progress ?? 0) * 100)}% (${pp.verdict})`}
                                  >
                                    {pp.direction === "rise" ? "↑" : "↓"}
                                  </span>
                                );
                              })()}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="hidden px-2 py-1.5 text-xs text-zinc-500 sm:table-cell">
                        {POSITIONS[s?.elementType ?? 0] ?? "—"}
                      </td>
                      <td className="hidden px-2 py-1.5 text-xs tabular-nums text-zinc-500 sm:table-cell">
                        {money(pick.purchasePrice)}
                      </td>
                      <td className="px-1.5 py-1.5 tabular-nums font-semibold text-purple-800 dark:text-primary">
                        {s ? xpFor(s, horizon).toFixed(1) : "—"}
                      </td>
                      <td className="px-1.5 py-1.5 tabular-nums text-zinc-500">
                        {s ? riskScore(s, horizon, seasonWindow) : "—"}
                      </td>
                      {/* Tighter left padding than the stat columns — this is
                          the action, not another number, so it doesn't need
                          the same breathing room, and the freed width is
                          what used to read as a gap before the button. */}
                      <td className="py-1.5 pl-1 pr-2 text-right">
                        {move ? (
                          <button
                            type="button"
                            onClick={() => setMoves((prev) => prev.filter((m) => m.outId !== move.outId))}
                            className="rounded text-xs text-zinc-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            undo
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setPickingFor(pick.playerId);
                              setSearch("");
                            }}
                            className="min-h-9 rounded border border-input px-2.5 py-1.5 text-sm font-medium transition-colors hover:border-purple-700 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:border-primary dark:hover:text-primary"
                          >
                            Replace
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {/* candidate picker — mobile only; the desktop copy renders in
                the aside beside the table (see below), since there's room
                there and no reason to hunt for it below the whole table. */}
            {pickerBody && (
              <div
                ref={mobilePickerRef}
                className="mt-4 rounded-lg border border-purple-300 p-3 lg:hidden dark:border-primary/40"
              >
                {pickerBody}
              </div>
            )}
          </section>

          {/* result — order-first so the decision (net xP, hits, bank) shows
              before the squad table and picker on a phone, where the grid
              collapses to one column; lg:order-none restores the right-rail
              position once there's room for both side by side. */}
          <aside className="order-first space-y-4 lg:order-none">
            {/* candidate picker — desktop only; see the mobile copy in the
                squad section above. Rendered first so it appears above the
                simulation result while a swap is in progress. */}
            {pickerBody && (
              <div className="hidden rounded-xl border border-purple-300 bg-card-supporting p-3 lg:block dark:border-primary/40">
                {pickerBody}
              </div>
            )}

            {simulation && moves.length === 0 && (
              <div className="rounded-xl border border-zinc-200 bg-card-supporting p-3 dark:border-card-supporting-border">
                <p className="text-sm text-zinc-500">
                  Choose a player to transfer out. Nothing is committed until you apply, and applying
                  writes a new draft rather than changing this one.
                </p>
                <dl className="mt-3 space-y-1 text-sm">
                  <Row
                    label={`Team xP · ${horizonLabel(horizon)}`}
                    value={simulation.before.projection.total.toFixed(1)}
                  />
                  <Row label="In the bank" value={money(simulation.before.bank)} />
                </dl>
                {/* Lives here rather than in the basket panel below, because
                    applying clears the basket immediately — the confirmation
                    would vanish along with it if it stayed there. */}
                {applied && (
                  <p
                    role="status"
                    className="mt-3 border-t border-zinc-100 pt-2.5 text-xs text-emerald-700 dark:border-purple-900/40 dark:text-emerald-400"
                  >
                    {applied}{" "}
                    <Link
                      href="/scenarios"
                      className="underline-offset-2 hover:underline dark:text-[#00FF87]"
                    >
                      Compare in Scenario Lab
                    </Link>
                  </p>
                )}
              </div>
            )}

            {simulation && moves.length > 0 && (
              <div className="rounded-xl border border-purple-300 bg-card p-4 dark:border-primary/40">
                <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {simulation.cost.transfers} transfer
                  {simulation.cost.transfers === 1 ? "" : "s"} · {horizonLabel(horizon)}
                  {wildcardMode && (
                    <span className="ml-1.5 rounded bg-purple-950 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-white dark:bg-[#00FF87] dark:text-slate-950">
                      Wildcard
                    </span>
                  )}
                </h2>

                {/* headline */}
                <div className="mt-1.5">
                  <div
                    className={`text-3xl font-extrabold tabular-nums ${
                      simulation.transferGain > 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {signed(simulation.transferGain)}
                  </div>
                  {/* The hit is shown as its own term, never folded silently into
                      the net figure. */}
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {signed(simulation.xpDelta)} xP
                    {simulation.cost.pointsCost > 0
                      ? ` − ${simulation.cost.pointsCost} hit`
                      : " · no hit"}
                    {Math.abs(simulation.riskPointsDelta) >= 0.05
                      ? ` ${simulation.riskPointsDelta > 0 ? "−" : "+"} ${Math.abs(simulation.riskPointsDelta).toFixed(1)} risk`
                      : ""}
                  </p>
                  {simulation.cost.hits > 0 && (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {simulation.cost.transfers} transfers, {simulation.cost.freeTransfers} free →{" "}
                      {simulation.cost.hits} hit{simulation.cost.hits === 1 ? "" : "s"}
                    </p>
                  )}
                </div>

                {!simulation.legal && (
                  <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
                    <p className="font-medium">This squad could not be entered into FPL:</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {simulation.problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {simulation.legal && simulation.transferGain <= 0 && (
                  <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                    This does not pay for itself over {horizonLabel(horizon)}. Rolling the transfer
                    keeps the option open.
                  </p>
                )}

                {simulation.armbandNote && (
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                    {simulation.armbandNote}
                  </p>
                )}

                {/* before / after */}
                <dl className="mt-3 space-y-1 border-t border-zinc-100 pt-2.5 text-sm dark:border-purple-900/40">
                  <Row
                    label="Team xP"
                    value={`${simulation.before.projection.total.toFixed(1)} → ${simulation.after.projection.total.toFixed(1)}`}
                    delta={simulation.xpDelta}
                  />
                  <Row
                    label="Mean FDR score"
                    value={`${simulation.before.meanFixture.toFixed(2)} → ${simulation.after.meanFixture.toFixed(2)}`}
                    delta={simulation.after.meanFixture - simulation.before.meanFixture}
                    digits={2}
                  />
                  <Row
                    label="Mean risk"
                    value={`${simulation.before.meanRisk.toFixed(0)} → ${simulation.after.meanRisk.toFixed(0)}`}
                    delta={simulation.after.meanRisk - simulation.before.meanRisk}
                    digits={0}
                    lowerIsBetter
                  />
                  <Row
                    label="Bench contribution"
                    value={`${(simulation.before.benchContribution ?? 0).toFixed(1)} → ${(simulation.after.benchContribution ?? 0).toFixed(1)}`}
                    delta={
                      (simulation.after.benchContribution ?? 0) -
                      (simulation.before.benchContribution ?? 0)
                    }
                  />
                  <Row
                    label="In the bank"
                    value={`${money(simulation.before.bank)} → ${money(simulation.after.bank)}`}
                  />
                </dl>

                {/* per move */}
                <ul className="mt-3 space-y-1.5 border-t border-zinc-100 pt-2.5 text-xs dark:border-purple-900/40">
                  {simulation.moves.map((m) => (
                    <li key={`${m.outId}-${m.inId}`}>
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {m.outName} → {m.inName}
                      </span>
                      <span className="ml-1.5 text-zinc-500">
                        {signed(m.xpDelta)} xP · {m.cashFreed >= 0 ? "frees" : "costs"}{" "}
                        {money(Math.abs(m.cashFreed))}
                        {Math.abs(m.riskDelta) >= 1 ? ` · risk ${signed(m.riskDelta, 0)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => {
                    if (simulation.legal) applyAsNewDraft();
                  }}
                  aria-disabled={!simulation.legal}
                  title={
                    simulation.legal
                      ? "Saves the result as a new draft"
                      : "Fix the problems above first"
                  }
                  className="mt-3 w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                >
                  Apply as a new draft
                </button>

                <p className="mt-3 text-[10px] leading-relaxed text-zinc-400">
                  {TRANSFER_MODEL_NOTE}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">
                  An ↑/↓ next to an incoming player above means its price watch reads &ldquo;likely
                  tonight&rdquo;. {PRICE_WATCH_MODEL_NOTE}
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
      </>
      )}
    </main>
  );
}

function Row({
  label,
  value,
  delta,
  digits = 1,
  lowerIsBetter = false,
}: {
  label: string;
  value: string;
  delta?: number;
  digits?: number;
  lowerIsBetter?: boolean;
}) {
  const good = delta === undefined ? null : lowerIsBetter ? delta < 0 : delta > 0;
  const show = delta !== undefined && Math.abs(delta) >= (digits === 0 ? 1 : 0.05);

  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">
        {value}
        {show && (
          <span
            className={`ml-1.5 text-xs ${
              good ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
            }`}
          >
            ({delta! >= 0 ? "+" : ""}
            {delta!.toFixed(digits)})
          </span>
        )}
      </dd>
    </div>
  );
}
