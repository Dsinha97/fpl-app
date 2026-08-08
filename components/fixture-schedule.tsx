"use client";

import { useState } from "react";
import { TeamCrest } from "./identity";

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
  minutes: number | null;
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
}

/**
 * How many upcoming gameweeks start expanded.
 *
 * Pre-season every gameweek is "upcoming", and opening all 38 produced a
 * 21,000px page — 30 screens of scrolling. The next few weeks are what anyone
 * is actually looking at; the rest are one click away.
 */
const OPEN_AHEAD = 2;

export function FixtureSchedule({ fixtures, teams, gameweeks, nextGw }: FixtureScheduleProps) {
  // The state records deviations from the default, so toggling flips a section.
  const [toggled, setToggled] = useState<Set<number>>(new Set());

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

  if (events.length === 0) {
    return <p className="mt-6 text-sm text-zinc-500">No fixtures have been published yet.</p>;
  }

  return (
    <div className="mt-4 space-y-3">
      {events.map((event) => {
        const list = byEvent.get(event)!;
        const meta = gwMeta.get(event);
        const openByDefault =
          nextGw === null ? event <= OPEN_AHEAD : event >= nextGw && event < nextGw + OPEN_AHEAD;
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
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-purple-950/40"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`text-zinc-400 transition-transform ${open ? "" : "rotate-180"}`}
                >
                  ⌃
                </span>
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
                      <FixtureRow fixture={f} teams={teams} />
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
}: {
  fixture: ScheduleFixture;
  teams: Map<number, ScheduleTeam>;
}) {
  const home = teams.get(f.team_h);
  const away = teams.get(f.team_a);

  const hasScore = f.team_h_score !== null && f.team_a_score !== null;
  const complete = f.finished === true && hasScore;
  const live = f.started === true && f.finished !== true;

  const homeWon = complete && f.team_h_score! > f.team_a_score!;
  const awayWon = complete && f.team_a_score! > f.team_h_score!;

  return (
    <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 text-sm last:border-0 dark:border-purple-900/30">
      {/* home */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <span
          className={`truncate ${
            homeWon
              ? "font-semibold text-zinc-900 dark:text-zinc-50"
              : "text-zinc-700 dark:text-zinc-300"
          }`}
        >
          {home?.name ?? "—"}
        </span>
        <TeamCrest teamCode={home?.code} shortName={home?.short_name} className="h-6 w-5" />
      </div>

      {/* centre: kickoff, score, or live */}
      <div className="shrink-0">
        {complete ? (
          <span className="flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded border border-zinc-300 px-2 py-1 font-semibold tabular-nums text-zinc-900 dark:border-purple-800/60 dark:text-zinc-100">
            {f.team_h_score} <span className="text-zinc-400">–</span> {f.team_a_score}
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
          className={`truncate ${
            awayWon
              ? "font-semibold text-zinc-900 dark:text-zinc-50"
              : "text-zinc-700 dark:text-zinc-300"
          }`}
        >
          {away?.name ?? "—"}
        </span>
      </div>

      <span className="hidden w-10 shrink-0 text-right text-[10px] uppercase text-zinc-400 sm:block">
        GW{f.event}
      </span>
    </div>
  );
}
