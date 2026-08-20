import type { Gw1Tier } from "@/lib/gw1-lineups";

// GW1 predicted-lineup badge — same shape as `ConfidenceBadge`
// (components/confidence-badge.tsx) and `GemBadge`: a bordered text pill,
// colour-coded per tier, with the reasoning in `title` so nothing is
// conveyed by colour alone. Gone once GW1 is scored, along with the rest of
// lib/gw1-lineups.ts — see that file's header.

const STYLE: Record<Gw1Tier, string> = {
  locked: "border-emerald-300 text-emerald-700 dark:border-emerald-800/60 dark:text-emerald-400",
  medium: "border-amber-300 text-amber-700 dark:border-amber-800/60 dark:text-amber-400",
  high: "border-red-300 text-red-700 dark:border-red-800/60 dark:text-red-400",
};

const SHORT: Record<Gw1Tier, string> = {
  locked: "XI",
  medium: "ROT",
  high: "OUT",
};

export function Gw1Badge({
  tier,
  note,
  inPredictedXi,
  className = "",
}: {
  tier: Gw1Tier | null | undefined;
  note?: string | null;
  inPredictedXi?: boolean;
  className?: string;
}) {
  if (!tier) return null;
  const label = inPredictedXi === false ? "Not in the predicted XI" : "In the predicted XI";
  const title = note ? `${label} — ${note}` : label;

  return (
    <span
      title={title}
      aria-label={`GW1 predicted lineup: ${title}`}
      className={`inline-flex shrink-0 cursor-help items-center whitespace-nowrap rounded border px-1 py-px text-[9px] font-medium uppercase tracking-wide ${STYLE[tier]} ${className}`}
    >
      {SHORT[tier]}
    </span>
  );
}
