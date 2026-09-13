"use client";

import { cn } from "@/lib/utils";

/**
 * The app's checkbox.
 *
 * Before this there were five native boxes with four different treatments —
 * `accent-purple-700`, `accent-purple-800`, `text-purple-700` and one with no
 * styling at all — so the same control looked different on /players, /scenarios
 * and /transfers, and the native `accent-*` box ignores the brand palette in
 * dark mode anyway.
 *
 * The check is the Transitions.dev `checkbox-check` recipe
 * (References/Components/checkbox-check.md): the box fills first, then the
 * tick draws itself in via `stroke-dashoffset`. Ticking is deliberate at
 * `duration-slow`; unticking is `duration-fast`, so a box you clear gets out
 * of the way rather than un-drawing at you. `--check-len` is that path's own
 * length (≈14.4, rounded up to 15), which is what keeps the stroke from
 * over- or under-drawing.
 *
 * A real `<input type="checkbox">` does the work — `appearance-none` and
 * painted over, rather than a `role="checkbox"` button as the recipe's own
 * markup suggests — so labels, `htmlFor`, form state and the space key all
 * keep working, and the tick is driven by `:checked` rather than by React
 * re-rendering an aria attribute.
 */
export function Checkbox({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <span className={cn("relative inline-flex size-4 shrink-0", className)}>
      <input
        type="checkbox"
        className="peer size-full cursor-pointer appearance-none rounded-[5px] border border-input bg-background outline-none transition-[background-color,border-color] duration-fast ease-slide checked:border-primary checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none dark:bg-input/30 dark:checked:border-primary dark:checked:bg-primary"
        {...props}
      />
      <svg
        viewBox="0 0 10.1668 10.1668"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto size-2.5 [&_path]:[stroke-dasharray:15] [&_path]:[stroke-dashoffset:15] [&_path]:transition-[stroke-dashoffset] [&_path]:duration-fast [&_path]:ease-slide peer-checked:[&_path]:[stroke-dashoffset:0] peer-checked:[&_path]:duration-slow motion-reduce:[&_path]:transition-none"
      >
        <path
          d="M1 5.52L3.92 9.17L9.17 1"
          fill="none"
          stroke="var(--primary-foreground)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
