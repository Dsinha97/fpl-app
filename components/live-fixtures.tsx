"use client";

import { useState } from "react";
import { ExpandToggle } from "@/components/ui/expand-toggle";
import { TeamCrest } from "./identity";
import {
  DISPLAY_STAT_ORDER,
  hasFixtureStats,
  parseFixtureStats,
  STAT_LABELS,
  type FixtureStatLine,
} from "@/lib/fixture-stats";

export interface LiveFixtureTeam {
  id: number;
  code: number | null;
  name: string;
  short_name: string;
}

export interface LiveFixturePlayer {
  webName: string;
  teamId: number;
}

export interface LiveFixtureData {
  id: number;
  event: number | null;
  kickoff_time: string | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  started: boolean | null;
  finished: boolean | null;
  /** FPL's own "bonus confirmed" flag — a match can be `finished` with bonus still provisional. */
  finished_provisional: boolean | null;
  minutes: number | null;
  stats: unknown;
}

export type MatchStatus = "not_started" | "live" | "finished_provisional" | "finished";

/**
 * `finished` and `finished_provisional` are separate FPL flags — a match can
 * be full time with bonus points not yet confirmed, so "finished" on its own
 * isn't enough to say the result (and its bonus) is settled. Shared by the
 * live hub card and the /fixtures schedule row so the two screens never
 * disagree about what a given fixture's state means.
 */
export function matchStatus(fixture: Pick<LiveFixtureData, "started" | "finished" | "finished_provisional">): MatchStatus {
  if (fixture.finished === true) return "finished";
  if (fixture.finished_provisional === true) return "finished_provisional";
  if (fixture.started === true) return "live";
  return "not_started";
}

const showValue = (identifier: string, value: number) =>
  (identifier === "goals_scored" || identifier === "assists" || identifier === "bonus") && value > 1;

interface FixtureStatBreakdownProps {
  stats: Map<string, FixtureStatLine>;
  playersById: Map<number, LiveFixturePlayer>;
  /** Squad players get the accent treatment and an "(in your squad)" tag — omitted on the
   *  squad-agnostic /fixtures mount. */
  squadElementIds?: Set<number>;
  /** Bonus is provisional until FPL confirms it post-match. */
  provisional: boolean;
}

/**
 * Goals / assists / cards / bonus for one fixture, parsed from fixtures.stats
 * (lib/fixture-stats.ts). Shared by the live hub's per-fixture card
 * (LiveFixtureCard, squad-aware) and /fixtures' expandable schedule row
 * (squad-agnostic) — one implementation, not two readings of the same jsonb.
 */
export function FixtureStatBreakdown({
  stats,
  playersById,
  squadElementIds,
  provisional,
}: FixtureStatBreakdownProps) {
  const lines = DISPLAY_STAT_ORDER
    .map((id) => ({ id, line: stats.get(id) }))
    .filter(
      (x): x is { id: (typeof DISPLAY_STAT_ORDER)[number]; line: FixtureStatLine } =>
        x.line !== undefined && (x.line.h.length > 0 || x.line.a.length > 0),
    );

  if (lines.length === 0) {
    return <p className="text-xs text-zinc-500">No match events yet.</p>;
  }

  const nameOf = (element: number) => playersById.get(element)?.webName ?? `#${element}`;
  const inSquad = (element: number) => squadElementIds?.has(element) ?? false;

  const side = (entries: FixtureStatLine["h"], identifier: string) =>
    entries.length === 0 ? (
      <li className="text-zinc-400">—</li>
    ) : (
      entries.map((e) => (
        <li
          key={e.element}
          className={
            inSquad(e.element)
              ? "font-medium text-emerald-700 dark:text-primary"
              : "text-zinc-700 dark:text-zinc-300"
          }
        >
          {nameOf(e.element)}
          {showValue(identifier, e.value) ? ` (${e.value})` : ""}
          {inSquad(e.element) ? " (in your squad)" : ""}
        </li>
      ))
    );

  return (
    <div className="space-y-3">
      {lines.map(({ id, line }) => (
        <div key={id}>
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            <span aria-hidden="true">{STAT_LABELS[id].icon}</span> {STAT_LABELS[id].label}
            {id === "bonus" && provisional && (
              <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] normal-case text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                provisional
              </span>
            )}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-3 text-sm">
            <ul className="space-y-0.5 text-right">{side(line.h, id)}</ul>
            <ul className="space-y-0.5">{side(line.a, id)}</ul>
          </div>
        </div>
      ))}
    </div>
  );
}

