"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { FdrLegendContent, InfoTooltip } from "@/components/info-tooltip";
import { CaptainBadge, ViceCaptainBadge } from "@/components/armband";
import { DraftTimeline } from "@/components/draft-timeline";
import {
  cloneDraft,
  deleteDraft,
  draftHistory,
  exportDrafts,
  importDrafts,
  listDrafts,
  renameDraft,
  type DraftSnapshot,
} from "@/lib/drafts";
import {
  meanPlayerValue,
  squadScore,
  SQUAD_SCORE_NOTE,
  type SquadScoreBreakdown,
} from "@/lib/squad-score";
import { fixtureScore, riskScore, RISK_MODEL_NOTE, type ScoredPlayer } from "@/lib/scoring";
import { optimiseLineup, type LineupCandidate } from "@/lib/lineup";
import { benchBoostAt, tripleCaptainAt, type ChipValuation } from "@/lib/chips";
import {
  HORIZONS,
  horizonLabel,
  seasonHorizonNote,
  validateSquad,
  type Horizon,
  type HorizonXp,
  type PlayerMeta,
  type SquadRules,
  type TeamState,
  DEFAULT_RULES,
} from "@/lib/team-state";

interface PlayerRow {
  id: number;
  web_name: string;
  team_id: number;
  element_type: number;
  now_cost: number | null;
  selected_by_percent: number | null;
  points_per_game: number | null;
  status: string | null;
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

const MAX_COMPARE = 4;
/** Fallback when `player_xp_horizons` has no rows yet — matches `generate-predictions`' own floor. */
const FALLBACK_SEASON_WINDOW = 8;

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function ScenariosPage() {
  const [drafts, setDrafts] = useState<TeamState[]>([]);
  const [rowById, setRowById] = useState<Map<number, PlayerRow>>(new Map());
  const [scoredById, setScoredById] = useState<Map<number, ScoredPlayer>>(new Map());
  const [xp, setXp] = useState<Map<number, XpRow>>(new Map());
  const [rules, setRules] = useState<SquadRules>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The real "season" prediction window — from `player_xp_horizons`, not hardcoded. */
  const [seasonWindow, setSeasonWindow] = useState(FALLBACK_SEASON_WINDOW);
  const [nextEvent, setNextEvent] = useState<number | null>(null);

  const [horizon, setHorizon] = useState<Horizon>(5);
  const [selected, setSelected] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [timelineFor, setTimelineFor] = useState<string | null>(null);
  const [history, setHistory] = useState<DraftSnapshot[]>([]);
  /** Delete is permanent, so it takes a second click to confirm. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Drafts live in localStorage, so they can only be read after mount — an
  // effect is the right place despite the set-state-in-effect lint preference.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(listDrafts());
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

        const [playersRes, teamsRes, typesRes, settingsRes, xpRes, predsRes, fixturesRes] =
          await Promise.all([
            supabase
              .from("players")
              .select(
                "id, web_name, team_id, element_type, now_cost, selected_by_percent, points_per_game, status, chance_of_playing_next_round, penalties_order",
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
            // real "season" window is however many the model actually
            // predicted (see seasonWindow below) — capping the fetch at a
            // constant would silently under-serve fixtureScore/riskScore the
            // moment that window changes.
            supabase
              .from("fixtures")
              .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
              .eq("season", gw.season)
              .gte("event", gw.id)
              .order("event"),
          ]);
        if (playersRes.error) throw new Error(playersRes.error.message);
        if (teamsRes.error) throw new Error(teamsRes.error.message);

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
          const availability =
            p.chance_of_playing_next_round !== null
              ? Math.max(0, Math.min(1, p.chance_of_playing_next_round / 100))
              : p.status === "a"
                ? 1
                : 0;
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

  /**
   * Best-lineup bench contribution per draft.
   *
   * Each draft is measured against its own optimal XI rather than whatever
   * lineup happens to be stored, so the comparison is like for like — one draft
   * having been through the lineup optimiser and another not is a property of
   * the user's clicking, not of the squad.
   */
  const benchByDraft = useMemo(() => {
    const m = new Map<string, number | null>();
    if (scoredById.size === 0) return m;
    for (const d of drafts) {
      const candidates: LineupCandidate[] = d.players.flatMap((pick) => {
        const s = scoredById.get(pick.playerId);
        const row = rowById.get(pick.playerId);
        if (!s || !row) return [];
        return [
          {
            playerId: s.id,
            elementType: s.elementType,
            webName: s.webName,
            xp: s.xp[1],
            expectedMinutes: s.expectedMinutes,
            startProbability: s.startProbability,
            availability: s.availability,
            fdr: s.fdrRun[0] ?? null,
            opponent: null,
            isPenaltyTaker: row.penalties_order === 1,
          },
        ];
      });
      const lineup = candidates.length > 0 ? optimiseLineup(candidates) : null;
      m.set(d.draftId, lineup ? lineup.benchExpectedContribution : null);
    }
    return m;
  }, [drafts, scoredById, rowById]);

  const isPenaltyTaker = useCallback(
    (id: number): boolean => rowById.get(id)?.penalties_order === 1,
    [rowById],
  );

  /**
   * A `PredAt` scoped to the next gameweek, built entirely from `ScoredPlayer`
   * fields already loaded — no new fetch. Mirrors the same next-gameweek-only
   * shortcut `/builder` uses; Free Hit and Wildcard are full-squad rebuilds
   * and stay on `/chips` rather than running per draft here.
   */
  const nextEventPredAt = useCallback(
    (id: number, event: number) => {
      if (nextEvent === null || event !== nextEvent) return undefined;
      const s = scoredById.get(id);
      if (!s) return undefined;
      return {
        expectedMinutes: s.expectedMinutes,
        startProbability: s.startProbability,
        availability: s.availability,
        fdr: s.fdrRun[0] ?? null,
        xp: s.xp[1],
      };
    },
    [nextEvent, scoredById],
  );

  /** Bench Boost / Triple Captain for the next gameweek, per draft. */
  const chipsByDraft = useMemo(() => {
    const m = new Map<string, { bboost: ChipValuation; threeXC: ChipValuation }>();
    if (scoredById.size === 0 || nextEvent === null) return m;
    for (const d of drafts) {
      if (d.players.length !== rules.squadSize) continue;
      m.set(d.draftId, {
        bboost: benchBoostAt(d.players, nextEvent, nextEventPredAt, lookup, isPenaltyTaker),
        threeXC: tripleCaptainAt(d, nextEvent, nextEventPredAt, availabilityOf, lookup, isPenaltyTaker),
      });
    }
    return m;
  }, [drafts, scoredById, nextEvent, nextEventPredAt, lookup, isPenaltyTaker, availabilityOf, rules.squadSize]);

  /** SquadScore per draft, keyed by draftId. */
  const scores = useMemo(() => {
    const m = new Map<string, SquadScoreBreakdown>();
    if (scoredById.size === 0) return m;
    for (const d of drafts) {
      m.set(
        d.draftId,
        squadScore({
          team: d,
          scoredById,
          xpOf,
          availabilityOf,
          horizon,
          benchContribution: benchByDraft.get(d.draftId) ?? null,
          seasonWindow,
        }),
      );
    }
    return m;
  }, [drafts, scoredById, xpOf, availabilityOf, horizon, benchByDraft, seasonWindow]);

  const refresh = () => setDrafts(listDrafts());

  // ------------------------------------------------ export / import backup
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<{
    text: string;
    tone: "ok" | "error";
  } | null>(null);

  const handleExport = () => {
    const json = exportDrafts();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fpl-drafts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const result = importDrafts(text, "merge");
    if (result.error) {
      setImportMessage({ text: result.error, tone: "error" });
      return;
    }
    setImportMessage({
      text:
        `Imported ${result.added} draft${result.added === 1 ? "" : "s"}` +
        (result.skipped > 0
          ? ` · skipped ${result.skipped} (already up to date locally, or invalid)`
          : ""),
      tone: "ok",
    });
    refresh();
  };

  const toggleSelect = (draftId: string) =>
    setSelected((prev) =>
      prev.includes(draftId)
        ? prev.filter((id) => id !== draftId)
        : prev.length >= MAX_COMPARE
          ? prev
          : [...prev, draftId],
    );

  const openTimeline = (draftId: string) => {
    setTimelineFor(draftId);
    setHistory(draftHistory(draftId));
  };

  const commitRename = (draftId: string) => {
    if (renameValue.trim().length === 0) {
      setRenaming(null);
      setRenameError(null);
      return;
    }
    const result = renameDraft(draftId, renameValue);
    if (result.error) {
      // Keep the input open so the collision is visible and correctable,
      // rather than silently discarding the attempted rename.
      setRenameError(result.error);
      return;
    }
    setRenaming(null);
    setRenameError(null);
    refresh();
  };

  const chosen = useMemo(
    () => selected.flatMap((id) => drafts.filter((d) => d.draftId === id)),
    [selected, drafts],
  );

  const ranked = useMemo(
    () =>
      [...drafts]
        .map((d) => ({ draft: d, score: scores.get(d.draftId) }))
        .sort((a, b) => (b.score?.total ?? -Infinity) - (a.score?.total ?? -Infinity)),
    [drafts, scores],
  );

  const bestTotal = ranked[0]?.score?.total;

  // Ticking a 2nd draft used to leave the comparison a full page-scroll
  // below the card grid with no way to jump to it — this ref plus the
  // sticky bar below fix that, mirroring the pattern app/players/page.tsx
  // already uses for its own bottom bar.
  const comparisonRef = useRef<HTMLElement>(null);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Scenario Lab
            <InfoTooltip>
              <FdrLegendContent />
            </InfoTooltip>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Every draft in this browser, ranked by SquadScore. Pick up to {MAX_COMPARE} to compare
            side by side.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
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

      {/* backup — drafts live in this browser's localStorage only */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        {drafts.length > 0 && (
          <button
            onClick={handleExport}
            className="rounded-md border border-zinc-300 px-2.5 py-1 font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:bg-purple-950/60"
          >
            Export drafts
          </button>
        )}
        <button
          onClick={() => importInputRef.current?.click()}
          className="rounded-md border border-zinc-300 px-2.5 py-1 font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:bg-purple-950/60"
        >
          Import drafts
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = "";
          }}
        />
        <span className="text-zinc-400">
          Drafts live in this browser only — export a backup before switching devices or clearing
          site data.
        </span>
        {importMessage && (
          <span
            className={
              importMessage.tone === "error"
                ? "text-red-600 dark:text-red-400"
                : "text-emerald-700 dark:text-emerald-400"
            }
          >
            {importMessage.text}
          </span>
        )}
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading player data…</p>}

      {drafts.length === 0 && !loading && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 text-center dark:border-purple-900/40 dark:bg-[#1E0234]">
          <p className="text-sm text-zinc-500">
            No drafts saved yet. Build a squad in the{" "}
            <Link
              href="/builder"
              className="font-medium text-purple-700 underline-offset-2 hover:underline dark:text-[#00FF87]"
            >
              Team Builder
            </Link>{" "}
            and save it — every save lands here.
          </p>
        </div>
      )}

      {/* draft cards */}
      {drafts.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ranked.map(({ draft, score }, rank) => {
            const validation = validateSquad(draft, rules, lookup);
            const isBest = score !== undefined && score.total === bestTotal && drafts.length > 1;
            const picked = selected.includes(draft.draftId);

            return (
              <article
                key={draft.draftId}
                className={`rounded-xl border p-4 transition-colors ${
                  picked
                    ? "border-purple-600 bg-purple-50/60 dark:border-[#00FF87] dark:bg-[#25063f]"
                    : "border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {renaming === draft.draftId ? (
                      <>
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => {
                            setRenameValue(e.target.value);
                            if (renameError) setRenameError(null);
                          }}
                          onBlur={() => commitRename(draft.draftId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(draft.draftId);
                            if (e.key === "Escape") {
                              setRenaming(null);
                              setRenameError(null);
                            }
                          }}
                          aria-label="Draft name"
                          className="w-full rounded border border-purple-400 bg-white px-1.5 py-0.5 text-sm font-semibold text-zinc-900 outline-none dark:border-[#00FF87] dark:bg-[#2A0A45] dark:text-zinc-100"
                        />
                        {renameError && (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{renameError}</p>
                        )}
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setRenaming(draft.draftId);
                          setRenameValue(draft.name);
                          setRenameError(null);
                        }}
                        title="Rename"
                        className="max-w-full truncate text-left text-sm font-semibold text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
                      >
                        {draft.name}
                      </button>
                    )}
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      #{rank + 1} · saved {formatWhen(draft.updatedAt)}
                    </p>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-zinc-500">
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() => toggleSelect(draft.draftId)}
                      disabled={!picked && selected.length >= MAX_COMPARE}
                      className="accent-purple-800 dark:accent-[#00FF87]"
                    />
                    compare
                  </label>
                </div>

                {/* score */}
                <div className="mt-3 flex items-end gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                      SquadScore
                    </div>
                    <div className="text-2xl font-extrabold tabular-nums text-purple-900 dark:text-[#00FF87]">
                      {score ? score.total.toFixed(1) : "—"}
                    </div>
                  </div>
                  {isBest && (
                    <span className="mb-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      best
                    </span>
                  )}
                  <div className="mb-1 text-[11px] text-zinc-500">
                    {score ? `${score.expectedPoints.toFixed(1)} xP` : ""}
                  </div>
                </div>

                {/* legality + budget */}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span
                    className={
                      validation.isLegal
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }
                  >
                    {validation.isLegal ? "✓ Legal" : "Incomplete"} · {draft.players.length}/
                    {rules.squadSize}
                  </span>
                  <span className="text-zinc-500">{money(validation.budgetRemaining)} left</span>
                  {score && score.missing > 0 && (
                    <span className="text-amber-700 dark:text-amber-400">
                      {score.missing} without xP
                    </span>
                  )}
                </div>

                {/* armband */}
                <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-600 dark:text-zinc-400">
                  <span className="flex items-center gap-1">
                    <CaptainBadge className="h-4 w-4" />
                    {draft.captain !== null
                      ? (rowById.get(draft.captain)?.web_name ?? "—")
                      : "none"}
                  </span>
                  <span className="flex items-center gap-1">
                    <ViceCaptainBadge className="h-4 w-4" />
                    {draft.viceCaptain !== null
                      ? (rowById.get(draft.viceCaptain)?.web_name ?? "—")
                      : "none"}
                  </span>
                </div>

                {/* actions */}
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-zinc-100 pt-2.5 text-xs dark:border-purple-900/40">
                  <Link
                    href={`/builder?draft=${draft.draftId}`}
                    className="rounded bg-purple-950 px-2 py-1 font-medium text-white transition-colors hover:bg-purple-800 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => {
                      cloneDraft(draft);
                      refresh();
                    }}
                    className="rounded border border-zinc-300 px-2 py-1 font-medium transition-colors hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/60 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
                  >
                    Clone
                  </button>
                  <button
                    onClick={() => openTimeline(draft.draftId)}
                    className="rounded border border-zinc-300 px-2 py-1 font-medium transition-colors hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/60 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
                  >
                    Timeline
                  </button>
                  <button
                    onClick={() => {
                      if (confirmDelete !== draft.draftId) {
                        setConfirmDelete(draft.draftId);
                        return;
                      }
                      deleteDraft(draft.draftId);
                      setSelected((prev) => prev.filter((id) => id !== draft.draftId));
                      if (timelineFor === draft.draftId) setTimelineFor(null);
                      setConfirmDelete(null);
                      refresh();
                    }}
                    onBlur={() => setConfirmDelete(null)}
                    className={`rounded border px-2 py-1 font-medium transition-colors ${
                      confirmDelete === draft.draftId
                        ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                        : "border-zinc-300 text-red-600 hover:border-red-500 dark:border-purple-800/60 dark:text-red-400"
                    }`}
                  >
                    {confirmDelete === draft.draftId ? "Confirm delete?" : "Delete"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* timeline */}
      {timelineFor !== null && (
        <DraftTimeline
          draftName={drafts.find((d) => d.draftId === timelineFor)?.name ?? "Draft"}
          history={history}
          nameOf={(id) => rowById.get(id)?.web_name ?? `#${id}`}
          onClose={() => setTimelineFor(null)}
        />
      )}

      {/* comparison */}
      {chosen.length >= 2 && (
        <section ref={comparisonRef} className="mt-8 scroll-mt-4">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Comparing {chosen.length} drafts
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                  <th className="px-3 py-2">Metric</th>
                  {chosen.map((d) => (
                    <th key={d.draftId} className="px-3 py-2">
                      {d.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <ComparisonRows
                  drafts={chosen}
                  scores={scores}
                  scoredById={scoredById}
                  horizon={horizon}
                  seasonWindow={seasonWindow}
                  rules={rules}
                  lookup={lookup}
                  chipsByDraft={chipsByDraft}
                />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">{SQUAD_SCORE_NOTE}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">{RISK_MODEL_NOTE}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
            Bench Boost and Triple Captain above are for the next gameweek only. Free Hit and
            Wildcard are full-squad rebuilds, valued for every playable gameweek on the{" "}
            <Link
              href={chosen[0] ? `/chips?draft=${chosen[0].draftId}` : "/chips"}
              className="text-purple-700 underline-offset-2 hover:underline dark:text-[#00FF87]"
            >
              Chip Strategy
            </Link>{" "}
            page.
          </p>
        </section>
      )}

      {chosen.length === 1 && (
        <p className="mt-6 text-sm text-zinc-500">
          Select one more draft to compare — a single squad has nothing to be measured against.
        </p>
      )}

      {chosen.length >= 2 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-purple-900/40 dark:bg-[#1E0234]/95">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Comparing {chosen.length} draft{chosen.length === 1 ? "" : "s"}
            </span>
            <span className="flex items-center gap-3">
              <button
                onClick={() => setSelected([])}
                className="text-sm text-zinc-500 underline transition-colors hover:text-purple-700 dark:hover:text-[#00FF87]"
              >
                Clear
              </button>
              <button
                onClick={() =>
                  comparisonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="rounded-md bg-purple-950 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-900 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e078]"
              >
                Compare {chosen.length} drafts ↓
              </button>
            </span>
          </div>
        </div>
      )}
    </main>
  );
}

/** Metric rows, with the best cell per row marked. */
function ComparisonRows({
  drafts,
  scores,
  scoredById,
  horizon,
  seasonWindow,
  rules,
  lookup,
  chipsByDraft,
}: {
  drafts: TeamState[];
  scores: Map<string, SquadScoreBreakdown>;
  scoredById: Map<number, ScoredPlayer>;
  horizon: Horizon;
  seasonWindow: number;
  rules: SquadRules;
  lookup: (id: number) => PlayerMeta | undefined;
  chipsByDraft: Map<string, { bboost: ChipValuation; threeXC: ChipValuation }>;
}) {
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

  const squadPlayers = (d: TeamState) =>
    d.players.flatMap((p) => {
      const s = scoredById.get(p.playerId);
      return s ? [s] : [];
    });

  const rows: {
    label: string;
    /** "none" for figures that are context rather than merit — spending less is
     *  not a virtue in FPL, and a tied row has nothing to distinguish. */
    dir: "high" | "low" | "none";
    format: (v: number) => string;
    values: number[];
    note?: string;
  }[] = [
    {
      label: "SquadScore",
      dir: "high",
      format: (v) => v.toFixed(1),
      values: drafts.map((d) => scores.get(d.draftId)?.total ?? 0),
    },
    {
      label: `Expected points · ${horizonLabel(horizon)}`,
      dir: "high",
      format: (v) => v.toFixed(1),
      values: drafts.map((d) => scores.get(d.draftId)?.expectedPoints ?? 0),
    },
    {
      label: "Fixture quality",
      dir: "high",
      format: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
      values: drafts.map((d) => scores.get(d.draftId)?.fixtureQuality ?? 0),
      note: "Points-equivalent, relative to an average fixture run",
    },
    {
      label: "Bench contribution",
      dir: "high",
      format: (v) => (v === 0 ? "no legal XI" : v.toFixed(1)),
      values: drafts.map((d) => scores.get(d.draftId)?.benchStrength ?? 0),
      note: "Bench xP weighted by the chance an auto-sub uses the slot, from each draft's best XI",
    },
    {
      label: "Bench Boost this week",
      dir: "high",
      format: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
      values: drafts.map((d) => chipsByDraft.get(d.draftId)?.bboost.gain ?? 0),
      note: "What playing Bench Boost next gameweek would add over auto-subs",
    },
    {
      label: "Triple Captain this week",
      dir: "high",
      format: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
      values: drafts.map((d) => chipsByDraft.get(d.draftId)?.threeXC.gain ?? 0),
      note: "One extra copy of the captain's next-gameweek score",
    },
    {
      label: "Value",
      dir: "high",
      format: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
      values: drafts.map((d) => scores.get(d.draftId)?.value ?? 0),
    },
    {
      label: "Risk penalty",
      dir: "low",
      format: (v) => `−${v.toFixed(1)}`,
      values: drafts.map((d) => scores.get(d.draftId)?.risk ?? 0),
    },
    {
      label: "Mean player risk",
      dir: "low",
      format: (v) => v.toFixed(0),
      values: drafts.map((d) => mean(squadPlayers(d).map((p) => riskScore(p, horizon, seasonWindow)))),
    },
    {
      label: "Mean FDR score",
      dir: "high",
      format: (v) => v.toFixed(2),
      values: drafts.map((d) => mean(squadPlayers(d).map((p) => fixtureScore(p, horizon, seasonWindow)))),
    },
    {
      label: "xP per £m",
      dir: "high",
      format: (v) => v.toFixed(2),
      values: drafts.map((d) => meanPlayerValue(d, scoredById, horizon)),
    },
    {
      label: "Spent",
      dir: "none",
      format: (v) => money(v),
      values: drafts.map((d) => d.players.reduce((s, p) => s + p.purchasePrice, 0)),
    },
    {
      label: "Squad size",
      dir: "none",
      format: (v) => `${v}/${rules.squadSize}`,
      values: drafts.map((d) => d.players.length),
    },
  ];

  const uniquePlayers = drafts.map((d, i) => {
    const others = new Set(
      drafts.flatMap((o, j) => (i === j ? [] : o.players.map((p) => p.playerId))),
    );
    return d.players.filter((p) => !others.has(p.playerId)).map((p) => p.playerId);
  });

  return (
    <>
      {rows.map((row) => {
        const nums = row.values;
        // Compare what the reader can see: a ▲ beside two cells both showing
        // "0.5" claims a winner nobody can verify, so ties are judged on the
        // formatted value rather than the raw float.
        const shown = nums.map(row.format);
        const allEqual = shown.every((v) => v === shown[0]);
        const best =
          nums.length === 0 || row.dir === "none" || allEqual
            ? null
            : row.dir === "high"
              ? Math.max(...nums)
              : Math.min(...nums);
        return (
          <tr
            key={row.label}
            className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200"
          >
            <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">
              <span title={row.note} className={row.note ? "cursor-help underline decoration-dotted underline-offset-2" : ""}>
                {row.label}
              </span>
            </th>
            {nums.map((v, i) => (
              <td key={i} className="px-3 py-2 tabular-nums">
                <span
                  className={
                    best !== null && v === best && nums.length > 1
                      ? "font-semibold text-purple-800 dark:text-[#00FF87]"
                      : ""
                  }
                >
                  {row.format(v)}
                  {best !== null && v === best && nums.length > 1 ? " ▲" : ""}
                </span>
              </td>
            ))}
          </tr>
        );
      })}
      <tr className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200">
        <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">
          Unique to this draft
        </th>
        {uniquePlayers.map((ids, i) => (
          <td key={i} className="px-3 py-2 text-xs">
            {ids.length === 0 ? (
              <span className="text-zinc-400">none — identical squads</span>
            ) : (
              <span className="text-zinc-600 dark:text-zinc-300">
                {ids.length} ·{" "}
                {ids
                  .slice(0, 4)
                  .map((id) => lookup(id)?.webName ?? `#${id}`)
                  .join(", ")}
                {ids.length > 4 ? ` +${ids.length - 4}` : ""}
              </span>
            )}
          </td>
        ))}
      </tr>
    </>
  );
}
