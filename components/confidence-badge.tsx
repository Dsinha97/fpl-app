import { COLD_START_NOTE, RELIABILITY_LABELS } from "@/lib/scoring";
import { TapToReveal } from "@/components/info-tooltip";

type Reliability = "high" | "medium" | "low";

const STYLE: Record<Reliability, string> = {
  high: "border-emerald-300 text-emerald-700 dark:border-emerald-800/60 dark:text-emerald-400",
  medium: "border-zinc-300 text-zinc-600 dark:border-purple-800/60 dark:text-zinc-400",
  low: "border-amber-300 text-amber-700 dark:border-amber-800/60 dark:text-amber-400",
};

const SHORT: Record<Reliability, string> = { high: "own record", medium: "part prior", low: "prior" };
/** Below `sm` the full two-word label collides with `RateBand` underneath it
 * in narrow table cells (see app/players/page.tsx) — the two-letter form
 * carries the same colour + border channel, and the full sentence is still
 * in `title`/`aria-label` at every width. */
const SHORTEST: Record<Reliability, string> = { high: "OR", medium: "PP", low: "PR" };

/**
 * How much of a projection is the player's own record versus a fitted prior.
 *
 * Shown rather than hidden because since model v1.1.0 almost every player has a
 * number, including promoted-club squads with no Premier League minutes at all.
 * A number without its provenance would read as equally solid as Salah's.
 */
export function ConfidenceBadge({
  reliability,
  priorWeight,
  className = "",
}: {
  reliability: Reliability | null | undefined;
  priorWeight?: number | null;
  className?: string;
}) {
  if (!reliability) return null;

  const share = priorWeight === null || priorWeight === undefined
    ? null
    : `${Math.round(priorWeight * 100)}% prior`;

  return (
    <span
      title={`${RELIABILITY_LABELS[reliability]}${share ? ` (${share})` : ""}`}
      aria-label={`Projection confidence: ${reliability}${share ? `, ${share}` : ""}`}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1 py-px text-[9px] font-medium uppercase tracking-wide ${STYLE[reliability]} ${className}`}
    >
      <span className="sm:hidden">{SHORTEST[reliability]}</span>
      <span className="hidden sm:inline">{SHORT[reliability]}</span>
    </span>
  );
}

/**
 * The rate-uncertainty band around a projection.
 *
 * Deliberately not called a prediction interval — it propagates uncertainty in
 * the underlying rates and ignores match-to-match variance, so it is narrower
 * than the spread of real outcomes. The tooltip says so.
 */
export function RateBand({
  lower,
  upper,
  className = "",
}: {
  lower: number | null | undefined;
  upper: number | null | undefined;
  className?: string;
}) {
  if (lower === null || lower === undefined || upper === null || upper === undefined) return null;
  return (
    <TapToReveal
      label="What does this range mean?"
      wrapperClassName={`relative block ${className}`}
      triggerClassName="mt-0.5 block text-[10px] tabular-nums text-zinc-400"
      trigger={`${lower.toFixed(1)}–${upper.toFixed(1)}`}
    >
      <p>{COLD_START_NOTE}</p>
    </TapToReveal>
  );
}
