// Fixture Difficulty Rating scale.
//
// Ordered ramp, not a categorical palette: dark green (very easy) through
// yellow to dark red (very hard). Verified with the dataviz palette validator
// — adjacent-pair CVD separation is 12.3 ΔE (protan), normal-vision floor
// 17.4, both comfortably above target. Several fills fall under 3:1 contrast
// against the page surface, which is why every cell carries visible text and
// a tooltip rather than relying on colour alone.

export type FdrRating = 1 | 2 | 3 | 4 | 5;

export interface FDRConfig {
  label: string;
  bgClass: string;
  textClass: string;
  hexCode: string;
}

export const fdrTheme: Record<FdrRating, FDRConfig> = {
  1: {
    label: "V. Easy",
    // Dark Green
    bgClass: "bg-emerald-900 dark:bg-emerald-950",
    textClass: "text-emerald-100 dark:text-emerald-200",
    hexCode: "#064E3B",
  },
  2: {
    label: "Easy",
    // Green
    bgClass: "bg-emerald-500 dark:bg-emerald-500",
    textClass: "text-slate-950 dark:text-slate-950",
    hexCode: "#10B981",
  },
  3: {
    label: "Medium",
    // Yellow
    bgClass: "bg-amber-400 dark:bg-amber-400",
    textClass: "text-slate-950 dark:text-slate-950",
    hexCode: "#FBBF24",
  },
  4: {
    label: "Hard",
    // Orange
    bgClass: "bg-orange-500 dark:bg-orange-500",
    textClass: "text-white dark:text-slate-950",
    hexCode: "#F97316",
  },
  5: {
    label: "V. Hard",
    // Dark Red
    bgClass: "bg-red-900 dark:bg-red-950",
    textClass: "text-red-100 dark:text-red-200",
    hexCode: "#7F1D1D",
  },
};

/** Clamp an arbitrary number to a valid rating, defaulting to Medium. */
export const asRating = (n: number | null | undefined): FdrRating => {
  if (n === null || n === undefined) return 3;
  const r = Math.round(n);
  return (r >= 1 && r <= 5 ? r : 3) as FdrRating;
};

export const fdrConfig = (n: number | null | undefined): FDRConfig => fdrTheme[asRating(n)];

export const fdrClasses = (n: number | null | undefined): string => {
  const c = fdrConfig(n);
  return `${c.bgClass} ${c.textClass}`;
};

export const fdrLabel = (n: number | null | undefined): string => fdrConfig(n).label;

// Venue is encoded as a ring rather than by letter case, which was hard to
// read at a glance. The 1px surface-coloured offset guarantees the ring stays
// legible even when its hue is close to the FDR fill underneath (green ring on
// an easy-green fixture, red ring on a very-hard-red one).
export const venueRing = (home: boolean): string =>
  home
    ? "ring-2 ring-offset-1 ring-green-400 ring-offset-white dark:ring-offset-zinc-950"
    : "ring-2 ring-offset-1 ring-red-400 ring-offset-white dark:ring-offset-zinc-950";
