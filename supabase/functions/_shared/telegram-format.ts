// Presentation helpers for the Telegram bot. Sprint 36 follow-up.
//
// Kept out of index.ts so the emoji maps and the number formats have one home
// rather than being re-decided per command — the same reason the app has a
// design-system file rather than colours inlined per page.
//
// Everything here is decoration over facts. No helper in this file changes
// what a number means; they only change how it reads on a phone.

/**
 * Club emoji, keyed by `teams.short_name`.
 *
 * Nicknames rather than colours wherever one exists, because two clubs in the
 * same kit are indistinguishable at emoji size: Arsenal are the Gunners 🔫 and
 * Liverpool the Liver bird 🐦 rather than both being red circles.
 *
 * Keyed off the same 2026-27 `teams` rows `_shared/entities.ts`'s CLUB_ALIASES
 * uses, and needs the same once-a-season update on promotion and relegation.
 * A club with no entry renders with no emoji rather than a wrong one.
 */
export const CLUB_EMOJI: Record<string, string> = {
  ARS: "🔫", // Gunners
  AVL: "🦁", // Villans
  BOU: "🍒", // Cherries
  BRE: "🐝", // Bees
  BHA: "🕊️", // Seagulls
  CHE: "🔵", // Blues
  COV: "☁️", // Sky Blues
  CRY: "🦅", // Eagles
  EVE: "🍬", // Toffees
  FUL: "🏠", // Cottagers
  HUL: "🐯", // Tigers
  IPS: "🚜", // Tractor Boys
  LEE: "⚪", // Whites
  LIV: "🐦", // Liver bird
  MCI: "🩵", // Cityzens
  MUN: "👹", // Red Devils
  NEW: "🐦‍⬛", // Magpies
  NFO: "🌳", // Forest
  TOT: "🐓", // Cockerel
  SUN: "🐈‍⬛", // Black Cats
};

export const clubEmoji = (shortName: string | null | undefined): string =>
  (shortName && CLUB_EMOJI[shortName]) || "";

/** Position emoji, keyed by `element_types.singular_name_short`. */
export const POSITION_EMOJI: Record<string, string> = {
  GKP: "🧤",
  DEF: "🛡️",
  MID: "⚙️",
  FWD: "🎯",
};

export const positionEmoji = (short: string | null | undefined): string =>
  (short && POSITION_EMOJI[short]) || "•";

/**
 * A rank at a glance: `3220` → `3.2k`, `1029798` → `1M`, `5` → `5`.
 *
 * One decimal, and a trailing `.0` is dropped — `1M` reads better than `1.0M`
 * and the digit it hides was never meaningful at that scale. Below 1,000 the
 * exact number is short enough to keep, and it is exactly the range where
 * precision matters most: `1 of 5` in a mini-league is the whole point.
 */
export function shortRank(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "?";
  const abs = Math.abs(n);
  if (abs < 1_000) return String(n);
  const [value, suffix] = abs < 1_000_000 ? [n / 1_000, "k"] : [n / 1_000_000, "M"];
  return `${value.toFixed(1).replace(/\.0$/, "")}${suffix}`;
}

/**
 * Direction of travel for a rank, where **lower is better**.
 *
 * The convention is the trap here — a falling number is an improving rank —
 * so it is resolved once, in this function, rather than at each call site
 * (CLAUDE.md's rule about not mixing the two percentile conventions on one
 * screen applies just as well to a bot).
 *
 * Returns 🟰 when there is nothing to compare against, which is honest: an
 * unknown movement is not a flat one, but a bot has no room to explain the
 * difference and a wrong arrow is worse than a neutral mark.
 */
export function movement(
  current: number | null | undefined,
  previous: number | null | undefined,
): "🔼" | "🔽" | "🟰" {
  if (
    current === null || current === undefined ||
    previous === null || previous === undefined ||
    previous === 0
  ) {
    return "🟰";
  }
  if (previous > current) return "🔼";
  if (previous < current) return "🔽";
  return "🟰";
}

/** A message header: what this is, and whose team it is about. */
export function title(icon: string, what: string, teamName: string | null): string {
  return teamName ? `${icon} ${what} — ${teamName}` : `${icon} ${what}`;
}

const LONDON = "Europe/London";

/** "Sat 12 Sep" — the grouping key and heading for a day's fixtures. */
export function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: LONDON,
  }).format(new Date(iso));
}

/** "14:00", UK time — the only part that varies within a day's group. */
export function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: LONDON,
  }).format(new Date(iso));
}

/** "Sat 12 Sep, 12:30" — for a deadline, where date and time belong together. */
export const dateTimeLabel = (iso: string): string => `${dayLabel(iso)}, ${timeLabel(iso)}`;
