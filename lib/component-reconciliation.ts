// Per-component reconciliation of predicted xP against realised points.
//
// A pooled bias cannot say *which* part of the model is wrong, and a single
// multiplicative `positionCalibration` can hide several opposite errors at once:
// measured on live 2026-27 (GW2-6, Sprint 43), defensive contribution came in
// ~3.5x under-predicted and assists under-predicted while goals, bonus and saves
// were already right, and the x1.22-1.27 scalar inflated the right ones to cover
// the wrong ones. This module scores each component separately so that kind of
// error shows up instead of cancelling.
//
// Realised component points come from `breakdownFor` (lib/fpl-scoring-rules.ts),
// the same derivation the player card shows, so there is one mapping from match
// stats to points, not two. Anything the model has no component for (penalties
// saved/missed, own goals, and whatever `breakdownFor` reports as Unattributed)
// is kept as `other` rather than dropped, so the components still sum to the
// recorded total.
//
// Calibration-by-bucket is the companion check. Splitting residuals by the
// *realised* outcome (played / did not) is opposite-signed for any honest
// probabilistic forecast — see docs/sprints/dsi-185-minutes-model.md §1 — so the
// question it answers is the wrong one. Bucketing by the *predicted* probability
// of appearing asks whether players the model calls a 30% chance play 30% of the
// time, and score what such players score.

import { breakdownFor, type BreakdownLine, type PositionShort, type ScorableLine, type ScoringRules } from "./fpl-scoring-rules";
import { mean } from "./stats";

/** The model's own component names, as `Prediction.components` spells them. */
export const COMPONENTS = [
  "appearance",
  "goals",
  "assists",
  "cleanSheet",
  "goalsConceded",
  "saves",
  "bonus",
  "defensiveContribution",
  "cards",
] as const;
export type Component = (typeof COMPONENTS)[number];
export type ComponentPoints = Record<Component, number>;
export type RealisedPoints = ComponentPoints & { other: number };

const COMPONENT_OF_IDENTIFIER: Record<string, Component | "other"> = {
  minutes: "appearance",
  goals_scored: "goals",
  assists: "assists",
  clean_sheets: "cleanSheet",
  goals_conceded: "goalsConceded",
  saves: "saves",
  bonus: "bonus",
  defensive_contribution: "defensiveContribution",
  yellow_cards: "cards",
  red_cards: "cards",
};

export const zeroComponents = (): ComponentPoints =>
  Object.fromEntries(COMPONENTS.map((c) => [c, 0])) as ComponentPoints;

/** Folds a `breakdownFor` result into the model's components, plus `other`. */
export function componentsFromBreakdown(lines: BreakdownLine[]): RealisedPoints {
  const out: RealisedPoints = { ...zeroComponents(), other: 0 };
  for (const l of lines) out[COMPONENT_OF_IDENTIFIER[l.identifier] ?? "other"] += l.points;
  return out;
}

/**
 * Realised component points for one player-fixture. `dcScores` is false for a
 * season before FPL scored defensive contribution (2025/26 on): the stat may
 * be recorded, but it earned nothing, and `total_points` agrees.
 */
export function realisedComponents(
  line: ScorableLine,
  position: PositionShort,
  rules: ScoringRules,
  dcScores = true,
): RealisedPoints {
  const scored = dcScores ? line : { ...line, defensive_contribution: null };
  return componentsFromBreakdown(breakdownFor(scored, position, rules));
}

export interface ComponentRow {
  position: string;
  /** Raw component points, before `positionCalibration`. */
  predicted: ComponentPoints;
  /** Final xP, after calibration. */
  predictedXp: number;
  realised: RealisedPoints;
  actualTotal: number;
}

export interface ComponentSummary {
  position: string;
  n: number;
  predicted: ComponentPoints;
  realised: RealisedPoints;
  rawSum: number;
  predictedXp: number;
  actualTotal: number;
}

