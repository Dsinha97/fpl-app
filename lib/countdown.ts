// A live "time until an ISO deadline" formatter — the one implementation
// (CLAUDE.md: "one quantity, one implementation"). Previously private to
// app/deadline/page.tsx; components/context-bar.tsx needs the identical
// format for its own always-visible countdown, so this is the shared home
// for both rather than a second hand-copy.

export interface Countdown {
  text: string;
  passed: boolean;
  /** Whether `text` carries a seconds term — i.e. whether a caller has any
   *  reason to re-render once a second. False when the deadline is more than
   *  `SECONDS_WITHIN_MS` away. */
  showsSeconds: boolean;
}

/** Seconds are shown only inside this window. A digit that changes every
 *  second on a countdown still measured in days is movement with no
 *  information in it — it reads as urgency nineteen days out, and it costs a
 *  re-render a second to say nothing. Inside a day it is real: this is when
 *  "have I got time to think about it" turns into "set the team now". */
export const SECONDS_WITHIN_MS = 24 * 60 * 60 * 1000;

export function fmtCountdown(deadline: string, now: number): Countdown {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return { text: "Deadline has passed", passed: true, showsSeconds: false };
  const showsSeconds = ms < SECONDS_WITHIN_MS;
  const totalSecs = Math.floor(ms / 1000);
  const days = Math.floor(totalSecs / 86_400);
  const hours = Math.floor((totalSecs % 86_400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const parts = [
    days > 0 ? `${days}d` : null,
    `${hours}h`,
    `${mins}m`,
    showsSeconds ? `${secs}s` : null,
  ].filter(Boolean);
  return { text: parts.join(" "), passed: false, showsSeconds };
}
