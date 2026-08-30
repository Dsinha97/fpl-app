"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { InfoTooltip } from "@/components/info-tooltip";
import { AvailabilityBadge } from "@/components/player-status-icons";
import { useAuth } from "@/components/auth-provider";
import { layoutFromLineup, PitchView, type SquadLayout } from "@/components/pitch-view";
import type { PlayerData } from "@/components/player-card";
import { listDrafts, resolveRequestedDraft, saveDraft } from "@/lib/drafts";
import { ChipPlanEditor } from "@/components/chip-plan-editor";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TransferPath } from "@/components/transfer-path";
import { planTransferPath, type TransferPathResult } from "@/lib/transfer-path";
import { chipContextFor, validateChipPlan, type ChipDefinitionRow } from "@/lib/chip-plan";
import { loadSeasonContext, type SeasonContext } from "@/lib/season-context";
import { fmtCountdown } from "@/lib/countdown";
import { loadManagerPicks, type ManagerPick } from "@/lib/manager-picks";
import { loadPredictionSeries } from "@/lib/player-pool";
import { loadGameweekState, LIVE_MODEL_NOTE, type GameweekState } from "@/lib/gameweek-state";
import {
  LiveFixtureCard,
  type LiveFixtureData,
  type LiveFixturePlayer,
  type LiveFixtureTeam,
} from "@/components/live-fixtures";
import {
  hasConsistentLineup,
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
  type WildcardWindow,
  type XpByEvent,
} from "@/lib/transfer-optimizer";
import { freeTransfersDisplay, MAX_FREE_TRANSFERS, TRANSFER_MODEL_NOTE } from "@/lib/transfers";
import { ago, describe, type FeedRow } from "@/lib/change-feed";
import { confidentEntities, dedupeByUrl, sourceBadge, type NewsRow } from "@/lib/news-feed";
import { loadPastResults, type PastResult } from "@/lib/player-history";