/** Mean predicted vs realised per component, per position, plus an ALL row. */
export function summariseComponents(rows: ComponentRow[]): ComponentSummary[] {
  const groups = new Map<string, ComponentRow[]>();
  for (const r of rows) {
    for (const key of [r.position, "ALL"]) {
      const g = groups.get(key);
      if (g) g.push(r); else groups.set(key, [r]);
    }
  }
  const order = ["GKP", "DEF", "MID", "FWD", "ALL"];
  return [...groups.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([position, g]) => {
      const predicted = zeroComponents();
      const realised: RealisedPoints = { ...zeroComponents(), other: 0 };
      for (const c of COMPONENTS) {
        predicted[c] = mean(g.map((r) => r.predicted[c]));
        realised[c] = mean(g.map((r) => r.realised[c]));
      }
      realised.other = mean(g.map((r) => r.realised.other));
      return {
        position,
        n: g.length,
        predicted,
        realised,
        rawSum: COMPONENTS.reduce((s, c) => s + predicted[c], 0),
        predictedXp: mean(g.map((r) => r.predictedXp)),
        actualTotal: mean(g.map((r) => r.actualTotal)),
      };
    });
}

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "  n/a");

/** One line per position: `component pred/actual` pairs, then the totals. */
export function formatComponentSummary(summary: ComponentSummary[]): string {
  const lines = [
    "  component reconciliation — mean points per player-fixture, raw predicted / realised",
  ];
  for (const s of summary) {
    const cells = COMPONENTS
      .filter((c) => s.predicted[c] !== 0 || s.realised[c] !== 0)
      .map((c) => `${c} ${f3(s.predicted[c])}/${f3(s.realised[c])}`);
    lines.push(
      `    ${s.position.padEnd(3)} n=${String(s.n).padStart(6)}  ${cells.join("  ")}  other —/${f3(s.realised.other)}`,
    );
    lines.push(
      `        raw sum ${f3(s.rawSum)} -> calibrated xP ${f3(s.predictedXp)} vs actual ${f3(s.actualTotal)}`,
    );
  }
  return lines.join("\n");
}

export interface CalibrationRow {
  /** Predicted probability of appearing at all. */
  pAppear: number;
  /** Predicted probability of 60+ minutes. */
  p60: number;
  pred: number;
  actual: number;
  minutes: number;
}

export interface CalibrationBucket {
  lo: number;
  hi: number;
  n: number;
  pAppear: number;
  appeared: number;
  p60: number;
  played60: number;
  pred: number;
  actual: number;
}

/** Equal-width buckets on predicted P(appear). */
export function calibrationByBucket(rows: CalibrationRow[], buckets = 5): CalibrationBucket[] {
  const out: CalibrationBucket[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = b / buckets;
    const hi = (b + 1) / buckets;
    const g = rows.filter((r) => r.pAppear >= lo && (b === buckets - 1 ? r.pAppear <= hi : r.pAppear < hi));
    out.push({
      lo,
      hi,
      n: g.length,
      pAppear: mean(g.map((r) => r.pAppear)),
      appeared: mean(g.map((r) => (r.minutes > 0 ? 1 : 0))),
      p60: mean(g.map((r) => r.p60)),
      played60: mean(g.map((r) => (r.minutes >= 60 ? 1 : 0))),
      pred: mean(g.map((r) => r.pred)),
      actual: mean(g.map((r) => r.actual)),
    });
  }
  return out;
}

export function formatCalibration(buckets: CalibrationBucket[]): string {
  const lines = [
    "  calibration by predicted P(appear) — predicted / realised",
    "    bucket       n    appear         60+          points",
  ];
  for (const b of buckets) {
    lines.push(
      `    ${b.lo.toFixed(1)}-${b.hi.toFixed(1)} ${String(b.n).padStart(6)}  ` +
        `${f3(b.pAppear)}/${f3(b.appeared)}  ${f3(b.p60)}/${f3(b.played60)}  ${f3(b.pred)}/${f3(b.actual)}`,
    );
  }
  return lines.join("\n");
}
