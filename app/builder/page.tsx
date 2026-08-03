"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import { PitchView } from "@/components/pitch-view";
import type { PlayerData } from "@/components/player-card";
import { cloneDraft, deleteDraft, listDrafts, saveDraft } from "@/lib/drafts";
import {
  addPlayer,
  blockedReason,
  computeProjection,
  DEFAULT_RULES,
  emptyTeamState,
  removePlayer,
  setCaptain,
  setViceCaptain,
  validateSquad,
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
  type Horizon,
  type OptimizerPlayer,
  type RiskLevel,
  type Strategy,
} from "@/lib/optimizer";

interface PlayerRow {
  id: number;
  web_name: string;
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
}

interface XpRow {
  player_id: number;
  xp_1: number | null;
  xp_3: number | null;
  xp_6: number | null;
  xp_8: number | null;
}

interface NextFixture {
  opponent_short_name: string;
  is_home: boolean;
  fdr: number;
}

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
const PAGE_SIZE = 25;
const HORIZONS: Horizon[] = [1, 3, 6, 8];

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

type SortKey = "xp6" | "xp1" | "price" | "ownership";

export default function BuilderPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [teamShort, setTeamShort] = useState<Map<number, string>>(new Map());
  const [xp, setXp] = useState<Map<number, XpRow>>(new Map());
  const [nextFixtures, setNextFixtures] = useState<Map<number, NextFixture>>(new Map());
  const [rules, setRules] = useState<SquadRules>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [team, setTeam] = useState<TeamState>(() => emptyTeamState(DEFAULT_RULES));
  const [drafts, setDrafts] = useState<TeamState[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<number>(0);
  const [teamFilter, setTeamFilter] = useState<number>(0);
  const [sortKey, setSortKey] = useState<SortKey>("xp6");
  const [page, setPage] = useState(0);

  const [horizon, setHorizon] = useState<Horizon>(6);
  const [strategy, setStrategy] = useState<Strategy>("max_points");
  const [risk, setRisk] = useState<RiskLevel>("medium");
  const [optimizeNote, setOptimizeNote] = useState<string | null>(null);

  // ------------------------------------------------------------- load

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

        const [playersRes, teamsRes, typesRes, settingsRes, xpRes, fixturesRes] =
          await Promise.all([
            supabase
              .from("players")
              .select(
                "id, web_name, team_id, team_code, element_type, now_cost, selected_by_percent, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order",
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
              .select("player_id, xp_1, xp_3, xp_6, xp_8")
              .eq("season", gw.season)
              .limit(1000),
            supabase
              .from("fixtures")
              .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
              .eq("season", gw.season)
              .eq("event", gw.id),
          ]);
        if (playersRes.error) throw new Error(playersRes.error.message);
        if (teamsRes.error) throw new Error(teamsRes.error.message);

        const shorts = new Map(
          (teamsRes.data ?? []).map((t) => [t.id as number, t.short_name as string]),
        );

        // Squad rules come from the database, never hardcoded — FPL has
        // changed budget and squad size between seasons.
        const settings = new Map(
          (settingsRes.data ?? []).map((s) => [s.key as string, Number(s.value)]),
        );
        const quota: Record<number, number> = {};
        for (const t of typesRes.data ?? []) quota[t.id as number] = Number(t.squad_select ?? 0);

        const loadedRules: SquadRules = {
          totalSpend: settings.get("squad_total_spend") ?? DEFAULT_RULES.totalSpend,
          teamLimit: settings.get("squad_team_limit") ?? DEFAULT_RULES.teamLimit,
          squadSize: settings.get("squad_squadsize") ?? DEFAULT_RULES.squadSize,
          positionQuota: Object.keys(quota).length > 0 ? quota : DEFAULT_RULES.positionQuota,
        };

        // Next gameweek's opponent per club, for the pitch cards.
        const fixtures = new Map<number, NextFixture>();
        for (const f of fixturesRes.data ?? []) {
          fixtures.set(f.team_h as number, {
            opponent_short_name: shorts.get(f.team_a as number) ?? "?",
            is_home: true,
            fdr: (f.team_h_difficulty as number | null) ?? 3,
          });
          fixtures.set(f.team_a as number, {
            opponent_short_name: shorts.get(f.team_h as number) ?? "?",
            is_home: false,
            fdr: (f.team_a_difficulty as number | null) ?? 3,
          });
        }

        setPlayers((playersRes.data ?? []) as PlayerRow[]);
        setTeamShort(shorts);
        setXp(new Map(((xpRes.data ?? []) as XpRow[]).map((r) => [r.player_id, r])));
        setNextFixtures(fixtures);
        setRules(loadedRules);

        const existing = listDrafts();
        setDrafts(existing);
        setTeam(existing[0] ?? emptyTeamState(loadedRules));
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
      return { xp1: r.xp_1, xp3: r.xp_3, xp6: r.xp_6, xp8: r.xp_8 };
    },
    [xp],
  );

  const availabilityOf = useCallback(
    (id: number): number => {
      const p = rowById.get(id);
      if (!p) return 0;
      if (p.chance_of_playing_next_round !== null) {
        return Math.max(0, Math.min(1, p.chance_of_playing_next_round / 100));
      }
      return p.status === "a" ? 1 : 0;
    },
    [rowById],
  );

  const validation = useMemo(() => validateSquad(team, rules, lookup), [team, rules, lookup]);

  const projection = useMemo(
    () => computeProjection(team.players, xpOf, availabilityOf, team.captain, team.viceCaptain),
    [team.players, team.captain, team.viceCaptain, xpOf, availabilityOf],
  );

  const optimizerPool = useMemo<OptimizerPlayer[]>(
    () =>
      players.map((p) => {
        const r = xp.get(p.id);
        return {
          id: p.id,
          elementType: p.element_type,
          teamId: p.team_id,
          price: p.now_cost ?? 0,
          xp: { 1: r?.xp_1 ?? null, 3: r?.xp_3 ?? null, 6: r?.xp_6 ?? null, 8: r?.xp_8 ?? null },
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

  const onSave = () => {
    const stored = saveDraft(team);
    setTeam(stored);
    setDrafts(listDrafts());
    setSaved(`Saved ${new Date(stored.updatedAt).toLocaleTimeString()}`);
  };

  const runOptimizer = (clearFirst: boolean) => {
    const base = clearFirst
      ? { ...team, players: [], captain: null, viceCaptain: null }
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
        (result.withoutXp > 0 ? ` · ${result.withoutXp} without an xP projection` : ""),
    );
  };

  // -------------------------------------------------------- filtering

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = players.filter((p) => {
      if (q && !p.web_name.toLowerCase().includes(q)) return false;
      if (position !== 0 && p.element_type !== position) return false;
      if (teamFilter !== 0 && p.team_id !== teamFilter) return false;
      return true;
    });

    const value = (p: PlayerRow) => {
      switch (sortKey) {
        case "xp6":
          return xp.get(p.id)?.xp_6 ?? -1;
        case "xp1":
          return xp.get(p.id)?.xp_1 ?? -1;
        case "price":
          return p.now_cost ?? -1;
        case "ownership":
          return p.selected_by_percent ?? -1;
      }
    };

    return rows.sort((a, b) => value(b) - value(a));
  }, [players, xp, search, position, teamFilter, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  /** Any filter change invalidates the current page index. */
  const changeFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };

  // Squad in the shape the pitch wants.
  const squadCards = useMemo<PlayerData[]>(
    () =>
      team.players.flatMap((pick) => {
        const row = rowById.get(pick.playerId);
        if (!row) return [];
        const card: PlayerData = {
          id: row.id,
          web_name: row.web_name,
          team_code: row.team_code,
          element_type: row.element_type,
          now_cost: row.now_cost ?? 0,
          expected_points: xp.get(row.id)?.xp_1 ?? null,
          status: row.status,
          chance_of_playing_next_round: row.chance_of_playing_next_round,
          is_captain: team.captain === row.id,
          is_vice_captain: team.viceCaptain === row.id,
          is_penalty_taker: row.penalties_order === 1,
          is_freekick_taker: row.direct_freekicks_order === 1,
          is_corner_taker: row.corners_and_indirect_freekicks_order === 1,
          next_fixture: nextFixtures.get(row.team_id) ?? null,
        };
        return [card];
      }),
    [team.players, team.captain, team.viceCaptain, rowById, xp, nextFixtures],
  );

  // ------------------------------------------------------------- view

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <p className="text-sm text-zinc-500">Loading player pool…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      </main>
    );
  }

  const captainName =
    team.captain !== null ? (rowById.get(team.captain)?.web_name ?? "—") : null;

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
            className={`h-full rounded-full transition-all ${
              validation.overBudget ? "bg-red-500" : "bg-purple-800 dark:bg-[#00FF87]"
            }`}
            style={{ width: `${Math.min(100, (validation.spent / rules.totalSpend) * 100)}%` }}
          />
        </div>
      </div>

      {/* Validity chips */}
      <div className="flex flex-wrap gap-1">
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
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            validation.isLegal
              ? "bg-emerald-600 text-white dark:bg-[#00FF87] dark:text-slate-950"
              : "bg-zinc-200 text-zinc-600 dark:bg-purple-900/60 dark:text-zinc-300"
          }`}
        >
          {validation.isLegal ? "Legal squad" : "Incomplete"}
        </span>
      </div>
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
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
          {drafts.length > 0 && (
            <select
              value={team.draftId}
              onChange={(e) => {
                const found = drafts.find((d) => d.draftId === e.target.value);
                if (found) persist(found);
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
          <button
            onClick={onSave}
            className="rounded-md bg-purple-950 px-3 py-1.5 font-medium text-white transition-colors hover:bg-purple-800 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
          >
            Save
          </button>
          {[
            { label: "New", fn: () => persist(emptyTeamState(rules)) },
            {
              label: "Clone",
              fn: () => {
                const copy = cloneDraft(team);
                setTeam(copy);
                setDrafts(listDrafts());
                setSaved("Cloned");
              },
            },
            {
              label: "Delete",
              fn: () => {
                deleteDraft(team.draftId);
                const rest = listDrafts();
                setDrafts(rest);
                setTeam(rest[0] ?? emptyTeamState(rules));
                setSaved(null);
              },
            },
          ].map((b) => (
            <button
              key={b.label}
              onClick={b.fn}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
            >
              {b.label}
            </button>
          ))}
          {saved && <span className="text-xs text-zinc-500">{saved}</span>}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ============================================ pitch column */}
        <section className="space-y-4">
          {/* prominent xP panel */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Projected · next GW
                </div>
                <div className="text-4xl font-extrabold tabular-nums text-purple-900 dark:text-[#00FF87]">
                  {projection.x1.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Next 6 GWs</div>
                <div className="text-3xl font-bold tabular-nums text-purple-800 dark:text-[#00FF87]/80">
                  {projection.x6.toFixed(1)}
                </div>
              </div>
              <div className="ml-auto text-right text-xs text-zinc-500">
                {projection.captainBonus1 > 0 ? (
                  <p>
                    <span className="font-semibold text-purple-800 dark:text-[#00FF87]">
                      +{projection.captainBonus1.toFixed(1)}
                    </span>{" "}
                    armband bonus{captainName ? ` · C ${captainName}` : ""}
                  </p>
                ) : (
                  <p>Pick a captain to add the armband bonus</p>
                )}
                {projection.missing > 0 && (
                  <p className="mt-1 text-amber-700 dark:text-amber-400">
                    {projection.missing} pick{projection.missing === 1 ? "" : "s"} without an xP
                    projection
                  </p>
                )}
              </div>
            </div>
          </div>

          <PitchView
            squad={squadCards}
            quota={rules.positionQuota}
            header={pitchHeader}
            onSetCaptain={(id) => persist(setCaptain(team, id))}
            onSetVice={(id) => persist(setViceCaptain(team, id))}
            onRemove={(id) => persist(removePlayer(team, id))}
          />
        </section>

        {/* ========================================== selector column */}
        <section className="space-y-4">
          {/* optimizer */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Optimise squad
            </h2>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-zinc-500">Horizon</span>
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value) as Horizon)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
                >
                  {HORIZONS.map((h) => (
                    <option key={h} value={h}>
                      {h} GW
                    </option>
                  ))}
                </select>
              </label>
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
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
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
                onClick={() => runOptimizer(false)}
                className="flex-1 rounded-md bg-purple-950 px-3 py-1.5 font-medium text-white transition-colors hover:bg-purple-800 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
              >
                Fill remaining
              </button>
              <button
                onClick={() => runOptimizer(true)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
              >
                Rebuild
              </button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              {optimizeNote ??
                "Existing picks are kept — “Fill remaining” optimises around them, “Rebuild” starts from an empty squad."}
            </p>
          </div>

          {/* player search */}
          <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                value={search}
                onChange={(e) => changeFilter(setSearch)(e.target.value)}
                placeholder="Search player…"
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus:border-[#00FF87]"
              />
              <select
                value={position}
                onChange={(e) => changeFilter(setPosition)(Number(e.target.value))}
                className="rounded-md border border-zinc-300 bg-white px-1.5 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
              >
                <option value={0}>All pos</option>
                {Object.entries(POSITIONS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={teamFilter}
                onChange={(e) => changeFilter(setTeamFilter)(Number(e.target.value))}
                className="rounded-md border border-zinc-300 bg-white px-1.5 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
              >
                <option value={0}>All teams</option>
                {[...teamShort.entries()]
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([id, short]) => (
                    <option key={id} value={id}>
                      {short}
                    </option>
                  ))}
              </select>
              <select
                value={sortKey}
                onChange={(e) => changeFilter(setSortKey)(e.target.value as SortKey)}
                className="rounded-md border border-zinc-300 bg-white px-1.5 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
              >
                <option value="xp6">xP 6</option>
                <option value="xp1">xP GW</option>
                <option value="price">Price</option>
                <option value="ownership">Owned</option>
              </select>
            </div>

            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                    <th className="py-1.5 pl-1">Player</th>
                    <th className="py-1.5">£</th>
                    <th className="py-1.5">GW</th>
                    <th className="py-1.5">6</th>
                    <th className="py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const meta = metaById.get(p.id)!;
                    const reason = blockedReason(team, rules, meta, lookup);
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200"
                      >
                        <td className="py-1 pl-1">
                          <span className="flex items-center gap-1">
                            <span className="truncate font-medium">{p.web_name}</span>
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
                          <span className="text-[10px] text-zinc-500">
                            {teamShort.get(p.team_id)} · {POSITIONS[p.element_type]}
                          </span>
                        </td>
                        <td className="py-1 tabular-nums">{((p.now_cost ?? 0) / 10).toFixed(1)}</td>
                        <td className="py-1 font-semibold tabular-nums text-purple-800 dark:text-[#00FF87]">
                          {xp.get(p.id)?.xp_1?.toFixed(1) ?? "—"}
                        </td>
                        <td className="py-1 tabular-nums">
                          {xp.get(p.id)?.xp_6?.toFixed(1) ?? "—"}
                        </td>
                        <td className="py-1 pr-1 text-right">
                          <button
                            disabled={reason !== null}
                            title={reason ?? `Add ${p.web_name}`}
                            onClick={() => persist(addPlayer(team, meta))}
                            className="rounded border border-zinc-300 px-1.5 py-0.5 font-medium transition-colors hover:border-purple-700 hover:text-purple-700 disabled:cursor-not-allowed disabled:opacity-35 dark:border-purple-800/50 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
                          >
                            +
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-zinc-500">
                        No players match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* pager */}
            <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 text-xs dark:border-purple-900/30">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="rounded border border-zinc-300 px-2 py-0.5 transition-colors hover:bg-zinc-100 disabled:opacity-35 dark:border-purple-800/50 dark:hover:bg-purple-950/60"
              >
                ‹ Prev
              </button>
              <span className="text-zinc-500">
                Page {safePage + 1} of {pageCount} · {filtered.length} player
                {filtered.length === 1 ? "" : "s"}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="rounded border border-zinc-300 px-2 py-0.5 transition-colors hover:bg-zinc-100 disabled:opacity-35 dark:border-purple-800/50 dark:hover:bg-purple-950/60"
              >
                Next ›
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
