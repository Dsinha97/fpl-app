import { asRating, fdrTheme, venueRing, type FdrRating } from "@/lib/fdr";

interface FDRBadgeProps {
  rating: FdrRating;
  showLabel?: boolean;
  className?: string;
  /** Replaces the numeric rating — used on pitch cards to show "MCI (H)". */
  children?: React.ReactNode;
}

/** A difficulty-coloured chip: the rating by default, or arbitrary content. */
export function FDRBadge({ rating, showLabel = false, className = "", children }: FDRBadgeProps) {
  const fdr = fdrTheme[rating] ?? fdrTheme[3];

  return (
    <span
      title={`FDR ${rating} — ${fdr.label}`}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold shadow-sm transition-colors ${fdr.bgClass} ${fdr.textClass} ${className}`}
    >
      {children ?? rating}
      {showLabel && !children && <span className="ml-1 font-semibold">{fdr.label}</span>}
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
  /** Names which rating this is, in the tooltip — e.g. "Strength FDR". Defaults to "FDR". */
  ratingLabel?: string;
  /**
   * Opt-in handling for a missing rating. Without it, `fdr` of null/undefined
   * falls through `asRating` to Medium, which is right for FPL's own rating
   * (always published) and wrong for one that can genuinely be absent — a
   * yellow "3" would be an invented value. Supply a reason and the cell renders
   * neutral instead. Existing callers are unaffected.
   */
  unratedReason?: string;
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
  ratingLabel = "FDR",
  unratedReason,
}: FixtureCellProps) {
  const unrated = unratedReason !== undefined && (fdr === null || fdr === undefined);
  const rating = asRating(fdr);
  const cfg = fdrTheme[rating];
  const where = home ? "home vs" : "away at";
  const title = [
    gw !== undefined ? `GW${gw}` : null,
    team ? `${team} ${where} ${opponent}` : `${where} ${opponent}`,
    unrated ? unratedReason : `${ratingLabel} ${rating} — ${cfg.label}`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (unrated) {
    return (
      <span
        title={title}
        className={`inline-flex items-center justify-center rounded bg-zinc-200 px-1 py-0.5 text-[10px] font-bold text-zinc-500 shadow-sm dark:bg-[#2A0A45] dark:text-zinc-500 ${venueRing(home)} ${className}`}
      >
        {opponent.toUpperCase()}
      </span>
    );
  }

  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center rounded px-1 py-0.5 text-[10px] font-bold shadow-sm ${cfg.bgClass} ${cfg.textClass} ${venueRing(home)} ${className}`}
    >
      {opponent.toUpperCase()}
    </span>
  );
}
