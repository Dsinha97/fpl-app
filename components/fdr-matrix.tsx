"use client";

import { useMemo, useState } from "react";
import { averageFdr, fdrTheme, fixtureCellsByTeam, type FdrCell, type FdrRating } from "@/lib/fdr";
import { FDRBadge, FixtureCell } from "./fdr-badge";

export interface MatrixFixture {
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_difficulty: number | null;
  team_a_difficulty: number | null;
}

export interface MatrixTeam {
  id: number;
  name: string;
  short_name: string;
  /** FPL's own league position — 0 for every team pre-season, since FPL publishes no table until GW1 is scored. */
  position?: number | null;
}

/** Column counts for the matrix — a window width, not an xP horizon. */
const HORIZONS = [5, 8, 10, 38] as const;

type SortOrder = "position" | "az" | "easiest" | "hardest";

const SORT_LABELS: Record<SortOrder, string> = {
  position: "Table position",
  az: "Team A–Z",
  easiest: "Easiest run",
  hardest: "Hardest run",
};

export function FdrMatrix({
  teams,
  fixtures,
  nextGw,
}: {
  teams: MatrixTeam[];
  fixtures: MatrixFixture[];
  nextGw: number | null;
}) {
  const [horizon, setHorizon] = useState<number>(8);
  const [sort, setSort] = useState<SortOrder>("easiest");
  const [search, setSearch] = useState("");

  // Every position reads 0 pre-season (FPL publishes no table until GW1 is
  // scored) — sorting by it would just be "sorted by zero, tie-broken by
  // whatever order the query returned", not a real standing. Disabled with
  // an explanation rather than silently letting the option no-op.
  const positionsKnown = teams.some((t) => (t.position ?? 0) > 0);

  const { gwCols, byTeam } = useMemo(
    () => fixtureCellsByTeam(teams, fixtures, nextGw, horizon),
    [teams, fixtures, nextGw, horizon],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? teams.filter(
          (t) => t.name.toLowerCase().includes(term) || t.short_name.toLowerCase().includes(term),
        )
      : teams;

    const withAvg = filtered.map((team) => ({
      team,
      cells: byTeam.get(team.id) ?? new Map<number, FdrCell[]>(),
      avg: averageFdr(byTeam, team.id, gwCols),
    }));

    switch (sort) {
      case "position":
        return withAvg.sort((a, b) => (a.team.position ?? 99) - (b.team.position ?? 99));
      case "az":
        return withAvg.sort((a, b) => a.team.name.localeCompare(b.team.name));
      case "hardest":
        return withAvg.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
      case "easiest":
      default:
        return withAvg.sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99));
    }
  }, [teams, byTeam, gwCols, sort, search]);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          {sort === "easiest" && `Sorted easiest ${horizon === 38 ? "season" : `${horizon}-GW`} run first`}
          {sort === "hardest" && `Sorted hardest ${horizon === 38 ? "season" : `${horizon}-GW`} run first`}
          {sort === "az" && "Sorted A–Z"}
          {sort === "position" && "Sorted by table position"}
          {" · green ring = home, red ring = away"}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Window</span>
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              aria-pressed={horizon === h}
              className={`rounded-md border px-2.5 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                horizon === h
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-input text-muted-foreground hover:bg-muted"
              }`}
            >
              {h === 38 ? "All" : `${h} GWs`}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search team…"
          className="w-40 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
        />
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOrder)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
          >
            {(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => (
              <option key={s} value={s} disabled={s === "position" && !positionsKnown}>
                {SORT_LABELS[s]}
                {s === "position" && !positionsKnown ? " (not published yet)" : ""}
              </option>
            ))}
          </select>
        </label>
        {sort === "position" && !positionsKnown && (
          <span className="text-xs text-zinc-500">
            FPL hasn&apos;t published table positions yet — showing GW1 order instead.
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        <span className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(fdrTheme) as unknown as FdrRating[]).map((r) => (
            <FDRBadge key={r} rating={Number(r) as FdrRating} showLabel />
          ))}
        </span>
        <span className="flex items-center gap-3 text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-zinc-300 ring-2 ring-green-400 ring-offset-1 ring-offset-white dark:bg-purple-900 dark:ring-offset-[#1E0234]" />
            home
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-zinc-300 ring-2 ring-red-400 ring-offset-1 ring-offset-white dark:bg-purple-900 dark:ring-offset-[#1E0234]" />
            away
          </span>
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]">
        <table className="w-full min-w-[36rem] border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
              <th className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-[#1E0234]">Team</th>
              <th className="px-2 py-2 text-center">Avg</th>
              {gwCols.map((g) => (
                <th key={g} className="px-1 py-2 text-center">
                  GW{g}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, cells, avg }) => (
              <tr
                key={team.id}
                className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30"
              >
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-zinc-800 dark:bg-[#1E0234] dark:text-zinc-200">
                  {team.short_name}
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums text-zinc-500">
                  {avg !== null ? avg.toFixed(1) : "—"}
                </td>
                {gwCols.map((g) => {
                  const cellFixtures = cells.get(g) ?? [];
                  return (
                    <td key={g} className="px-1 py-1.5 text-center">
                      {cellFixtures.length === 0 ? (
                        <span
                          className="block rounded bg-zinc-100 px-1 py-1 text-zinc-400 dark:bg-[#2A0A45] dark:text-zinc-600"
                          title={`GW${g}: blank — no fixture`}
                        >
                          —
                        </span>
                      ) : (
                        <span className="flex flex-col items-center gap-1">
                          {cellFixtures.map((c, i) => (
                            <FixtureCell
                              key={i}
                              opponent={c.opp}
                              home={c.home}
                              fdr={c.fdr}
                              gw={g}
                              team={team.short_name}
                              className="w-full"
                            />
                          ))}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={gwCols.length + 2} className="px-3 py-6 text-center text-zinc-500">
                  No team matches &quot;{search}&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-zinc-400">
        Uses the official FPL difficulty rating for now. A custom analytical FDR is no longer
        blocked on missing data — FPL now publishes an overall home/away strength for every club —
        it just hasn’t been built.
      </p>
    </>
  );
}
