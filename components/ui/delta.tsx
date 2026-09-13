import { cn } from "@/lib/utils";
import { semanticText } from "@/lib/semantic-colors";

/**
 * A signed number that knows which direction is good.
 *
 * Three separate audit findings were the same defect: an arrow and a colour
 * chosen from the *sign* of a number rather than from whether that number is
 * an improvement. `/scenarios` rendered the lowest mean player risk as
 * `24 ▲` in green — an up-arrow on the smallest value; `/players` painted the
 * cheapest price green as though cheap were a performance win; price rises and
 * falls shared one purple pill across `/news` and `/deadline`.
 *
 * So direction is an explicit input. `goodDirection: "down"` inverts both the
 * arrow and the tone, and `"neutral"` keeps the arrow (the value still moved)
 * while dropping the colour claim — which is the honest rendering for price,
 * where cheaper is only better if you need the money.
 *
 * Per CLAUDE.md's "say what the number means": `unit` is rendered, not
 * assumed. A bare `+0.3` is what this component exists to stop.
 */
export function Delta({
  value,
  goodDirection = "up",
  unit,
  decimals = 1,
  showArrow = true,
  showSign = true,
  className,
  label,
}: {
  value: number | null | undefined;
  /** Which way is an improvement. `"neutral"` = the move is real but not a win. */
  goodDirection?: "up" | "down" | "neutral";
  /** Rendered after the number — "xP", "pts", "%" — or before it for "£". */
  unit?: string;
  decimals?: number;
  showArrow?: boolean;
  showSign?: boolean;
  className?: string;
  /** Screen-reader text replacing the arrow glyph, e.g. "risk, lower is better". */
  label?: string;
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  // -0.0 is a real output of toFixed on a tiny negative; it reads as a fall
  // that did not happen.
  const rounded = Number(value.toFixed(decimals));
  const flat = rounded === 0;
  const up = rounded > 0;

  const improving = goodDirection === "neutral" ? null : goodDirection === "up" ? up : !up;
  const tone = flat || improving === null ? null : improving ? "positive" : "negative";

  const arrow = flat ? "→" : up ? "▲" : "▼";
  const body = `${Math.abs(rounded).toFixed(decimals)}${unit ? `\u2009${unit}` : ""}`;
  const sign = showSign && !flat ? (up ? "+" : "\u2212") : "";

  return (
    <span
      className={cn("inline-flex items-center gap-1 tabular-nums", tone && semanticText(tone), className)}
      aria-label={label}
    >
      {showArrow && (
        <span aria-hidden className="text-[0.85em] leading-none">
          {arrow}
        </span>
      )}
      <span>
        {sign}
        {body}
      </span>
    </span>
  );
}
