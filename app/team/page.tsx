"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { CountryFlag, flagCode, SeasonsBadge, TeamCrest } from "@/components/identity";
import { ManagerProfileCard, RivalTable } from "@/components/manager-profile-card";
import type { ManagerLeagueRow } from "@/components/manager-leagues";
import { loadLeagueStandings, type LeagueStandingRow } from "@/lib/leagues";
import { ChevronRight } from "lucide-react";
import { groupByEvent, hitCost, loadTransfers, type TransferRow } from "@/lib/manager-transfers";
import { diffSquads } from "@/lib/squad-diff";
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
import { IMPORTED_SQUAD_NOTE, importedDraftName, resolveImportTarget, teamStateFromPicks } from "@/lib/fpl-squad";
import {
  draftHistory,
  listDrafts,
  onDraftsChanged,
  resolveRequestedDraft,
  saveDraft,
  uniqueDraftName,
} from "@/lib/drafts";
import { freeTransfersDisplay, MAX_FREE_TRANSFERS } from "@/lib/transfers";
import {
  layoutFromPicks,
  loadEventPoints,
  loadManagerPicks,
  MANAGER_PICKS_NOTE,
  squadPointsFor,
  type ActualPoints,
  type ManagerPick,
  type SquadPoints,
} from "@/lib/manager-picks";
import { loadSeasonContext } from "@/lib/season-context";
import {
  loadFixtureRows,
  loadLiveDetail,
  matchStatusForTeam,
  type LiveStatLine,
  type PlayerMatchStatus,
} from "@/lib/gameweek-state";
import { DEFAULT_RULES, type SquadRules, type TeamState } from "@/lib/team-state";
import { InfoTooltip } from "@/components/info-tooltip";
import { GameweekReviewPanel } from "@/components/gameweek-review-panel";
import { DecisionAnalyticsPanel } from "@/components/decision-analytics-panel";
import { useAuth } from "@/components/auth-provider";

/**
 * How many rivals one "add from league" press will take on.
 *
 * Deliberately small, and the constraint is real rather than cosmetic: every
 * rival needs a `sync-manager` call before it can be written (see addRivalById),
 * and that endpoint carries Sprint 32's per-user rate limit off
 * `sync_runs.invoked_by`. Adding a whole league in one press would spend the
 * budget and 429 partway through, so the batch is capped here instead of the
 * limit being raised there.
 */
const RIVAL_BATCH_MAX = 5;

/** Separator between identity badges in the profile line. */
const Dot = () => <span className="text-zinc-300 dark:text-purple-700">•</span>;

/**
 * Not an error in the page-failed sense — a refresh this visitor isn't
 * entitled to. Sprint 32 put sync-manager behind `verifyUser`, so a
 * signed-out visitor reads what the background cron wrote and is told why
 * the Refresh button didn't fetch, rather than being shown a 401.
 */
class SignedOutSyncError extends Error {
  constructor() {
    super("Sign in to refresh from FPL. Showing the last data the background sync wrote.");
    this.name = "SignedOutSyncError";
  }
}

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

/** Mirrors app/deadline/page.tsx's NextFixture shape exactly — both feed the
 *  same PlayerData["next_fixture"] prop on player-card.tsx. */
interface NextFixture {
  opponent_short_name: string;
  is_home: boolean;
  fdr: number;
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
  teamNames: Map<number, string>;
  teamMeta: Map<number, { code: number | null; short: string }>;
  /** Each picked gameweek's own opponent per team — keyed by event, not
   *  "next", so a historical squad view shows the fixture that gameweek
   *  actually played rather than today's next one. */
  fixturesByEvent: Map<number, Map<number, NextFixture>>;
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

/** The API caps every response at 1000 rows however big `.limit()` asks — see CLAUDE.md. */
const PAGE_ROWS = 1000;

// Sprint 23 — same tokens `/deadline` and `/chips` already use, so this page
// stops repeating `border-zinc-200 bg-white … dark:border-purple-900/40
// dark:bg-[#1E0234]` inline on every card.
const card = "rounded-lg border border-zinc-200 bg-card p-4 dark:border-purple-900/40";
const cardSupporting =
  "rounded-lg border border-zinc-200 bg-card-supporting p-3 dark:border-card-supporting-border";
const supportingHeading = "text-xs font-medium uppercase tracking-wide text-zinc-500";

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
    <div className="mt-3 rounded-lg border border-zinc-200 bg-card p-4 text-sm dark:border-purple-900/40">
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
  /** Why a requested refresh didn't happen — distinct from `error`, which
   *  means the page has nothing to show. */
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [data, setData] = useState<TeamData | null>(null);
  const [importing, setImporting] = useState(false);

  const { user, loading: authLoading, entryId: linkedEntryId, teamName: linkedTeamName } = useAuth();

