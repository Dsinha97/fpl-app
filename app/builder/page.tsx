"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import { cloneDraft, deleteDraft, listDrafts, saveDraft } from "@/lib/drafts";
import {
  addPlayer,
  blockedReason,
  DEFAULT_RULES,
  emptyTeamState,
  removePlayer,
  setCaptain,
  setViceCaptain,
  validateSquad,
  type PlayerMeta,
  type SquadRules,
  type TeamState,
} from "@/lib/team-state";

interface PlayerRow {
  id: number;
  web_name: string;
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
}

interface XpRow {
  player_id: number;
  xp_1: number | null;
  xp_6: number | null;
}

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
const POSITION_LABELS: Record<number, string> = {
  1: "Goalkeepers",
  2: "Defenders",
  3: "Midfielders",
  4: "Forwards",
};

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

type SortKey = "xp6" | "xp1" | "price" | "ownership";

export default function BuilderPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [teamShort, setTeamShort] = useState<Map<number, string>>(new Map());
  const [xp, setXp] = useState<Map<number, XpRow>>(new Map());
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

        const [playersRes, teamsRes, typesRes, settingsRes, xpRes] = await Promise.all([
          supabase
            .from("players")
            .select(
              "id, web_name, team_id, element_type, now_cost, selected_by_percent, status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order",
            )
            .eq("season", gw.season)
            .limit(1000),
          supabase.from("teams").select("id, short_name").eq("season", gw.season),
          supabase
            .from("element_types")
            .select("id, squad_select")
            .eq("season", gw.season),
          supabase
            .from("game_settings")
            .select("key, value")
            .eq("season", gw.season)
            .in("key", ["squad_total_spend", "squad_team_limit", "squad_squadsize"]),
          supabase
            .from("player_xp_horizons")
            .select("player_id, xp_1, xp_6")
            .eq("season", gw.season)
            .limit(1000),
        ]);
        if (playersRes.error) throw new Error(playersRes.error.message);
        if (teamsRes.error) throw new Error(teamsRes.error.message);

        // Squad rules come from the database, never hardcoded — FPL has
        // changed budget and squad size between seasons.
        const settings = new Map(
          (settingsRes.data ?? []).map((s) => [s.key as string, Number(s.value)]),
        );
        const quota: Record<number, number> = {};
        for (const t of typesRes.data ?? []) {
          quota[t.id as number] = Number(t.squad_select ?? 0);
        }
        const loadedRules: SquadRules = {
          totalSpend: settings.get("squad_total_spend") ?? DEFAULT_RULES.totalSpend,
          teamLimit: settings.get("squad_team_limit") ?? DEFAULT_RULES.teamLimit,
          squadSize: settings.get("squad_squadsize") ?? DEFAULT_RULES.squadSize,
          positionQuota:
            Object.keys(quota).length > 0 ? quota : DEFAULT_RULES.positionQuota,
        };

        setPlayers((playersRes.data ?? []) as PlayerRow[]);
        setTeamShort(
          new Map((teamsRes.data ?? []).map((t) => [t.id as number, t.short_name as string])),
        );
        setXp(new Map(((xpRes.data ?? []) as XpRow[]).map((r) => [r.player_id, r])));
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
  const rowById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const validation = useMemo(
    () => validateSquad(team, rules, lookup),
    [team, rules, lookup],
  );

  const projection = useMemo(() => {
    let x1 = 0;
    let x6 = 0;
    let missing = 0;
    for (const pick of team.players) {
      const row = xp.get(pick.playerId);
      if (!row || row.xp_1 === null) missing++;
      x1 += row?.xp_1 ?? 0;
      x6 += row?.xp_6 ?? 0;
    }
    return { x1, x6, missing };
  }, [team.players, xp]);

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

  const onNew = () => {
    persist(emptyTeamState(rules));
  };

  const onClone = () => {
    const copy = cloneDraft(team);
    setTeam(copy);
    setDrafts(listDrafts());
    setSaved("Cloned");
  };

  const onDelete = () => {
    deleteDraft(team.draftId);
    const rest = listDrafts();
    setDrafts(rest);
    setTeam(rest[0] ?? emptyTeamState(rules));
    setSaved(null);
  };

  // -------------------------------------------------------- filtering

  const candidates = useMemo(() => {
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

    rows.sort((a, b) => value(b) - value(a));
    return rows.slice(0, 60);
  }, [players, xp, search, position, teamFilter, sortKey]);

  const picked = useMemo(
    () =>
      team.players
        .map((pick) => ({ pick, row: rowById.get(pick.playerId) }))
        .filter((x): x is { pick: typeof x.pick; row: PlayerRow } => x.row !== undefined),
    [team.players, rowById],
  );

  // ------------------------------------------------------------- view

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <p className="text-sm text-zinc-500">Loading player pool…</p>
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

  const check = (ok: boolean) => (ok ? "✓" : "○");
  const checkClass = (ok: boolean) =>
    ok ? "text-emerald-600 dark:text-[#00FF87]" : "text-zinc-400 dark:text-zinc-500";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Team Builder
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Build a legal squad and project it with the xP model. Drafts are saved in this
            browser.
          </p>
        </div>

        {/* ----------------------------------------------- drafts bar */}
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
            className="w-40 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus:border-[#00FF87]"
          />
          <button
            onClick={onSave}
            className="rounded-md bg-purple-950 px-3 py-1.5 font-medium text-white transition-colors hover:bg-purple-800 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
          >
            Save
          </button>
          {[
            { label: "New", fn: onNew },
            { label: "Clone", fn: onClone },
            { label: "Delete", fn: onDelete },
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

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* ================================================== search */}
        <section>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player…"
              className="w-44 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus:border-[#00FF87]"
            />
            <select
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
            >
              <option value={0}>All positions</option>
              {Object.entries(POSITIONS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(Number(e.target.value))}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
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
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
            >
              <option value="xp6">Sort: xP next 6</option>
              <option value="xp1">Sort: xP next GW</option>
              <option value="price">Sort: price</option>
              <option value="ownership">Sort: ownership</option>
            </select>
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                  <th className="px-3 py-2">Player</th>
                  <th className="px-2 py-2">Team</th>
                  <th className="px-2 py-2">Pos</th>
                  <th className="px-2 py-2">Price</th>
                  <th className="px-2 py-2">xP GW</th>
                  <th className="px-2 py-2">xP 6</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((p) => {
                  const meta = metaById.get(p.id)!;
                  const reason = blockedReason(team, rules, meta, lookup);
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200"
                    >
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium">{p.web_name}</span>
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
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-zinc-500">{teamShort.get(p.team_id)}</td>
                      <td className="px-2 py-1.5 text-zinc-500">{POSITIONS[p.element_type]}</td>
                      <td className="px-2 py-1.5 tabular-nums">{money(p.now_cost ?? 0)}</td>
                      <td className="px-2 py-1.5 font-semibold tabular-nums text-purple-800 dark:text-[#00FF87]">
                        {xp.get(p.id)?.xp_1?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {xp.get(p.id)?.xp_6?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          disabled={reason !== null}
                          title={reason ?? `Add ${p.web_name}`}
                          onClick={() => persist(addPlayer(team, meta))}
                          className="rounded border border-zinc-300 px-2 py-0.5 text-xs font-medium transition-colors hover:border-purple-700 hover:text-purple-700 disabled:cursor-not-allowed disabled:opacity-35 dark:border-purple-800/50 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
                        >
                          Add
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* =================================================== squad */}
        <section className="space-y-4">
          {/* budget + projection */}
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-zinc-500">Budget</span>
              <span
                className={`font-semibold tabular-nums ${
                  validation.overBudget ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100"
                }`}
              >
                {money(validation.budgetRemaining)} left
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-[#2A0A45]">
              <div
                className={`h-full rounded-full transition-all ${
                  validation.overBudget ? "bg-red-500" : "bg-purple-800 dark:bg-[#00FF87]"
                }`}
                style={{
                  width: `${Math.min(100, (validation.spent / rules.totalSpend) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {money(validation.spent)} of {money(rules.totalSpend)} spent ·{" "}
              {team.players.length}/{rules.squadSize} players
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-3 dark:border-purple-900/30">
              <div>
                <div className="text-xs text-zinc-500">Squad xP · next GW</div>
                <div className="text-lg font-semibold text-purple-900 dark:text-[#00FF87]">
                  {projection.x1.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Squad xP · next 6</div>
                <div className="text-lg font-semibold text-purple-900 dark:text-[#00FF87]">
                  {projection.x6.toFixed(1)}
                </div>
              </div>
            </div>
            {projection.missing > 0 && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                {projection.missing} pick{projection.missing === 1 ? "" : "s"} have no xP — the
                model needs prior-season minutes, so new signings and promoted-club players are
                excluded.
              </p>
            )}
          </div>

          {/* validation checklist */}
          <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Squad validity
            </h2>
            <ul className="mt-2 space-y-1">
              {validation.positions.map((p) => (
                <li key={p.elementType} className="flex items-center gap-2">
                  <span className={checkClass(p.filled === p.required)}>
                    {check(p.filled === p.required)}
                  </span>
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {POSITIONS[p.elementType]} {p.filled} / {p.required}
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span className={checkClass(!validation.overBudget)}>
                  {check(!validation.overBudget)}
                </span>
                <span className="text-zinc-700 dark:text-zinc-300">Within budget</span>
              </li>
              <li className="flex items-center gap-2">
                <span className={checkClass(validation.clubsValid)}>
                  {check(validation.clubsValid)}
                </span>
                <span className="text-zinc-700 dark:text-zinc-300">
                  Max {rules.teamLimit} per club
                  {validation.clubBreaches.length > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {" "}
                      — {validation.clubBreaches
                        .map((b) => `${teamShort.get(b.teamId) ?? b.teamId} (${b.count})`)
                        .join(", ")}
                    </span>
                  )}
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className={checkClass(validation.hasCaptain)}>
                  {check(validation.hasCaptain)}
                </span>
                <span className="text-zinc-700 dark:text-zinc-300">Captain selected</span>
              </li>
              <li className="flex items-center gap-2">
                <span className={checkClass(validation.hasViceCaptain)}>
                  {check(validation.hasViceCaptain)}
                </span>
                <span className="text-zinc-700 dark:text-zinc-300">Vice-captain selected</span>
              </li>
            </ul>
            <p
              className={`mt-3 rounded px-2 py-1 text-center text-xs font-medium ${
                validation.isLegal
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-[#00FF87]"
                  : "bg-zinc-100 text-zinc-600 dark:bg-[#2A0A45] dark:text-zinc-400"
              }`}
            >
              {validation.isLegal ? "Legal squad" : "Squad incomplete"}
            </p>
          </div>

          {/* picks */}
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Squad</h2>
            {picked.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">
                No players yet — add them from the list on the left.
              </p>
            ) : (
              <div className="mt-2 space-y-3">
                {[1, 2, 3, 4].map((type) => {
                  const rows = picked.filter((x) => x.row.element_type === type);
                  if (rows.length === 0) return null;
                  return (
                    <div key={type}>
                      <h3 className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                        {POSITION_LABELS[type]}
                      </h3>
                      <ul className="mt-1 space-y-1">
                        {rows.map(({ pick, row }) => (
                          <li
                            key={pick.playerId}
                            className="flex items-center justify-between gap-2 text-sm text-zinc-800 dark:text-zinc-200"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium">{row.web_name}</span>
                              <AvailabilityBadge
                                status={row.status}
                                chanceOfPlaying={row.chance_of_playing_next_round}
                                news={row.news}
                              />
                              <span className="shrink-0 text-xs text-zinc-500">
                                {teamShort.get(row.team_id)}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <span className="tabular-nums text-xs text-zinc-500">
                                {money(pick.purchasePrice)}
                              </span>
                              <button
                                title="Set as captain"
                                onClick={() => persist(setCaptain(team, pick.playerId))}
                                className={`h-5 w-5 rounded text-xs font-bold transition-colors ${
                                  team.captain === pick.playerId
                                    ? "bg-purple-950 text-white dark:bg-[#00FF87] dark:text-slate-950"
                                    : "border border-zinc-300 text-zinc-500 hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/50 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
                                }`}
                              >
                                C
                              </button>
                              <button
                                title="Set as vice-captain"
                                onClick={() => persist(setViceCaptain(team, pick.playerId))}
                                className={`h-5 w-5 rounded text-xs font-bold transition-colors ${
                                  team.viceCaptain === pick.playerId
                                    ? "bg-purple-800 text-white dark:bg-[#00FF87]/70 dark:text-slate-950"
                                    : "border border-zinc-300 text-zinc-500 hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/50 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
                                }`}
                              >
                                V
                              </button>
                              <button
                                title={`Remove ${row.web_name}`}
                                onClick={() => persist(removePlayer(team, pick.playerId))}
                                className="h-5 w-5 rounded border border-zinc-300 text-xs text-zinc-500 transition-colors hover:border-red-500 hover:text-red-500 dark:border-purple-800/50"
                              >
                                ×
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-xs text-zinc-400">
            Automatic squad optimisation, starting XI, and bench ordering arrive in the next
            sprints. This sprint covers manual building, validation, and projection.
          </p>
        </section>
      </div>
    </main>
  );
}
