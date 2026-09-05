"use client";

import { CHIP_LABELS } from "@/lib/chip-plan";
import { DEFAULT_DECISION_MARGIN } from "@/lib/transfer-optimizer";
import { horizonLabel, type Horizon } from "@/lib/team-state";
import type { TransferMove } from "@/lib/transfers";
import type { TransferPathResult, TransferPathStep } from "@/lib/transfer-path";
import { Spinner } from "@/components/ui/spinner";

interface TransferPathProps {
  result: TransferPathResult | null;
  loading: boolean;
  onRun: () => void;
  /** Whether the current chip plan has anything for the path to shape itself around. */
  hasChipPlan: boolean;
  /** True while the per-event xP series this search reads isn't fully loaded yet. */
  disabled?: boolean;
  /** The horizon the opening gameweek was searched at — stated, because it is a page-level control the reader can change. */
  horizon?: Horizon;
  /** Inputs changed since the result was produced. */
  stale?: boolean;
  /** Set on the pages that own a manual basket: loads the opening move into it. */
  onLoad?: (moves: TransferMove[]) => void;
  /** Signature of whatever is already in the basket, so a loaded opening move can say so. */
  loadedSignature?: string | null;
  /** Signature of a move list, so `loadedSignature` can be compared against the opening move. */
  signatureOf?: (moves: TransferMove[]) => string;
  decisionMargin?: number;
  onDecisionMarginChange?: (v: number) => void;
}

const signed = (v: number, digits = 1) => {
  const rounded = Number(v.toFixed(digits));
  if (rounded === 0) return (0).toFixed(digits);
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
};

/**
 * The forward transfer path — what should happen between now and the last
 * planned chip, not just at this deadline. Gated behind a button on both
 * pages it appears on: it is a bounded but still real search, and never
 * belongs in an eager memo alongside the per-deadline optimiser.
 *
 * Sprint 28 made this the *only* recommendation on /transfers and /deadline.
 * It used to sit below `TransferPlan`, which answered the same question — "what
 * should I do at this deadline" — from `optimizeTransfers().recommended`, at a
 * different horizon, without the decision margin, and the two disagreed on
 * screen with nothing to reconcile them. `optimizeTransfers` still decides the
 * opening gameweek; it just does it inside `planTransferPath` now, where its
 * answer is one step of a sequence rather than a competing headline.
 */
