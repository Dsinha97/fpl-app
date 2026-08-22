import { GEM_ARCHETYPE_LABELS, type GemArchetype, type GemVerdict } from "@/lib/hidden-gems";
import { TapToReveal } from "@/components/info-tooltip";

// Hidden Gems archetype badge — same shape as `ConfidenceBadge`
// (components/confidence-badge.tsx): a bordered text pill, colour-coded per
// archetype, with the full reasoning in a click-toggled `TapToReveal` panel
// so nothing is conveyed by colour alone — and so the reasoning is reachable
// on touch, not just hover (a bare `title` never showed it there).

const STYLE: Record<GemArchetype, string> = {
  defcon_defender: "border-sky-300 text-sky-700 dark:border-sky-800/60 dark:text-sky-400",
  defcon_midfielder: "border-indigo-300 text-indigo-700 dark:border-indigo-800/60 dark:text-indigo-400",
  breakout_attacker: "border-orange-300 text-orange-700 dark:border-orange-800/60 dark:text-orange-400",
};

const SHORT: Record<GemArchetype, string> = {
  defcon_defender: "Defcon DEF",
  defcon_midfielder: "Defcon MID",
  breakout_attacker: "Breakout",
};

export function GemBadge({
  verdict,
  className = "",
}: {
  verdict: GemVerdict | null | undefined;
  className?: string;
}) {
  if (!verdict) return null;

  return (
    <TapToReveal
      label={`Hidden gem: ${GEM_ARCHETYPE_LABELS[verdict.archetype]}`}
      triggerClassName={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1 py-px text-[9px] font-medium uppercase tracking-wide ${STYLE[verdict.archetype]} ${className}`}
      trigger={SHORT[verdict.archetype]}
    >
      <p className="font-semibold text-zinc-900 dark:text-zinc-100">
        {GEM_ARCHETYPE_LABELS[verdict.archetype]}
      </p>
      <p className="mt-1">{verdict.reasons.join(" · ")}</p>
    </TapToReveal>
  );
}
