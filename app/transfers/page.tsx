"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { FdrLegendContent, InfoTooltip } from "@/components/info-tooltip";
import { AvailabilityBadge } from "@/components/player-status-icons";
import { CaptainBadge, ViceCaptainBadge } from "@/components/armband";
import { listDrafts, resolveRequestedDraft, saveDraft } from "@/lib/drafts";
import { fullName, matchesPlayerQuery } from "@/lib/player-search";
import {
  availabilityFromStatus,
  findReplacements,
  riskScore,
  RISK_MODEL_NOTE,
  xpFor,
  type ScoredPlayer,
} from "@/lib/scoring";
import {
  MAX_FREE_TRANSFERS,
  simulateTransfers,
  TRANSFER_MODEL_NOTE,
  type TransferMove,
} from "@/lib/transfers";
import {
  DEFAULT_DECISION_MARGIN,
  optimizeTransfers,
  type XpByEvent,
} from "@/lib/transfer-optimizer";
import { signatureOf, TransferPlan } from "@/components/transfer-plan";
import { ChipPlanEditor } from "@/components/chip-plan-editor";
import { TransferPath } from "@/components/transfer-path";
import { planTransferPath, type TransferPathResult } from "@/lib/transfer-path";
import {
  chipContextFor,
  validateChipPlan,
  type ChipDefinitionRow,
  type EventPrediction,
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

/**
 * Rows per request when reading the per-gameweek predictions.
 *
 * The API caps every response at a thousand rows whatever `.limit()` asks for,
 * and the per-gameweek series is ~380 players x 8 gameweeks. Passing a bigger
 * limit does not raise the cap — it just truncates silently, which would shrink
 * every gain the transfer plan reports. So it is paged explicitly.
 */
const PAGE_ROWS = 1000;

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

export default function TransfersPage() {
  const [drafts, setDrafts] = useState<TeamState[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [rowById, setRowById] = useState<Map<number, PlayerRow>>(new Map());
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
  const [applied, setApplied] = useState<string | null>(null);
  const [pathResult, setPathResult] = useState<TransferPathResult | null>(null);
  const [pathLoading, setPathLoading] = useState(false);

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

        const [
          playersRes,
          teamsRes,
          typesRes,
          settingsRes,
          xpRes,
          predsRes,
          fixturesRes,
          chipsRes,
        ] = await Promise.all([
            supabase
              .from("players")
              .select(
                "id, web_name, first_name, second_name, known_name, team_id, element_type, now_cost, selected_by_percent, points_per_game, status, news, chance_of_playing_next_round, penalties_order",
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
            supabase
              .from("player_predictions")
              .select("player_id, expected_minutes, start_probability")
              .eq("season", gw.season)
              .eq("event", gw.id)
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

        // Paged deliberately — see PAGE_ROWS. No upper `event` bound either:
        // rows only exist through whatever window generate-predictions last
        // ran (see "Prediction window extended" in
        // docs/sprints/additional-info.md), so this naturally tracks that
        // window rather than needing to be told it. Carries the columns
        // /chips and /deadline already fetch — expected_minutes,
        // start_probability, availability, fdr — so a chip plan's Bench
        // Boost / Triple Captain bonus can be valued per event here too.
        const series = new Map<number, XpByEvent>();
        const preds = new Map<number, Map<number, EventPrediction>>();
        for (let from = 0; ; from += PAGE_ROWS) {
          const { data: page, error: pageError } = await supabase
            .from("player_predictions")
            .select("player_id, event, expected_minutes, start_probability, availability, fdr, xp")
            .eq("season", gw.season)
            .gte("event", gw.id)
            .order("player_id")
            .order("event")
            .range(from, from + PAGE_ROWS - 1);
          if (pageError) throw new Error(pageError.message);
          for (const r of page ?? []) {
            const id = r.player_id as number;
            let byEvent = series.get(id);
            if (!byEvent) series.set(id, (byEvent = new Map()));
            byEvent.set(r.event as number, Number(r.xp ?? 0));
            let predByEvent = preds.get(id);
            if (!predByEvent) preds.set(id, (predByEvent = new Map()));
            predByEvent.set(r.event as number, {
              expectedMinutes: r.expected_minutes as number | null,
              startProbability: r.start_probability as number | null,
              availability: (r.availability as number | null) ?? 0,
              fdr: r.fdr as number | null,
              xp: r.xp as number | null,
            });
          }
          if ((page?.length ?? 0) < PAGE_ROWS) break;
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
        const predById = new Map(
          (predsRes.data ?? []).map((r) => [
            r.player_id as number,
            r as { expected_minutes: number | null; start_probability: number | null },
          ]),
        );

        const rows = (playersRes.data ?? []) as PlayerRow[];
        const scored = new Map<number, ScoredPlayer>();
        for (const p of rows) {
          const x = xpById.get(p.id);
          const pred = predById.get(p.id);
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
            expectedMinutes: pred?.expected_minutes ?? null,
            startProbability: pred?.start_probability ?? null,
            availability,
            fdrRun: fdrRuns.get(p.team_id) ?? [],
          });
        }

        setRowById(new Map(rows.map((p) => [p.id, p])));
        setScoredById(scored);
        setXp(xpById);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFreeTransfers(Math.min(MAX_FREE_TRANSFERS, Math.max(0, team.freeTransfers)));
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
    return validateChipPlan(team.chipPlan, chipDefinitions, nextEvent, lastEvent, team.activeChip).usable;
  }, [team, chipDefinitions, nextEvent, lastEvent]);

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
      scoredById,
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
        ? `This draft already has the ${team.activeChip} chip active.`
        : null;

  const pool = useMemo(() => [...scoredById.values()], [scoredById]);

  /** The weekly decision: roll, spend, take a hit, or wildcard. */
  const plan = useMemo(() => {
    if (!team || scoredById.size === 0 || nextEvent === null) return null;
    if (team.players.length !== rules.squadSize) return null;
    return optimizeTransfers({
      team,
      pool,
      scoredById,
      lookup,
      xpOf,
      availabilityOf,
      isPenaltyTaker,
      seriesOf,
      rules,
      horizon,
      freeTransfers,
      event: nextEvent,
      wildcard,
      decisionMargin,
      chip: chipContext ?? undefined,
      predAt,
    });
  }, [
    team,
    pool,
    scoredById,
    lookup,
    xpOf,
    availabilityOf,
    isPenaltyTaker,
    seriesOf,
    rules,
    horizon,
    freeTransfers,
    chipContext,
    predAt,
    nextEvent,
    wildcard,
    decisionMargin,
  ]);

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
        freeTransfers,
        event: nextEvent,
        windowEnd: lastEvent,
        plan: chipPlanUsable,
        wildcard,
      });
      setPathResult(result);
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
    freeTransfers,
    chipPlanUsable,
    wildcard,
  ]);

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
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">Horizon</span>
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              title={h === "season" ? seasonHorizonNote(seasonWindow) : undefined}
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
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{seasonHorizonNote(seasonWindow)}</p>
      )}

      {/* controls */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        {drafts.length > 0 && (
          <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            Squad
            <select
              value={draftId ?? ""}
              onChange={(e) => setDraftId(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
            >
              {drafts.map((d) => (
                <option key={d.draftId} value={d.draftId}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label
          className={`flex items-center gap-2 text-zinc-600 dark:text-zinc-400 ${wildcardMode ? "opacity-40" : ""}`}
        >
          Free transfers
          <select
            value={freeTransfers}
            onChange={(e) => setFreeTransfers(Number(e.target.value))}
            disabled={wildcardMode}
            title={
              wildcardMode
                ? "Irrelevant in Wildcard mode — every move is free."
                : "FPL lets you bank up to five. Accrual is not modelled — set what you actually hold."
            }
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 disabled:cursor-not-allowed dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
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
            onClick={() => setMoves([])}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
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
          onChange={handleChipPlanChange}
        />
      )}

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading player data…</p>}

      {!loading && drafts.length === 0 && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 text-center dark:border-purple-900/40 dark:bg-[#1E0234]">
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
        <TransferPlan
          result={plan}
          horizon={horizon}
          event={nextEvent}
          decisionMargin={decisionMargin}
          onDecisionMarginChange={setDecisionMargin}
          onLoad={(next) => {
            setMoves(next);
            setPickingFor(null);
            setSearch("");
            setApplied(null);
          }}
          loadedSignature={moves.length > 0 ? signatureOf(moves) : null}
          loading={plan === null}
        />
      )}

      {team && !loading && nextEvent !== null && team.players.length === rules.squadSize && (
        <TransferPath
          result={pathResult}
          loading={pathLoading}
          onRun={runTransferPath}
          hasChipPlan={chipPlanUsable.length > 0}
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
          <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {team.name} · {team.players.length} players
            </h2>
            <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                  <th className="sticky left-0 z-10 bg-white px-2 py-1.5 dark:bg-[#1E0234]">
                    Player
                  </th>
                  <th className="hidden px-2 py-1.5 sm:table-cell">Pos</th>
                  <th className="hidden px-2 py-1.5 sm:table-cell">Sell</th>
                  <th className="px-2 py-1.5">{horizonLabel(horizon)}</th>
                  <th className="px-2 py-1.5">
                    <span
                      title={RISK_MODEL_NOTE}
                      className="cursor-help underline decoration-dotted underline-offset-2"
                    >
                      Risk
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
                      className={`border-b border-zinc-100 last:border-0 dark:border-purple-900/30 ${
                        move ? "bg-amber-50/60 dark:bg-amber-950/20" : ""
                      }`}
                    >
                      <td
                        className={`sticky left-0 z-10 px-2 py-1.5 ${
                          move
                            ? "bg-amber-50 dark:bg-[#2a1f0a]"
                            : "bg-white dark:bg-[#1E0234]"
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
                            <span className="truncate text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              → {incoming.webName}
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
                      <td className="px-2 py-1.5 tabular-nums font-semibold text-purple-800 dark:text-[#00FF87]">
                        {s ? xpFor(s, horizon).toFixed(1) : "—"}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-zinc-500">
                        {s ? riskScore(s, horizon, seasonWindow) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {move ? (
                          <button
                            onClick={() => setMoves((prev) => prev.filter((m) => m.outId !== move.outId))}
                            className="text-xs text-zinc-500 underline-offset-2 hover:underline"
                          >
                            undo
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setPickingFor(pick.playerId);
                              setSearch("");
                            }}
                            className="min-h-9 rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/60 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
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

            {/* candidate picker */}
            {pickingFor !== null && (
              <div className="mt-4 rounded-lg border border-purple-300 p-3 dark:border-[#00FF87]/40">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Replace {scoredById.get(pickingFor)?.webName}
                  </h3>
                  <button
                    onClick={() => setPickingFor(null)}
                    aria-label="Cancel"
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    ×
                  </button>
                </div>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search for a specific player…"
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
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
                        <button
                          onClick={() => addMove(pickingFor, player.id)}
                          className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-purple-950/60"
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
                                className="block text-[10px] text-zinc-400"
                                title="Other legal candidates at this position after this swap — an exit route, not a ranking factor."
                              >
                                {exitRoutes} exit route{exitRoutes === 1 ? "" : "s"}
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
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* result */}
          <aside className="space-y-4">
            {simulation && moves.length === 0 && (
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
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
              <div className="rounded-xl border border-purple-300 bg-white p-4 dark:border-[#00FF87]/40 dark:bg-[#1E0234]">
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
                  onClick={() => {
                    if (simulation.legal) applyAsNewDraft();
                  }}
                  aria-disabled={!simulation.legal}
                  title={
                    simulation.legal
                      ? "Saves the result as a new draft"
                      : "Fix the problems above first"
                  }
                  className="mt-3 w-full rounded-md bg-purple-950 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
                >
                  Apply as a new draft
                </button>

                <p className="mt-3 text-[10px] leading-relaxed text-zinc-400">
                  {TRANSFER_MODEL_NOTE}
                </p>
              </div>
            )}
          </aside>
        </div>
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
