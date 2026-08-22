// A live "time until an ISO deadline" formatter — the one implementation
// (CLAUDE.md: "one quantity, one implementation"). Previously private to
// app/deadline/page.tsx; components/context-bar.tsx needs the identical
// format for its own always-visible countdown, so this is the shared home
// for both rather than a second hand-copy.

export interface Countdown {
  text: string;
  passed: boolean;
}

export function fmtCountdown(deadline: string, now: number): Countdown {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return { text: "Deadline has passed", passed: true };
  const totalSecs = Math.floor(ms / 1000);
  const days = Math.floor(totalSecs / 86_400);
  const hours = Math.floor((totalSecs % 86_400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const parts = [
    days > 0 ? `${days}d` : null,
    `${hours}h`,
    `${mins}m`,
    `${secs}s`,
  ].filter(Boolean);
  return { text: parts.join(" "), passed: false };
}
