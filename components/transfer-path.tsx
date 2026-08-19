"use client";

import { CHIP_LABELS } from "@/lib/chip-plan";
import type { TransferPathResult, TransferPathStep } from "@/lib/transfer-path";

interface TransferPathProps {
  result: TransferPathResult | null;
  loading: boolean;
  onRun: () => void;
  /** Whether the current chip plan has anything for the path to shape itself around. */
  hasChipPlan: boolean;
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
 */
export function TransferPath({ result, loading, onRun, hasChipPlan }: TransferPathProps) {
  return (
    <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Transfer path</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {hasChipPlan
              ? "What to do between now and your last planned chip — not just this deadline."
              : "No chips planned, so this only covers a couple of gameweeks. Pin a chip on /chips or above to see a real path."}
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          className="min-h-9 rounded-md border border-purple-700 px-3 py-1.5 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary dark:text-primary dark:hover:bg-primary/10"
        >
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
                  {result.recommended.steps.map((step) => (
                    <StepRow key={step.event} step={step} />
                  ))}
                </ol>
              )}

              {result.recommended && (
                <p className="mt-2 text-[11px] tabular-nums text-zinc-500">
                  {signed(result.recommended.terms.eventXp)} xP
                  {result.recommended.terms.chipBonus > 0 ? ` + ${result.recommended.terms.chipBonus.toFixed(1)} chip bonus` : ""}
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

function StepRow({ step }: { step: TransferPathStep }) {
  const label = step.chip
    ? `GW${step.event} — ${CHIP_LABELS[step.chip]}`
    : step.moves.length === 0
      ? `GW${step.event} — roll`
      : `GW${step.event} — ${step.moves.length} transfer${step.moves.length === 1 ? "" : "s"}`;

  return (
    <li className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-purple-900/40">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
        <span className="text-[11px] tabular-nums text-zinc-500">
          {signed(step.eventXp)} xP
          {step.chipBonus > 0 ? ` + ${step.chipBonus.toFixed(1)} chip` : ""}
          {step.pointsCost > 0 ? ` − ${step.pointsCost} hit` : ""}
        </span>
      </div>
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
