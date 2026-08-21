// Tiered player/team resolution for RSS headlines. Every tier carries an
// explicit confidence and a `matched_via` label — CLAUDE.md's "say what the
// number means" applies to a match as much as to a score. Ambiguous
// surnames are skipped, not guessed at: lib/gw1-lineups.ts found 23 of 262
// name resolutions wrong on a much more curated source (a predicted-lineup
// video), so a wire-service headline gets no benefit of the doubt.
//
// fold() below is a copy of lib/player-search.ts's accent-folding helper —
// Supabase bundles each function directory independently, so
// supabase/functions/** cannot import from lib/. Keep the two in sync if
// either changes; lib/player-search.ts is the source of truth.

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");
const SPECIAL_LETTERS: [RegExp, string][] = [
  [/ø/g, "o"],
  [/đ/g, "d"],
  [/ł/g, "l"],
  [/ß/g, "ss"],
  [/æ/g, "ae"],
];

function fold(s: string): string {
  let out = s.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
  for (const [pattern, replacement] of SPECIAL_LETTERS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Club name/nickname aliases, keyed by team `short_name` (as stored in
 * `teams`). Sourced from the live 2026-27 `teams` table (verified 2026-08-21)
 * — update on promotion/relegation, once a season.
 */
export const CLUB_ALIASES: Record<string, string[]> = {
  ARS: ["arsenal"],
  AVL: ["aston villa", "villa"],
  BOU: ["bournemouth", "cherries"],
  BRE: ["brentford", "bees"],
  BHA: ["brighton", "brighton & hove albion", "seagulls"],
  CHE: ["chelsea", "blues"],
  COV: ["coventry", "coventry city", "sky blues"],
  CRY: ["crystal palace", "palace", "eagles"],
  EVE: ["everton", "toffees"],
  FUL: ["fulham", "cottagers"],
  HUL: ["hull", "hull city", "tigers"],
  IPS: ["ipswich", "ipswich town", "tractor boys"],
  LEE: ["leeds", "leeds united", "whites"],
  LIV: ["liverpool", "reds"],
  MCI: ["man city", "manchester city", "city"],
  MUN: ["man utd", "man united", "manchester united", "united"],
  NEW: ["newcastle", "newcastle united", "magpies", "toon"],
  NFO: ["nott'm forest", "nottingham forest", "forest"],
  TOT: ["spurs", "tottenham", "tottenham hotspur"],
  SUN: ["sunderland", "black cats"],
};

/** "arsenal team news" -> ARS; "Villa" -> AVL. First match wins. */
function clubFromText(text: string): string | null {
  const folded = fold(text);
  for (const [shortName, aliases] of Object.entries(CLUB_ALIASES)) {
    if (aliases.some((a) => folded.includes(a))) return shortName;
  }
  return null;
}

export interface TeamRow {
  code: number;
  short_name: string;
}

export interface PlayerRow {
  code: number;
  team_code: number | null;
  web_name: string | null;
  first_name: string | null;
  second_name: string | null;
  known_name: string | null;
}

export interface EntityMatch {
  entity_type: "team" | "player";
  entity_id: number;
  confidence: number;
  matched_via: "feed_category" | "full_name" | "surname_team_confirmed" | "surname";
}

interface NamePart {
  code: number;
  teamCode: number | null;
  fullName: string | null; // folded "first second" or known_name
  surname: string | null; // folded second_name/web_name segment
}

function namePartsFor(p: PlayerRow): NamePart {
  const full = [p.first_name, p.second_name].filter(Boolean).join(" ").trim();
  const fullName = p.known_name ? fold(p.known_name) : full ? fold(full) : null;
  const surnameRaw = p.second_name ?? p.web_name;
  return {
    code: p.code,
    teamCode: p.team_code,
    fullName,
    surname: surnameRaw ? fold(surnameRaw) : null,
  };
}

/**
 * Resolves an item's categories + title + excerpt to teams and players.
 * `teams`/`players` should already be scoped to the current season.
 */
export function resolveEntities(
  item: { title: string; excerpt: string | null; categories: string[] },
  teams: TeamRow[],
  players: PlayerRow[],
): EntityMatch[] {
  const teamByCode = new Map(teams.map((t) => [t.short_name, t]));
  const haystackText = fold(`${item.title} ${item.excerpt ?? ""}`);

  // --- tier 1: feed_category, conf 1.0 ---------------------------------
  const matchedTeams = new Set<string>();
  for (const cat of item.categories) {
    const shortName = clubFromText(cat);
    if (shortName) matchedTeams.add(shortName);
  }
  // Fall back to scanning the title when the feed supplies no categories
  // at all (BBC) — still feed_category tier since it's the same club-alias
  // rule, just applied to the title instead of an explicit tag.
  if (item.categories.length === 0) {
    const shortName = clubFromText(item.title);
    if (shortName) matchedTeams.add(shortName);
  }

  const matches: EntityMatch[] = [];
  for (const shortName of matchedTeams) {
    const team = teamByCode.get(shortName);
    if (team) {
      matches.push({ entity_type: "team", entity_id: team.code, confidence: 1.0, matched_via: "feed_category" });
    }
  }
  const confirmedTeamCodes = new Set(
    [...matchedTeams].map((s) => teamByCode.get(s)?.code).filter((c): c is number => c !== undefined),
  );

  // --- player tiers -----------------------------------------------------
  const parts = players.map(namePartsFor);

  // Surnames that are ambiguous within this season's player pool never
  // reach tier `surname` — counted once so "two Silvas" produces no row
  // rather than a coin flip.
  const surnameCounts = new Map<string, number>();
  for (const p of parts) {
    if (!p.surname) continue;
    surnameCounts.set(p.surname, (surnameCounts.get(p.surname) ?? 0) + 1);
  }

  for (const p of parts) {
    // tier 2: full_name, conf 0.9
    if (p.fullName && haystackText.includes(p.fullName)) {
      matches.push({ entity_type: "player", entity_id: p.code, confidence: 0.9, matched_via: "full_name" });
      continue;
    }

    if (!p.surname || p.surname.length < 4) continue; // short surnames ("Cole", "Ward") are too collision-prone
    if (!haystackText.includes(p.surname)) continue;

    // tier 3: surname_team_confirmed, conf 0.85 — the player's own club was
    // already resolved on this item, so the surname hit is corroborated
    // even if the surname itself isn't unique league-wide.
    if (p.teamCode !== null && confirmedTeamCodes.has(p.teamCode)) {
      matches.push({
        entity_type: "player",
        entity_id: p.code,
        confidence: 0.85,
        matched_via: "surname_team_confirmed",
      });
      continue;
    }

    // tier 4: surname, conf 0.6 — only when unique across the season's players.
    if (surnameCounts.get(p.surname) === 1) {
      matches.push({ entity_type: "player", entity_id: p.code, confidence: 0.6, matched_via: "surname" });
    }
  }

  return matches;
}
