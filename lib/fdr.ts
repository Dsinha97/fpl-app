// Fixture Difficulty Rating scale.
//
// Ordered ramp, not a categorical palette: dark green (very easy) through
// yellow to dark red (very hard). Verified with the dataviz palette validator
// — adjacent-pair CVD separation is 12.3 ΔE (protan), normal-vision floor
// 17.4, both comfortably above target. Several fills fall under 3:1 contrast
// against the page surface, which is why every cell carries visible text and
// a tooltip rather than relying on colour alone.

export type FdrRating = 1 | 2 | 3 | 4 | 5;

export interface FDRConfig {
  label: string;
  bgClass: string;
  textClass: string;
  hexCode: string;
}

export const fdrTheme: Record<FdrRating, FDRConfig> = {
  1: {
    label: "V. Easy",
    // Dark Green
    bgClass: "bg-emerald-900 dark:bg-emerald-950",
    textClass: "text-emerald-100 dark:text-emerald-200",
    hexCode: "#064E3B",
  },
  2: {
    label: "Easy",
    // Green
    bgClass: "bg-emerald-500 dark:bg-emerald-500",
    textClass: "text-slate-950 dark:text-slate-950",
    hexCode: "#10B981",
  },
  3: {
    label: "Medium",
    // Yellow
    bgClass: "bg-amber-400 dark:bg-amber-400",
    textClass: "text-slate-950 dark:text-slate-950",
    hexCode: "#FBBF24",
  },
  4: {
    label: "Hard",
    // Orange
    bgClass: "bg-orange-500 dark:bg-orange-500",
    textClass: "text-white dark:text-slate-950",
    hexCode: "#F97316",
  },
  5: {
    label: "V. Hard",
    // Dark Red
    bgClass: "bg-red-900 dark:bg-red-950",
    textClass: "text-red-100 dark:text-red-200",
    hexCode: "#7F1D1D",
  },
};

/** Clamp an arbitrary number to a valid rating, defaulting to Medium. */
export const asRating = (n: number | null | undefined): FdrRating => {
  if (n === null || n === undefined) return 3;
  const r = Math.round(n);
  return (r >= 1 && r <= 5 ? r : 3) as FdrRating;
};

export const fdrConfig = (n: number | null | undefined): FDRConfig => fdrTheme[asRating(n)];

export const fdrClasses = (n: number | null | undefined): string => {
  const c = fdrConfig(n);
  return `${c.bgClass} ${c.textClass}`;
};

export const fdrLabel = (n: number | null | undefined): string => fdrConfig(n).label;

// Venue is encoded as a ring rather than by letter case, which was hard to
// read at a glance. The 1px surface-coloured offset guarantees the ring stays
// legible even when its hue is close to the FDR fill underneath (green ring on
// an easy-green fixture, red ring on a very-hard-red one).
export const venueRing = (home: boolean): string =>
  home
    ? "ring-2 ring-offset-1 ring-green-400 ring-offset-white dark:ring-offset-[#1E0234]"
    : "ring-2 ring-offset-1 ring-red-400 ring-offset-white dark:ring-offset-[#1E0234]";

// ------------------------------------------------------- fixture windows
//
// The fixture -> per-team-per-gameweek mapping (Sprint 21), extracted out of
// FdrMatrix so the /fixtures Table tab's next-5 strip uses the exact same
// blanks/doubles handling as the FDR matrix rather than a second copy
// (CLAUDE.md: one quantity, one implementation).

export interface FdrCell {
  opp: string;
  home: boolean;
  fdr: number;
}

export interface FdrTeamRef {
  id: number;
  short_name: string;
}

export interface FdrFixtureRef {
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_difficulty: number | null;
  team_a_difficulty: number | null;
}

/**
 * Sprint 29 bugfix — `teams.played/win/draw/loss/points/form` are populated
 * verbatim from FPL's own `bootstrap-static` `teams[]` array
 * (supabase/functions/sync-bootstrap), but that array's standings fields
 * stay 0/null all season on the live API — verified 2026-08-30 by fetching
 * bootstrap-static directly against a season with multiple gameweeks
 * already finished (real scorelines in `fixtures`, `teams.played` still 0
 * for every team). `teams.position` is *not* zeroed the same way, but it
 * doesn't track played/points either, so it isn't a real table position —
 * treating it as one would be exactly the mistake CLAUDE.md warns about
 * ("don't multiply a term by zero and ship a quietly shrunken score"). This
 * is the same class of bug as the documented `total_players` and team
 * attack-strength gotchas: a field FPL's public API simply doesn't carry,
 * silently read as if it did.
 *
 * The fix is to derive the table from `fixtures` instead, which the FDR
 * matrix already loads and which does carry real scorelines — one quantity
 * (a finished result), one implementation.
 */
export interface StandingsFixtureRef extends FdrFixtureRef {
  team_h_score: number | null;
  team_a_score: number | null;
  finished: boolean | null;
}

export interface DerivedStanding {
  played: number;
  win: number;
  draw: number;
  loss: number;
  points: number;
  /** Last 5 finished results, oldest first, e.g. "WDLWW" — a plain
   *  win/draw/loss tally, not FPL's own weighted decimal `form` figure
   *  (which the API doesn't publish either); disclosed as derived. */
  form: string | null;
  position: number;
}

