// Live/finished fixture events, parsed once from fixtures.stats.
//
// FPL's own event/{id}/live/ shape (the same one sync-fixtures stores
// verbatim as `stats`, refreshed every 2 minutes by the self-gated cron —
// see docs/wiki/data-pipeline.md): an array of { identifier, h: [...], a:
// [...] } lines, each entry { element, value }. No new sync or column —
// everything components/live-fixtures.tsx needs is already here.

export interface FixtureStatEntry {
  element: number;
  value: number;
}

export interface FixtureStatLine {
  identifier: string;
  h: FixtureStatEntry[];
  a: FixtureStatEntry[];
}

/** Identifiers worth surfacing on a fixture card, in display order. */
export const DISPLAY_STAT_ORDER = [
  "goals_scored",
  "assists",
  "own_goals",
  "penalties_saved",
  "penalties_missed",
  "yellow_cards",
  "red_cards",
  "saves",
  "bonus",
] as const;

export type DisplayStatIdentifier = (typeof DISPLAY_STAT_ORDER)[number];

export const STAT_LABELS: Record<DisplayStatIdentifier, { label: string; icon: string }> = {
  goals_scored: { label: "Goals", icon: "⚽" },
  assists: { label: "Assists", icon: "👟" },
  own_goals: { label: "Own goals", icon: "⚽" },
  penalties_saved: { label: "Penalties saved", icon: "🧤" },
  penalties_missed: { label: "Penalties missed", icon: "❌" },
  yellow_cards: { label: "Yellow cards", icon: "🟨" },
  red_cards: { label: "Red cards", icon: "🟥" },
  saves: { label: "Saves", icon: "🧤" },
  bonus: { label: "Bonus points", icon: "⭐" },
};

/**
 * `fixtures.stats` verbatim from FPL, keyed by identifier for O(1) lookup.
 * Unrecognised shapes (a fixture with no stats yet, or a malformed payload)
 * return an empty map rather than throwing — a fixture that hasn't kicked
 * off is not an error.
 */
export function parseFixtureStats(raw: unknown): Map<string, FixtureStatLine> {
  const byIdentifier = new Map<string, FixtureStatLine>();
  if (!Array.isArray(raw)) return byIdentifier;

  for (const line of raw) {
    if (
      typeof line !== "object" ||
      line === null ||
      typeof (line as Record<string, unknown>).identifier !== "string"
    ) {
      continue;
    }
    const l = line as { identifier: string; h?: unknown; a?: unknown };
    const clean = (side: unknown): FixtureStatEntry[] =>
      Array.isArray(side)
        ? side
            .filter(
              (e): e is FixtureStatEntry =>
                typeof e === "object" &&
                e !== null &&
                typeof (e as FixtureStatEntry).element === "number" &&
                typeof (e as FixtureStatEntry).value === "number",
            )
        : [];
    byIdentifier.set(l.identifier, { identifier: l.identifier, h: clean(l.h), a: clean(l.a) });
  }
  return byIdentifier;
}

/** True once a fixture has at least one recognised stat line — i.e. kicked off. */
export function hasFixtureStats(stats: Map<string, FixtureStatLine>): boolean {
  return stats.size > 0;
}

/** Readable labels for the broader identifier set player_live_stats.explain uses
 *  (scoring stats, not just fan-facing events) — the player detail panel's live
 *  breakdown table. */
const LIVE_STAT_LABELS: Record<string, string> = {
  minutes: "Minutes played",
  goals_scored: "Goals",
  assists: "Assists",
  clean_sheets: "Clean sheets",
  goals_conceded: "Goals conceded",
  own_goals: "Own goals",
  penalties_saved: "Penalties saved",
  penalties_missed: "Penalties missed",
  yellow_cards: "Yellow cards",
  red_cards: "Red cards",
  saves: "Saves",
  bonus: "Bonus",
  defensive_contribution: "Defensive contribution",
};

/** Falls back to a humanised identifier for anything not in the curated map above. */
export function liveStatLabel(identifier: string): string {
  return (
    LIVE_STAT_LABELS[identifier] ??
    identifier.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}
