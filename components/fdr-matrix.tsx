"use client";

import { useMemo, useState } from "react";
import { DataCell, DataHeadCell, DataRow } from "@/components/ui/data-table";
import { NoteDisclosure } from "@/components/ui/note-disclosure";
import {
  averageFdr,
  fdrTheme,
  fixtureCellsByTeam,
  STRENGTH_FDR_NOTE,
  type FdrCell,
  type FdrRating,
  venueRing,
  type FdrSource,
} from "@/lib/fdr";
import { FDRBadge, FixtureCell } from "./fdr-badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FilterDisclosure } from "@/components/ui/filter-disclosure";

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
  /** Sprint 31. Optional: without both, the Strength view isn't offered at all. */
  strength_overall_home?: number | null;
  strength_overall_away?: number | null;
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
  // Defaults to FPL's own rating. The strength view is a second opinion, not a
  // replacement — nothing this app ranks or projects uses it (see strengthFdr).
  const [source, setSource] = useState<FdrSource>("official");

  /** How many of the collapsed controls are off their default — the count the
   * "Filter" trigger carries so a left-on filter is never invisible. */
  const activeFilters =
    (search ? 1 : 0) + (sort === "easiest" ? 0 : 1) + (source === "official" ? 0 : 1);

  // Every position reads 0 pre-season (FPL publishes no table until GW1 is
  // scored) — sorting by it would just be "sorted by zero, tie-broken by
  // whatever order the query returned", not a real standing. Disabled with
  // an explanation rather than silently letting the option no-op.
  const positionsKnown = teams.some((t) => (t.position ?? 0) > 0);

  const strengthById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  );
  // Offered only when FPL has actually published strength for someone. It read
  // 0 for all 20 clubs through the whole of pre-season, and a toggle that
  // paints every cell "no rating" is worse than no toggle.
  const strengthKnown = useMemo(
    () =>
      teams.some(
        (t) => (t.strength_overall_home ?? 0) > 0 || (t.strength_overall_away ?? 0) > 0,
      ),
    [teams],
  );

  const { gwCols, byTeam } = useMemo(
    () => fixtureCellsByTeam(teams, fixtures, nextGw, horizon, (id) => strengthById.get(id)),
    [teams, fixtures, nextGw, horizon, strengthById],
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
      avg: averageFdr(byTeam, team.id, gwCols, source),
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
  }, [teams, byTeam, gwCols, sort, search, source]);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          {sort === "easiest" && `Sorted easiest ${horizon === 38 ? "season" : `${horizon}-GW`} run first`}
          {sort === "hardest" && `Sorted hardest ${horizon === 38 ? "season" : `${horizon}-GW`} run first`}
          {sort === "az" && "Sorted A–Z"}
          {sort === "position" && "Sorted by table position"}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Window</span>
          {/* A window is a parameter, not a view, so `radio` rather than `tabs`
              — "tab" would be a lie to a screen reader here. */}
          <SegmentedControl
            label="Fixture window"
            semantics="radio"
            size="sm"
            value={String(horizon)}
            onValueChange={(v) => setHorizon(Number(v) as (typeof HORIZONS)[number])}
            options={HORIZONS.map((h) => ({
              value: String(h),
              label: h === 38 ? "All" : `${h} GWs`,
            }))}
          />
        </div>
      </div>

      {/* DSI-141: search, sort, rating source and a six-swatch legend all
          stacked above the matrix, so on a phone the screen was filters and the
          table began below the fold. Window stays out here — it changes what the
          table *is* — and the rest moves behind the app's one filter disclosure,
          with `activeCount` so a filter left on is never invisible. */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <FilterDisclosure activeCount={activeFilters}>
          <div className="flex flex-col gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team…"
              aria-label="Search team"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-surface-3 dark:text-zinc-100"
            />
            <label className="flex items-center justify-between gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
              Sort
              {/* Stays a select: three options, one of them conditionally
                  disabled with a "(not published yet)" suffix that a segmented
                  control has nowhere to put (DSI-138 decision 2). */}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOrder)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-surface-3 dark:text-zinc-100"
              >
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => (
                  <option key={s} value={s} disabled={s === "position" && !positionsKnown}>
                    {SORT_LABELS[s]}
                    {s === "position" && !positionsKnown ? " (not published yet)" : ""}
                  </option>
                ))}
              </select>
            </label>

            {strengthKnown && (
              <span className="flex items-center justify-between gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                Rating
                {/* DSI-127: these two read as one solid green button beside one
                    dark button, which looks like an action and its disabled twin
                    rather than a binary choice. One segmented switch says "pick
                    a side". */}
                <SegmentedControl
                  label="Difficulty rating source"
                  semantics="radio"
                  size="sm"
                  value={source}
                  onValueChange={(v) => setSource(v as FdrSource)}
                  options={[
                    { value: "official", label: "Official" },
                    { value: "strength", label: "Strength" },
                  ]}
                />
              </span>
            )}

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs">
              <span className="flex flex-wrap items-center gap-1.5">
                {(Object.keys(fdrTheme) as unknown as FdrRating[]).map((r) => (
                  <FDRBadge key={r} rating={Number(r) as FdrRating} showLabel />
                ))}
              </span>
              {/* One swatch, not two: only away is marked now, so a "home"
                  swatch would be a picture of the absence of a thing. */}
              <span className="flex items-center gap-1.5 text-zinc-500">
                <span className={`inline-block h-3 w-3 rounded bg-zinc-300 dark:bg-purple-900 ${venueRing(false)}`} />
                ring = away
              </span>
            </div>
          </div>
        </FilterDisclosure>

        {/* A filter left on inside a closed panel is the trap FilterDisclosure
            exists to avoid, so each non-default choice says so out here too. */}
        {search && <span className="text-xs text-zinc-500">Filtered to &ldquo;{search}&rdquo;</span>}
        {sort === "position" && !positionsKnown && (
          <span className="text-xs text-zinc-500">
            FPL hasn&apos;t published table positions yet — showing GW1 order instead.
          </span>
        )}
        {strengthKnown && source === "strength" && (
          <span className="text-xs text-zinc-500">Rated by club strength</span>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-card">
        <table className="w-full min-w-[36rem] border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
              <DataHeadCell className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-card">Team</DataHeadCell>
              <DataHeadCell className="px-2 py-2 text-center">Avg</DataHeadCell>
              {gwCols.map((g) => (
                <DataHeadCell key={g} className="px-1 py-2 text-center">
                  GW{g}
                </DataHeadCell>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, cells, avg }) => (
              <DataRow key={team.id} className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">
                <DataCell className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-zinc-800 dark:bg-card dark:text-zinc-200">
                  {team.short_name}
                </DataCell>
                <DataCell className="px-2 py-1.5 text-center tabular-nums text-zinc-500">
                  {avg !== null ? avg.toFixed(1) : "—"}
                </DataCell>
                {gwCols.map((g) => {
                  const cellFixtures = cells.get(g) ?? [];
                  return (
                    <DataCell key={g} className="px-1 py-1.5 text-center">
                      {cellFixtures.length === 0 ? (
                        <span
                          className="block rounded bg-zinc-100 px-1 py-1 text-zinc-400 dark:bg-surface-3 dark:text-zinc-600"
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
                              fdr={source === "strength" ? c.strengthFdr : c.fdr}
                              gw={g}
                              team={team.short_name}
                              className="w-full"
                              ratingLabel={source === "strength" ? "Strength FDR" : "FDR"}
                              unratedReason={
                                source === "strength"
                                  ? "no strength published for this opponent"
                                  : undefined
                              }
                            />
                          ))}
                        </span>
                      )}
                    </DataCell>
                  );
                })}
              </DataRow>
            ))}
            {rows.length === 0 && (
              <DataRow>
                <DataCell colSpan={gwCols.length + 2} className="px-3 py-6 text-center text-zinc-500">
                  No team matches &quot;{search}&quot;.
                </DataCell>
              </DataRow>
            )}
          </tbody>
        </table>
      </div>

      {/* The Strength note runs to ~90 words of methodology -- how the rating
          is derived, that it is coarser than its own five-colour ramp, and
          that nothing in the app scores against it. All load-bearing, none of
          it worth reading on the way to the next thing, which is what
          NoteDisclosure is for (DSI-140). The official one is a single line
          and stays plain: collapsing a one-liner adds a click and hides
          nothing. */}
      {source === "official" ? (
        <p className="mt-4 text-xs text-zinc-400">
          Uses FPL&apos;s own published difficulty rating for each fixture.
        </p>
      ) : (
        <NoteDisclosure className="mt-4">{STRENGTH_FDR_NOTE}</NoteDisclosure>
      )}
    </>
  );
}