/**
 * Aggregates finished fixtures into a real table: P/W/D/L/Pts per team, a
 * simple win/draw/loss form string (last 5), and position from sorting by
 * points then goal difference then goals for — the standard tiebreak FPL's
 * own (non-functional) `position` field would apply. Teams with zero
 * finished fixtures still get a row (played: 0, position last).
 */
export function deriveStandingsFromFixtures<T extends FdrTeamRef>(
  teams: T[],
  fixtures: StandingsFixtureRef[],
): Map<number, DerivedStanding> {
  interface Acc {
    played: number;
    win: number;
    draw: number;
    loss: number;
    goalsFor: number;
    goalsAgainst: number;
    results: string[]; // chronological, one per finished fixture
  }
  const acc = new Map<number, Acc>();
  for (const t of teams) {
    acc.set(t.id, { played: 0, win: 0, draw: 0, loss: 0, goalsFor: 0, goalsAgainst: 0, results: [] });
  }

  // fixtures aren't guaranteed ordered by event — sort so `results` (and the
  // "last 5" slice of it) reflects actual chronological order.
  const finished = fixtures
    .filter((f) => f.finished && f.team_h_score !== null && f.team_a_score !== null)
    .sort((a, b) => (a.event ?? 0) - (b.event ?? 0));

  for (const f of finished) {
    const home = acc.get(f.team_h);
    const away = acc.get(f.team_a);
    const hs = f.team_h_score as number;
    const as = f.team_a_score as number;
    if (home) {
      home.played += 1;
      home.goalsFor += hs;
      home.goalsAgainst += as;
      home.results.push(hs > as ? "W" : hs < as ? "L" : "D");
      if (hs > as) home.win += 1;
      else if (hs < as) home.loss += 1;
      else home.draw += 1;
    }
    if (away) {
      away.played += 1;
      away.goalsFor += as;
      away.goalsAgainst += hs;
      away.results.push(as > hs ? "W" : as < hs ? "L" : "D");
      if (as > hs) away.win += 1;
      else if (as < hs) away.loss += 1;
      else away.draw += 1;
    }
  }

  const ranked = [...acc.entries()].sort(([, a], [, b]) => {
    const aPts = a.win * 3 + a.draw;
    const bPts = b.win * 3 + b.draw;
    if (aPts !== bPts) return bPts - aPts;
    const aGd = a.goalsFor - a.goalsAgainst;
    const bGd = b.goalsFor - b.goalsAgainst;
    if (aGd !== bGd) return bGd - aGd;
    return b.goalsFor - a.goalsFor;
  });

  const result = new Map<number, DerivedStanding>();
  ranked.forEach(([teamId, a], i) => {
    result.set(teamId, {
      played: a.played,
      win: a.win,
      draw: a.draw,
      loss: a.loss,
      points: a.win * 3 + a.draw,
      form: a.results.length > 0 ? a.results.slice(-5).join("") : null,
      position: i + 1,
    });
  });
  return result;
}

/**
 * For each team, a map of gameweek -> that gameweek's fixture(s) across a
 * window of `windowSize` gameweeks starting at `fromGw` (capped at GW38).
 * A blank gameweek is simply absent from the inner map; a double has 2+
 * entries.
 */
export function fixtureCellsByTeam(
  teams: FdrTeamRef[],
  fixtures: FdrFixtureRef[],
  fromGw: number | null,
  windowSize: number,
): { gwCols: number[]; byTeam: Map<number, Map<number, FdrCell[]>> } {
  if (fromGw === null) return { gwCols: [], byTeam: new Map() };

  const lastGw = Math.min(fromGw + windowSize - 1, 38);
  const gwCols: number[] = [];
  for (let g = fromGw; g <= lastGw; g++) gwCols.push(g);

  const shortOf = new Map(teams.map((t) => [t.id, t.short_name]));
  const byTeam = new Map<number, Map<number, FdrCell[]>>();

  for (const f of fixtures) {
    if (f.event === null || f.event < fromGw || f.event > lastGw) continue;

    const push = (teamId: number, cell: FdrCell) => {
      if (!byTeam.has(teamId)) byTeam.set(teamId, new Map());
      const m = byTeam.get(teamId)!;
      if (!m.has(f.event!)) m.set(f.event!, []);
      m.get(f.event!)!.push(cell);
    };

    push(f.team_h, {
      opp: shortOf.get(f.team_a) ?? "?",
      home: true,
      fdr: f.team_h_difficulty ?? 3,
    });
    push(f.team_a, {
      opp: shortOf.get(f.team_h) ?? "?",
      home: false,
      fdr: f.team_a_difficulty ?? 3,
    });
  }

  return { gwCols, byTeam };
}

/** Mean FDR across `gwCols` for one team, or null when it has no fixtures in the window. */
export function averageFdr(
  byTeam: Map<number, Map<number, FdrCell[]>>,
  teamId: number,
  gwCols: number[],
): number | null {
  const cells = byTeam.get(teamId) ?? new Map<number, FdrCell[]>();
  const fdrs = gwCols.flatMap((g) => (cells.get(g) ?? []).map((c) => c.fdr));
  return fdrs.length > 0 ? fdrs.reduce((a, b) => a + b, 0) / fdrs.length : null;
}
