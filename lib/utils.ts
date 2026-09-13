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

/**
 * A number rendered with its sign, for a headline or a summary string.
 *
 * This existed **eight times** — in app/deadline, app/scenarios, app/transfers,
 * components/chip-timing, components/transfer-path, components/transfer-plan,
 * components/decision-analytics-panel and lib/transfer-optimizer — in three
 * mutually incompatible versions. That is CLAUDE.md's "one quantity, one
 * implementation" with a delay on it, and the delay had already produced a bug.
 *
 * Five of the copies read `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`, which
 * signs the *unrounded* value: -0.04 renders as "-0.0", a fall that did not
 * happen, and 0 renders as "+0.0", a gain that did not happen. Two copies had
 * already fixed this by rounding first; this is that behaviour, so the fix
 * reaches the other six.
 *
 * The minus is U+2212, not a hyphen — the convention transfer-plan.tsx already
 * documented and `Delta` already follows, so a headline reads
 * `+8.5 xP − 8 hit` with a real minus sign.
 *
 * Presentation only. `lib/transfer-optimizer.ts`'s single caller builds a
 * summary line ("Kinsky → Leno: +14.0 xP, price-neutral"); no computed value
 * passes through here, so no engine behaviour moves.
 */
export function signed(v: number, digits = 1): string {
  const rounded = Number(v.toFixed(digits))
  if (rounded === 0) return (0).toFixed(digits)
  return `${rounded > 0 ? "+" : "\u2212"}${Math.abs(rounded).toFixed(digits)}`
}
