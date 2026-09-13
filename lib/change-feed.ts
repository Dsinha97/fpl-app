// Shared shape and presentation helpers for the `change_feed` view
// (price rises/falls, availability status, news, fixture changes). Lifted
// out of app/changes/page.tsx so the Deadline Hub can reuse the same feed,
// filtered to one squad, without a second implementation — one quantity,
// one implementation, per CLAUDE.md.

import { formatDateTime } from "./utils";

export interface FeedRow {
  season: string;
  kind: "price_rise" | "price_fall" | "status" | "news" | "fixture";
  observed_at: string;
  player_code: number | null;
  web_name: string | null;
  team_short: string | null;
  detail: Record<string, unknown>;
}

export const STATUS_LABEL: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not in squad",
};

export function ago(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

const money = (tenths: unknown): string =>
  typeof tenths === "number" ? `£${(tenths / 10).toFixed(1)}m` : "?";

/**
 * How one feed row should read.
 *
 * This used to return `{ icon, text }`, where `icon` was a system emoji
 * (📈 📉 🟡 🔴 📰 📅) and `text` was everything else crammed into one string.
 * Two problems the audit named (DSI-122): an emoji renders in the platform's
 * own colours and never matches the design system around it, and a price rise
 * and a price fall came out visually identical, so the direction had to be read
 * out of the decimals.
 *
 * So this returns semantics, not presentation. The caller picks the glyph and
 * the badge; this decides what changed, which way, and how much it matters.
 * `detail` is the second line DSI-122 asked for — it exists so an availability
 * row can put the medical quote under the status change instead of running
 * three restatements of the same fact into one sentence.
 */
export type FeedTone = "positive" | "negative" | "warning" | "neutral";

export interface FeedPresentation {
  tone: FeedTone;
  /** What changed, as a phrase. Never carries the magnitude — that is `badge`. */
  headline: string;
  /** The magnitude or resulting state, for a Badge. */
  badge?: string;
  /** Supporting quote or note, rendered muted on its own line. */
  detail?: string;
}

const signedMoney = (oldT: unknown, newT: unknown): string | undefined => {
  if (typeof oldT !== "number" || typeof newT !== "number") return undefined;
  const delta = (newT - oldT) / 10;
  // U+2212 minus, matching the transfer headline convention.
  return `${delta > 0 ? "+" : "−"}£${Math.abs(delta).toFixed(1)}m`;
};

/**
 * How many fixtures a club has in a gameweek, for the round a fixture moved
 * out of and into. `undefined` when the caller has no schedule loaded, which
 * is the normal case on a page that only renders the feed.
 *
 * DSI-122/137: a cross-round move already said `GW20 -> GW21`, so the *fact*
 * was shown -- but not the consequence, which is the part that rewrites chip
 * strategy. A move only matters because of what it leaves behind: a blank in
 * the round it left, a double in the round it joined.
 */
export type FixtureCountAt = (teamShort: string, event: number) => number | undefined;

/**
 * "SUN blank in GW20", "both doubled in GW21", or both -- omitting whichever
 * half is not true, and the whole thing when the counts are unknown.
 *
 * Counts are post-move (the schedule as it now stands), so a club showing 0 in
 * the old round is blank *because of* this move, and 2 in the new round is
 * doubled. A club that still has another fixture in the old round is not
 * mentioned: nothing happened to it worth a reader's attention.
 */
function roundEffect(
  home: string | undefined,
  away: string | undefined,
  from: number,
  to: number,
  countAt: FixtureCountAt,
): string | undefined {
  const clubs = [home, away].filter((c): c is string => typeof c === "string" && c !== "?");
  if (clubs.length === 0) return undefined;

  const phrase = (event: number, want: (n: number) => boolean, word: string) => {
    const hit = clubs.filter((c) => {
      const n = countAt(c, event);
      return n !== undefined && want(n);
    });
    if (hit.length === 0) return null;
    const who = hit.length === clubs.length && clubs.length > 1 ? "both" : hit.join(" and ");
    return `${who} ${word} in GW${event}`;
  };

  const parts = [
    phrase(from, (n) => n === 0, "blank"),
    phrase(to, (n) => n > 1, "doubled"),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function describe(row: FeedRow, countAt?: FixtureCountAt): FeedPresentation {
  const d = row.detail;
  switch (row.kind) {
    case "price_rise":
      return {
        tone: "positive",
        headline: `${money(d.old)} → ${money(d.new)}`,
        badge: signedMoney(d.old, d.new),
      };
    case "price_fall":
      return {
        tone: "negative",
        headline: `${money(d.old)} → ${money(d.new)}`,
        badge: signedMoney(d.old, d.new),
      };
    case "status": {
      const oldS = STATUS_LABEL[String(d.old_status)] ?? String(d.old_status);
      const newS = STATUS_LABEL[String(d.new_status)] ?? String(d.new_status);
      // Tone follows where the player LANDED, not merely that something moved.
      // Reading only "is the new status a ruled-out one" made
      // `Suspended -> Available` amber — a player becoming available again is
      // the best news in this feed, and it was styled as a caution.
      const ruledOut = d.new_status === "i" || d.new_status === "s" || d.new_status === "u";
      const recovered = d.new_status === "a";
      // Sprint 29.5: change_feed folds a co-timestamped news change into the
      // same status row (news_new) rather than emitting a second row for the
      // same FPL update — surface it here so the sentence isn't lost.
      const news = typeof d.news_new === "string" && d.news_new !== "" ? d.news_new : undefined;
      const chance =
        d.new_chance !== null && d.new_chance !== undefined ? `${d.new_chance}%` : undefined;
      return {
        tone: recovered ? "positive" : ruledOut ? "negative" : "warning",
        headline: `${oldS} → ${newS}`,
        // The status and the chance are one fact, so they travel as one badge
        // rather than as a sentence restating the headline.
        badge: chance ? `${newS} · ${chance}` : newS,
        detail: news,
      };
    }
    case "news": {
      const cleared = d.new === null || d.new === "";
      return {
        tone: "neutral",
        headline: cleared ? "News cleared" : String(d.new),
      };
    }
    case "fixture": {
      const match = `${d.home ?? "?"} v ${d.away ?? "?"}`;
      const movedRound = d.field === "event";
      return {
        // A fixture crossing a gameweek boundary can create a blank or double
        // and rewrites chip strategy; a kickoff shifting within a round does
        // not. They should not read the same (DSI-122).
        tone: movedRound ? "warning" : "neutral",
        headline: match,
        badge: movedRound ? `GW${d.old} → GW${d.new}` : "Time change",
        detail: movedRound
          ? roundEffect(
              typeof d.home === "string" ? d.home : undefined,
              typeof d.away === "string" ? d.away : undefined,
              Number(d.old),
              Number(d.new),
              countAt ?? (() => undefined),
            )
          // Was `.slice(0, 16)` on the raw ISO string, which printed
          // `2027-01-06T20:00` — DSI-122's "looks like a raw backend log".
          : `${formatDateTime(d.old as string)} → ${formatDateTime(d.new as string)}`,
      };
    }
  }
}
