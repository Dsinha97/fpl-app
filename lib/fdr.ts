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
  /**
   * Sprint 31. The strength-derived alternative to FPL's own `fdr`, present
   * only when `fixtureCellsByTeam` was given team strengths. Deliberately a
   * *second* field rather than a replacement — see `strengthFdr`.
   */
  strengthFdr?: number;
}

export interface FdrTeamRef {
  id: number;
  short_name: string;
}

/** A team's own overall strength, by venue, as FPL publishes it. */
export interface TeamStrength {
  strength_overall_home?: number | null;
  strength_overall_away?: number | null;
}

export type FdrSource = "official" | "strength";

/**
 * Difficulty of facing an opponent, derived from that opponent's own overall
 * strength at the venue they are playing.
 *
 * FPL's `strength_overall_home`/`_away` were `0` for every club through the
 * whole of pre-season (the long-standing `TeamAttackStrength` block); they
 * became populated for all 20 clubs on 2026-09-02, which is what unblocked
 * this. `strength_attack_*`/`strength_defence_*` are **still** 0 and `strength`
 * still NULL, so the overall pair is the only usable half — see
 * docs/wiki/fpl-api-constraints.md.
 *
 * **This never feeds the model, and here is the reason.** `teams` holds one
 * season's rows and `strength_overall_*` is a live snapshot, not history —
 * there is nothing for `scripts/backtest-walkforward.ts` to walk forward over,
 * so a strength-based FDR cannot be measured against the standing gate at all.
 * `ScoredPlayer.fdrRun` (lib/scoring.ts) feeds `fixtureScore` and `riskScore`'s
 * `fixtureVariance`, so swapping it would move ranked output on no evidence —
 * CLAUDE.md's "an acceptance threshold you invented is not evidence", with the
 * threshold missing entirely. It is offered as a second view on /fixtures and
 * nowhere else.
 *
 * The scale is FPL's own 1–5, unmapped: a strength value *is* already on that
 * scale. What it is not is evenly spread — see `STRENGTH_FDR_NOTE`.
 */
export function strengthFdr(opponent: TeamStrength | undefined, opponentAtHome: boolean): number | null {
  const raw = opponentAtHome ? opponent?.strength_overall_home : opponent?.strength_overall_away;
  // 0 is FPL's "not published", not a real floor — the same zeroed-field trap
  // this codebase hits with team attack strength and `players.form`. Drop the
  // cell rather than painting a very-easy green over missing data.
  if (raw === null || raw === undefined || raw === 0) return null;
  return asRating(raw);
}

/**
 * Disclosure for the strength view, per CLAUDE.md's "say what the number
 * means". Measured against live data 2026-09-03: across all 20 clubs
 * `strength_overall_home` takes only {2, 3, 4} and `strength_overall_away`
 * only {2, 3, 4, 5} — three home tiers and four away, painted onto a five-step
 * colour ramp. The cells are honest about their own inputs; the ramp is finer
 * than the data behind it.
 */
