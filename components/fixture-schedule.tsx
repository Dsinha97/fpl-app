"use client";

import { useState } from "react";
import { TeamCrest } from "./identity";
import { FixtureStatBreakdown, matchStatus, type LiveFixturePlayer } from "./live-fixtures";
import { hasFixtureStats, parseFixtureStats } from "@/lib/fixture-stats";
import { ExpandToggle } from "@/components/ui/expand-toggle";

export interface ScheduleFixture {
  id: number;
  event: number | null;
  kickoff_time: string | null;
  provisional_start_time: boolean | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  started: boolean | null;
  finished: boolean | null;
  /** FPL's own "bonus confirmed" flag — a match can be `finished` with bonus still provisional. */
  finished_provisional: boolean | null;
  minutes: number | null;
  /** FPL's per-fixture event breakdown, verbatim — see lib/fixture-stats.ts. Optional so a
   *  caller that hasn't fetched it yet (or a fixture with none published) just hides the
   *  expand affordance rather than erroring. */
  stats?: unknown;
}

export interface ScheduleTeam {
  id: number;
  code: number;
  name: string;
  short_name: string;
}

export interface ScheduleGameweek {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
}

/**
 * The viewer's timezone, printed once next to the times.
 *
 * Kickoffs are stored as timestamptz and rendered in local time. Without saying
 * which zone that is, a 07:30 Saturday kickoff reads as a data bug.
 */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local time";
  } catch {
    return "local time";
  }
}

const dayKey = (iso: string) => new Date(iso).toDateString();

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const formatDeadline = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

interface FixtureScheduleProps {
  fixtures: ScheduleFixture[];
  teams: Map<number, ScheduleTeam>;
  gameweeks: ScheduleGameweek[];
  /** The next gameweek, used to decide which sections start open. */
  nextGw: number | null;
  /** Player names for the expandable event breakdown (lib/fixture-stats.ts). Omitted hides
   *  the expand affordance — a caller that hasn't loaded players yet just shows scores. */
  playersById?: Map<number, LiveFixturePlayer>;
}

/**
 * How many upcoming gameweeks start expanded.
 *
 * Pre-season every gameweek is "upcoming", and opening all 38 produced a
 * 21,000px page — 30 screens of scrolling. The next few weeks are what anyone
 * is actually looking at; the rest are one click away.
 */
const OPEN_AHEAD = 2;

