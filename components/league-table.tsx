"use client";

import { useMemo } from "react";
import { TeamCrest } from "./identity";
import { FixtureCell } from "./fdr-badge";
import { fixtureCellsByTeam, type FdrFixtureRef, type FdrTeamRef } from "@/lib/fdr";

const NEXT_N = 5;

export interface StandingsTeam extends FdrTeamRef {
  code: number;
  name: string;
  position: number | null;
  played: number | null;
  win: number | null;
  draw: number | null;
  loss: number | null;
  points: number | null;
  form: string | null;
}

export function LeagueTable({
  teams,
  fixtures,
  nextGw,
}: {
  teams: StandingsTeam[];
  fixtures: FdrFixtureRef[];
  nextGw: number | null;
}) {
  // FPL zeroes position/played/W/D/L/points and leaves form null until GW1
  // is scored (verified 2026-08-21, live DB) — a table of zeros sorted by
  // "position" would just be arbitrary, so this falls back to name order and
  // says so, rather than presenting a fake standing.
  const prePublished = teams.every((t) => (t.played ?? 0) === 0);

  const { gwCols, byTeam } = useMemo(
    () => fixtureCellsByTeam(teams, fixtures, nextGw, NEXT_N),
    [teams, fixtures, nextGw],
  );

  const rows = useMemo(() => {
    return [...teams].sort((a, b) =>
      prePublished
        ? a.name.localeCompare(b.name)
        : (a.position ?? 99) - (b.position ?? 99),
    );
  }, [teams, prePublished]);

  return (
    <div className="mt-4">
      {prePublished && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Gameweek 1 hasn&apos;t been scored yet, so FPL has published no table — every row
          reads 0. Listed alphabetically below until real standings exist.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
              <th className="sticky left-0 z-10 bg-white px-2 py-2 text-center dark:bg-[#1E0234]">#</th>
              <th className="sticky left-8 z-10 bg-white px-2 py-2 dark:bg-[#1E0234]">Team</th>
              <th className="px-2 py-2 text-center">P</th>
              <th className="px-2 py-2 text-center">W</th>
              <th className="px-2 py-2 text-center">D</th>
              <th className="px-2 py-2 text-center">L</th>
              <th className="px-2 py-2 text-center">Pts</th>
              <th className="px-2 py-2 text-center">Form</th>
              {gwCols.map((g) => (
                <th key={g} className="px-1 py-2 text-center">
                  GW{g}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((team, i) => {
              const cells = byTeam.get(team.id) ?? new Map();
              return (
                <tr
                  key={team.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30"
                >
                  <td className="sticky left-0 z-10 bg-white px-2 py-1.5 text-center tabular-nums text-zinc-500 dark:bg-[#1E0234]">
                    {prePublished ? "—" : (team.position ?? i + 1)}
                  </td>
                  <td className="sticky left-8 z-10 flex items-center gap-1.5 whitespace-nowrap bg-white px-2 py-1.5 font-medium text-zinc-800 dark:bg-[#1E0234] dark:text-zinc-200">
                    <TeamCrest teamCode={team.code} shortName={team.short_name} className="h-4 w-4 shrink-0" />
                    {team.name}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-zinc-600 dark:text-zinc-400">
                    {team.played ?? 0}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-zinc-600 dark:text-zinc-400">
                    {team.win ?? 0}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-zinc-600 dark:text-zinc-400">
                    {team.draw ?? 0}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-zinc-600 dark:text-zinc-400">
                    {team.loss ?? 0}
                  </td>
                  <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {team.points ?? 0}
                  </td>
                  <td className="px-2 py-1.5 text-center text-zinc-500">{team.form ?? "—"}</td>
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
                            {cellFixtures.map(
                              (c: { opp: string; home: boolean; fdr: number }, ci: number) => (
                                <FixtureCell
                                  key={ci}
                                  opponent={c.opp}
                                  home={c.home}
                                  fdr={c.fdr}
                                  gw={g}
                                  team={team.short_name}
                                  className="w-full"
                                />
                              ),
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-zinc-400">
        Rows follow FPL&apos;s own published table once it exists. Next-{NEXT_N} chips use the
        same official difficulty rating as the FDR tab.
      </p>
    </div>
  );
}
