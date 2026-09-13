import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one status pill.
 *
 * Before this existed, four components (`confidence-badge.tsx`,
 * `gem-badge.tsx`, `fdr-badge.tsx`, `player-status-icons.tsx`) each carried a
 * byte-identical shell string and their own private colour map, and the pages
 * carried ~49 further ad-hoc status colour tokens — five or six distinct shade
 * pairs for each of the three semantic roles `lib/semantic-colors.ts` defines
 * exactly one of. The shell below is that shared string, lifted verbatim so
 * migrating a call site is a colour decision and not also a size decision.
 *
 * Tones map onto the `--success`/`--warning`/`--danger` tokens, so one class
 * string is correct in both themes — the token swaps under `.dark`, the class
 * does not. `accent` is deliberately separate and deliberately rare: it is the
 * `--primary` neon, reserved by M9's accent-discipline rule for a primary
 * action or the single top-tier winner, never for "this number is positive".
 * Reach for `positive` for that.
 */
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border font-medium tracking-wide",
  {
    variants: {
      tone: {
        positive: "",
        warning: "",
        negative: "",
        neutral: "",
        accent: "",
      },
      /**
       * `outline` is the existing look everywhere — a hairline border and
       * coloured text on the card's own background. `solid` fills with the
       * matching `-surface` token and is for a badge that has to survive on
       * top of an already-coloured surface (a pitch card, an FDR cell).
       */
      variant: {
        outline: "bg-transparent",
        solid: "",
      },
      size: {
        /** The existing badge shell — 9px uppercase. */
        xs: "px-1 py-px text-[9px] uppercase",
        /** Sentence-case, for a badge carrying words rather than a token. */
        sm: "px-1.5 py-0.5 text-[10px]",
      },
    },
    compoundVariants: [
      { tone: "positive", variant: "outline", class: "border-success-border text-success" },
      { tone: "warning", variant: "outline", class: "border-warning-border text-warning" },
      { tone: "negative", variant: "outline", class: "border-danger-border text-danger" },
      { tone: "neutral", variant: "outline", class: "border-border text-muted-foreground" },
      { tone: "accent", variant: "outline", class: "border-primary/50 text-primary" },
      {
        tone: "positive",
        variant: "solid",
        class: "border-success-border bg-success-surface text-success-foreground",
      },
      {
        tone: "warning",
        variant: "solid",
        class: "border-warning-border bg-warning-surface text-warning-foreground",
      },
      {
        tone: "negative",
        variant: "solid",
        class: "border-danger-border bg-danger-surface text-danger-foreground",
      },
      { tone: "neutral", variant: "solid", class: "border-border bg-muted text-muted-foreground" },
      {
        tone: "accent",
        variant: "solid",
        class: "border-transparent bg-primary text-primary-foreground",
      },
    ],
    defaultVariants: { tone: "neutral", variant: "outline", size: "xs" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  children,
  tone,
  variant,
  size,
  className,
  icon,
  title,
  "aria-label": ariaLabel,
}: VariantProps<typeof badgeVariants> & {
  children: ReactNode;
  className?: string;
  /** Leading glyph or SVG. Kept a separate prop so the gap is applied once here. */
  icon?: ReactNode;
  title?: string;
  "aria-label"?: string;
}) {
  return (
    <span
      title={title}
      aria-label={ariaLabel}
      className={cn(badgeVariants({ tone, variant, size }), className)}
    >
      {icon}
      {children}
    </span>
  );
}

export { badgeVariants };
