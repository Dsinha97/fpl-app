"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadSeasonContext } from "@/lib/season-context";
import {
  ACCURACY_MODEL_NOTE,
  buildAccuracyReport,
  loadPositionByCode,
  type AccuracyReport,
} from "@/lib/prediction-accuracy";
import { InfoTooltip } from "@/components/info-tooltip";

/**
 * How the shipped xP model has actually done against real results.
 *
 * The data layer (`lib/prediction-accuracy.ts`) shipped in Sprint 27 with no
 * caller on purpose: a residual needs both a prediction and a result, and
 * until GW3 was scored the archive/results intersection was a single
 * gameweek. A panel on n=1 could only invite reading one gameweek's noise as
 * a verdict on the model, which is the opposite of what this is for.
 *
 * Everything here is deliberately stated rather than netted, per CLAUDE.md's
 * "say what the number means": which gameweeks were scored, how many
 * residuals, and which direction the bias runs — never a bare magnitude.
 */

const POSITION_ORDER = ["GKP", "DEF", "MID", "FWD"];

/**
 * `accuracyStats` defines `bias = mean(actual - pred)`, so a NEGATIVE bias
 * means the model predicted more than happened. That sign is easy to read
 * backwards — `docs/phase-4-model.md` states it both ways in prose — so the
 * direction is spelled out here rather than left to the reader.
 */
function biasPhrase(bias: number): string {
  if (!Number.isFinite(bias)) return "—";
  if (Math.abs(bias) < 0.005) return "level";
  return bias < 0 ? "over-predicts" : "under-predicts";
}

const num = (v: number, dp = 3): string => (Number.isFinite(v) ? v.toFixed(dp) : "—");

interface ScoreboardState {
  season: string;
  report: AccuracyReport;
  /** Scored gameweeks whose fixtures are not all `finished` — bonus still provisional. */
  provisional: number[];
}

export function AccuracyScoreboard() {
  const [state, setState] = useState<ScoreboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadSeasonContext();
      const positionByCode = await loadPositionByCode(ctx.season);
      const report = await buildAccuracyReport(ctx.season, positionByCode);

      // A gameweek whose fixtures are `finished_provisional` but not
      // `finished` has had its bonus points calculated but not confirmed, so
      // a handful of residuals in it can still move by a point or three.
      let provisional: number[] = [];
      if (report.events.length > 0) {
        const { data, error: fxError } = await supabase
          .from("fixtures")
          .select("event, finished")
          .eq("season", ctx.season)
          .in("event", report.events);
        if (fxError) throw new Error(fxError.message);
        provisional = [
          ...new Set(
            (data ?? []).filter((f) => f.finished !== true).map((f) => f.event as number),
          ),
        ].sort((a, b) => a - b);
      }

      setState({ season: ctx.season, report, provisional });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Static export: no server component to load from, so an effect is the
    // only place this can happen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const rows = state
    ? [
        { label: "All players", stats: state.report.overall },
        ...POSITION_ORDER.filter((p) => state.report.byPosition[p]).map((p) => ({
          label: p,
          stats: state.report.byPosition[p],
        })),
      ]
    : [];

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Model accuracy
        </h2>
        <InfoTooltip label="How is model accuracy measured?">
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
            Archived predictions vs. real results
          </p>
          <p className="mt-1.5">{ACCURACY_MODEL_NOTE}</p>
          <p className="mt-1.5">
            Bias is the mean of (actual &minus; predicted), so a negative figure means the model
            predicted more points than were scored. MAE and RMSE are error sizes, lower is
            better. Pearson r is how well the ranking held up, higher is better.
          </p>
        </InfoTooltip>
      </div>

      {loading && <p className="mt-3 text-sm text-zinc-500">Scoring the archive…</p>}

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          Could not score the archive: {error}
        </p>
      )}

      {state && !loading && state.report.events.length === 0 && (
        <p className="mt-3 text-sm text-zinc-500">
          Nothing to score yet — no archived gameweek has results to join against.
        </p>
      )}

      {state && !loading && state.report.events.length > 0 && (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {state.season} · scored GW
            {state.report.events.join(", GW")} ·{" "}
            <span className="tabular-nums">{state.report.overall.n.toLocaleString()}</span>{" "}
            player-fixtures. The model{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {biasPhrase(state.report.overall.bias)}
            </span>{" "}
            by {num(Math.abs(state.report.overall.bias), 2)} points per player-fixture.
          </p>

          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                  <th className="px-3 py-2">Cohort</th>
                  <th className="px-3 py-2 text-right">n</th>
                  <th className="px-3 py-2 text-right">Bias</th>
                  <th className="px-3 py-2">Direction</th>
                  <th className="px-3 py-2 text-right">MAE</th>
                  <th className="px-3 py-2 text-right">RMSE</th>
                  <th className="px-3 py-2 text-right">r</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.label}
                    className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-purple-900/30 dark:text-zinc-200"
                  >
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.stats.n.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(row.stats.bias)}</td>
                    <td className="px-3 py-2 text-zinc-500">{biasPhrase(row.stats.bias)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(row.stats.mae)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(row.stats.rmse)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(row.stats.r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-zinc-400">
            {state.report.events.length < 5 && (
              <>
                {state.report.events.length} scored gameweek
                {state.report.events.length === 1 ? "" : "s"} is a running count, not a verdict —
                a single gameweek is dominated by match variance the model does not claim to
                predict.{" "}
              </>
            )}
            {state.provisional.length > 0 && (
              <>
                GW{state.provisional.join(", GW")}{" "}
                {state.provisional.length === 1 ? "has" : "have"} provisional bonus points
                (fixtures scored but not confirmed), so those residuals can still move.{" "}
              </>
            )}
            GW1 is permanently absent: the archive did not exist before its deadline.
          </p>
        </>
      )}
    </section>
  );
}
