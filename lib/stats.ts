// Shared statistics primitives.
//
// `mean` was independently re-declared in five files (lib/scoring.ts,
// lib/squad-score.ts, lib/transfers.ts, app/scenarios/page.tsx, and Deno-side in
// supabase/functions/_shared/xp-model.ts) and `clamp` in three, while no
// percentile, quantile or median existed anywhere. Sprint 12A needed the last
// three for a manager's percentile history, which is the occasion for
// collecting all of it in one place rather than writing a sixth copy of `mean`.
//
// `supabase/functions/_shared/xp-model.ts` is Deno and excluded from tsconfig
// and eslint (see CLAUDE.md), so it cannot import this module — its own copies
// of `mean`/`clamp`/`variance` stay where they are, same as `COLD_START_NOTE`
// is duplicated rather than shared across that boundary.

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** The middle value of a sorted copy of `xs`; averages the two middle values on an even count. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Sample variance (divides by n-1). Zero below two observations, not undefined —
 * a caller asking "how spread out is this" about one point should get "no
 * spread", not a crash.
 */
export function varianceSample(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

export const stdevSample = (xs: number[]): number => Math.sqrt(varianceSample(xs));

/**
 * Population variance (divides by n) — the form `lib/scoring.ts`'s risk engine
 * has always used. Kept as a distinct function rather than folded into the
 * sample form above: they are not the same number, and `riskScore` must not
 * move when it switches to importing this module instead of declaring its own.
 */
export function variancePopulation(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
}

export const stdevPopulation = (xs: number[]): number => Math.sqrt(variancePopulation(xs));

/**
 * The value at percentile `p` (0-1) of `xs`, by linear interpolation between
 * the two nearest ranks (the "R-7" / Excel `PERCENTILE.INC` method — the one
 * most readers' intuition for "P90" already matches).
 *
 * Example: quantile([1,2,3,4,5,6,7,8,9,10], 0.9) — rank = 0.9 * 9 = 8.1, so it
 * is 0.9 seven-tenths from index 8 (value 9) to index 9 (value 10) = 9.9.
 */
export function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];

  const rank = clamp(p, 0, 1) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];

  const fraction = rank - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * fraction;
}

/**
 * Least-squares slope of `ys` against 0..n-1 — "how much per step", signed.
 * Zero below two points. Used for a manager's percentile trend across seasons,
 * where the seasons are already ordered but not evenly dated.
 */
export function linearSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;

  const xs = ys.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(ys);

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** One residual: a predicted value and the actual value it is scored against. */
export interface Residual {
  pred: number;
  actual: number;
}

/**
 * Bias, MAE, RMSE and Pearson r over a set of prediction residuals. Lifted
 * out of `scripts/backtest-walkforward.ts` (was a locally-declared `stats`
 * there) so the walk-forward backtest and the live prediction-accuracy
 * scoreboard (`lib/prediction-accuracy.ts`) score residuals the same way —
 * "one quantity, one implementation" applies to the accuracy metric itself,
 * not just the model. `n === 0` reports `NaN` for every derived figure
 * rather than 0, so an empty gameweek reads as "no data" and not as "zero
 * error" — a caller must check `n` before trusting the rest.
 */
export function accuracyStats(residuals: Residual[]): {
  n: number;
  bias: number;
  mae: number;
  rmse: number;
  r: number;
} {
  const n = residuals.length;
  if (n === 0) return { n: 0, bias: NaN, mae: NaN, rmse: NaN, r: NaN };
  const bias = mean(residuals.map((x) => x.actual - x.pred));
  const mae = mean(residuals.map((x) => Math.abs(x.actual - x.pred)));
  const rmse = Math.sqrt(mean(residuals.map((x) => (x.actual - x.pred) ** 2)));
  const mp = mean(residuals.map((x) => x.pred));
  const ma = mean(residuals.map((x) => x.actual));
  const cov = mean(residuals.map((x) => (x.pred - mp) * (x.actual - ma)));
  const sp = Math.sqrt(mean(residuals.map((x) => (x.pred - mp) ** 2)));
  const sa = Math.sqrt(mean(residuals.map((x) => (x.actual - ma) ** 2)));
  const r = sp > 0 && sa > 0 ? cov / (sp * sa) : NaN;
  return { n, bias, mae, rmse, r };
}
