"use client";

import { useState } from "react";
import {
  DEFAULT_DECISION_MARGIN,
  type Branch,
  type OptimizerResult,
} from "@/lib/transfer-optimizer";
import { horizonLabel, type ChipKind, type Horizon } from "@/lib/team-state";
import type { TransferMove } from "@/lib/transfers";
import { CHIP_LABELS } from "@/lib/chip-plan";
import { Spinner } from "@/components/ui/spinner";

interface TransferPlanProps {
  result: OptimizerResult | null;
  horizon: Horizon;
  /** The gameweek being decided, for "GW1 → GW2" wording. */
  event: number;
  decisionMargin: number;
  onDecisionMarginChange: (value: number) => void;
  onLoad: (moves: TransferMove[]) => void;
  /** Signature of the basket currently loaded, so the active row is marked. */
  loadedSignature: string | null;
  loading: boolean;
  /** True once horizon/free transfers/decision margin/chip plan have moved since this result was computed. */
  stale?: boolean;
  onRerun?: () => void;
}

export const signatureOf = (moves: TransferMove[]) =>
  moves
    .map((m) => `${m.outId}>${m.inId}`)
    .sort()
    .join("|");

/**
 * Signed to the displayed precision, so a value that rounds to nothing reads as
 * "0.0" rather than "-0.0" — which looks like a rendering bug and invites the
 * reader to distrust the rest of the row.
 */
const signed = (v: number, digits = 1) => {
  const rounded = Number(v.toFixed(digits));
  if (rounded === 0) return (0).toFixed(digits);
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
};

/**
 * "Bench Boost GW5, Wildcard GW8" from whatever chip terms any branch's
 * simulation carries — a wildcard's mask repeats across every event it
 * covers, so this reports only the earliest (its own gameweek) per chip.
 */
function summarizeChipTerms(result: OptimizerResult): string | null {
  const terms = result.branches.flatMap((b) => b.simulation?.after.chipAdjustment?.terms ?? []);
  if (terms.length === 0) return null;
  const minEventByChip = new Map<ChipKind, number>();
  for (const t of terms) {
    const cur = minEventByChip.get(t.chip);
    if (cur === undefined || t.event < cur) minEventByChip.set(t.chip, t.event);
  }
  return [...minEventByChip.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([chip, event]) => `${CHIP_LABELS[chip]} GW${event}`)
    .join(", ");
}

const CONFIDENCE_STYLE: Record<OptimizerResult["confidence"], string> = {
  high: "text-emerald-700 dark:text-emerald-400",
  medium: "text-zinc-600 dark:text-zinc-400",
  low: "text-amber-700 dark:text-amber-400",
};

/**
 * The weekly decision: roll, spend, take a hit, or wildcard.
 *
 * Every row shows its arithmetic rather than a bare net, so the hit and the
 * assumed value of waiting can each be argued with separately. Blocked options
 * stay visible with their reason — an option that silently disappears reads as a
 * bug, and "no wildcard until GW2" is information.
 */