interface PlayerRow {
  id: number;
  code: number;
  web_name: string;
  team_id: number;
  element_type: number;
  now_cost: number | null;
  selected_by_percent: number | null;
  points_per_game: number | null;
  total_points: number | null;
  bonus: number | null;
  form: number | null;
  defensive_contribution: number | null;
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

const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

const STATUS_SEVERITY: Record<string, number> = { s: 0, i: 0, u: 0, n: 0, d: 1, a: 2 };

/**
 * Two tiers, not one — Sprint 19 Stage 4a. This page used to give every
 * section the same card, so nothing outranked anything else and the page
 * read as a list rather than an answer. `card` stays full weight for the
 * deadline's actual decisions (squad, captain/XI, chip call, transfer call);
 * `cardSupporting` recedes into the page background with a fainter border
 * and a smaller uppercase heading for context that isn't itself a decision
 * (readiness, availability, price & news watch).
 */
const card = "rounded-lg border border-zinc-200 bg-card p-4 dark:border-purple-900/40";
const cardSupporting =
  "rounded-lg border border-zinc-200 bg-card-supporting p-3 dark:border-card-supporting-border";
const supportingHeading = "text-xs font-medium uppercase tracking-wide text-zinc-500";

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
  // Each team's run of upcoming FDRs — published alongside rowById/xpById
  // (Stage 2) rather than folded silently into scoredById, so scoredById can
  // be derived rather than needing its own setter blocked on predictions.
  const [fdrRunsByTeam, setFdrRunsByTeam] = useState<Map<number, number[]>>(new Map());
  const [predsByPlayer, setPredsByPlayer] = useState<Map<number, Map<number, EventPrediction>>>(
    new Map(),
  );
  const [wildcard, setWildcard] = useState<WildcardWindow>({ available: false, reason: null });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `loading` now covers only the shell + squad-view fetch (Stage 1 & 2
  // below) so the pitch and readiness sections paint immediately; the
  // predictions fetch is staged separately so it never blocks that first
  // paint. `predsLoading` clears once the deadline gameweek's own
  // predictions are in (unlocks the pitch's xP, captain/XI, chip call);
  // `predsFullLoading` clears once every remaining event has arrived
  // (needed before the transfer optimiser/path can trust the series).
  const [predsLoading, setPredsLoading] = useState(true);
  const [predsFullLoading, setPredsFullLoading] = useState(true);

  const [horizon, setHorizon] = useState<Horizon>(5);
  const [freeTransfers, setFreeTransfers] = useState(1);
  const [decisionMargin, setDecisionMargin] = useState(DEFAULT_DECISION_MARGIN);
  const [pathResult, setPathResult] = useState<TransferPathResult | null>(null);
  const [pathLoading, setPathLoading] = useState(false);

  const [feedRows, setFeedRows] = useState<FeedRow[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);

  const [newsRows, setNewsRows] = useState<NewsRow[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);

  const [now, setNow] = useState(() => Date.now());

  // ------------------------------------------------------------- live hub
  //
  // Sprint 13. `ctx.nextEvent` (is_next) is the gameweek being *planned* —
  // once GW1 kicks off it's already GW2, so live tracking reads a separate
  // "is_current" gameweek rather than piggy-backing on ctx.
  const [liveEvent, setLiveEvent] = useState<{ season: string; event: number } | null>(null);
  const [liveStarted, setLiveStarted] = useState(false);
  // Sprint 28. `liveStarted` alone cannot tell "in play" from "over" — a
  // `started = true` fixture row stays true after the final whistle, forever.
  // These two carry the extra evidence the phase needs; see `livePhase` below.
  const [liveProbed, setLiveProbed] = useState(false);
  const [liveOver, setLiveOver] = useState(false);
  const [gwState, setGwState] = useState<GameweekState | null>(null);
  const [gwStateLoading, setGwStateLoading] = useState(false);
  const [gwStateError, setGwStateError] = useState<string | null>(null);
  const [liveTick, setLiveTick] = useState(0);
  const [liveTeamsById, setLiveTeamsById] = useState<Map<number, LiveFixtureTeam>>(new Map());
  const [liveFixtures, setLiveFixtures] = useState<LiveFixtureData[]>([]);
  const [pastResultsByPlayer, setPastResultsByPlayer] = useState<Map<number, PastResult[]>>(new Map());

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
    if (!team) return;
    const ft = freeTransfersDisplay(team);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFreeTransfers(ft.kind === "unlimited" ? MAX_FREE_TRANSFERS : ft.n);
  }, [team]);

  useEffect(() => {
    // A different squad invalidates the last transfer search.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPathResult(null);
  }, [draftId]);

  // ------------------------------------------------------------------ countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // --------------------------------------------------------------------- data
  //
  // Staged in three parts so the page paints as soon as it can rather than
  // waiting on the slowest query. Stage 1 (season context) and Stage 2
  // (players/xp/chips/fixtures/teams) are everything the squad pitch,
  // readiness and availability sections need — `loading` clears the moment
  // Stage 2 lands. Stage 3 is `player_predictions`, split into 3a (just the
  // deadline gameweek — unlocks the pitch's xP, captain/XI, chip call) and
  // 3b (the rest of the horizon, paged exactly as before — needed only by
  // the transfer optimiser/path). Previously all three ran serially behind
  // one `loading` flag, so the whole page sat behind 3b's ~20 sequential
  // 1000-row pages before anything painted.
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
              "id, code, web_name, team_id, element_type, now_cost, selected_by_percent, points_per_game, total_points, bonus, form, defensive_contribution, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order",
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
          supabase.from("teams").select("id, code, name, short_name").eq("season", seasonCtx.season),
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
        const liveTeams = new Map<number, LiveFixtureTeam>();
        for (const t of teamsRes.data ?? []) {
          meta.set(t.id as number, {
            code: (t.code as number | null) ?? null,
            short: t.short_name as string,
          });
          liveTeams.set(t.id as number, {
            id: t.id as number,
            code: (t.code as number | null) ?? null,
            name: t.name as string,
            short_name: t.short_name as string,
          });
        }
        setTeamMeta(meta);
        setLiveTeamsById(liveTeams);

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
        setFdrRunsByTeam(fdrRuns);

        const rows = (playersRes.data ?? []) as PlayerRow[];
        setRowById(new Map(rows.map((p) => [p.id, p])));
        setXpById(new Map((xpRes.data ?? []).map((r) => [r.player_id as number, r as XpRow])));

        // Stage 2 is everything the squad pitch, readiness and availability
        // sections need — paint now rather than waiting on predictions.
        setLoading(false);

        // Stage 3a: just the deadline gameweek, one request — unlocks the
        // pitch's xP, captain/XI and chip call without the full-horizon page.
        const rowToEvent = (r: {
          player_id: unknown;
          event: unknown;
          expected_minutes: unknown;
          start_probability: unknown;
          availability: unknown;
          fdr: unknown;
          xp: unknown;
        }) => ({
          id: r.player_id as number,
          event: r.event as number,
          pred: {
            expectedMinutes: r.expected_minutes as number | null,
            startProbability: r.start_probability as number | null,
            availability: (r.availability as number | null) ?? 0,
            fdr: r.fdr as number | null,
            xp: r.xp as number | null,
          } satisfies EventPrediction,
        });

        const { data: firstEventRows, error: firstEventError } = await supabase
          .from("player_predictions")
          .select("player_id, event, expected_minutes, start_probability, availability, fdr, xp")
          .eq("season", seasonCtx.season)
          .eq("event", seasonCtx.nextEvent);
        if (firstEventError) throw new Error(firstEventError.message);

        const preds = new Map<number, Map<number, EventPrediction>>();
        for (const r of firstEventRows ?? []) {
          const { id, event, pred } = rowToEvent(r);
          let byEvent = preds.get(id);
          if (!byEvent) preds.set(id, (byEvent = new Map()));
          byEvent.set(event, pred);
        }
        setPredsByPlayer(new Map(preds));
        setPredsLoading(false);

        // Stage 3b: the rest of the horizon — via the shared, concurrently-
        // paged, memoised loader lib/player-pool.ts already built for
        // /transfers and /chips, rather than this page's own serial
        // .range() loop (CLAUDE.md's "one quantity, one implementation").
        // Deliberately fetches from `nextEvent`, not `nextEvent + 1`: that's
        // the exact cache key /transfers and /chips already use, so
        // navigating between any of these pages is a cache hit rather than
        // a refetch. It re-covers the event Stage 3a already fetched, but
        // that overlap is free (same concurrent batch) and safe (the
        // `.set()` below overwrites with an identical value).
        const fullSeries = await loadPredictionSeries(seasonCtx.season, seasonCtx.nextEvent);
        for (const row of fullSeries) {
          let byEvent = preds.get(row.playerId);
          if (!byEvent) preds.set(row.playerId, (byEvent = new Map()));
          byEvent.set(row.event, {
            expectedMinutes: row.expectedMinutes,
            startProbability: row.startProbability,
            availability: row.availability,
            fdr: row.fdr,
            xp: row.xp,
          });
        }
        setPredsByPlayer(new Map(preds));
        setPredsFullLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPredsLoading(false);
        setPredsFullLoading(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ------------------------------------------------------------- live hub
  //
  // Polled independently of the once-a-second countdown timer — sync-live-
  // gameweek itself only runs every 2 minutes, so anything faster than that
  // is wasted reads.
  useEffect(() => {
    const id = setInterval(() => setLiveTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Which gameweek is actually live right now, independent of what's being
  // planned. Cheap and safe to poll: one row, cache-friendly, and this is
  // the only place on the page that needs "is_current" rather than "is_next".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: gw } = await supabase
        .from("gameweeks")
        .select("season, id, finished")
        .eq("is_current", true)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (!gw) {
        setLiveProbed(true);
        return;
      }
      const season = gw.season as string;
      const event = gw.id as number;
      setLiveEvent({ season, event });

      const [started, unfinished] = await Promise.all([
        supabase
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .eq("season", season)
          .eq("event", event)
          .eq("started", true),
        // `finished_provisional` flips at the final whistle, ahead of both
        // `fixtures.finished` and the `gameweeks` row — so this clause moves
        // the page on a sync cycle or two earlier than waiting for FPL's own
        // gameweek flag. Deliberately NOT `data_checked`: that lags the last
        // whistle by hours, and gating on it would bury the upcoming-gameweek
        // section through most of the planning window.
        supabase
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .eq("season", season)
          .eq("event", event)
          .eq("finished_provisional", false),
      ]);
      if (cancelled) return;
      const startedCount = started.count ?? 0;
      setLiveStarted(startedCount > 0);
      setLiveOver(startedCount > 0 && (gw.finished === true || (unfinished.count ?? 0) === 0));
      setLiveProbed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [liveTick]);

  // The live event's fixtures, with FPL's own event breakdown (`stats` —
  // lib/fixture-stats.ts), refreshed on the same tick as the live-started
  // check above. Only fetched once something is actually live, so this
  // costs nothing pre-kickoff.
  useEffect(() => {
    if (!liveEvent || !liveStarted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLiveFixtures([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("fixtures")
        .select(
          "id, event, kickoff_time, team_h, team_a, team_h_score, team_a_score, started, finished, finished_provisional, minutes, stats",
        )
        .eq("season", liveEvent.season)
        .eq("event", liveEvent.event)
        .order("kickoff_time", { ascending: true });
      if (!cancelled) setLiveFixtures((data ?? []) as LiveFixtureData[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [liveEvent, liveStarted, liveTick]);

  const resolvedEntryId = entryId ?? team?.entryId ?? null;

  useEffect(() => {
    if (!liveEvent || !liveStarted || !resolvedEntryId || rowById.size === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGwState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setGwStateLoading(true);
      setGwStateError(null);
      try {
        const byEvent = await loadManagerPicks(liveEvent.season, resolvedEntryId);
        const picks: ManagerPick[] | undefined = byEvent.get(liveEvent.event);
        if (!picks) {
          if (!cancelled) setGwState(null);
          return;
        }
        const state = await loadGameweekState(
          liveEvent.season,
          liveEvent.event,
          picks,
          (id) => rowById.get(id)?.element_type,
          (id) => rowById.get(id)?.team_id,
        );
        if (!cancelled) setGwState(state);
      } catch (err) {
        if (!cancelled) setGwStateError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setGwStateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveEvent, liveStarted, resolvedEntryId, rowById, liveTick]);

  // ------------------------------------------------------------- price/news
  //
  // change_feed already unions price rises/falls, status, news and fixture
  // changes with lag() — no new detection logic, filtered to this squad only.
  useEffect(() => {
    if (!team || rowById.size === 0 || !ctx) return;
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
        .eq("season", ctx.season)
        .in("player_code", codes)
        .order("observed_at", { ascending: false })
        .limit(100);
      setFeedRows((data ?? []) as FeedRow[]);
      setFeedLoading(false);
    })();
  }, [team, rowById, ctx]);

  // ------------------------------------------------------------- team news
  //
  // RSS headlines (Sprint 20's news_feed view) linked to this squad's players
  // or their clubs. Filtered client-side against the squad's codes rather
  // than a server-side jsonb containment query, the way change_feed's
  // `.in("player_code", codes)` works — the entities column is an aggregated
  // array per item, not a queryable column, and the last-7-days page this
  // pulls is small enough that client filtering is the simpler correct
  // choice. Only confident links (>= 0.85) surface here — a wrong headline
  // attached to a squad player is worse than no headline at all.
  useEffect(() => {
    if (!team || rowById.size === 0) return;
    const playerCodes = new Set(
      team.players.map((p) => rowById.get(p.playerId)?.code).filter((c): c is number => c !== undefined),
    );
    const clubCodes = new Set(
      team.players
        .map((p) => teamMeta.get(rowById.get(p.playerId)?.team_id ?? -1)?.code)
        .filter((c): c is number => c !== undefined),
    );
    if (playerCodes.size === 0 && clubCodes.size === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewsRows([]);
      return;
    }
    (async () => {
      setNewsLoading(true);
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data } = await supabase
        .from("news_feed")
        .select("*")
        .gte("published_at", since)
        .order("published_at", { ascending: false })
        .limit(300);
      const rows = ((data ?? []) as NewsRow[]).filter((row) =>
        confidentEntities(row).some(
          (e) =>
            (e.entity_type === "player" && playerCodes.has(e.entity_id)) ||
            (e.entity_type === "team" && clubCodes.has(e.entity_id)),
        ),
      );
      // Sprint 29.5: this card previously leaked the FFS triple-source
      // duplication that /news already filters (lib/news-feed.ts).
      setNewsRows(dedupeByUrl(rows));
      setNewsLoading(false);
    })();
  }, [team, rowById, teamMeta]);

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

  // Derived rather than set from inside the loading effect, so it exists as
  // soon as Stage 2 (rowById/xpById/fdrRunsByTeam) lands — expectedMinutes/
  // startProbability read null until Stage 3a's predictions arrive and this
  // recomputes, same "undefined/null hides it" convention as the rest of the
  // page rather than blocking the whole map on predictions.
  const scoredById = useMemo(() => {
    const scored = new Map<number, ScoredPlayer>();
    for (const p of rowById.values()) {
      const x = xpById.get(p.id);
      const pred = ctx ? predsByPlayer.get(p.id)?.get(ctx.nextEvent) : undefined;
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
        fdrRun: fdrRunsByTeam.get(p.team_id) ?? [],
      });
    }
    return scored;
  }, [rowById, xpById, fdrRunsByTeam, predsByPlayer, ctx]);

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
          value_loading: predsLoading,
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
          season_total_points: row.total_points,
          season_bonus: row.bonus,
          dc_actions: row.defensive_contribution,
          form: row.form,
          past_results: pastResultsByPlayer.get(row.id) ?? [],
        },
      ];
    });
  }, [
    team,
    ctx,
    rowById,
    predAt,
    teamMeta,
    nextFixtureByTeam,
    xpById,
    pastResultsByPlayer,
    predsLoading,
  ]);

  /**
   * The pitch shows the XI **you entered**, not the optimiser's. The Captain &
   * starting XI section below already says what the model would change, and
   * blending the recommendation into the picture of your own squad would make
   * it impossible to see which is which. When no XI has been set, the model's
   * is shown and labelled as such.
   */
  const squadLayout: SquadLayout | null = useMemo(() => {
    if (!team || !ctx) return null;

    // Your own XI/bench split needs no optimiser output at all — render it
    // as soon as the squad view (Stage 2) is in, rather than waiting on
    // predictions the way the fallback branch below has to.
    if (hasConsistentLineup(team)) {
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
        // Predictions still loading: xiXp sums to 0, which would print a
        // false "0.0 xP" — say "your XI" alone rather than a number that
        // hasn't been computed yet (CLAUDE.md's "don't ship a quietly
        // shrunken number").
        benchSummary: predsLoading ? "your XI" : `your XI ${xiXp.toFixed(1)} xP`,
      };
    }

    if (!lineup) return null;
    return layoutFromLineup(lineup);
  }, [team, ctx, lineup, rowById, predAt, predsLoading]);

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

  // ---------------------------------------------------------- live fixtures
  //
  // Sprint 13 follow-up: which of the live gameweek's fixtures the squad is
  // actually involved in, so the live hub shows match detail rather than
  // just the aggregate total above.
  const squadElementIds = useMemo(() => new Set(team?.players.map((p) => p.playerId) ?? []), [team]);

  const livePlayersById = useMemo(() => {
    const map = new Map<number, LiveFixturePlayer>();
    for (const [id, row] of rowById) map.set(id, { webName: row.web_name, teamId: row.team_id });
    return map;
  }, [rowById]);

  const squadLiveFixtures = useMemo(() => {
    if (squadElementIds.size === 0) return [];
    const squadTeamIds = new Set(
      [...squadElementIds].map((id) => rowById.get(id)?.team_id).filter((id): id is number => id !== undefined),
    );
    return liveFixtures
      .filter((f) => squadTeamIds.has(f.team_h) || squadTeamIds.has(f.team_a))
      .sort((a, b) => (a.kickoff_time ?? "9").localeCompare(b.kickoff_time ?? "9"));
  }, [liveFixtures, squadElementIds, rowById]);

  // Past-gameweek results for the squad's "recent form" ticker (player-
  // detail.tsx) — one query per squad change, not per player.
  useEffect(() => {
    if (!ctx || squadElementIds.size === 0) return;
    let cancelled = false;
    (async () => {
      const shortById = new Map([...teamMeta].map(([id, m]) => [id, m.short]));
      try {
        const rows = await loadPastResults(ctx.season, [...squadElementIds], shortById);
        if (!cancelled) setPastResultsByPlayer(rows);
      } catch {
        // Non-critical — the ticker just stays empty rather than erroring the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, squadElementIds, teamMeta]);

  // ------------------------------------------------------------ transfer path
  //
  // The only recommendation this page makes. It runs `optimizeTransfers` for
  // the deadline gameweek internally (~1,875 simulateTransfers calls: BEAM_WIDTH
  // 8 + FUNDER_WIDTH 4, MAX_BASKET 3, CANDIDATES_PER_SLOT 5) and then extends
  // that decision forward — never on load, only behind the path's own button.
  const runTransferPath = useCallback(() => {
    if (!team || !ctx || scoredById.size === 0) return;
    setPathLoading(true);
    setTimeout(() => {
      const pool = [...scoredById.values()];
      const result = planTransferPath({
        team,
        pool,
        scoredById: scoredById,
        lookup,
        xpOf,
        availabilityOf,
        isPenaltyTaker,
        seriesOf,
        predAt,
        rules: ctx.rules,
        horizon,
        decisionMargin,
        freeTransfers,
        event: ctx.nextEvent,
        windowEnd: ctx.windowEnd,
        plan: chipPlanUsable,
        wildcard,
      });
      setPathResult(result);
      setPathLoading(false);
    }, 0);
  }, [team, ctx, scoredById, lookup, xpOf, availabilityOf, isPenaltyTaker, seriesOf, predAt, horizon, decisionMargin, freeTransfers, chipPlanUsable, wildcard]);

  const countdown = ctx ? fmtCountdown(ctx.deadlineTime, now) : null;

  // ---------------------------------------------------------- live vs upcoming
  //
  // Sprint 28. The page holds two gameweeks at once — the one being played and
  // the one being planned — and which of them you care about flips at kickoff
  // and again at the final whistle. Rather than showing both in full all the
  // time, each is a collapsible section and the *phase* decides which is open
  // and which comes first.
  //
  //   none  — nothing has kicked off (pre-season, or the deadline has passed
  //           but no fixture has started). One section only; no chrome.
  //   live  — in play. Live first and open, upcoming second and closed.
  //   over  — all fixtures whistled. Order and expansion reverse.
  const livePhase: "unknown" | "none" | "live" | "over" = !liveProbed
    ? "unknown"
    : !liveEvent || !liveStarted
      ? "none"
      : liveOver
        ? "over"
        : "live";

  // Derived from the phase until the user touches a header, then theirs sticks.
  // Keyed on the live event so a new gameweek starts from the derived answer
  // again rather than inheriting last week's click.
  const [openOverride, setOpenOverride] = useState<{
    event: number | null;
    live?: boolean;
    upcoming?: boolean;
  }>({ event: null });
  const overrideFor: { live?: boolean; upcoming?: boolean } =
    openOverride.event === (liveEvent?.event ?? null) ? openOverride : {};
  const liveOpen = overrideFor.live ?? livePhase === "live";
  const upcomingOpen = overrideFor.upcoming ?? livePhase !== "live";
  const setSectionOpen = (key: "live" | "upcoming", open: boolean) =>
    setOpenOverride((prev) => ({
      ...(prev.event === (liveEvent?.event ?? null) ? prev : {}),
      event: liveEvent?.event ?? null,
      [key]: open,
    }));

  // Sprint 29.3. The watch cards (price/news + team news) moved out of the
  // top strip and into this same flex `order` scheme, so they never sit
  // above a live gameweek — live comes first while it's live, and the watch
  // cards always land between whichever gameweek section is primary and
  // whichever is secondary, never above both. When no live section is
  // rendered at all they still precede upcoming (Sprint 23's original
  // reason for existing outside a collapsible section: never orphaned
  // behind a collapsed one).
  const liveRendered = livePhase !== "none" && livePhase !== "unknown" && !!liveEvent;
  const sectionOrder = (
    section: "live" | "watch" | "upcoming",
  ): "order-1" | "order-2" | "order-3" => {
    if (livePhase === "over") {
      return section === "upcoming" ? "order-1" : section === "live" ? "order-2" : "order-3";
    }
    if (liveRendered) {
      return section === "live" ? "order-1" : section === "watch" ? "order-2" : "order-3";
    }
    return section === "upcoming" ? "order-2" : "order-1";
  };

  const liveSummary = gwStateLoading
    ? "Loading…"
    : gwState
      ? `${gwState.liveTotal} pts${gwState.provisional ? " · provisional" : ""}`
      : "No picks recorded";

  const upcomingSummary = [
    validation ? (validation.isLegal ? "Squad ready" : "Squad incomplete") : null,
    alerts.length === 0 ? "no flags" : `${alerts.length} flag${alerts.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

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
      {loading && (
        <div className="mt-6 space-y-3" role="status" aria-label="Loading deadline data">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

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
          {/* Sprint 29.3, revised in the follow-up. No card — a border
              around one line of text is chrome, not structure (Sprint 19,
              Stage 4a). But the label and the countdown+date+hint block are
              kept visually distinct now (own line each, extra vertical gap)
              rather than run on as siblings in one flex row — the label
              names what's below it, it isn't part of the same reading. */}
          <h2 className={`mt-6 ${supportingHeading}`}>{ctx.gameweekName} deadline</h2>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p
              className={`text-3xl font-bold tabular-nums ${
                countdown?.passed ? "text-red-700 dark:text-red-400" : "text-purple-900 dark:text-primary"
              }`}
            >
              {countdown?.text}
            </p>
            <p className="text-xs text-zinc-500">
              {new Date(ctx.deadlineTime).toLocaleString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {team.source === "fpl" && (
              <span className="flex items-center gap-1 text-xs text-zinc-500">
                Imported squad
                <InfoTooltip label="About this imported squad">
                  Imported from your real FPL team. {IMPORTED_SQUAD_NOTE}
                </InfoTooltip>
              </span>
            )}
          </div>

          {/* ------------------------------------ live GW ‖ upcoming GW */}
          {/* Sprint 28. Two gameweeks live on this page at once — the one
              being played and the one being planned — and which one you care
              about flips at kickoff and again at the final whistle. Each is a
              collapsible section; `livePhase` decides which is open and which
              comes first.

              Reordered with flex `order` rather than by reordering an array of
              elements: the DOM order never changes, so React cannot remount
              either subtree at the whistle and wipe an open PlayerDetail
              popover, an expanded LiveFixtureCard or ChipPlanEditor's own
              collapse state. The usual a11y objection to visual reordering
              does not bite here — whichever section is second is also
              collapsed, and a collapsed CollapsibleCard body is `inert`. */}
          <div className="mt-5 flex flex-col gap-5">
            {livePhase !== "none" && livePhase !== "unknown" && liveEvent && (
              <div className={sectionOrder("live")}>
                <CollapsibleCard
                  tier="section"
                  title={`Live — GW${liveEvent.event}`}
                  summary={liveSummary}
                  open={liveOpen}
                  onOpenChange={(o) => setSectionOpen("live", o)}
                >
                  <section className={card}>
                    {/* No title of its own any more — the section header above
                        already names the gameweek and carries the provisional
                        marker in its collapsed summary. What is left here is
                        the pair of controls that used to sit beside it. */}
                    <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
                      {gwState?.provisional && (
                        <span className="mr-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          Provisional
                        </span>
                      )}
                      <div className="flex items-center gap-3">
                        <Link
                          href="/team/"
                          className="text-xs font-medium text-purple-700 underline-offset-2 hover:underline dark:text-[#00FF87]"
                        >
                          View in My Team →
                        </Link>
                        <InfoTooltip label="About live figures">{LIVE_MODEL_NOTE}</InfoTooltip>
                      </div>
                    </div>

                    {gwStateLoading && (
                      <div className="mb-3 space-y-3" role="status" aria-label="Loading live scores">
                        <Skeleton className="h-9 w-24" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-3/4" />
                        </div>
                      </div>
                    )}
                    {gwStateError && (
                      <p className="text-sm text-red-700 dark:text-red-300">{gwStateError}</p>
                    )}
                    {!gwStateLoading && !gwStateError && !gwState && (
                      <p className="text-sm text-zinc-500">
                        No picks recorded for this manager for GW{liveEvent.event} yet.
                      </p>
                    )}

                    {gwState && (
                      // `max-w-2xl` — the live card used to sit in a 1fr
                      // column beside a 360px rail, which is what stopped the
                      // BPS race stretching the full page width (Sprint 23).
                      // The rail moved to the top strip in Sprint 28, so the
                      // constraint has to live here instead.
                      <div className="mb-3 max-w-2xl space-y-3">
                        <div>
                          <p className="text-3xl font-bold tabular-nums text-purple-900 dark:text-primary">
                            {gwState.liveTotal}
                          </p>
                          <p className="text-xs text-zinc-500">
                            Live points, starters + captain{gwState.autoSubs.length > 0 ? " + projected subs" : ""}.
                            Bench score ({gwState.squadPoints.benchRaw}) only counts under a live Bench
                            Boost.
                          </p>
                          {gwState.captaincy.handedOver && (
                            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                              Captain didn&apos;t feature — armband projected onto the vice-captain (
                              {rowById.get(gwState.captaincy.effectiveElement)?.web_name ?? `#${gwState.captaincy.effectiveElement}`}
                              ).
                            </p>
                          )}
                        </div>

                        <div>
                          <p className={supportingHeading}>Player status</p>
                          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                            {(() => {
                              const counts = { not_started: 0, playing: 0, finished: 0 };
                              for (const s of gwState.statusByElement.values()) counts[s] += 1;
                              return `${counts.playing} playing · ${counts.not_started} yet to play · ${counts.finished} finished`;
                            })()}
                          </p>
                        </div>

                        {gwState.autoSubs.length > 0 && (
                          <div>
                            <p className={supportingHeading}>Projected auto-subs</p>
                            <ul className="mt-1 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                              {gwState.autoSubs.map((sub) => (
                                <li key={`${sub.outElement}-${sub.inElement}`}>
                                  {rowById.get(sub.inElement)?.web_name ?? `#${sub.inElement}`} on for{" "}
                                  {rowById.get(sub.outElement)?.web_name ?? `#${sub.outElement}`}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {gwState.bpsRace.length > 0 && (
                          <div>
                            <p className={supportingHeading}>BPS race (provisional bonus)</p>
                            <ul className="mt-1 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                              {gwState.bpsRace
                                .filter((r) => r.bps > 0)
                                .slice(0, 5)
                                .map((r) => (
                                  <li key={r.element} className="flex justify-between">
                                    <span>{rowById.get(r.element)?.web_name ?? `#${r.element}`}</span>
                                    <span className="tabular-nums">
                                      {r.bps} bps{r.bonus > 0 ? ` · +${r.bonus} bonus so far` : ""}
                                    </span>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {squadLiveFixtures.length > 0 && (
                      <div className="flex flex-wrap gap-3">
                        {squadLiveFixtures.map((f) => (
                          <LiveFixtureCard
                            key={f.id}
                            fixture={f}
                            teams={liveTeamsById}
                            playersById={livePlayersById}
                            squadElementIds={squadElementIds}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                </CollapsibleCard>
              </div>
            )}

            {/* --------------------------------------- price/news watch pair */}
            {/* Sprint 29.3. Moved out of the old top strip so a live gameweek
                is never buried under two collapsed watch cards — see
                sectionOrder above for exactly where this lands. Side by side
                on `flex flex-wrap` rather than a grid, each with a fixed
                `w-[calc(...)]` basis AND `self-start`: these are two
                independently-expandable cards, and a grid (or a flex row
                without self-start) stretches the collapsed neighbour to
                match whichever one is expanded (CLAUDE.md). */}
            <div className={`${sectionOrder("watch")} flex flex-wrap gap-5`}>
              <div className="w-full self-start space-y-0 lg:w-[calc(50%-0.625rem)]">
                <CollapsibleCard
                  title="Price & news watch"
                  tier="supporting"
                  summary={
                    feedLoading
                      ? "Loading…"
                      : feedRows.length === 0
                        ? "Nothing has changed for this squad recently."
                        : `${feedRows.length} change${feedRows.length === 1 ? "" : "s"} flagged`
                  }
                >
                  {!feedLoading && feedRows.length > 0 && (
                    <ul className="divide-y divide-zinc-100 dark:divide-purple-900/30">
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
                    <Link href="/news" className="underline-offset-2 hover:underline">
                      See every change, not just this squad
                    </Link>
                    .
                  </p>
                </CollapsibleCard>
              </div>

              <div className="w-full self-start space-y-0 lg:w-[calc(50%-0.625rem)]">
                <CollapsibleCard
                  title="Team news"
                  tier="supporting"
                  summary={
                    newsLoading
                      ? "Loading…"
                      : newsRows.length === 0
                        ? "No recent headlines for this squad."
                        : newsRows.length > 5
                          ? `Latest 5 of ${newsRows.length}`
                          : `${newsRows.length} headline${newsRows.length === 1 ? "" : "s"}`
                  }
                >
                  <p className="text-[11px] text-zinc-500">
                    Third-party reporting, not verified data — see{" "}
                    <Link href="/news" className="underline-offset-2 hover:underline">
                      every source
                    </Link>
                    .
                  </p>
                  {!newsLoading && newsRows.length > 0 && (
                    <>
                      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-purple-900/30">
                        {newsRows.slice(0, 5).map((row) => (
                          <li key={row.id} className="py-2 text-sm">
                            <div className="flex items-start justify-between gap-2">
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="min-w-0 flex-1 font-medium underline-offset-2 hover:underline"
                              >
                                {row.title}
                              </a>
                              <span className="shrink-0 text-xs text-zinc-400">{ago(row.published_at)}</span>
                            </div>
                            <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {sourceBadge(row)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {newsRows.length > 5 && (
                        <Link
                          href="/news"
                          className="mt-2 block text-center text-xs font-medium text-purple-700 underline-offset-2 hover:underline dark:text-primary"
                        >
                          All {newsRows.length} headlines →
                        </Link>
                      )}
                    </>
                  )}
                </CollapsibleCard>
              </div>
            </div>

            <div className={sectionOrder("upcoming")}>
              <CollapsibleCard
                tier="section"
                title={`Upcoming — ${ctx.gameweekName}`}
                summary={upcomingSummary}
                open={upcomingOpen}
                onOpenChange={(o) => setSectionOpen("upcoming", o)}
              >
                {/* ------------------ squad ‖ readiness ‖ availability ‖ captain & XI ‖ chip call */}
                {/* Sprint 23: readiness/availability and captain/chip-call used to
                    be two independent paired grids stacked full width below the
                    squad. They're decisions about that same squad, so they now
                    share a rail beside its pitch view instead of consuming the
                    page's full width twice more. */}
                <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <section className="min-w-0">
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
                    {predsLoading && (
                      <p role="status" className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
                        <Spinner /> Calculating expected points…
                      </p>
                    )}
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

                  <div className="min-w-0 space-y-4">
                {validation && (
                  <section className={cardSupporting}>
                    <h2 className={supportingHeading}>Squad readiness</h2>
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
                <section className={cardSupporting}>
                  <h2 className={supportingHeading}>Availability</h2>
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

                <section className={card}>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Captain &amp; starting XI — GW{ctx.nextEvent}
                    </h2>
                    <InfoTooltip label="About the captain model">{CAPTAIN_MODEL_NOTE}</InfoTooltip>
                  </div>
                  {predsLoading ? (
                    <div className="mt-2 space-y-2" role="status" aria-label="Loading captain recommendation">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  ) : !lineup ? (
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

                {/* -------------------------------------------------------- chips */}
                <section className={card}>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Chip call — GW{ctx.nextEvent}
                  </h2>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    {predsLoading && (
                      <div role="status" aria-label="Loading chip call" className="space-y-2 sm:col-span-2">
                        <Skeleton className="h-14 w-full" />
                        <Skeleton className="h-14 w-full" />
                      </div>
                    )}
                    {!predsLoading && [benchBoost, tripleCaptain].map((v) =>
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
                  </div>
                </div>

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
                  className="mt-5"
                />

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
                            className={`rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            setFreeTransfers(n);
                            // Persisted so the sticky ContextBar (and My Team,
                            // /transfers) reflect the same count everywhere,
                            // rather than this page's own throwaway local state —
                            // this select was the only place that ever set the
                            // real value and it evaporated on navigation.
                            saveDraft({ ...team, freeTransfers: n });
                            setDrafts(listDrafts());
                          }}
                          className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
                        >
                          {Array.from({ length: MAX_FREE_TRANSFERS + 1 }, (_, i) => (
                            <option key={i} value={i}>
                              {i}
                            </option>
                          ))}
                        </select>
                      </label>
                      <InfoTooltip label="About the transfer model">{TRANSFER_MODEL_NOTE}</InfoTooltip>
                    </div>
                  </div>
                  {team.players.length !== ctx.rules.squadSize && (
                    <p className="mt-2 text-sm text-zinc-500">Complete the squad first to evaluate transfers.</p>
                  )}
                  {predsFullLoading && team.players.length === ctx.rules.squadSize && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-zinc-500">
                      <Spinner /> Still loading expected points across the horizon…
                    </p>
                  )}
                  {!predsFullLoading && !pathResult && team.players.length === ctx.rules.squadSize && !pathLoading && (
                    <p className="mt-2 text-sm text-zinc-500">
                      These settings drive the transfer path below — plan it when ready.
                    </p>
                  )}
                </section>

                {/* Sprint 28 — one answer. This page used to render
                    TransferPlan (optimizeTransfers' own recommendation) AND
                    TransferPath below it, two headlines answering "what should
                    I do at this deadline" at different horizons with no
                    reconciliation. optimizeTransfers still decides the opening
                    gameweek; it does it inside planTransferPath now. */}
                {team.players.length === ctx.rules.squadSize && (
                  <TransferPath
                    result={pathResult}
                    loading={pathLoading}
                    onRun={runTransferPath}
                    hasChipPlan={chipPlanUsable.length > 0}
                    disabled={predsFullLoading}
                    horizon={horizon}
                    decisionMargin={decisionMargin}
                    onDecisionMarginChange={setDecisionMargin}
                    onLoad={() => router.push(`/transfers/?draft=${team.draftId}`)}
                  />
                )}
              </CollapsibleCard>
            </div>
          </div>

        </>
      )}
    </main>
  );
}