  // For the free-transfers control below — /team otherwise never loads
  // drafts at all, only ever *creates* one via handleImport's saveDraft.
  // Same resolution every other draft-aware page uses (see lib/drafts.ts),
  // so "the squad My Team is showing an FT control for" agrees with what
  // /deadline, /transfers, and the sticky ContextBar call the real squad.
  const [drafts, setDrafts] = useState<TeamState[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(listDrafts());
    return onDraftsChanged(() => setDrafts(listDrafts()));
  }, []);
  const importedDraft = useMemo(
    () => resolveRequestedDraft(drafts, "", { entryId: linkedEntryId, teamName: linkedTeamName }),
    [drafts, linkedEntryId, linkedTeamName],
  );

  // Squad section: which of the two views, and which gameweek in the second.
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [eventPoints, setEventPoints] = useState<Map<number, ActualPoints>>(new Map());
  // FPL's own live points breakdown (player_live_stats.explain) for the
  // selected gameweek — a finalised gameweek carries null per player, same
  // "undefined/null hides the section" convention player-detail.tsx follows.
  const [explainByElement, setExplainByElement] = useState<Map<number, LiveStatLine[] | null>>(new Map());
  const [eventProvisional, setEventProvisional] = useState(false);
  // Whether each squad player's fixture for `selectedEvent` has kicked off
  // yet — distinguishes "hasn't played" from a genuine 0-minute blank so the
  // card can show "–" instead of a misleading 0 (see matchStatusForTeam,
  // lib/gameweek-state.ts, the same check /deadline's live card already uses).
  const [matchStatusByElement, setMatchStatusByElement] = useState<Map<number, PlayerMatchStatus>>(
    new Map(),
  );
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState<string | null>(null);

  const connect = useCallback(async (entryId: number, opts: { sync?: boolean } = {}) => {
    const { sync = true } = opts;
    setInputId(String(entryId));
    setLoading(true);
    setError(null);
    setSyncNotice(null);

    // A background cron (supabase/functions/sync-claimed-managers) now keeps
    // every claimed manager fresh — once a day, or every 2 minutes while a
    // match is live, mirroring sync-live-gameweek's own gating. `sync: false`
    // (the auto-mount effect below) skips this and just reads what the cron
    // already wrote, instead of blocking every page load on a live FPL
    // re-fetch (measured at 3.7s — docs/sprints/latency.md item 5). The
    // Connect/Refresh button and rival mutations below keep forcing a real
    // sync (sync: true, the default) exactly as before.
    const syncFromFpl = async () => {
      // Sprint 32: sync-manager requires a signed-in caller now. Check here
      // rather than letting it 401, so a signed-out visitor gets a sentence
      // that explains itself instead of a rejection they can't act on.
      // Reading the page signed out still works — it just shows whatever the
      // background cron last wrote, which for a claimed manager is fresh.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new SignedOutSyncError();

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
    };

    const readBack = () =>
      Promise.all([
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

    try {
      // 1. Ask the Edge Function to pull fresh data from FPL into Supabase.
      if (sync) {
        try {
          await syncFromFpl();
        } catch (err) {
          // Signed out is not a failure to load the page — it's a failure to
          // *refresh*. Say which, and carry on to the read-back below.
          if (err instanceof SignedOutSyncError) setSyncNotice(err.message);
          else throw err;
        }
      }

      // 2. Read everything back from Supabase.
      let [managerRes, seasonsRes, gwRes, nextGwRes] = await readBack();

      // A claim the background cron hasn't reached yet (no `managers` row
      // at all — e.g. claimed seconds ago on another device) falls back to
      // a real sync rather than surfacing an error. Same "no row yet"
      // signal sync-claimed-managers' own due-list check uses server-side,
      // checked here instead of guessed at with a timer.
      //
      // Sprint 32: signed out, this path can no longer fetch. A manager the
      // cron has never seen genuinely has no rows to show, so let the
      // PGRST116 fall through to the error below with the reason attached
      // rather than reporting a bare "no rows".
      if (!sync && managerRes.error?.code === "PGRST116") {
        try {
          await syncFromFpl();
          [managerRes, seasonsRes, gwRes, nextGwRes] = await readBack();
        } catch (err) {
          if (err instanceof SignedOutSyncError) {
            throw new Error(
              "That Manager ID hasn't been synced yet, and refreshing from FPL needs you signed in.",
            );
          }
          throw err;
        }
      }

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
      // kept — the per-gameweek squad view reads them.
      //
      // Through lib/manager-picks' loadManagerPicks rather than an inline
      // query, which is what every other page uses: it scopes to the season
      // (an unscoped read collides across seasons on rollover, since `event`
      // restarts at 1) and it pages, which the inline version did not — the
      // API caps every response at 1000 rows however big `.limit()` asks, so
      // a long enough career would have silently lost its oldest gameweeks.
      // Season-gated on nextGw, like the rest of this loader already is.
      const picksByEvent = nextGw ? await loadManagerPicks(nextGw.season, entryId) : new Map<number, ManagerPick[]>();

      // The latest gameweek's picks in the row shape the import flow and the
      // squad list still take (teamStateFromPicks wants FPL's own snake_case).
      const latestEvent = [...picksByEvent.keys()].sort((a, b) => b - a)[0];
      const picks: PickRow[] = (picksByEvent.get(latestEvent) ?? []).map((p) => ({
        event: p.event,
        position: p.position,
        element: p.element,
        multiplier: p.multiplier,
        is_captain: p.isCaptain,
        is_vice_captain: p.isViceCaptain,
      }));

      // 4. Resolve player and team names for every player ever picked (not
      // just this gameweek's — the GW selector reaches back through the
      // season) plus the favourite team, and today's squad rules for the pitch.
      const players = new Map<number, PlayerRow>();
      const teamNames = new Map<number, string>();
      const teamMeta = new Map<number, { code: number | null; short: string }>();
      const fixturesByEvent = new Map<number, Map<number, NextFixture>>();
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

        const [teamsRes, gwsRes, ctxRes, fixturesRes] = await Promise.all([
          supabase.from("teams").select("id, name, code, short_name").eq("season", nextGw.season),
          supabase.from("gameweeks").select("id, finished").eq("season", nextGw.season),
          loadSeasonContext().catch(() => null),
          supabase
            .from("fixtures")
            .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
            .eq("season", nextGw.season)
            .in("event", [...picksByEvent.keys()]),
        ]);

        for (const t of teamsRes.data ?? []) {
          teamNames.set(t.id, t.name);
          teamMeta.set(t.id, { code: t.code ?? null, short: t.short_name });
        }
        for (const g of gwsRes.data ?? []) {
          if (g.finished) finishedEvents.add(g.id as number);
        }
        if (ctxRes) rules = ctxRes.rules;

        // Mirrors app/deadline/page.tsx's nextFixtureByTeam build exactly,
        // just once per picked gameweek instead of once for "next" — a
        // double gameweek keeps the earlier kickoff (fixtures come back
        // ordered by id, not guaranteed by kickoff, but first-seen-per-team
        // is the same convention deadline uses).
        for (const f of fixturesRes.data ?? []) {
          const event = f.event as number | null;
          if (event === null) continue;
          let byTeam = fixturesByEvent.get(event);
          if (!byTeam) {
            byTeam = new Map<number, NextFixture>();
            fixturesByEvent.set(event, byTeam);
          }
          const home = f.team_h as number;
          const away = f.team_a as number;
          const homeFdr = (f.team_h_difficulty as number | null) ?? 3;
          const awayFdr = (f.team_a_difficulty as number | null) ?? 3;
          if (!byTeam.has(home)) {
            byTeam.set(home, {
              opponent_short_name: teamMeta.get(away)?.short ?? "—",
              is_home: true,
              fdr: homeFdr,
            });
          }
          if (!byTeam.has(away)) {
            byTeam.set(away, {
              opponent_short_name: teamMeta.get(home)?.short ?? "—",
              is_home: false,
              fdr: awayFdr,
            });
          }
        }
      }

      setData({
        manager,
        seasons: (seasonsRes.data as SeasonRow[]) ?? [],
        gwHistory: (gwRes.data as GwRow[]) ?? [],
        picks,
        picksByEvent,
        finishedEvents,
        players,
        teamNames,
        teamMeta,
        fixturesByEvent,
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

  // ---------------------------------------------------------- transfer ledger
  //
  // Sprint 29.2. manager_transfers is FPL's own record, already written by
  // sync-manager on every connect — the truth for what actually happened.
  // Cross-checked (not overridden) against the local draft-snapshot diff,
  // which needs no sync but only sees whatever squad shape got saved here.
  // Declared before handleImport (below), which reads purchasePriceByPlayer.
  const [transfersByEvent, setTransfersByEvent] = useState<Map<number, TransferRow[]>>(new Map());
  useEffect(() => {
    const entryId = data?.manager.entry_id;
    const season = data?.nextGw?.season;
    if (!entryId || !season) return;
    (async () => {
      const rows = await loadTransfers(season, entryId).catch(() => []);
      setTransfersByEvent(groupByEvent(rows));
    })();
  }, [data?.manager.entry_id, data?.nextGw?.season]);

  // Sprint 29 follow-up: real purchase price for the manager_picks import
  // path, from this season's own transfer record — see teamStateFromPicks'
  // purchasePriceOf and the updated IMPORTED_SQUAD_NOTE (lib/fpl-squad.ts).
  // transfersByEvent's rows are already ordered newest-first per event
  // (lib/manager-transfers.ts's loadTransfers), and events themselves
  // iterate highest-first below, so the first elementInCost seen per player
  // is the most recent transfer-in — exactly what "what you paid to bring
  // them in, currently" needs.
  const purchasePriceByPlayer = useMemo(() => {
    const byPlayer = new Map<number, number>();
    const events = [...transfersByEvent.keys()].sort((a, b) => b - a);
    for (const event of events) {
      for (const t of transfersByEvent.get(event) ?? []) {
        if (t.elementInCost === null) continue;
        if (!byPlayer.has(t.elementIn)) byPlayer.set(t.elementIn, t.elementInCost);
      }
    }
    return byPlayer;
  }, [transfersByEvent]);

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

      // Sprint 29.2: re-importing overwrites the existing import (found via
      // resolveImportTarget's entryId/name precedence) instead of minting a
      // new draft each time — uniqueDraftName's " (2)" only applies on a
      // genuine first import. saveDraft's own update-in-place logic
      // (matching on draftId) does the rest. `drafts` is this page's own
      // live-updating list (above), not a fresh listDrafts() call.
      const targetDraftId = resolveImportTarget(drafts, data.manager.entry_id, data.manager.team_name);
      const draftName = targetDraftId
        ? importedDraftName(data.manager.team_name, data.manager.entry_id)
        : uniqueDraftName(importedDraftName(data.manager.team_name, data.manager.entry_id));

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
        draftName,
        (id) => purchasePriceByPlayer.get(id),
      );
      if (targetDraftId) {
        state.draftId = targetDraftId;
        // Sprint 29 follow-up: a fresh FPL pull can't know the owner's
        // forward chip plan, pinned flag, or free-text notes/strategy — none
        // of those are FPL facts, so carry them forward from the draft being
        // overwritten rather than losing them to the fresh import's defaults
        // (emptyTeamState). Everything else (squad, captain, budget,
        // activeChip, freeTransfers) is deliberately NOT carried forward —
        // that's supposed to come from the fresh import.
        const existing = drafts.find((d) => d.draftId === targetDraftId);
        if (existing) {
          state.chipPlan = existing.chipPlan;
          state.pinned = existing.pinned;
          state.notes = existing.notes;
          state.strategy = existing.strategy;
        }
      }

      const saved = saveDraft(state);
      router.push(`/builder/?draft=${saved.draftId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [data, router, drafts, purchasePriceByPlayer]);

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

  // The most recent two saved snapshots of the currently-resolved imported
  // draft — HISTORY_LIMIT (lib/drafts.ts) keeps the last 20, so "last saved
  // vs the one before" is always available once a second save has happened.
  const importReconciliation = useMemo(() => {
    if (!importedDraft) return null;
    const history = draftHistory(importedDraft.draftId);
    if (history.length < 2) return null;
    const [prev, latest] = history.slice(-2);
    const diff = diffSquads(prev, latest);
    if (diff.in.length === 0 && diff.out.length === 0) return null;
    return { diff, latestEvent: [...transfersByEvent.keys()].sort((a, b) => b - a)[0] ?? null };
  }, [importedDraft, transfersByEvent]);

  /** Gameweeks with picks, newest first — what the selector offers. */
  const pickedEvents = useMemo(
    () => (data ? [...data.picksByEvent.keys()].sort((a, b) => b - a) : []),
    [data],
  );

  useEffect(() => {
    // Default to the most recent gameweek that has picks — unless ?event=
    // names one, which is how /review's redirect stub keeps its deep links
    // pointing at the gameweek they named. window.location.search rather
    // than useSearchParams, the convention every query-reading page here
    // already follows (no Suspense-boundary precedent in a static export).
    if (selectedEvent !== null || pickedEvents.length === 0) return;
    const requested = Number(new URLSearchParams(window.location.search).get("event"));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedEvent(pickedEvents.includes(requested) ? requested : pickedEvents[0]);
  }, [pickedEvents, selectedEvent]);

  /**
   * The selected gameweek's own `manager_gameweek_history` row — the source
   * for every number that describes *that* gameweek rather than "now".
   *
   * `managers` only ever holds FPL's current snapshot
   * (`summary_event_points`, `last_deadline_value`, …), so driving the stat
   * tiles off it meant selecting a past gameweek left the live gameweek's
   * score sitting under a "GW Points" label. The history rows were already
   * fetched and were only being read by the gameweek summary card.
   */
  const gwRow = useMemo(
    () => data?.gwHistory.find((g) => g.event === selectedEvent) ?? null,
    [data, selectedEvent],
  );

  /** On the newest gameweek with picks — the one case where the `managers`
   *  snapshot and the history row describe the same thing. */
  const viewingLatestEvent =
    selectedEvent !== null && pickedEvents.length > 0 && selectedEvent === pickedEvents[0];

  // Points are fetched for the gameweek being looked at, not for the whole
  // season up front — a season's worth of per-fixture rows for every player
  // ever picked is a few thousand, and most of them are never displayed.
  // A gameweek in progress keeps refreshing every 60s (same idiom as
  // /deadline's liveTick) — sync-live-gameweek itself only runs every 2min,
  // but 60s means the pitch never sits on a stale number for long while
  // matches are being played. A finished gameweek never re-fetches: nothing
  // there changes, and there's no point polling settled history.
  const [livePointsTick, setLivePointsTick] = useState(0);
  /** Which event the points currently in state were fetched for — see the
   *  `isPoll` comment below for why the tick count can't answer that. */
  const lastPointsEvent = useRef<number | null>(null);
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
    //
    // "Is this a poll" is a question about the *event*, not about the tick
    // count: `livePointsTick > 0` was true for every fetch after the first
    // 60s tick, so changing gameweek was misread as a refresh. The loading
    // state was skipped, and the new gameweek's picks rendered against the
    // old gameweek's points until the fetch resolved — or indefinitely, if
    // it failed.
    const isPoll = lastPointsEvent.current === selectedEvent;
    lastPointsEvent.current = selectedEvent;

    let cancelled = false;
    (async () => {
      if (!isPoll) {
        setPointsLoading(true);
        // Nothing already in these maps belongs to the gameweek being
        // switched to. Clearing up front is what keeps a slow — or failed —
        // fetch from leaving the previous gameweek's numbers on the pitch.
        setEventPoints(new Map());
        setExplainByElement(new Map());
        setMatchStatusByElement(new Map());
        setEventProvisional(false);
      }
      setPointsError(null);
      try {
        const elements = picks.map((p) => p.element);
        const [result, liveDetail, fixtures] = await Promise.all([
          loadEventPoints(data.nextGw!.season, selectedEvent, elements),
          loadLiveDetail(data.nextGw!.season, selectedEvent, elements),
          loadFixtureRows(data.nextGw!.season, selectedEvent),
        ]);
        if (cancelled) return;
        setEventPoints(result.byPlayer);
        setEventProvisional(result.provisional);
        setExplainByElement(new Map([...liveDetail.byPlayer].map(([id, d]) => [id, d.explain])));
        setMatchStatusByElement(
          new Map(
            elements.map((id) => {
              const teamId = data!.players.get(id)?.team_id;
              return [id, teamId !== undefined ? matchStatusForTeam(teamId, fixtures) : "not_started"];
            }),
          ),
        );
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
      // A pre-kickoff placeholder row reads identically to a real 0-minute
      // blank (loadEventPoints, lib/manager-picks.ts) — matchStatusByElement
      // disambiguates "hasn't played yet" so the card can say so honestly
      // instead of printing a 0 that hasn't happened.
      const notStarted = matchStatusByElement.get(p.element) === "not_started";
      const card = toCard(p.element, {
        value: notStarted ? null : scored ? scored.points * (p.position <= 11 ? multiplier : 1) : null,
        valueNote: notStarted
          ? `Hasn't kicked off yet — GW${p.event} fixture not started`
          : scored === undefined
            ? "No stats recorded for this player in this gameweek"
            : `GW${p.event} points${multiplier > 1 ? ` (×${multiplier} armband)` : ""}${
                scored.fixtures > 1 ? ` · ${scored.fixtures} fixtures` : ""
              }${p.position >= 12 ? " · benched, counted only under a Bench Boost" : ""}`,
        decimals: 0,
        isCaptain: p.isCaptain,
        isVice: p.isViceCaptain,
      });
      if (!card) return [];
      // The opponent chip that makes /deadline and /builder cards compact
      // (player-card.tsx's short value row) — keyed off this pick's own
      // event, not "next", so a historical gameweek shows the fixture it
      // actually played. Without this /team's cards fell into player-card's
      // tall, centered fallback branch and visually overlapped the pitch.
      const teamId = data?.players.get(p.element)?.team_id;
      const nextFixture =
        teamId !== undefined ? (data?.fixturesByEvent.get(p.event)?.get(teamId) ?? null) : null;
      // FPL's own live breakdown, and this gameweek's raw goals/assists/mins —
      // never multiplied by the armband, unlike the points value above — only
      // meaningful for the gameweek result being looked at, so both are
      // attached here rather than in the generic toCard shared with other
      // squad views.
      return [
        {
          ...card,
          next_fixture: nextFixture,
          live_breakdown: notStarted ? null : (explainByElement.get(p.element) ?? null),
          gw_goals: notStarted ? null : (scored?.goals ?? null),
          gw_assists: notStarted ? null : (scored?.assists ?? null),
          gw_minutes: notStarted ? null : (scored?.minutes ?? null),
        },
      ];
    });
  }, [gwPicks, eventPoints, explainByElement, toCard, data, matchStatusByElement]);

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
          void connect(profileRow.entry_id, { sync: false });
          return;
        }
      }
      const stored = localStorage.getItem("fpl_manager_id");
      if (stored) void connect(Number(stored), { sync: false });
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
  /**
   * Sync one candidate, then write it. The single "Add" button and the
   * add-from-league batch both go through here — two callers, one rule about
   * what it takes to become a rival.
   *
   * A rate-limited response is returned as its own outcome rather than a
   * generic failure: the batch has to stop on it (every later call would fail
   * the same way) where it can carry on past an ordinary error.
   */
  const addRivalById = useCallback(
    async (id: number): Promise<{ ok: true } | { ok: false; rateLimited: boolean; message: string }> => {
      if (!user) return { ok: false, rateLimited: false, message: "Sign in to add rivals." };
      try {
        const { error: fnError } = await supabase.functions.invoke("sync-manager", {
          body: { entry_id: id },
        });
        if (fnError) {
          if (fnError instanceof FunctionsHttpError) {
            const status = fnError.context.status;
            const body = await fnError.context.json().catch(() => null);
            return {
              ok: false,
              rateLimited: status === 429,
              message: body?.error ?? "sync failed",
            };
          }
          return { ok: false, rateLimited: false, message: fnError.message };
        }

        const { error: writeError } = await supabase
          .from("manager_rivals")
          .upsert({ user_id: user.id, entry_id: id }, { onConflict: "user_id,entry_id" });
        if (writeError) return { ok: false, rateLimited: false, message: writeError.message };
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          rateLimited: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [user],
  );

  const addRival = useCallback(async () => {
    const id = Number(rivalInput.trim());
    if (!Number.isInteger(id) || id <= 0) {
      setRivalError("Enter a numeric FPL Manager ID.");
      return;
    }
    if (!user || !savedId) return;
    setRivalBusy(true);
    setRivalError(null);
    const result = await addRivalById(id);
    if (result.ok) {
      setRivalInput("");
      await connect(savedId);
    } else {
      setRivalError(result.message);
    }
    setRivalBusy(false);
  }, [user, savedId, rivalInput, connect, addRivalById]);

  // ------------------------------------------- rivals from a league's table
  //
  // DSI-61. `/leagues` has held real standings off `league_entries` since
  // Sprint 29 while this list stayed hand-typed, which is the whole gap: the
  // rival pipeline consumes entry ids and `loadLeagueStandings` produces them
  // in rank order. What it does NOT produce is `managers` rows, which is why
  // this is a bounded, sequential batch rather than a single write.
  const [rivalLeagueId, setRivalLeagueId] = useState<number | null>(null);
  const [rivalStandings, setRivalStandings] = useState<LeagueStandingRow[] | null>(null);
  const [rivalStandingsLoading, setRivalStandingsLoading] = useState(false);
  const [rivalBatchStatus, setRivalBatchStatus] = useState<string | null>(null);

  const rivalSeason = data?.nextGw?.season ?? null;
  useEffect(() => {
    // No setState on this branch: the select's own onChange already clears the
    // previous league's rows, and clearing them here as well is a synchronous
    // setState in an effect body — a cascading render React lints against.
    if (rivalLeagueId === null || !rivalSeason) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRivalStandingsLoading(true);
    (async () => {
      try {
        const rows = await loadLeagueStandings(rivalSeason, rivalLeagueId);
        if (!cancelled) setRivalStandings(rows);
      } catch (err) {
        if (!cancelled) {
          setRivalStandings([]);
          setRivalError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setRivalStandingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rivalLeagueId, rivalSeason]);

  /** The top of the table, minus yourself and anyone already on the list. */
  const rivalCandidates = useMemo(() => {
    if (!rivalStandings || !data) return [];
    const already = new Set(data.rivalEntryIds);
    const self = data.manager.entry_id;
    return rivalStandings
      .filter((r) => r.entryId !== self && !already.has(r.entryId))
      .slice(0, RIVAL_BATCH_MAX);
  }, [rivalStandings, data]);

  const addFromLeague = useCallback(async () => {
    if (!user || !savedId || rivalCandidates.length === 0) return;
    setRivalBusy(true);
    setRivalError(null);

    let added = 0;
    const failed: string[] = [];
    let stoppedAt: string | null = null;

    // Sequential on purpose. These are rate-limited calls, and firing them in
    // parallel would turn one 429 into several while making it impossible to
    // say which rivals actually landed.
    for (const [i, candidate] of rivalCandidates.entries()) {
      setRivalBatchStatus(`Adding ${candidate.playerName} (${i + 1} of ${rivalCandidates.length})…`);
      const result = await addRivalById(candidate.entryId);
      if (result.ok) {
        added += 1;
      } else if (result.rateLimited) {
        stoppedAt = candidate.playerName;
        break;
      } else {
        failed.push(candidate.playerName);
      }
    }

    // Every term named, none of them netted away.
    const parts = [`Added ${added} of ${rivalCandidates.length}`];
    if (failed.length > 0) parts.push(`${failed.length} failed (${failed.join(", ")})`);
    if (stoppedAt) {
      parts.push(
        `stopped at ${stoppedAt} — the sync rate limit was reached, so the rest were not attempted`,
      );
    }
    setRivalBatchStatus(`${parts.join(" · ")}.`);

    if (added > 0) await connect(savedId);
    setRivalBusy(false);
  }, [user, savedId, rivalCandidates, addRivalById, connect]);

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

      {/* A refresh that didn't happen, not a page that failed — amber, and it
          sits alongside the data rather than replacing it. */}
      {syncNotice && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {syncNotice}{" "}
          <a href="/signin/" className="underline">
            Sign in
          </a>
          .
        </p>
      )}

      {m && (
        <>
          {/* ------------------------------------------------- profile */}
          <section className="mt-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {m.team_name ?? `Entry ${m.entry_id}`}
              </h1>
              {/* The highest-value action on this page, moved out of the
                  "Free transfers" card it used to be buried in (a casual
                  tester never found it there) and next to the header
                  instead, where "import my squad" is actually decided. */}
              {data && data.picks.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={importing}
                  className="shrink-0 rounded-md bg-purple-950 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
                >
                  {importing ? "Importing…" : "Import as draft →"}
                </button>
              )}
            </div>
            {data && data.picks.length > 0 && (
              <p className="mt-1.5 flex items-start gap-1 text-xs text-zinc-500">
                <InfoTooltip label="About the imported squad">{IMPORTED_SQUAD_NOTE}</InfoTooltip>
                Import opens this squad in the Builder as a new, independent draft.
              </p>
            )}
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

          {/* -------------------------- squad view ‖ tiles, FT/import, leagues */}
          {/* Sprint 23: the position-grouped squad list that used to sit
              below the pitch view showed the same 15 players a second time
              — deleted, not just visually deduped, since PitchView above is
              the read of record. Free transfers + import (its only other
              job) move into the rail alongside the points tiles and
              Your Leagues, which used to be full-width sections of their
              own further down the page. */}
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
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
                <section>
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
                  {/* The points are that gameweek's; the rest of the card
                      isn't, and can't be — `players` holds one current row
                      per player, and FPL publishes no history for status,
                      ownership or news. Disclose rather than imply. */}
                  {!pointsLoading && gwLayout && !viewingLatestEvent && selectedEvent !== null && (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Points are GW{selectedEvent}&apos;s. Prices, ownership and availability on
                      these cards are today&apos;s — FPL doesn&apos;t publish what they were then.
                    </p>
                  )}

                  {/* Sprint 33 — what /review was. Only for a *finished*
                      gameweek: the whole panel is a post-mortem, and a
                      post-mortem on a match still being played is a
                      different, wrong claim. `finishedEvents` is this
                      page's one source for that, so there is no second
                      event list to disagree with the selector above.
                      `data.players` is passed in rather than re-read —
                      /review used to fetch its own 1000-row copy of a map
                      this page already holds. */}
                  {selectedEvent !== null &&
                    data.finishedEvents.has(selectedEvent) &&
                    data.nextGw && (
                      <div className="mt-6 border-t border-zinc-200 pt-5 dark:border-purple-900/40">
                        <GameweekReviewPanel
                          season={data.nextGw.season}
                          entryId={data.manager.entry_id}
                          event={selectedEvent}
                          players={data.players}
                        />
                      </div>
                    )}
                </section>
              )}
            </div>

            <div className="min-w-0 space-y-4">
              {/* Every tile except the deadline describes the gameweek the
                  selector is on, so say which one rather than leaving five
                  unlabelled numbers to be read as "now". */}
              {!viewingLatestEvent && selectedEvent !== null && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Showing GW{selectedEvent} — totals below are as they stood after that
                  gameweek.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: "Team Value",
                    value: fmtMoney(
                      gwRow ? gwRow.value : m.last_deadline_value,
                      seasonStarted ? "—" : "£100.0m",
                    ),
                  },
                  {
                    label: "In the Bank",
                    value: fmtMoney(
                      gwRow ? gwRow.bank : m.last_deadline_bank,
                      seasonStarted ? "—" : "£0.0m",
                    ),
                  },
                  {
                    label: "Overall Points",
                    value: fmtNum(gwRow ? gwRow.total_points : m.summary_overall_points),
                  },
                  {
                    label: "Overall Rank",
                    value: fmtNum(gwRow ? gwRow.overall_rank : m.summary_overall_rank),
                  },
                  {
                    label: selectedEvent !== null ? `GW${selectedEvent} Points` : "GW Points",
                    value: fmtNum(gwRow ? gwRow.points : m.summary_event_points),
                  },
                  {
                    label: data?.nextGw ? `${data.nextGw.name} Deadline` : "Next Deadline",
                    value: data?.nextGw ? fmtCountdown(data.nextGw.deadline_time) : "—",
                  },
                ].map((tile) => (
                  <div key={tile.label} className={cardSupporting}>
                    <div className="text-xs text-zinc-500">{tile.label}</div>
                    <div className="mt-1 text-lg font-semibold text-purple-900 dark:text-[#00FF87]">
                      {tile.value}
                    </div>
                  </div>
                ))}
              </div>

              <section className={cardSupporting}>
                <h2 className={supportingHeading}>Free transfers</h2>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label
                    className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400"
                    title={
                      !importedDraft
                        ? "Import your squad as a draft first — there's nothing to save this to yet."
                        : undefined
                    }
                  >
                    <select
                      value={
                        importedDraft
                          ? (() => {
                              const ft = freeTransfersDisplay(importedDraft);
                              return ft.kind === "unlimited" ? MAX_FREE_TRANSFERS : ft.n;
                            })()
                          : 1
                      }
                      onChange={(e) => {
                        if (!importedDraft) return;
                        saveDraft({ ...importedDraft, freeTransfers: Number(e.target.value) });
                        setDrafts(listDrafts());
                      }}
                      aria-disabled={!importedDraft}
                      disabled={!importedDraft}
                      className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
                    >
                      {Array.from({ length: MAX_FREE_TRANSFERS + 1 }, (_, i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {leagues.length > 0 && (
                <section className={cardSupporting}>
                  <h2 className={supportingHeading}>Your Leagues</h2>
                  {/* Sprint 29 follow-up: the full grouped table read as
                      illegible squeezed into this 360px rail — /leagues
                      (Sprint 29.1) is the real place to browse standings
                      and EO, so this is a pointer, not a second render. */}
                  <a
                    href="/leagues/"
                    className="mt-2 flex items-center justify-between gap-2 text-sm text-purple-700 underline-offset-2 hover:underline dark:text-primary"
                  >
                    {leagues.length} league{leagues.length === 1 ? "" : "s"} — view standings & EO
                    <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </a>
                </section>
              )}

              {/* Sprint 29 follow-up: relocated from directly under the pitch
                  (main column) to here, below the leagues link — see the plan
                  for the desktop/mobile trade-off this accepts.
                  GameweekSummary already renders its own bordered card, so
                  no cardSupporting wrapper here — that would box it twice. */}
              {data && !pointsLoading && gwScore && selectedEvent !== null && (
                <GameweekSummary
                  event={selectedEvent}
                  score={gwScore}
                  history={gwRow}
                  captainName={
                    gwScore.captain
                      ? (data.players.get(gwScore.captain.element)?.web_name ?? "Captain")
                      : null
                  }
                  provisional={eventProvisional || !data.finishedEvents.has(selectedEvent)}
                />
              )}

              {transfersByEvent.size > 0 && (
                <section className={cardSupporting}>
                  <h2 className={supportingHeading}>Transfers this season</h2>
                  <ul className="mt-2 space-y-2">
                    {[...transfersByEvent.entries()]
                      .sort(([a], [b]) => b - a)
                      .map(([event, rows]) => (
                        <li key={event} className="text-sm">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            GW{event}
                          </span>{" "}
                          <span className="text-zinc-500">
                            {rows.length} transfer{rows.length === 1 ? "" : "s"}
                            {rows.length > 1 ? ` · ${hitCost(Math.max(0, rows.length - 1))} pt hit` : ""}
                          </span>
                          <ul className="mt-1 space-y-0.5 pl-3 text-xs text-zinc-500">
                            {rows.map((t, i) => (
                              <li key={i}>
                                {data?.players.get(t.elementOut)?.web_name ?? `#${t.elementOut}`} →{" "}
                                {data?.players.get(t.elementIn)?.web_name ?? `#${t.elementIn}`}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-zinc-400">
                    From FPL&apos;s own transfer record. Only appears once a transfer has been
                    synced — see Refresh above if a recent change is missing.
                  </p>
                  {importReconciliation && (
                    <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                      Your saved squad also changed by{" "}
                      {importReconciliation.diff.in
                        .map((id) => data?.players.get(id)?.web_name ?? `#${id}`)
                        .join(", ") || "—"}{" "}
                      in / {importReconciliation.diff.out
                        .map((id) => data?.players.get(id)?.web_name ?? `#${id}`)
                        .join(", ") || "—"}{" "}
                      out since the last save — check that against the ledger above if the two
                      don&apos;t obviously match.
                    </p>
                  )}
                </section>
              )}
            </div>
          </div>

          {/* ------------------------------------- decisions this season */}
          {/* Season-scoped, so deliberately outside the gameweek selector
              above — and directly above the table it complements, since the
              rank arc and that table's Overall Rank column are the same
              series read two ways. */}
          {seasonStarted && data && data.manager && data.nextGw && (
            <DecisionAnalyticsPanel
              season={data.nextGw.season}
              entryId={data.manager.entry_id}
              players={data.players}
            />
          )}

          {/* ---------------------------------------- gameweek history */}
          {seasonStarted && data && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                This Season
              </h2>
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-card dark:border-purple-900/40">
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
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-card dark:border-purple-900/40">
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
                  <div className="rounded-lg border border-zinc-200 bg-card p-4 text-sm text-zinc-500 dark:border-purple-900/40">
                    First season — no career record yet. A career percentile profile needs at
                    least one completed season.
                  </div>
                )}
                <div>
                  <RivalTable rivals={data.rivals} />

                  {/* The comparison set is whichever rivals you've chosen —
                      not every manager anyone has ever connected here. */}
                  {user ? (
                    <div className="mt-3 rounded-lg border border-zinc-200 bg-card p-3 dark:border-purple-900/40">
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

                      {/* --- or take them from a league's own table (DSI-61) --- */}
                      {leagues.length > 0 && (
                        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-purple-900/40">
                          <div className="flex flex-wrap items-center gap-2">
                            <label htmlFor="rival-league" className="sr-only">
                              Add rivals from a league
                            </label>
                            <select
                              id="rival-league"
                              value={rivalLeagueId ?? ""}
                              onChange={(e) => {
                                setRivalLeagueId(e.target.value ? Number(e.target.value) : null);
                                setRivalStandings(null);
                                setRivalBatchStatus(null);
                                if (rivalError) setRivalError(null);
                              }}
                              className="max-w-[13rem] rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus-visible:border-purple-700 focus-visible:ring-2 focus-visible:ring-ring dark:border-purple-800/50 dark:bg-input dark:text-zinc-100"
                            >
                              <option value="">Add from a league…</option>
                              {leagues.map((l) => (
                                <option key={l.league_id} value={l.league_id}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                            {rivalCandidates.length > 0 && (
                              <button
                                type="button"
                                onClick={() => void addFromLeague()}
                                disabled={rivalBusy}
                                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
                              >
                                Add top {rivalCandidates.length}
                              </button>
                            )}
                          </div>

                          {rivalStandingsLoading && (
                            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                              Loading standings…
                            </p>
                          )}

                          {/* An unsynced league is a real, fixable state — say
                              which one it is rather than showing an empty list
                              that looks like "no rivals available". */}
                          {!rivalStandingsLoading &&
                            rivalStandings !== null &&
                            rivalStandings.length === 0 && (
                              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                No standings stored for this league yet — sync it once on{" "}
                                <a
                                  href="/leagues/"
                                  className="underline hover:text-zinc-700 dark:hover:text-zinc-200"
                                >
                                  Leagues
                                </a>
                                , then come back.
                              </p>
                            )}

                          {!rivalStandingsLoading &&
                            rivalStandings !== null &&
                            rivalStandings.length > 0 &&
                            rivalCandidates.length === 0 && (
                              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                Everyone at the top of this league is already a rival.
                              </p>
                            )}

                          {rivalCandidates.length > 0 && !rivalBusy && !rivalBatchStatus && (
                            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                              Will add: {rivalCandidates.map((c) => c.playerName).join(", ")}
                              {rivalStandings && rivalStandings.length > RIVAL_BATCH_MAX && (
                                <> · top {RIVAL_BATCH_MAX} only, one sync each</>
                              )}
                            </p>
                          )}

                          {rivalBatchStatus && (
                            <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                              {rivalBatchStatus}
                            </p>
                          )}
                        </div>
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
