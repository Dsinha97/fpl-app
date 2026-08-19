// Semantic status colour scale — the token-backed counterpart to lib/fdr.ts.
//
// Three roles only (positive / warning / negative), matching the pairs that
// already dominate the app by usage count before this file existed:
// text-emerald-700/dark:text-emerald-400 (positive), text-amber-700/
// dark:text-amber-400 (warning), text-red-700/dark:text-red-300 (negative).
// Unlike fdr.ts's bgClass/textClass pairs (which must stay Tailwind palette
// classes — the FDR ramp is CVD-validated at specific hues and is not
// backed by a CSS variable), these classes reference the --success/
// --warning/--danger custom properties in app/globals.css, so one class
// string is correct in both themes — no dark: variant needed, because the
// token itself swaps under .dark.
//
// Sprint 19. See docs/wiki/design-system.md.

export type SemanticStatus = "positive" | "warning" | "negative";

export interface SemanticConfig {
  /** Text-only usage — a number, a delta, an inline word. */
  textClass: string;
  /** The alert-block trio (bg-*-surface + border-*-border + text-*-foreground), used ×15–25 by hand today. */
  alertClass: string;
  /** Small badge/pill border+text, matching confidence-badge.tsx's and gem-badge.tsx's existing shell. */
  badgeClass: string;
}

export const semanticTheme: Record<SemanticStatus, SemanticConfig> = {
  positive: {
    textClass: "text-success",
    alertClass: "border border-success-border bg-success-surface text-success-foreground",
    badgeClass: "border-success-border text-success",
  },
  warning: {
    textClass: "text-warning",
    alertClass: "border border-warning-border bg-warning-surface text-warning-foreground",
    badgeClass: "border-warning-border text-warning",
  },
  negative: {
    textClass: "text-danger",
    alertClass: "border border-danger-border bg-danger-surface text-danger-foreground",
    badgeClass: "border-danger-border text-danger",
  },
};

export const semanticConfig = (status: SemanticStatus): SemanticConfig => semanticTheme[status];
export const semanticText = (status: SemanticStatus): string => semanticTheme[status].textClass;
export const semanticAlert = (status: SemanticStatus): string => semanticTheme[status].alertClass;
export const semanticBadge = (status: SemanticStatus): string => semanticTheme[status].badgeClass;
