"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import { CountryFlag, flagCode, SeasonsBadge, TeamCrest } from "@/components/identity";
import { ManagerProfileCard, RivalTable } from "@/components/manager-profile-card";
import { ManagerLeagues, type ManagerLeagueRow } from "@/components/manager-leagues";
import { PitchView, type SquadLayout } from "@/components/pitch-view";
import type { PlayerData } from "@/components/player-card";
import { loadSquadHeadlines, type NewsHeadline } from "@/lib/news-feed";
import {
  buildManagerProfile,
  buildSeasonToDate,
  compareSeasonToDate,
  compareToRival,
  type ManagerProfile,
  type RivalRow,
} from "@/lib/manager-profile";
import { IMPORTED_SQUAD_NOTE, importedDraftName, teamStateFromPicks } from "@/lib/fpl-squad";
import { saveDraft, uniqueDraftName } from "@/lib/drafts";
import {
  layoutFromPicks,
  loadEventPoints,
  MANAGER_PICKS_NOTE,
  squadPointsFor,
  type ActualPoints,
  type ManagerPick,
  type SquadPoints,
} from "@/lib/manager-picks";
import { loadSeasonContext } from "@/lib/season-context";
import { loadLiveDetail, type LiveStatLine } from "@/lib/gameweek-state";
import { DEFAULT_RULES, type SquadRules } from "@/lib/team-state";
import { InfoTooltip } from "@/components/info-tooltip";
import { useAuth } from "@/components/auth-provider";

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
  /** Shown as its own term in the gameweek summary, never netted off silently. */
  event_transfers_cost: number | null;
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
  code: number;
  web_name: string | null;
  now_cost: number | null;
  selected_by_percent: number | null;
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
  /** The latest gameweek's picks, as the position lists have always shown. */
  picks: PickRow[];
  /**
   * Every entered gameweek's picks. These rows were already being fetched and
   * then discarded down to the latest event — keeping them is what makes the
   * per-gameweek squad view free.
   */
  picksByEvent: Map<number, ManagerPick[]>;
  /** Which of those gameweeks FPL has finished — an unfinished one is provisional. */
  finishedEvents: Set<number>;
  players: Map<number, PlayerRow>;
  /** player_id -> next gameweek's xP, for the current-squad pitch. */
  xp1: Map<number, number>;
  teamNames: Map<number, string>;
  teamMeta: Map<number, { code: number | null; short: string }>;
  nextGw: NextGw | null;
  rules: SquadRules;
  profile: ManagerProfile | null;
  rivals: RivalRow[];
  /** IDs from manager_rivals, whether or not each one resolved to a row above — lets a stuck/unresolved rival still be removed. */
  rivalEntryIds: number[];
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

/** The API caps every response at 1000 rows however big `.limit()` asks — see CLAUDE.md. */
const PAGE_ROWS = 1000;

// --------------------------------------------------------- gw summary

/**
 * A gameweek's return, as terms rather than one number.
 *
 * These picks are the squad as *entered*; FPL's automatic substitutions
 * aren't stored (supabase/functions/sync-manager doesn't write them), and
 * FPL's own gameweek total is net of any transfer hit. So the two figures can
 * legitimately differ, and reconciling them here would mean inventing the
 * missing subs. Both are shown, the hit is its own term, and the note explains
 * the gap — CLAUDE.md's "say what the number means".
 *
 * `score` (this app's asPicked figure) should now track `history.points`
 * (FPL's own total) far more closely than before a still-playing player used
 * to freeze at whatever their last finalised fixture showed —
 * loadEventPoints (lib/manager-picks.ts) merges finalised and live rows
 * per-player rather than gating the live fallback on the whole gameweek. Any
 * remaining gap is the auto-subs/hit difference described above, not a stale
 * read.
 */
