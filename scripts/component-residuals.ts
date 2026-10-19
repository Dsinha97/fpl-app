// Sprint 43 — what the shipped model actually got right and wrong, per component.
//
// Reads the pre-deadline `player_prediction_archive` (what was really shown before
// each deadline, by whichever MODEL_VERSION was live) and joins it to
// `player_gameweek_stats` per player-fixture, over landed fixtures only (the
// same `landedFixtures` gate the live scoreboard uses — an unwritten fixture
// reads all zeros and would count every player as a blank).
//
// Prints, per model version:
//   - the component reconciliation (lib/component-reconciliation.ts): mean raw
//     predicted vs realised points per component, per position;
//   - calibration by predicted P(appear) bucket;
//   - bias / MAE / Pearson r / Spearman ρ, pooled.
//
// Then a REPLAY: the same archived production inputs (post-shrinkage,
// post-reconciliation, with FPL's availability flags — the population the
// walk-forward harness cannot reach) re-scored through the current
// `predict()` rules, so a model change can be checked on what production
// actually fed it. The archive stores only part of each player's rates, so the
// replay reconstructs the rest, exactly where it can:
//   - goals, bonus, cards are linear in minutes: scaled by the minutes ratio;
//   - clean sheet depends only on p60, which the change leaves alone;
//   - assists: scaled by the minutes ratio and `assistsPerXa`;
//   - appearance and defensive contribution: recomputed from the stored
//     start probability, expected minutes, availability and dc90;
//   - saves and goals conceded: the per-fixture rate is recovered by inverting
//     `expectedFloorDiv` (monotone, bisection) and re-spread over the states;
//   - goalkeeper minutes: re-filled to 90 per club fixture with the stored
//     prior weights, as `reconcileClubSquadWeighted` now does. Approximate —
//     it starts from already-reconciled minutes rather than raw ones.
// Not replayed: the in-season minutes model for GW2-6 (those rows predate it).
//
// Read-only, publishable key. Usage:
//   set -a; . ./.env.local; set +a; npx tsx scripts/component-residuals.ts [season]

import {
  calibrationByBucket,
  COMPONENTS,
  formatCalibration,
  formatComponentSummary,
  realisedComponents,
  summariseComponents,
  type CalibrationRow,
  type ComponentPoints,
  type ComponentRow,
} from "../lib/component-reconciliation";
import { loadScoringRules, type PositionShort, type ScorableLine } from "../lib/fpl-scoring-rules";
import { fetchAllPages, landedFixtures, loadPositionByCode } from "../lib/prediction-accuracy";
import { accuracyStats, spearman } from "../lib/stats";
import { supabase } from "../lib/supabase/client";
import {
  expectedFloorDiv,
  minuteStates,
  MODEL_PARAMS,
  MODEL_VERSION,
  negBinAtLeast,
  solveWeightedWaterFill,
} from "../supabase/functions/_shared/xp-model.ts";

const season = process.argv[2] ?? "2026-27";

/**
 * Archive column per model component. The select strings above spell the same
 * columns out literally — Supabase's typed `.select()` needs one string literal
 * (CLAUDE.md), so this map is the read-back side only.
 */
const ARCHIVE_COLUMN: Record<(typeof COMPONENTS)[number], string> = {
  appearance: "xp_appearance",
  goals: "xp_goals",
  assists: "xp_assists",
  cleanSheet: "xp_clean_sheet",
  goalsConceded: "xp_goals_conceded",
  saves: "xp_saves",
  bonus: "xp_bonus",
  defensiveContribution: "xp_defensive_contribution",
  cards: "xp_cards",
};

/** Mirrors `predict()`'s appearance-minutes constant (MODEL_PARAMS.appearanceMinutes) for v1.6.0 and earlier. */
const LEGACY_APPEARANCE_MINUTES = 72;

