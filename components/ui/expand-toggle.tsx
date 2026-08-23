"use client";

import { ChevronDown } from "lucide-react";

const SIZE_CLASS = { md: "h-9 w-9", sm: "h-7 w-7" } as const;

const CIRCLE_CLASS = (expanded: boolean, hoverVariant: "self" | "group", size: "sm" | "md") =>
  `flex ${SIZE_CLASS[size]} shrink-0 items-center justify-center rounded-full border transition-colors ${
    expanded
      ? "border-primary text-primary"
      : hoverVariant === "self"
        ? "border-border text-muted-foreground hover:border-primary hover:text-primary"
        : "border-border text-muted-foreground group-hover:border-primary group-hover:text-primary"
  }`;

const ICON_CLASS = (expanded: boolean) =>
  `h-4 w-4 transition-transform duration-300 will-change-transform motion-reduce:transition-none ${
    expanded ? "rotate-180" : ""
  }`;

/**
 * Sprint 24 — a real 36px circular expand/collapse target, replacing the
 * ad-hoc `⌃` glyph each expander (`CollapsibleCard`, `LiveFixtureCard`,
 * `ClubTacticsGrid`) drew for itself at whatever size its header happened to
 * be. Colours come from the app's existing tokens (`bg-card`, `border`,
 * `primary`) rather than the literal purple/green hexes a first draft of
 * this pulled from — the theme layer already abstracts those, and both
 * themes need to work here same as everywhere else.
 *
 * `interactive` (default `true`) renders a real `<button>` — use this when
 * the toggle is its own dedicated control (`LiveFixtureCard`,
 * `ClubTacticsGrid`). Pass `interactive={false}` when the toggle is purely
 * decorative because a *different* element already owns the click (e.g.
 * `CollapsibleCard`'s header is one full-row `<button>`) — nesting a real
 * `<button>` inside another `<button>` is invalid HTML and throws a React
 * hydration error (caught the hard way in the replace-candidate picker on
 * /transfers, task_ee2fcd44).
 */
export function ExpandToggle({
  expanded,
  onToggle,
  label,
  size = "md",
  className = "",
  interactive = true,
}: {
  expanded: boolean;
  onToggle?: () => void;
  /** Announced state-dependent — e.g. "fixture details" becomes "Expand
   * fixture details" / "Collapse fixture details". Unused when
   * `interactive={false}`, since the owning control announces its own state. */
  label?: string;
  /** `md` (36px, the default) is a real touch target for a standalone
   * toggle. `sm` (28px) fits inline beside a score line or card title
   * without dominating it — still comfortably tappable, just not the
   * primary control on that row. */
  size?: "sm" | "md";
  className?: string;
  interactive?: boolean;
}) {
  if (!interactive) {
    // `group-hover` — relies on the owning `<button>` (e.g. CollapsibleCard's
    // header) carrying the `group` class so hovering the whole row previews
    // the toggle's active colour, same as a real button would for itself.
    return (
      <span aria-hidden="true" className={`${CIRCLE_CLASS(expanded, "group", size)} ${className}`}>
        <ChevronDown className={ICON_CLASS(expanded)} />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
      className={`${CIRCLE_CLASS(expanded, "self", size)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      <ChevronDown aria-hidden="true" className={ICON_CLASS(expanded)} />
    </button>
  );
}
