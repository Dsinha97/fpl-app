import { asRating, fdrTheme, venueRing, type FdrRating } from "@/lib/fdr";

interface FDRBadgeProps {
  rating: FdrRating;
  showLabel?: boolean;
  className?: string;
}

/** The rating itself as a chip — used in legends and keys. */
export function FDRBadge({ rating, showLabel = false, className = "" }: FDRBadgeProps) {
  const fdr = fdrTheme[rating] ?? fdrTheme[3];

  return (
    <span
      className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-bold shadow-sm transition-colors ${fdr.bgClass} ${fdr.textClass} ${className}`}
    >
      {rating}
      {showLabel && <span className="ml-1 font-semibold">{fdr.label}</span>}
    </span>
  );
}

interface FixtureCellProps {
  opponent: string;
  home: boolean;
  fdr: number | null | undefined;
  gw?: number;
  team?: string;
  className?: string;
}

/**
 * One fixture in a matrix or run: fill encodes difficulty, ring encodes venue,
 * text names the opponent. Three independent channels, so neither colour
 * blindness nor a monochrome print loses the meaning.
 */
export function FixtureCell({
  opponent,
  home,
  fdr,
  gw,
  team,
  className = "",
}: FixtureCellProps) {
  const rating = asRating(fdr);
  const cfg = fdrTheme[rating];
  const where = home ? "home vs" : "away at";
  const title = [
    gw !== undefined ? `GW${gw}` : null,
    team ? `${team} ${where} ${opponent}` : `${where} ${opponent}`,
    `FDR ${rating} — ${cfg.label}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center rounded px-1 py-0.5 text-[10px] font-bold shadow-sm ${cfg.bgClass} ${cfg.textClass} ${venueRing(home)} ${className}`}
    >
      {opponent.toUpperCase()}
    </span>
  );
}