async function main() {
  const [archive, stats, positions, rules] = await Promise.all([
    fetchAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("player_prediction_archive")
        .select(
          "event, player_code, fixture, model_version, expected_minutes, start_probability, availability, p60, prior_weight, rates, xp, xp_appearance, xp_goals, xp_assists, xp_clean_sheet, xp_goals_conceded, xp_saves, xp_bonus, xp_defensive_contribution, xp_cards",
        )
        .eq("season", season)
        .order("event")
        .order("player_code")
        .order("fixture")
        .range(from, to),
    ),
    fetchAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("player_gameweek_stats")
        .select(
          "player_code, fixture, minutes, total_points, goals_scored, assists, clean_sheets, goals_conceded, own_goals, penalties_saved, penalties_missed, yellow_cards, red_cards, saves, bonus, defensive_contribution",
        )
        .eq("season", season)
        .order("player_code")
        .order("fixture")
        .range(from, to),
    ),
    loadPositionByCode(season),
    loadScoringRules(season),
  ]);
  const teams = await fetchAllPages<{ code: number; team_id: number }>((from, to) =>
    supabase.from("players").select("code, team_id").eq("season", season).order("code").range(from, to),
  );
  const teamByCode = new Map(teams.map((t) => [t.code, t.team_id]));

  const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
  const actuals: (Record<string, unknown> & { fixture: number; minutes: number })[] = stats.map(
    (r) => ({ ...r, fixture: num(r.fixture), minutes: num(r.minutes) }),
  );
  const landed = landedFixtures(actuals);
  const actualByKey = new Map(
    actuals.filter((a) => landed.has(a.fixture)).map((a) => [`${a.player_code}:${a.fixture}`, a]),
  );

  console.log(
    `Input fingerprint @ ${new Date().toISOString()}: season=${season} archive=${archive.length} ` +
      `gameweekStats=${stats.length} landedFixtures=${landed.size} positions=${positions.size}`,
  );

  type Joined = { p: Record<string, unknown>; line: ScorableLine; position: PositionShort };
  const joined: Joined[] = [];
  for (const p of archive) {
    const actual = actualByKey.get(`${p.player_code}:${p.fixture}`);
    const position = positions.get(p.player_code as number) as PositionShort | undefined;
    if (!actual || !position) continue;
    joined.push({
      p,
      position,
      line: {
        minutes: num(actual.minutes),
        total_points: num(actual.total_points),
        goals_scored: num(actual.goals_scored),
        assists: num(actual.assists),
        clean_sheets: num(actual.clean_sheets),
        goals_conceded: num(actual.goals_conceded),
        own_goals: num(actual.own_goals),
        penalties_saved: num(actual.penalties_saved),
        penalties_missed: num(actual.penalties_missed),
        yellow_cards: num(actual.yellow_cards),
        red_cards: num(actual.red_cards),
        saves: num(actual.saves),
        bonus: num(actual.bonus),
        defensive_contribution: actual.defensive_contribution === null ? null : num(actual.defensive_contribution),
      },
    });
  }

  // ---- as shipped ----------------------------------------------------------
  const byVersion = new Map<string, Group>();
  for (const { p, line, position } of joined) {
    const predicted = Object.fromEntries(COMPONENTS.map((c) => [c, num(p[ARCHIVE_COLUMN[c]])])) as ComponentPoints;
    groupFor(byVersion, p.model_version as string).add(p.event as number, {
      position,
      predicted,
      predictedXp: num(p.xp),
      realised: realisedComponents(line, position, rules),
      actualTotal: line.total_points,
    }, Math.min(1, num(p.expected_minutes) / LEGACY_APPEARANCE_MINUTES), num(p.p60), line.minutes);
  }
  for (const [version, g] of [...byVersion.entries()].sort()) {
    report(`${season} · ${version} as shipped`, g,
      "P(appear) here is the archive's expected_minutes / 72, the rule v1.6.0 and earlier used");
  }

  // ---- replayed through the current rules ----------------------------------
  // Goalkeeper minutes, re-filled per club fixture (see the header).
  const gkMinutes = new Map<Joined, number>();
  const gkGroups = new Map<string, Joined[]>();
  for (const j of joined) {
    if (j.position !== "GKP") continue;
    const key = `${j.p.event}:${j.p.fixture}:${teamByCode.get(j.p.player_code as number)}`;
    const list = gkGroups.get(key) ?? [];
    list.push(j);
    gkGroups.set(key, list);
  }
  for (const group of gkGroups.values()) {
    const fit = solveWeightedWaterFill(
      group.map((j) => num(j.p.expected_minutes)),
      group.map((j) => 90 * num(j.p.availability)),
      group.map((j) => Math.min(1, Math.max(0, num(j.p.prior_weight ?? 1)))),
      90,
    );
    group.forEach((j, i) => gkMinutes.set(j, fit.status === "ok" ? fit.q[i] : num(j.p.expected_minutes)));
  }

  const replayed = new Map<string, Group>();
  for (const j of joined) {
    const { p, line, position } = j;
    const pts = (stat: string) => rules.valueFor(stat, position);
    const oldMinutes = num(p.expected_minutes);
    const newMinutes = gkMinutes.get(j) ?? oldMinutes;
    const ratio = oldMinutes > 0 ? newMinutes / oldMinutes : 0;
    const availability = num(p.availability);
    const startProbability = num(p.start_probability);
    const states = minuteStates(startProbability, newMinutes, availability, position === "GKP");
    const pAny = Math.min(1, states.reduce((sum, st) => sum + st.probability, 0));
    const p60 = Math.min(num(p.p60), pAny);
    const over = (f: (share: number) => number) => states.reduce((sum, st) => sum + st.probability * f(st.minutes / 90), 0);

    // Per-fixture count rates for the floor-divided components, recovered from
    // what the archived (mean-field) prediction scored them at.
    const perMinute = (archived: number, unitPoints: number, divisor: number) =>
      oldMinutes > 0 && unitPoints !== 0 ? invertFloorDiv(archived / unitPoints, divisor) / oldMinutes : 0;
    const concededPerMinute = perMinute(num(p.xp_goals_conceded), pts("goals_conceded"), MODEL_PARAMS.concededPerPenalty);
    const savesPerMinute = perMinute(num(p.xp_saves), pts("saves"), MODEL_PARAMS.savesPerPoint);

    const rates = (p.rates ?? {}) as Record<string, number>;
    const threshold = MODEL_PARAMS.dcThreshold[ELEMENT_TYPE_ID[position]] ?? 0;
    const dcSize = MODEL_PARAMS.dcDispersion[ELEMENT_TYPE_ID[position]] ?? Infinity;

    const predicted: ComponentPoints = {
      appearance: pts("long_play") * p60 + pts("short_play") * Math.max(0, pAny - p60),
      goals: num(p.xp_goals) * ratio,
      assists: num(p.xp_assists) * ratio * (MODEL_PARAMS.assistsPerXa[position] ?? 1),
      cleanSheet: num(p.p60) > 0 ? num(p.xp_clean_sheet) * (p60 / num(p.p60)) : 0,
      goalsConceded: pts("goals_conceded") *
        over((share) => expectedFloorDiv(concededPerMinute * share * 90, MODEL_PARAMS.concededPerPenalty)),
      saves: pts("saves") * over((share) => expectedFloorDiv(savesPerMinute * share * 90, MODEL_PARAMS.savesPerPoint)),
      bonus: num(p.xp_bonus) * ratio,
      defensiveContribution: threshold > 0
        ? pts("defensive_contribution") * over((share) => negBinAtLeast(num(rates.dc90) * share, dcSize, threshold))
        : 0,
      cards: num(p.xp_cards) * ratio,
    };
    const raw = COMPONENTS.reduce((sum, c) => sum + predicted[c], 0);
    groupFor(replayed, `${MODEL_VERSION} replayed on ${p.model_version} inputs`).add(p.event as number, {
      position,
      predicted,
      predictedXp: raw * (MODEL_PARAMS.positionCalibration[position] ?? 1),
      realised: realisedComponents(line, position, rules),
      actualTotal: line.total_points,
    }, pAny, p60, line.minutes);
  }
  for (const [label, g] of [...replayed.entries()].sort()) {
    report(`${season} · ${label}`, g, "P(appear) here is the replayed start + cameo states (minuteStates)");
  }
}