export const STRENGTH_FDR_NOTE =
  "Derived from FPL's own overall home/away team strength — the difficulty of a fixture is the " +
  "opponent's strength at the venue they're playing. Coarser than it looks: across all 20 clubs " +
  "home strength takes only three distinct values and away strength four, so this five-colour " +
  "ramp is finer than its input. It is a second view only — no ranking, score or projection " +
  "anywhere in this app uses it, because FPL publishes strength as a live snapshot with no " +
  "history, leaving nothing to backtest it against.";

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
 *
 * Sprint 29 follow-up: extended to count a fixture that has kicked off but
 * not yet finished, using its live (possibly still-changing) score — a
 * table that only updates once every match of the gameweek is fully over
 * is a table that's stale for the entire gameweek it's meant to reflect.
 * `sync-fixtures` writes `team_h_score`/`team_a_score` from the moment a
 * match starts, not just once `finished` (see the function's own comment),
 * so the same "started, not finished" distinction `/deadline`'s `livePhase`
 * already uses (`app/deadline/page.tsx`'s `started`/`finished_provisional`
 * gate) is the right one here too, rather than waiting for `finished`.
 */
export interface StandingsFixtureRef extends FdrFixtureRef {
  team_h_score: number | null;
  team_a_score: number | null;
  started: boolean | null;
  finished: boolean | null;
  finished_provisional: boolean | null;
}

export interface DerivedStanding {
  played: number;
  win: number;
  draw: number;
  loss: number;
  points: number;
  /** Last 5 counted results, oldest first, e.g. "WDLWW" — a plain
   *  win/draw/loss tally, not FPL's own weighted decimal `form` figure
   *  (which the API doesn't publish either); disclosed as derived. */
  form: string | null;
  position: number;
}

export interface DerivedStandings {
  byTeam: Map<number, DerivedStanding>;
  /** True when any counted fixture has started but not finished — the table
   *  includes a live, still-changing result. */
  live: boolean;
}

/**
 * Aggregates started fixtures (finished or still live) into a real table:
 * P/W/D/L/Pts per team, a simple win/draw/loss form string (last 5), and
 * position from sorting by points then goal difference then goals for —
 * the standard tiebreak FPL's own (non-functional) `position` field would
 * apply. Teams with zero started fixtures still get a row (played: 0,
 * position last). A live fixture's current score counts provisionally,
 * same as the rest of this app treats a live gameweek — see `live` on the
 * return value for whether to disclose that.
 */
export function deriveStandingsFromFixtures<T extends FdrTeamRef>(
  teams: T[],
  fixtures: StandingsFixtureRef[],
): DerivedStandings {
  interface Acc {
    played: number;
    win: number;
    draw: number;
    loss: number;
    goalsFor: number;
    goalsAgainst: number;
    results: string[]; // chronological, one per counted fixture
  }
  const acc = new Map<number, Acc>();
  for (const t of teams) {
    acc.set(t.id, { played: 0, win: 0, draw: 0, loss: 0, goalsFor: 0, goalsAgainst: 0, results: [] });
  }

  // fixtures aren't guaranteed ordered by event — sort so `results` (and the
  // "last 5" slice of it) reflects actual chronological order.
  const counted = fixtures
    .filter((f) => f.started && f.team_h_score !== null && f.team_a_score !== null)
    .sort((a, b) => (a.event ?? 0) - (b.event ?? 0));
  // `finished`, not `finished_provisional`, is the wrong signal for "is this
  // score still capable of changing" — verified against real data:
  // finished_provisional flips at the final whistle, well ahead of
  // `finished` (which waits on bonus-point confirmation, per CLAUDE.md and
  // /deadline's own livePhase gate). A fixture that's whistled but still
  // provisional is over, just not confirmed — its score won't move again,
  // so it shouldn't read as "still being played".
  const live = counted.some((f) => f.started && !f.finished_provisional);

  for (const f of counted) {
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

  const byTeam = new Map<number, DerivedStanding>();
  ranked.forEach(([teamId, a], i) => {
    byTeam.set(teamId, {
      played: a.played,
      win: a.win,
      draw: a.draw,
      loss: a.loss,
      points: a.win * 3 + a.draw,
      form: a.results.length > 0 ? a.results.slice(-5).join("") : null,
      position: i + 1,
    });
  });
  return { byTeam, live };
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
  /** Optional, by team id. Supply it to populate `FdrCell.strengthFdr` alongside FPL's own rating. */
  strengthOf?: (teamId: number) => TeamStrength | undefined,
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

    // The home side faces the away side playing *away*, and vice versa — the
    // opponent's strength at the venue they're actually at, not at ours.
    const awayStrength = strengthOf ? strengthFdr(strengthOf(f.team_a), false) : null;
    const homeStrength = strengthOf ? strengthFdr(strengthOf(f.team_h), true) : null;

    push(f.team_h, {
      opp: shortOf.get(f.team_a) ?? "?",
      home: true,
      fdr: f.team_h_difficulty ?? 3,
      ...(awayStrength !== null ? { strengthFdr: awayStrength } : {}),
    });
    push(f.team_a, {
      opp: shortOf.get(f.team_h) ?? "?",
      home: false,
      fdr: f.team_a_difficulty ?? 3,
      ...(homeStrength !== null ? { strengthFdr: homeStrength } : {}),
    });
  }

  return { gwCols, byTeam };
}

/**
 * Mean FDR across `gwCols` for one team, or null when it has no fixtures in
 * the window. `source` selects which rating to average; a `"strength"` average
 * skips cells with no strength rather than substituting the official one, so
 * it never silently mixes the two scales.
 */
export function averageFdr(
  byTeam: Map<number, Map<number, FdrCell[]>>,
  teamId: number,
  gwCols: number[],
  source: FdrSource = "official",
): number | null {
  const cells = byTeam.get(teamId) ?? new Map<number, FdrCell[]>();
  const fdrs = gwCols
    .flatMap((g) => cells.get(g) ?? [])
    .map((c) => (source === "strength" ? c.strengthFdr : c.fdr))
    .filter((n): n is number => n !== undefined);
  return fdrs.length > 0 ? fdrs.reduce((a, b) => a + b, 0) / fdrs.length : null;
}