export function FixtureSchedule({ fixtures, teams, gameweeks, nextGw, playersById }: FixtureScheduleProps) {
  // The state records deviations from the default, so toggling flips a section.
  const [toggled, setToggled] = useState<Set<number>>(new Set());
  // Snapshotted once at mount (a lazy initialiser, not a render-time call) —
  // this only gates whether an in-progress gameweek should still be forced
  // open, not a live countdown, so it doesn't need a ticking clock.
  const [now] = useState(() => Date.now());

  const byEvent = new Map<number, ScheduleFixture[]>();
  for (const f of fixtures) {
    if (f.event === null) continue;
    if (!byEvent.has(f.event)) byEvent.set(f.event, []);
    byEvent.get(f.event)!.push(f);
  }
  for (const list of byEvent.values()) {
    // Nulls last: an unscheduled fixture has no place in a chronological list.
    list.sort((a, b) => (a.kickoff_time ?? "9").localeCompare(b.kickoff_time ?? "9"));
  }

  const events = [...byEvent.keys()].sort((a, b) => a - b);
  const gwMeta = new Map(gameweeks.map((g) => [g.id, g]));

  /**
   * A gameweek being played wins over the nextGw window below. `nextGw`
   * (gameweeks.is_next) flips to the *following* gameweek the moment its
   * deadline passes — hours before it's actually played — so without this,
   * the gameweek someone is watching live collapses right when it matters.
   * Stops overriding once every fixture is finished, or once the next
   * gameweek's own deadline has passed (whichever the viewer is still
   * checking back for) — matching what "in progress" should mean, not just
   * "has a kickoff time in the past".
   */
  const inProgress = (event: number): boolean => {
    const list = byEvent.get(event) ?? [];
    if (list.length === 0) return false;
    const anyStarted = list.some((f) => f.started === true);
    const allFinished = list.every((f) => f.finished === true);
    if (!anyStarted || allFinished) return false;
    const nextDeadline = nextGw !== null ? gwMeta.get(nextGw)?.deadline_time : undefined;
    if (nextDeadline && now > new Date(nextDeadline).getTime()) return false;
    return true;
  };

  if (events.length === 0) {
    return <p className="mt-6 text-sm text-zinc-500">No fixtures have been published yet.</p>;
  }

  return (
    <div className="mt-4 space-y-3">
      {events.map((event) => {
        const list = byEvent.get(event)!;
        const meta = gwMeta.get(event);
        const openByDefault =
          inProgress(event) ||
          (nextGw === null ? event <= OPEN_AHEAD : event >= nextGw && event < nextGw + OPEN_AHEAD);
        const open = toggled.has(event) ? !openByDefault : openByDefault;

        return (
          <section
            key={event}
            className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]"
          >
            <button
              onClick={() =>
                setToggled((prev) => {
                  const next = new Set(prev);
                  if (next.has(event)) next.delete(event);
                  else next.add(event);
                  return next;
                })
              }
              aria-expanded={open}
              className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-purple-950/40"
            >
              <span className="flex items-center gap-2">
                <ExpandToggle expanded={open} interactive={false} size="sm" />
                <span className="text-sm font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                  {meta?.name ?? `Gameweek ${event}`}
                </span>
                {meta?.finished && (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-[#2A0A45]">
                    complete
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3 text-xs text-zinc-500">
                {meta && (
                  <span className="hidden sm:inline">
                    Deadline · {formatDeadline(meta.deadline_time)}
                  </span>
                )}
                <span>{list.length} fixtures</span>
              </span>
            </button>

            {/* Deliberately still mount/unmount, not the grid accordion the
                rows below use — up to 38 gameweeks render at once here, and
                animating every section would mount every FixtureRow (each
                running parseFixtureStats) up front instead of only the ones
                a viewer has actually opened. Sections snap, rows glide. */}
            {open && (
              <div className="border-t border-zinc-100 dark:border-purple-900/40">
                {list.map((f, i) => {
                  const prev = i > 0 ? list[i - 1] : null;
                  const showDay =
                    f.kickoff_time !== null &&
                    (prev === null ||
                      prev.kickoff_time === null ||
                      dayKey(prev.kickoff_time) !== dayKey(f.kickoff_time));

                  return (
                    <div key={f.id}>
                      {showDay && (
                        <div className="bg-zinc-50 px-4 py-1.5 text-center text-xs font-medium uppercase tracking-widest text-zinc-500 dark:bg-[#160126]">
                          {formatDay(f.kickoff_time!)}
                        </div>
                      )}
                      <FixtureRow fixture={f} teams={teams} playersById={playersById} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function FixtureRow({
  fixture: f,
  teams,
  playersById,
}: {
  fixture: ScheduleFixture;
  teams: Map<number, ScheduleTeam>;
  playersById?: Map<number, LiveFixturePlayer>;
}) {
  const [expanded, setExpanded] = useState(false);

  const home = teams.get(f.team_h);
  const away = teams.get(f.team_a);

  const hasScore = f.team_h_score !== null && f.team_a_score !== null;
  // `finished` and `finished_provisional` are separate FPL flags — a match
  // can be full time with bonus not yet confirmed, so `finished` alone
  // isn't enough to say the result is settled. See matchStatus (live-fixtures.tsx).
  const status = matchStatus(f);
  const complete = status === "finished" && hasScore;
  const provisionalFT = status === "finished_provisional" && hasScore;
  const live = status === "live";

  const homeWon = (complete || provisionalFT) && f.team_h_score! > f.team_a_score!;
  const awayWon = (complete || provisionalFT) && f.team_a_score! > f.team_h_score!;

  const stats = playersById ? parseFixtureStats(f.stats) : null;
  const expandable = stats !== null && hasFixtureStats(stats);

  const row = (
    <div className="flex items-center gap-2 px-3 py-2 text-sm">
      {/* home — short code (ARS), not the full club name, so this row
          matches the live hub card and stays a fixed width regardless of
          club name length; full name still on `title`. */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <span
          title={home?.name}
          className={
            homeWon
              ? "font-semibold text-zinc-900 dark:text-zinc-50"
              : "text-zinc-700 dark:text-zinc-300"
          }
        >
          {home?.short_name ?? "—"}
        </span>
        <TeamCrest teamCode={home?.code} shortName={home?.short_name} className="h-6 w-5" />
      </div>

      {/* centre: kickoff, score, or live */}
      <div className="shrink-0">
        {complete ? (
          <span className="flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded border border-zinc-300 px-2 py-1 font-semibold tabular-nums text-zinc-900 dark:border-purple-800/60 dark:text-zinc-100">
            {f.team_h_score} <span className="text-zinc-400">–</span> {f.team_a_score}
          </span>
        ) : provisionalFT ? (
          <span
            className="flex min-w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded border border-zinc-300 px-2 py-1 font-semibold tabular-nums text-zinc-900 dark:border-purple-800/60 dark:text-zinc-100"
            title="Full time — bonus points not yet confirmed by FPL"
          >
            <span>
              {f.team_h_score} <span className="text-zinc-400">–</span> {f.team_a_score}
            </span>
            <span className="text-[9px] font-normal uppercase tracking-wide text-zinc-500">FT · bonus tbc</span>
          </span>
        ) : live ? (
          <span className="flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded border border-emerald-500/60 bg-emerald-50 px-2 py-1 font-semibold tabular-nums text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            {hasScore ? `${f.team_h_score} – ${f.team_a_score}` : "LIVE"}
            {f.minutes !== null && <span className="text-[10px]">{f.minutes}′</span>}
          </span>
        ) : (
          <span
            className="flex min-w-[4.5rem] items-center justify-center rounded border border-zinc-300 px-2 py-1 tabular-nums text-zinc-600 dark:border-purple-800/60 dark:text-zinc-300"
            title={
              f.provisional_start_time
                ? "Provisional kickoff — FPL has not confirmed this time"
                : undefined
            }
          >
            {f.kickoff_time ? formatTime(f.kickoff_time) : "TBC"}
            {f.provisional_start_time && f.kickoff_time ? "*" : ""}
          </span>
        )}
      </div>

      {/* away */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TeamCrest teamCode={away?.code} shortName={away?.short_name} className="h-6 w-5" />
        <span
          title={away?.name}
          className={
            awayWon
              ? "font-semibold text-zinc-900 dark:text-zinc-50"
              : "text-zinc-700 dark:text-zinc-300"
          }
        >
          {away?.short_name ?? "—"}
        </span>
      </div>

      <span className="hidden w-10 shrink-0 text-right text-[10px] uppercase text-zinc-400 sm:block">
        GW{f.event}
      </span>
      {expandable && <ExpandToggle expanded={expanded} interactive={false} size="sm" />}
    </div>
  );

  // Border lives on this outer element in both branches, whichever is
  // actually returned as the sibling in the day's fixture list — a border
  // on the inner `row` div would sit one level deeper once a row becomes
  // expandable, breaking `last:border-0`'s sibling-position check.
  if (!expandable) {
    return <div className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">{row}</div>;
  }

  return (
    <div className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="group w-full text-left transition-colors hover:bg-zinc-50 dark:hover:bg-purple-950/30"
      >
        {row}
      </button>
      {/* CSS Grid 0fr→1fr rather than mount/unmount (Sprint 24 pattern,
          Sprint 25 applied it here) — FixtureStatBreakdown does no
          side-effecting work, so mounting it while collapsed costs nothing. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="bg-zinc-50 px-4 py-3 dark:bg-[#160126]">
            <FixtureStatBreakdown stats={stats!} playersById={playersById!} provisional={!complete} />
          </div>
        </div>
      </div>
    </div>
  );
}