function GameweekSummary({
  event,
  score,
  history,
  captainName,
  provisional,
}: {
  event: number;
  score: SquadPoints;
  history: GwRow | null;
  captainName: string | null;
  provisional: boolean;
}) {
  const hit = history?.event_transfers_cost ?? 0;

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-purple-900/40 dark:bg-[#1E0234]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums text-zinc-800 dark:text-zinc-200">
        <span className="font-medium">GW{event} as picked:</span>
        <span>{score.startersRaw} XI</span>
        {score.captain && score.captain.added !== 0 && (
          <>
            <span className="text-zinc-400">+</span>
            <span>
              {score.captain.added} armband ({captainName} ×{score.captain.multiplier})
            </span>
          </>
        )}
        <span className="text-zinc-400">=</span>
        <span className="font-semibold text-purple-900 dark:text-[#00FF87]">{score.asPicked}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums text-zinc-600 dark:text-zinc-400">
        <span>FPL recorded {history?.points ?? "—"}</span>
        {hit > 0 && <span>· includes a −{hit} transfer hit</span>}
        <span>· {history?.points_on_bench ?? score.benchRaw} left on the bench</span>
        {history?.active_chip && (
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-900 dark:bg-purple-900/50 dark:text-[#00FF87]">
            {history.active_chip}
          </span>
        )}
      </div>

      {provisional && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
          This gameweek isn&apos;t finished — points and bonus are provisional.
        </p>
      )}
      {score.missing.length > 0 && (
        <p className="mt-1.5 text-xs text-zinc-500">
          {score.missing.length} pick{score.missing.length === 1 ? "" : "s"} had no stats recorded
          for this gameweek and count as 0 above.
        </p>
      )}

      <p className="mt-2 text-xs text-zinc-500">
        <InfoTooltip label="Why these two totals can differ">{MANAGER_PICKS_NOTE}</InfoTooltip>{" "}
        The two totals are shown side by side rather than reconciled.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------- page

export default function TeamPage() {
  const router = useRouter();
  const [inputId, setInputId] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TeamData | null>(null);
  const [importing, setImporting] = useState(false);

  const { user, loading: authLoading } = useAuth();

  // Squad section: which of the two views, and which gameweek in the second.
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [eventPoints, setEventPoints] = useState<Map<number, ActualPoints>>(new Map());
  // FPL's own live points breakdown (player_live_stats.explain) for the
  // selected gameweek — a finalised gameweek carries null per player, same
  // "undefined/null hides the section" convention player-detail.tsx follows.
  const [explainByElement, setExplainByElement] = useState<Map<number, LiveStatLine[] | null>>(new Map());
  const [eventProvisional, setEventProvisional] = useState(false);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState<string | null>(null);

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
          .select("event, points, total_points, overall_rank, bank, value, points_on_bench, event_transfers_cost, active_chip")
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

      // Sprint 12A — career percentile profile, built from the same rows the
      // Past Seasons table already fetched. buildManagerProfile assumes
      // oldest-to-newest for trend's sign, so re-sort ascending regardless of
      // how the display table orders them.
      const seasonRowsAsc = [...((seasonsRes.data as SeasonRow[]) ?? [])].sort((a, b) =>
        a.season_name.localeCompare(b.season_name),
      );
      const profile = buildManagerProfile(
        seasonRowsAsc
          .filter((s) => s.rank_percentage !== null)
          .map((s) => ({ seasonName: s.season_name, rankPercentage: s.rank_percentage! })),
      );

      // Rivals: an explicitly-added set (manager_rivals), scoped to the
      // signed-in user — replaces the earlier "every manager anyone has ever
      // connected on this deployment" scan, which was fine with one user and
      // wrong the moment there are accounts. Signed-out visitors simply see
      // no rivals rather than a stale global list.
      //
      // A rival is shown once they're in `managers` at all — not gated on
      // having a career profile. A first-season manager (no past seasons)
      // still has this-season rows once GW1 is played, and dropping them
      // from the list entirely (the old behaviour) made an added rival look
      // like the add silently failed.
      const mySeasonToDate = buildSeasonToDate(
        ((gwRes.data as GwRow[]) ?? []).map((g) => ({
          event: g.event,
          points: g.points ?? 0,
          totalPoints: g.total_points ?? 0,
          overallRank: g.overall_rank,
        })),
      );

      let rivals: RivalRow[] = [];
      let rivalEntryIds: number[] = [];
      if (user) {
        const { data: rivalRows } = await supabase
          .from("manager_rivals")
          .select("entry_id")
          .eq("user_id", user.id);
        rivalEntryIds = (rivalRows ?? []).map((r) => r.entry_id as number);
      }

      if (rivalEntryIds.length > 0) {
        const { data: otherManagers } = await supabase
          .from("managers")
          .select("entry_id, team_name")
          .in("entry_id", rivalEntryIds);

        if (otherManagers && otherManagers.length > 0) {
          const rivalIds = otherManagers.map((r) => r.entry_id);
          const [{ data: rivalSeasons }, { data: rivalGws }] = await Promise.all([
            supabase
              .from("manager_season_history")
              .select("entry_id, season_name, rank_percentage")
              .in("entry_id", rivalIds),
            supabase
              .from("manager_gameweek_history")
              .select("entry_id, event, points, total_points, overall_rank")
              .in("entry_id", rivalIds),
          ]);

          const seasonsByRival = new Map<number, { season_name: string; rank_percentage: number }[]>();
          for (const row of rivalSeasons ?? []) {
            if (row.rank_percentage === null) continue;
            const list = seasonsByRival.get(row.entry_id) ?? [];
            list.push({ season_name: row.season_name, rank_percentage: row.rank_percentage });
            seasonsByRival.set(row.entry_id, list);
          }

          const gwsByRival = new Map<number, { event: number; points: number; totalPoints: number; overallRank: number | null }[]>();
          for (const row of rivalGws ?? []) {
            const list = gwsByRival.get(row.entry_id) ?? [];
            list.push({
              event: row.event,
              points: row.points ?? 0,
              totalPoints: row.total_points ?? 0,
              overallRank: row.overall_rank,
            });
            gwsByRival.set(row.entry_id, list);
          }

          rivals = otherManagers.map((r) => {
            const seasonRows = (seasonsByRival.get(r.entry_id) ?? []).sort((a, b) =>
              a.season_name.localeCompare(b.season_name),
            );
            const rivalProfile = buildManagerProfile(
              seasonRows.map((s) => ({ seasonName: s.season_name, rankPercentage: s.rank_percentage })),
            );
            const rivalSeasonToDate = buildSeasonToDate(gwsByRival.get(r.entry_id) ?? []);

            return {
              entryId: r.entry_id,
              teamName: r.team_name ?? `Entry ${r.entry_id}`,
              career: rivalProfile ? compareToRival(profile, rivalProfile) : null,
              season: rivalSeasonToDate ? compareSeasonToDate(mySeasonToDate, rivalSeasonToDate) : null,
            };
          });
        }
      }

      // 3. Every entered gameweek's picks, if any exist yet. All events are
      // kept now — the per-gameweek squad view reads them, and they were
      // already on the wire before being filtered down to the latest.
      const { data: allPicks } = await supabase
        .from("manager_picks")
        .select("event, position, element, multiplier, is_captain, is_vice_captain")
        .eq("entry_id", entryId)
        .order("event", { ascending: false })
        .order("position");

      const latestEvent = allPicks?.[0]?.event;
      const picks = (allPicks ?? []).filter((p) => p.event === latestEvent);

      const picksByEvent = new Map<number, ManagerPick[]>();
      for (const r of allPicks ?? []) {
        const pick: ManagerPick = {
          event: r.event as number,
          position: r.position as number,
          element: r.element as number,
          multiplier: r.multiplier as number,
          isCaptain: r.is_captain as boolean,
          isViceCaptain: r.is_vice_captain as boolean,
        };
        const list = picksByEvent.get(pick.event);
        if (list) list.push(pick);
        else picksByEvent.set(pick.event, [pick]);
      }
      for (const list of picksByEvent.values()) list.sort((a, b) => a.position - b.position);

      // 4. Resolve player and team names for every player ever picked (not
      // just this gameweek's — the GW selector reaches back through the
      // season) plus the favourite team, and today's squad rules for the pitch.
      const players = new Map<number, PlayerRow>();
      const teamNames = new Map<number, string>();
      const teamMeta = new Map<number, { code: number | null; short: string }>();
      const xp1 = new Map<number, number>();
      const finishedEvents = new Set<number>();
      let rules = DEFAULT_RULES;

      if (nextGw) {
        // The whole season's players, not just the ones picked: the squad view
        // also renders an imported draft, whose players need not appear in any
        // manager_picks row (pre-GW1 there are none at all). One list serves
        // every gameweek the selector can reach, too. Paged — the cap is
        // silent, and this table is already close to it.
        for (let from = 0; ; from += PAGE_ROWS) {
          const { data: playerRows } = await supabase
            .from("players")
            .select(
              "id, code, web_name, now_cost, selected_by_percent, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order, element_type, team_id",
            )
            .eq("season", nextGw.season)
            .order("id")
            .range(from, from + PAGE_ROWS - 1);
          for (const p of playerRows ?? []) players.set(p.id, p as PlayerRow);
          if ((playerRows?.length ?? 0) < PAGE_ROWS) break;
        }

        for (let from = 0; ; from += PAGE_ROWS) {
          const { data: xpRows } = await supabase
            .from("player_xp_horizons")
            .select("player_id, xp_1")
            .eq("season", nextGw.season)
            .order("player_id")
            .range(from, from + PAGE_ROWS - 1);
          for (const r of xpRows ?? []) {
            if (r.xp_1 !== null) xp1.set(r.player_id as number, r.xp_1 as number);
          }
          if ((xpRows?.length ?? 0) < PAGE_ROWS) break;
        }

        const [teamsRes, gwsRes, ctxRes] = await Promise.all([
          supabase.from("teams").select("id, name, code, short_name").eq("season", nextGw.season),
          supabase.from("gameweeks").select("id, finished").eq("season", nextGw.season),
          loadSeasonContext().catch(() => null),
        ]);

        for (const t of teamsRes.data ?? []) {
          teamNames.set(t.id, t.name);
          teamMeta.set(t.id, { code: t.code ?? null, short: t.short_name });
        }
        for (const g of gwsRes.data ?? []) {
          if (g.finished) finishedEvents.add(g.id as number);
        }
        if (ctxRes) rules = ctxRes.rules;
      }

      setData({
        manager,
        seasons: (seasonsRes.data as SeasonRow[]) ?? [],
        gwHistory: (gwRes.data as GwRow[]) ?? [],
        picks,
        picksByEvent,
        finishedEvents,
        players,
        xp1,
        teamNames,
        teamMeta,
        nextGw,
        rules,
        profile,
        rivals,
        rivalEntryIds,
      });
      setSavedId(entryId);
      localStorage.setItem("fpl_manager_id", String(entryId));

      // Signed in: this is the entry the user has claimed, so it survives
      // across devices instead of living only in this browser's storage.
      if (user) {
        const { error: profileError } = await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, entry_id: entryId }, { onConflict: "user_id" });
        if (profileError) console.error(`user_profiles upsert failed: ${profileError.message}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Sprint 14 — pull one gameweek's picks into a TeamState the builder,
  // optimiser, and transfer/chip engines can all treat like any manual
  // draft. Rules are fetched lazily here, on click, rather than on every
  // page load — the same "only when the panel is opened" pattern the
  // replacement finder's SquadBalance already uses.
  const handleImport = useCallback(async () => {
    if (!data || data.picks.length === 0 || !data.nextGw) return;
    setImporting(true);
    setError(null);

    try {
      const { rules } = await loadSeasonContext();

      const latestEvent = data.picks[0].event;
      const gw = data.gwHistory.find((g) => g.event === latestEvent);

      const state = teamStateFromPicks(
        data.picks,
        (id) => data.players.get(id)?.now_cost ?? undefined,
        {
          entryId: data.manager.entry_id,
          event: latestEvent,
          activeChip: gw?.active_chip ?? null,
          bank: data.manager.last_deadline_bank,
          value: data.manager.last_deadline_value,
        },
        rules,
        // Same naming rule as the /settings paste importer, so
        // resolveRequestedDraft can recognise either as this manager's import.
        uniqueDraftName(importedDraftName(data.manager.team_name, data.manager.entry_id)),
      );

      const saved = saveDraft(state);
      router.push(`/builder/?draft=${saved.draftId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [data, router]);

  // ------------------------------------------------------------- headlines
  //
  // One squad-wide query for confident RSS links (Sprint 20), so the pitch's
  // PlayerDetail popover can show "In the news" without each panel fetching
  // its own data — same shared-query shape as /deadline's team-news strip.
  // Keyed off the most recent picks (`data.picks`), the same source the
  // Squad list section below uses, rather than the gameweek currently being
  // viewed — headlines are supplementary context, not worth a refetch on
  // every gameweek change in the selector.
  const [headlinesByCode, setHeadlinesByCode] = useState<Map<number, NewsHeadline[]>>(new Map());
  useEffect(() => {
    if (!data || data.picks.length === 0) return;
    const codes = data.picks
      .map((p) => data.players.get(p.element)?.code)
      .filter((c): c is number => c !== undefined);
    if (codes.length === 0) return;
    loadSquadHeadlines(supabase, codes).then(setHeadlinesByCode);
  }, [data]);

  // --------------------------------------------------------------- leagues
  //
  // entry.leagues.classic (Sprint 21) — already synced onto managers.raw by
  // sync-manager on every connect, promoted into its own table
  // (manager_leagues) so this is one small query rather than parsing jsonb.
  const [leagues, setLeagues] = useState<ManagerLeagueRow[]>([]);
  useEffect(() => {
    const entryId = data?.manager.entry_id;
    if (!entryId) return;
    (async () => {
      const { data: rows } = await supabase
        .from("manager_leagues")
        .select("league_id, name, league_type, entry_rank, entry_last_rank, rank_count")
        .eq("entry_id", entryId)
        .order("name");
      setLeagues((rows ?? []) as ManagerLeagueRow[]);
    })();
  }, [data?.manager.entry_id]);

  /** Gameweeks with picks, newest first — what the selector offers. */
  const pickedEvents = useMemo(
    () => (data ? [...data.picksByEvent.keys()].sort((a, b) => b - a) : []),
    [data],
  );

  useEffect(() => {
    // Default to the most recent gameweek that has picks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedEvent === null && pickedEvents.length > 0) setSelectedEvent(pickedEvents[0]);
  }, [pickedEvents, selectedEvent]);

  // Points are fetched for the gameweek being looked at, not for the whole
  // season up front — a season's worth of per-fixture rows for every player
  // ever picked is a few thousand, and most of them are never displayed.
  // A gameweek in progress keeps refreshing every 60s (same idiom as
  // /deadline's liveTick) — sync-live-gameweek itself only runs every 2min,
  // but 60s means the pitch never sits on a stale number for long while
  // matches are being played. A finished gameweek never re-fetches: nothing
  // there changes, and there's no point polling settled history.
  const [livePointsTick, setLivePointsTick] = useState(0);
  const eventIsLive = selectedEvent !== null && data ? !data.finishedEvents.has(selectedEvent) : false;
  useEffect(() => {
    if (!eventIsLive) return;
    const id = setInterval(() => setLivePointsTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [eventIsLive]);

  useEffect(() => {
    if (selectedEvent === null || !data?.nextGw) return;
    const picks = data.picksByEvent.get(selectedEvent);
    if (!picks) return;

    // Only the first fetch for a given event shows the loading state — a
    // background poll refresh shouldn't flash the pitch back to empty.
    const isPoll = livePointsTick > 0;

    let cancelled = false;
    (async () => {
      if (!isPoll) setPointsLoading(true);
      setPointsError(null);
      try {
        const elements = picks.map((p) => p.element);
        const [result, liveDetail] = await Promise.all([
          loadEventPoints(data.nextGw!.season, selectedEvent, elements),
          loadLiveDetail(data.nextGw!.season, selectedEvent, elements),
        ]);
        if (cancelled) return;
        setEventPoints(result.byPlayer);
        setEventProvisional(result.provisional);
        setExplainByElement(new Map([...liveDetail.byPlayer].map(([id, d]) => [id, d.explain])));
      } catch (err) {
        if (!cancelled) setPointsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled && !isPoll) setPointsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent, data, livePointsTick]);

  /** Shared card mapping for both views — the two differ only in the number they carry. */
  const toCard = useCallback(
    (
      playerId: number,
      opts: {
        value: number | null;
        valueNote: string;
        decimals: number;
        isCaptain: boolean;
        isVice: boolean;
      },
    ): PlayerData | null => {
      const row = data?.players.get(playerId);
      if (!row) return null;
      return {
        id: row.id,
        web_name: row.web_name ?? `#${row.id}`,
        team_code: data?.teamMeta.get(row.team_id)?.code ?? null,
        element_type: row.element_type,
        now_cost: row.now_cost ?? 0,
        expected_points: opts.value,
        value_note: opts.valueNote,
        value_decimals: opts.decimals,
        status: row.status,
        chance_of_playing_next_round: row.chance_of_playing_next_round,
        is_captain: opts.isCaptain,
        is_vice_captain: opts.isVice,
        is_penalty_taker: row.penalties_order === 1,
        is_freekick_taker: row.direct_freekicks_order === 1,
        is_corner_taker: row.corners_and_indirect_freekicks_order === 1,
        team_short: data?.teamMeta.get(row.team_id)?.short ?? null,
        news: row.news,
        ownership: row.selected_by_percent,
        headlines: headlinesByCode.get(row.code),
      };
    },
    [data, headlinesByCode],
  );


  const gwPicks = useMemo(
    () => (data && selectedEvent !== null ? (data.picksByEvent.get(selectedEvent) ?? null) : null),
    [data, selectedEvent],
  );

  const gwScore = useMemo(
    () => (gwPicks ? squadPointsFor(gwPicks, eventPoints) : null),
    [gwPicks, eventPoints],
  );

  const gwCards: PlayerData[] = useMemo(() => {
    if (!gwPicks) return [];
    return gwPicks.flatMap((p) => {
      const scored = eventPoints.get(p.element);
      // The captain's card shows the multiplied figure, which is what that
      // pick actually contributed — the ×2 marker beside it says why.
      const multiplier = Math.max(1, p.multiplier);
      const card = toCard(p.element, {
        value: scored ? scored.points * (p.position <= 11 ? multiplier : 1) : null,
        valueNote:
          scored === undefined
            ? "No stats recorded for this player in this gameweek"
            : `GW${p.event} points${multiplier > 1 ? ` (×${multiplier} armband)` : ""}${
                scored.fixtures > 1 ? ` · ${scored.fixtures} fixtures` : ""
              }${p.position >= 12 ? " · benched, counted only under a Bench Boost" : ""}`,
        decimals: 0,
        isCaptain: p.isCaptain,
        isVice: p.isViceCaptain,
      });
      if (!card) return [];
      // FPL's own live breakdown, and this gameweek's raw goals/assists/mins —
      // never multiplied by the armband, unlike the points value above — only
      // meaningful for the gameweek result being looked at, so both are
      // attached here rather than in the generic toCard shared with other
      // squad views.
      return [
        {
          ...card,
          live_breakdown: explainByElement.get(p.element) ?? null,
          gw_goals: scored?.goals ?? null,
          gw_assists: scored?.assists ?? null,
          gw_minutes: scored?.minutes ?? null,
        },
      ];
    });
  }, [gwPicks, eventPoints, explainByElement, toCard]);

  const gwLayout: SquadLayout | null = useMemo(() => {
    if (!gwPicks || !data || !gwScore) return null;
    return layoutFromPicks(
      gwPicks,
      (id) => data.players.get(id)?.element_type,
      `bench scored ${gwScore.benchRaw}`,
    );
  }, [gwPicks, data, gwScore]);

  useEffect(() => {
    // Auto-connect on first mount (and once more if sign-in status changes
    // after mount). Signed in: the claimed entry_id from user_profiles wins,
    // since that's what "claim your team" persisted across devices; signed
    // out (or never claimed): fall back to the localStorage id, same as
    // before Sprint 14.
    if (authLoading) return;

    (async () => {
      if (user) {
        const { data: profileRow } = await supabase
          .from("user_profiles")
          .select("entry_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profileRow?.entry_id) {
          void connect(profileRow.entry_id);
          return;
        }
      }
      const stored = localStorage.getItem("fpl_manager_id");
      if (stored) void connect(Number(stored));
    })();
  }, [connect, user, authLoading]);

  // Rivals are an explicitly-added set now (manager_rivals), not a scan of
  // every manager anyone has connected — see the comment in connect() above.
  // Adding/removing just re-runs connect() to refresh the whole page's data,
  // the same as the existing Refresh button, rather than a second code path
  // that recomputes just the rivals table.
  const [rivalInput, setRivalInput] = useState("");
  const [rivalBusy, setRivalBusy] = useState(false);
  const [rivalError, setRivalError] = useState<string | null>(null);

  // Sync the candidate before ever writing to manager_rivals — a bare
  // upsert used to accept any integer, and an entry that never resolved
  // (typo, wrong ID) sat invisibly in the table with no way to remove it
  // from the UI and no error shown. sync-manager also has to succeed for
  // an entry with zero completed seasons (a brand-new manager): it writes
  // `managers` unconditionally and only skips manager_season_history when
  // `past` is empty, so a first-season rival still resolves here.
  const addRival = useCallback(async () => {
    const id = Number(rivalInput.trim());
    if (!Number.isInteger(id) || id <= 0) {
      setRivalError("Enter a numeric FPL Manager ID.");
      return;
    }
    if (!user || !savedId) return;
    setRivalBusy(true);
    setRivalError(null);
    try {
      const { error: fnError } = await supabase.functions.invoke("sync-manager", {
        body: { entry_id: id },
      });
      if (fnError) {
        if (fnError instanceof FunctionsHttpError) {
          const body = await fnError.context.json().catch(() => null);
          throw new Error(body?.error ?? "sync failed");
        }
        throw fnError;
      }

      await supabase
        .from("manager_rivals")
        .upsert({ user_id: user.id, entry_id: id }, { onConflict: "user_id,entry_id" });
      setRivalInput("");
      await connect(savedId);
    } catch (err) {
      setRivalError(err instanceof Error ? err.message : String(err));
    } finally {
      setRivalBusy(false);
    }
  }, [user, savedId, rivalInput, connect]);

  const removeRival = useCallback(
    async (entryId: number) => {
      if (!user || !savedId) return;
      setRivalBusy(true);
      try {
        await supabase.from("manager_rivals").delete().eq("user_id", user.id).eq("entry_id", entryId);
        await connect(savedId);
      } finally {
        setRivalBusy(false);
      }
    },
    [user, savedId, connect],
  );

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
          className="w-40 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus-visible:border-purple-700 focus-visible:ring-2 focus-visible:ring-ring dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus-visible:border-[#00FF87]"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-purple-950 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
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

          {/* ---------------------------------------------- squad view */}
          {/*
            This used to offer a "Current squad" mode too — TeamState.players
            derived straight from the import/latest-picks, shown regardless
            of whether startingXI/benchOrder still matched it. That split
            could go stale after a transfer (see hasConsistentLineup in
            lib/team-state.ts) and PitchView silently dropped whichever
            players it couldn't place, rendering a short squad with no error.
            The real picks a gameweek was actually played with — this
            section's only remaining mode — don't carry that risk, since
            FPL publishes them as an already-consistent XI/bench. See
            docs/wiki/frontend-conventions.md.
          */}
          {data && (
            <section className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                  Squad view
                </h2>

                {/* Hidden entirely pre-GW1 rather than shown empty. */}
                {pickedEvents.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                    Gameweek
                    <select
                      value={selectedEvent ?? ""}
                      onChange={(e) => setSelectedEvent(Number(e.target.value))}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
                    >
                      {pickedEvents.map((event) => (
                        <option key={event} value={event}>
                          GW{event}
                          {data.finishedEvents.has(event) ? "" : " (live)"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {pickedEvents.length === 0 && (
                <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500 dark:border-purple-800/50 dark:bg-[#1E0234]">
                  No squad to show yet — FPL publishes picks after the first deadline.{" "}
                  <a
                    href="/settings/?tab=import"
                    className="text-purple-800 underline dark:text-[#00FF87]"
                  >
                    Import your squad from FPL
                  </a>{" "}
                  to see it here now.
                </p>
              )}

              {pointsError && (
                <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                  {pointsError}
                </p>
              )}
              {pointsLoading && <p className="mt-3 text-sm text-zinc-500">Loading points…</p>}
              {!pointsLoading && gwLayout && (
                <PitchView squad={gwCards} quota={data.rules.positionQuota} layout={gwLayout} />
              )}
              {!pointsLoading && gwScore && selectedEvent !== null && (
                <GameweekSummary
                  event={selectedEvent}
                  score={gwScore}
                  history={data.gwHistory.find((g) => g.event === selectedEvent) ?? null}
                  captainName={
                    gwScore.captain
                      ? (data.players.get(gwScore.captain.element)?.web_name ?? "Captain")
                      : null
                  }
                  provisional={eventProvisional || !data.finishedEvents.has(selectedEvent)}
                />
              )}
            </section>
          )}

          {/* --------------------------------------------------- squad */}
          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Squad</h2>
              {data && data.picks.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={importing}
                  className="rounded-md bg-purple-950 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
                >
                  {importing ? "Importing…" : "Import as draft →"}
                </button>
              )}
            </div>
            {data && data.picks.length > 0 && (
              <p className="mt-1.5 flex items-start gap-1 text-xs text-zinc-500">
                <InfoTooltip label="About the imported squad">{IMPORTED_SQUAD_NOTE}</InfoTooltip>
                Opens this squad in the Builder as a new, independent draft.
              </p>
            )}
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
                . Your team will appear here automatically once the season starts. Until then,{" "}
                <a
                  href="/settings/?tab=import"
                  className="text-purple-800 underline dark:text-[#00FF87]"
                >
                  import your squad from FPL directly
                </a>{" "}
                to get real purchase prices and start using the Builder now.
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
                        <td className="px-3 py-2">
                          {s.rank_percentage !== null ? (
                            <div className="flex items-center gap-2">
                              <span className="w-16 shrink-0 tabular-nums">
                                Top {s.rank_percentage}%
                              </span>
                              <div
                                role="img"
                                aria-label={`${s.season_name}: top ${s.rank_percentage}%`}
                                className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-purple-950/60"
                              >
                                <div
                                  className="h-full rounded-full bg-purple-700 transition-[width] duration-300 motion-reduce:transition-none dark:bg-[#00FF87]"
                                  style={{ width: `${100 - s.rank_percentage}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* -------------------------------------------------- leagues */}
          {leagues.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                Your Leagues
              </h2>
              <ManagerLeagues leagues={leagues} />
            </section>
          )}

          {/* ------------------------------------- manager intelligence */}
          {/* Always shown once a manager is connected — previously gated on
              having a career profile, which hid the add-rival box entirely
              for a first-season manager (no past seasons of their own). The
              career card becomes the conditional piece instead. */}
          {data?.manager && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                Manager Profile
              </h2>
              <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                {data.profile ? (
                  <ManagerProfileCard profile={data.profile} />
                ) : (
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-purple-900/40 dark:bg-[#1E0234]">
                    First season — no career record yet. A career percentile profile needs at
                    least one completed season.
                  </div>
                )}
                <div>
                  <RivalTable rivals={data.rivals} />

                  {/* The comparison set is whichever rivals you've chosen —
                      not every manager anyone has ever connected here. */}
                  {user ? (
                    <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-purple-900/40 dark:bg-[#1E0234]">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={rivalInput}
                          onChange={(e) => {
                            setRivalInput(e.target.value);
                            if (rivalError) setRivalError(null);
                          }}
                          inputMode="numeric"
                          placeholder="Add rival by Manager ID"
                          className="w-48 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-900 outline-none focus-visible:border-purple-700 focus-visible:ring-2 focus-visible:ring-ring dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus-visible:border-[#00FF87]"
                        />
                        <button
                          type="button"
                          onClick={() => void addRival()}
                          disabled={rivalBusy || !rivalInput.trim()}
                          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
                        >
                          {rivalBusy ? "Adding…" : "Add"}
                        </button>
                      </div>
                      {rivalError && (
                        <p className="mt-1.5 text-xs text-red-700 dark:text-red-400">{rivalError}</p>
                      )}
                      {data.rivalEntryIds.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {data.rivalEntryIds.map((entryId) => {
                            const resolved = data.rivals.find((r) => r.entryId === entryId);
                            const label = resolved?.teamName ?? `Entry ${entryId} (unresolved)`;
                            return (
                              <li
                                key={entryId}
                                className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-purple-950/50 dark:text-zinc-300"
                              >
                                {label}
                                <button
                                  type="button"
                                  onClick={() => void removeRival(entryId)}
                                  disabled={rivalBusy}
                                  aria-label={`Remove ${label} as a rival`}
                                  className="text-zinc-400 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:hover:text-red-400"
                                >
                                  ×
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-400">
                      Sign in to add rivals to compare against.
                    </p>
                  )}
                </div>
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
