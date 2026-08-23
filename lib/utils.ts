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