export function TransferPlan({
  result,
  horizon,
  event,
  decisionMargin,
  onDecisionMarginChange,
  onLoad,
  loadedSignature,
  loading,
  stale = false,
  onRerun,
}: TransferPlanProps) {
  // Collapsed by default — TRANSFER_MODEL_NOTE runs to a full paragraph and
  // ate the whole screen below the branch list on mobile. Same idiom as the
  // chips page's model-note banner.
  const [noteOpen, setNoteOpen] = useState(false);
  const chipSummary = result ? summarizeChipTerms(result) : null;

  return (
    <section className="mt-5 rounded-xl border border-zinc-200 bg-card p-4 dark:border-purple-900/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            What should I do in GW{event}?
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Every option scored over {horizonLabel(horizon)} by the same simulator as the basket
            below.
          </p>
        </div>
        {stale && onRerun && (
          <button
            type="button"
            onClick={onRerun}
            disabled={loading}
            className="order-first flex w-full items-center justify-between gap-2 rounded-md border border-warning-border bg-warning-surface px-2.5 py-1.5 text-xs font-medium text-warning-foreground transition-colors hover:bg-warning-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:order-none sm:w-auto"
          >
            <span className="flex items-center gap-1.5">
              {loading && <Spinner />}
              {loading ? "Re-running…" : "Inputs changed — re-run"}
            </span>
          </button>
        )}
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
      </div>

      {loading && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Searching transfer baskets…
        </p>
      )}

      {!loading && result && (
        <>
          {chipSummary && (
            <p className="mt-3 border-t border-border pt-3 text-xs text-purple-700 dark:text-primary">
              Conditioned on: {chipSummary}.
            </p>
          )}
          <p
            role="status"
            className={`${chipSummary ? "mt-2" : "mt-3 border-t border-zinc-100 pt-3 dark:border-purple-900/40"} text-sm`}
          >
            {result.holdIsBest ? (
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                Nothing available improves on this squad — hold.
              </span>
            ) : (
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {result.recommended?.label ?? "No option available"}
              </span>
            )}{" "}
            <span className={CONFIDENCE_STYLE[result.confidence]}>
              {result.confidence} confidence — {result.confidenceReason}
            </span>
          </p>

          <ul className="mt-3 space-y-2">
            {result.branches.map((branch, index) => (
              <BranchRow
                key={`${branch.kind}-${branch.label}`}
                branch={branch}
                isRecommended={index === 0 && branch.blocked === null && !result.holdIsBest}
                isLoaded={
                  branch.moves.length > 0 && signatureOf(branch.moves) === loadedSignature
                }
                onLoad={onLoad}
              />
            ))}
          </ul>

          <div className="mt-3 overflow-hidden rounded-md border border-zinc-200 dark:border-purple-900/40">
            <button
              type="button"
              onClick={() => setNoteOpen((v) => !v)}
              aria-expanded={noteOpen}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[10px] leading-relaxed text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <span
                aria-hidden="true"
                className={`shrink-0 text-zinc-400 transition-transform ${noteOpen ? "" : "rotate-180"}`}
              >
                ⌃
              </span>
              <span className={`min-w-0 flex-1 ${noteOpen ? "" : "truncate"}`}>
                Free transfers next gameweek if you spend none now: {result.accruedFreeTransfers}.{" "}
                {result.note}
              </span>
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function BranchRow({
  branch,
  isRecommended,
  isLoaded,
  onLoad,
}: {
  branch: Branch;
  isRecommended: boolean;
  isLoaded: boolean;
  onLoad: (moves: TransferMove[]) => void;
}) {
  const blocked = branch.blocked !== null;

  return (
    <li
      className={`rounded-lg border px-3 py-2 ${
        blocked
          ? "border-zinc-200 bg-zinc-50 dark:border-purple-900/30 dark:bg-secondary/30"
          : isRecommended
            ? "border-purple-400 bg-purple-50/50 dark:border-primary/50 dark:bg-primary/5"
            : "border-zinc-200 dark:border-purple-900/40"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span
            className={`text-sm font-medium ${
              blocked ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-800 dark:text-zinc-200"
            }`}
          >
            {branch.label}
          </span>
          {isRecommended && (
            <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
              Best
            </span>
          )}
          {isLoaded && (
            <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              in basket
            </span>
          )}
        </span>

        {blocked ? (
          <span className="text-xs text-zinc-500">{branch.blocked}</span>
        ) : (
          <span className="flex items-baseline gap-2">
            {/* The arithmetic in full: the hit and the news assumption are each
                their own term, so neither hides inside the net. */}
            <span className="text-[11px] tabular-nums text-zinc-500">
              {signed(branch.xpGain)} xP
              {(() => {
                const terms = branch.simulation?.after.chipAdjustment?.terms;
                if (!terms || terms.length === 0) return null;
                return (
                  <span title={terms.map((t) => t.reason).join(" ")}>
                    {" ("}
                    {terms
                      .map((t) => `${signed(t.delta)} GW${t.event} ${CHIP_LABELS[t.chip].toLowerCase()}`)
                      .join(", ")}
                    {")"}
                  </span>
                );
              })()}
              {branch.pointsCost > 0 ? ` − ${branch.pointsCost} hit` : ""}
              {Math.abs(branch.riskPointsDelta) >= 0.05
                ? ` ${branch.riskPointsDelta > 0 ? "−" : "+"} ${Math.abs(branch.riskPointsDelta).toFixed(1)} risk`
                : ""}
              {branch.assumedNewsValue > 0 ? ` + ${branch.assumedNewsValue} news` : ""} =
            </span>
            <span
              className={`text-lg font-bold tabular-nums ${
                branch.net > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-amber-700 dark:text-amber-400"
              }`}
            >
              {signed(branch.net)}
            </span>
          </span>
        )}
      </div>

      {!blocked && branch.explanation.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
          {branch.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {!blocked && branch.moves.length > 0 && (
        <button
          type="button"
          onClick={() => {
            if (!isLoaded) onLoad(branch.moves);
          }}
          aria-disabled={isLoaded}
          title={
            isLoaded ? "Already in the basket" : "Puts these transfers in the basket below to apply"
          }
          className="mt-1.5 min-h-9 rounded border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:border-purple-700 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40 motion-reduce:transition-none dark:hover:border-primary dark:hover:text-primary"
        >
          {isLoaded ? "Loaded" : "Load"}
        </button>
      )}
    </li>
  );
}