export function TransferPath({
  result,
  loading,
  onRun,
  hasChipPlan,
  disabled,
  horizon,
  stale = false,
  onLoad,
  loadedSignature,
  signatureOf,
  decisionMargin,
  onDecisionMarginChange,
}: TransferPathProps) {
  const opening = result?.recommended?.openingMove ?? null;
  const openingLoaded =
    !!opening && !!signatureOf && loadedSignature !== null && loadedSignature !== undefined
      ? signatureOf(opening.moves) === loadedSignature
      : false;

  return (
    <section className="mt-5 rounded-xl border border-zinc-200 bg-card p-4 dark:border-purple-900/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Transfer path</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {hasChipPlan
              ? "What to do between now and your last planned chip — not just this deadline."
              : "No chips planned, so this only covers a couple of gameweeks. Pin a chip on the Chip timing tab or above to see a real path."}
            {horizon ? ` This deadline is searched over ${horizonLabel(horizon)}; later gameweeks are valued one at a time.` : ""}
          </p>
        </div>
        {stale && (
          <button
            type="button"
            onClick={onRun}
            disabled={loading}
            className="order-first flex w-full items-center justify-between gap-2 rounded-md border border-warning-border bg-warning-surface px-2.5 py-1.5 text-xs font-medium text-warning-foreground transition-colors hover:bg-warning-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:order-none sm:w-auto"
          >
            <span className="flex items-center gap-1.5">
              {loading && <Spinner />}
              {loading ? "Re-running…" : "Inputs changed — re-run"}
            </span>
          </button>
        )}
        {onDecisionMarginChange && decisionMargin !== undefined && (
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <span title="Rolling is only worth something the model cannot see: injury news, price moves, rotation hints. That value is yours to assert, not the model's to claim.">
              Value of waiting for news
            </span>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={decisionMargin}
              aria-label="Assumed points value of waiting a gameweek for news"
              onChange={(e) => {
                const next = Number(e.target.value);
                onDecisionMarginChange(Number.isFinite(next) ? Math.max(0, Math.min(10, next)) : 0);
              }}
              className="w-16 rounded-md border border-input bg-surface-3 px-2 py-1 text-right tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {decisionMargin !== DEFAULT_DECISION_MARGIN && (
              <button
                type="button"
                onClick={() => onDecisionMarginChange(DEFAULT_DECISION_MARGIN)}
                className="rounded text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                reset
              </button>
            )}
          </label>
        )}
        <button
          type="button"
          onClick={onRun}
          disabled={loading || disabled}
          title={disabled ? "Still loading this horizon's expected points" : undefined}
          className="flex min-h-9 items-center gap-1.5 rounded-md border border-purple-700 px-3 py-1.5 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary dark:text-primary dark:hover:bg-primary/10"
        >
          {loading && <Spinner />}
          {loading ? "Planning…" : result ? "Re-plan path" : "Plan the path"}
        </button>
      </div>

      {result && (
        <>
          {result.paths.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No legal path found — the squad may already be at the edge of what the search can move.
            </p>
          ) : (
            <>
              <p role="status" className="mt-3 border-t border-zinc-100 pt-3 text-sm dark:border-purple-900/40">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {signed(result.recommended?.total ?? 0)} xP
                </span>{" "}
                <span className="text-xs text-zinc-500">
                  over holding today&rsquo;s squad unchanged through GW{result.recommended?.steps.at(-1)?.event ?? "?"}
                  {result.runnerUp
                    ? ` — ${result.margin.toFixed(1)} points clear of the next path`
                    : ""}
                  .
                </span>
              </p>

              {result.recommended && (
                <ol className="mt-3 space-y-2">
                  {result.recommended.steps.map((step, i) => (
                    <StepRow
                      key={step.event}
                      step={step}
                      // Only the opening step is actionable — every later one
                      // depends on a squad that does not exist yet.
                      onLoad={i === 0 && onLoad && step.moves.length > 0 ? () => onLoad(step.moves) : undefined}
                      loaded={i === 0 && openingLoaded}
                    />
                  ))}
                </ol>
              )}

              {result.recommended && (
                <p className="mt-2 text-[11px] tabular-nums text-zinc-500">
                  {signed(result.recommended.terms.eventXp)} xP
                  {result.recommended.terms.chipBonus > 0 ? ` + ${result.recommended.terms.chipBonus.toFixed(1)} chip bonus` : ""}
                  {result.recommended.terms.decisionMargin > 0
                    ? ` + ${result.recommended.terms.decisionMargin.toFixed(1)} assumed value of waiting`
                    : ""}
                  {result.recommended.terms.pointsCost > 0 ? ` − ${result.recommended.terms.pointsCost} hit` : ""}
                  {Math.abs(result.recommended.terms.riskPoints) >= 0.05
                    ? ` ${result.recommended.terms.riskPoints > 0 ? "−" : "+"} ${Math.abs(result.recommended.terms.riskPoints).toFixed(1)} risk`
                    : ""}{" "}
                  = <span className="font-semibold">{signed(result.recommended.total)}</span>
                </p>
              )}
            </>
          )}

          <p className="mt-3 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Ran {result.simulationCount} simulations beyond the deadline&rsquo;s own search. {result.note}
          </p>
        </>
      )}
    </section>
  );
}

function StepRow({
  step,
  onLoad,
  loaded,
}: {
  step: TransferPathStep;
  onLoad?: () => void;
  loaded?: boolean;
}) {
  const label = step.chip
    ? `GW${step.event} — ${CHIP_LABELS[step.chip]}`
    : step.moves.length === 0
      ? `GW${step.event} — roll`
      : `GW${step.event} — ${step.moves.length} transfer${step.moves.length === 1 ? "" : "s"}`;

  return (
    <li className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-purple-900/40">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
        <span className="flex items-center gap-3">
          <span className="text-[11px] tabular-nums text-zinc-500">
            {signed(step.eventXp)} xP
            {step.chipBonus > 0 ? ` + ${step.chipBonus.toFixed(1)} chip` : ""}
            {step.decisionMargin > 0 ? ` + ${step.decisionMargin.toFixed(1)} waiting` : ""}
            {step.pointsCost > 0 ? ` − ${step.pointsCost} hit` : ""}
          </span>
          {onLoad && (
            <button
              type="button"
              onClick={onLoad}
              className="shrink-0 rounded-md border border-purple-700 px-2 py-0.5 text-[11px] font-medium text-purple-700 transition-colors hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-primary dark:text-primary dark:hover:bg-primary/10"
            >
              Load
            </button>
          )}
          {loaded && !onLoad && (
            <span className="shrink-0 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              In basket
            </span>
          )}
        </span>
      </div>
      {loaded && onLoad && (
        <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          Already in the basket below.
        </p>
      )}
      {step.explanation.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
          {step.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
