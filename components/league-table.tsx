"use client";

import { useMemo } from "react";
import { TeamCrest } from "./identity";
import { FixtureCell } from "./fdr-badge";
import {
  deriveStandingsFromFixtures,
  fixtureCellsByTeam,
  type FdrTeamRef,
  type StandingsFixtureRef,
} from "@/lib/fdr";
import { Alert } from "@/components/ui/alert";
import { ModelNote } from "@/components/ui/model-note";

const NEXT_N = 5;

/**
 * The sentence that qualifies every P/W/D/L/Pts figure in this table. One
 * constant, two endings — the live variant only differs in whether matches
 * still in play are counted, and retyping the shared 20-word preamble twice is
 * how the two drift apart.
 */
const COMPUTED_STANDINGS_NOTE =
  "FPL's own standings feed doesn't publish P/W/D/L/Pts during the season, so this table is computed from ";
const FORM_NOTE =
  "Form is a plain win/draw/loss tally of the last five results, oldest first — not FPL's own weighted figure.";

/**
 * Last five results as W/D/L pips rather than the raw `WWDLW` string the
 * derivation returns (DSI-127). The string is readable but unscannable down a
 * 20-row column; shape and colour are read at a glance, and colour is never
 * the only channel — the letter stays inside each pip.
 */
function FormRun({ form }: { form: string | null }) {
  if (!form) return <span className="text-zinc-500">—</span>;

  const results = [...form].filter((c) => c === "W" || c === "D" || c === "L");
  if (results.length === 0) return <span className="text-zinc-500">—</span>;

  const tone: Record<string, string> = {
    W: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950",
    D: "bg-zinc-400 text-white dark:bg-zinc-500 dark:text-slate-950",
    L: "bg-rose-700 text-white dark:bg-rose-600 dark:text-white",
  };
  const word: Record<string, string> = { W: "win", D: "draw", L: "loss" };

  return (
    <span
      className="inline-flex items-center justify-center gap-0.5"
      aria-label={`Last ${results.length}, oldest first: ${results.map((r) => word[r]).join(", ")}`}
    >
      {results.map((r, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold leading-none ${tone[r]}`}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

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
  /** Sprint 31. Feeds the FDR matrix's Strength view (see lib/fdr.ts's strengthFdr); the table itself ignores them. */
  strength_overall_home: number | null;
  strength_overall_away: number | null;
}

export function LeagueTable({
  teams,
  fixtures,
  nextGw,
}: {
  teams: StandingsTeam[];
  fixtures: StandingsFixtureRef[];
  nextGw: number | null;
}) {
  // FPL's own teams[].played/win/draw/loss/points/form stay 0/null all
  // season on the live bootstrap-static API — verified 2026-08-30 by
  // fetching it directly against a season with finished gameweeks in
  // `fixtures`. Rather than present a table of zeros (or worse, sort by
  // `position`, which also isn't a real table position — see
  // lib/fdr.ts's deriveStandingsFromFixtures), the table is derived from
  // started fixtures (finished or still live) whenever FPL's own fields are
  // empty.
  const fplPublished = teams.some((t) => (t.played ?? 0) > 0);

  const derived = useMemo(
    () => (fplPublished ? null : deriveStandingsFromFixtures(teams, fixtures)),
    [teams, fixtures, fplPublished],
  );

  const { gwCols, byTeam } = useMemo(
    () => fixtureCellsByTeam(teams, fixtures, nextGw, NEXT_N),
    [teams, fixtures, nextGw],
  );

  const noFixturesStarted =
    derived !== null && [...derived.byTeam.values()].every((d) => d.played === 0);

  const rows = useMemo(() => {
    return [...teams].sort((a, b) => {
      if (fplPublished) return (a.position ?? 99) - (b.position ?? 99);
      if (noFixturesStarted) return a.name.localeCompare(b.name);
      return (derived?.byTeam.get(a.id)?.position ?? 99) - (derived?.byTeam.get(b.id)?.position ?? 99);
    });
  }, [teams, fplPublished, noFixturesStarted, derived]);

  return (
    <div className="mt-4">
      {/* An empty table needs an alert; a computed one needs a caption. These
          were one `tone="warning"` banner carrying both (DSI-127), which made
          the routine case look like a fault and put 40 words above the data.
          The explanation now travels with the table as a muted line, with the
          API background behind the same ModelNote disclosure DSI-129 set as
          the pattern for every other qualified number in the app. */}
      {!fplPublished && noFixturesStarted && (
        <Alert tone="info" className="mb-3">
          No gameweek has kicked off yet, so there&apos;s no table to show. Listed alphabetically
          below until real results exist.
        </Alert>
      )}
      {!fplPublished && !noFixturesStarted && (
        <p className="mb-2 text-xs text-zinc-500">
          Standings computed from {derived?.live ? "match results, including matches in play" : "finished match results"}
          <ModelNote label="Why these standings are computed">
            <span className="block">
              {COMPUTED_STANDINGS_NOTE}
              {derived?.live
                ? "fixture results instead — including matches still being played, so it updates live."
                : "finished fixture results instead."}
            </span>
            <span className="block">{FORM_NOTE}</span>
          </ModelNote>
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-card">
        <table className="w-full min-w-[40rem] border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
              <th className="sticky left-0 z-10 bg-white px-2 py-2 text-center dark:bg-card">#</th>
              <th className="sticky left-8 z-10 bg-white px-2 py-2 dark:bg-card">Team</th>
              <th className="px-2 py-2 text-right">P</th>
              <th className="px-2 py-2 text-right">W</th>
              <th className="px-2 py-2 text-right">D</th>
              <th className="px-2 py-2 text-right">L</th>
              <th className="px-2 py-2 text-right">Pts</th>
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
              const d = derived?.byTeam.get(team.id);
              const played = fplPublished ? (team.played ?? 0) : (d?.played ?? 0);
              const win = fplPublished ? (team.win ?? 0) : (d?.win ?? 0);
              const draw = fplPublished ? (team.draw ?? 0) : (d?.draw ?? 0);
              const loss = fplPublished ? (team.loss ?? 0) : (d?.loss ?? 0);
              const points = fplPublished ? (team.points ?? 0) : (d?.points ?? 0);
              const form = fplPublished ? team.form : (d?.form ?? null);
              const position = fplPublished ? (team.position ?? i + 1) : (d?.position ?? i + 1);
              return (
                <tr
                  key={team.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30"
                >
                  <td className="sticky left-0 z-10 bg-white px-2 py-1.5 text-center tabular-nums text-zinc-500 dark:bg-card">
                    {noFixturesStarted ? "—" : position}
                  </td>
                  <td className="sticky left-8 z-10 flex items-center gap-1.5 whitespace-nowrap bg-white px-2 py-1.5 font-medium text-zinc-800 dark:bg-card dark:text-zinc-200">
                    <TeamCrest teamCode={team.code} shortName={team.short_name} className="h-4 w-4 shrink-0" />
                    {team.name}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {played}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {win}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {draw}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {loss}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {points}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <FormRun form={form} />
                  </td>
                  {gwCols.map((g) => {
                    const cellFixtures = cells.get(g) ?? [];
                    return (
                      <td key={g} className="px-1 py-1.5 text-center">
                        {cellFixtures.length === 0 ? (
                          <span
                            className="block rounded bg-zinc-100 px-1 py-1 text-zinc-400 dark:bg-surface-3 dark:text-zinc-600"
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
