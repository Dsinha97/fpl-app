import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The landing hero's primary call to action.
 *
 * From References/Components/buton.md, retargeted onto this app's tokens
 * (the reference's `bg-background` / `bg-primary` / `text-primary-foreground`
 * already line up; only the fixed `w-32` and the un-tokenised radius needed
 * changing).
 *
 * Scoped deliberately to the landing page and nowhere else. The dot that
 * expands to fill the button, and the label that slides out and back with an
 * arrow, is marketing motion — it is right for the one button whose job is to
 * get a stranger to start, and wrong for `Save` or `Apply GW4 XI`, where
 * DSI-129's whole argument is that utility actions should get *quieter*, not
 * louder. `components/ui/button.tsx` remains the primitive for those.
 *
 * Rendered as a span-wrapper so it can be dropped inside a `next/link`
 * without nesting an interactive element inside an anchor.
 */
export function InteractiveHoverButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // The reference rests as a plain bordered pill, because it assumes it
        // is the only button on the page. Here it sits beside "Explore
        // players", and at rest the two were indistinguishable — the primary
        // action only announced itself on hover, which a touch device never
        // delivers. So the resting state carries the accent in its border and
        // label, and hover promotes that to a fill.
        "group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full border border-purple-700 bg-background px-6 py-2.5 text-center text-sm font-semibold text-purple-800 dark:border-primary/60 dark:text-primary",
        className,
      )}
    >
      {/* Resting label — slides right and fades as the fill arrives. */}
      <span className="relative z-10 inline-block transition-all duration-base ease-slide group-hover:translate-x-10 group-hover:opacity-0 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:opacity-100">
        {children}
      </span>

      {/* Hover label — arrives from the left, arrow included. */}
      <span
        aria-hidden
        className="absolute inset-0 z-10 flex -translate-x-10 items-center justify-center gap-2 text-primary-foreground opacity-0 transition-all duration-base ease-slide group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
      >
        {children}
        <ArrowRight className="size-4" />
      </span>

      {/* The dot that becomes the fill. */}
      <span
        aria-hidden
        className="absolute left-[18%] top-[42%] z-0 size-2 rounded-full bg-primary opacity-70 transition-all duration-slow ease-slide group-hover:left-0 group-hover:top-0 group-hover:size-full group-hover:rounded-none group-hover:opacity-100 motion-reduce:transition-none"
      />
    </span>
  );
}
