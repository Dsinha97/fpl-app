import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * `player_season_history.season_name` comes back as "2025/26" — too wide for
 * a table header. Shortens to "25/26"; anything not matching the four-digit
 * "YYYY/YY" shape (a malformed row, or an empty string before data loads)
 * passes through unchanged rather than mangling it.
 */
export function shortSeason(season: string): string {
  const m = /^\d{2}(\d{2})\/(\d{2})$/.exec(season)
  return m ? `${m[1]}/${m[2]}` : season
}

// --------------------------------------------------------------- date/time
//
// One implementation of "render a timestamp for a human". Before this, the
// fixture accordion had a private set of formatters and `lib/change-feed.ts`
// had none at all — it did `String(d.new).slice(0, 16)`, which is why the news
// feed printed `kickoff 2027-01-06T20:00 → 2027-01-05T20:15` and read as a raw
// backend log (DSI-122, DSI-129 #4).
//
// Everything here renders in the VIEWER's zone, because a kickoff is a wall
// clock question. That makes `localZone()` part of the contract rather than a
// nicety: without naming the zone, a 07:30 Saturday kickoff reads as a bug.
//
// All of these are called from client components after mount, never during
// prerender — a static export would otherwise bake the build machine's
// timezone into the HTML and mismatch on hydration.

/** The viewer's IANA timezone, for printing once beside a set of times. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local time"
  } catch {
    return "local time"
  }
}

/** `Tue 5 Jan, 20:15` — a kickoff or deadline in running text. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** `Sat 12 September 2026` — a day heading. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

/** `20:15` — a bare wall-clock time, for a column of them. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}