const ELEMENT_TYPE_ID: Record<PositionShort, number> = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };

/** The λ with `expectedFloorDiv(λ, d) = target` — monotone in λ, so bisection. */
function invertFloorDiv(target: number, d: number): number {
  if (target <= 0) return 0;
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (expectedFloorDiv(mid, d) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

interface Group {
  components: ComponentRow[];
  calibration: CalibrationRow[];
  events: Set<number>;
  add(event: number, row: ComponentRow, pAppear: number, p60: number, minutes: number): void;
}

function groupFor(map: Map<string, Group>, key: string): Group {
  let g = map.get(key);
  if (!g) {
    const created: Group = {
      components: [],
      calibration: [],
      events: new Set(),
      add(event, row, pAppear, p60, minutes) {
        created.events.add(event);
        created.components.push(row);
        created.calibration.push({ pAppear, p60, pred: row.predictedXp, actual: row.actualTotal, minutes });
      },
    };
    g = created;
    map.set(key, g);
  }
  return g;
}

function report(title: string, g: Group, note: string) {
  const residuals = g.calibration.map((r) => ({ pred: r.pred, actual: r.actual }));
  const st = accuracyStats(residuals);
  console.log(
    `\n=== ${title} · GW ${[...g.events].sort((x, y) => x - y).join(",")} ===\n` +
      `  pooled n=${st.n} bias=${st.bias.toFixed(3)} mae=${st.mae.toFixed(3)} r=${st.r.toFixed(3)} ` +
      `spearman=${spearman(residuals).toFixed(3)}  (bias = mean(actual − predicted))`,
  );
  console.log(formatComponentSummary(summariseComponents(g.components)));
  console.log(formatCalibration(calibrationByBucket(g.calibration)));
  console.log(`  (${note})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