interface LiveFixtureCardProps {
  fixture: LiveFixtureData;
  teams: Map<number, LiveFixtureTeam>;
  playersById: Map<number, LiveFixturePlayer>;
  squadElementIds?: Set<number>;
}

/**
 * A full match card — badges, score, LIVE state, and the event breakdown —
 * for the squad's own fixture(s) on /deadline's live hub.
 */
export function LiveFixtureCard({ fixture, teams, playersById, squadElementIds }: LiveFixtureCardProps) {
  const [expanded, setExpanded] = useState(false);
  const home = teams.get(fixture.team_h);
  const away = teams.get(fixture.team_a);
  const stats = parseFixtureStats(fixture.stats);
  const hasScore = fixture.team_h_score !== null && fixture.team_a_score !== null;
  const expandable = hasFixtureStats(stats);

  // Three states, not two: `finished` alone doesn't mean bonus is settled —
  // FPL confirms bonus separately via `finished_provisional`, so a match can
  // read full time with the Bonus row still marked provisional.
  const status = matchStatus(fixture);
  const live = status === "live";
  const provisionalBonus = status !== "finished";

  const scoreRow = (
    <div className="mt-2 flex items-center justify-center gap-3">
      {/* Short codes (ARS, COV), not full club names — a full name in a
          `sm:w-[calc(50%-0.375rem)]` card truncated unpredictably and shifted
          the crest/score layout depending on name length. The short_name is
          already on LiveFixtureTeam; the full name lives on `title` for a
          hover/long-press hint. */}
      <div className="flex items-center justify-end gap-2">
        <span
          title={home?.name}
          className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          {home?.short_name ?? "—"}
        </span>
        <TeamCrest teamCode={home?.code} shortName={home?.short_name} className="h-7 w-6" />
      </div>
      <span className="shrink-0 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
        {hasScore ? `${fixture.team_h_score} – ${fixture.team_a_score}` : "vs"}
      </span>
      <div className="flex items-center gap-2">
        <TeamCrest teamCode={away?.code} shortName={away?.short_name} className="h-7 w-6" />
        <span
          title={away?.name}
          className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          {away?.short_name ?? "—"}
        </span>
      </div>
      {expandable && <ExpandToggle expanded={expanded} interactive={false} size="sm" />}
    </div>
  );

  return (
    <div className="w-full self-start rounded-lg border border-zinc-200 bg-white p-3 dark:border-purple-900/40 dark:bg-[#1E0234] sm:w-[calc(50%-0.375rem)]">
      {live && (
        <span className="flex w-fit items-center gap-1.5 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />
          Live{fixture.minutes !== null ? ` · ${fixture.minutes}′` : ""}
        </span>
      )}
      {status === "finished_provisional" && (
        <span className="flex w-fit items-center gap-1.5 rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          FT · bonus provisional
        </span>
      )}
      {status === "finished" && (
        <span className="flex w-fit items-center gap-1.5 rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          FT
        </span>
      )}
      {expandable ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="w-full text-left"
        >
          {scoreRow}
        </button>
      ) : (
        scoreRow
      )}
      {/* CSS Grid 0fr→1fr rather than mount/unmount (Sprint 24) — see
          CollapsibleCard's identical pattern for why. `FixtureStatBreakdown`
          does no side-effecting work, so mounting it while collapsed costs
          nothing. */}
      {expandable && (
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-purple-900/40">
              <FixtureStatBreakdown
                stats={stats}
                playersById={playersById}
                squadElementIds={squadElementIds}
                provisional={provisionalBonus}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
