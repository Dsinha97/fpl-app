import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The landing hero's primary call to action.
 *
 * From References/Components/buton.md, retargeted onto this app's tokens and
 * scoped deliberately to the landing page. The label sliding out and back with
 * an arrow is marketing motion — right for the one button whose job is to get
 * a stranger to start, wrong for `Save` or `Apply GW4 XI`, where DSI-129's
 * argument is that utility actions should get *quieter*.
 * `components/ui/button.tsx` remains the primitive for those.
 *
 * Two departures from the reference, both forced by this button not being
 * alone on its page:
 *
 * 1. The reference rests as a plain bordered pill, so beside "Explore players"
 *    the two were indistinguishable and the primary action only announced
 *    itself on hover — which a touch device never delivers. The resting state
 *    carries the accent; hover promotes it to a fill.
 *
 * 2. The reference's expanding dot is gone. It sits at `left-[18%] top-[42%]`,
 *    which on a 200px button is squarely behind the label: an accent-coloured
 *    blob under accent-coloured text. Repositioning it into the padding gutter
 *    did not survive contact either, so the fill now wipes in from the left
 *    edge with no resting artifact at all. Same effect, nothing to misread —
 *    and the label it reveals sits on a solid `--primary` fill, so its
 *    contrast is guaranteed by the token pair rather than by luck.
 *
 * Rendered as a span-wrapper so it can be dropped inside a `next/link` without
 * nesting an interactive element inside an anchor.
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
        "group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full border border-purple-700 bg-background px-6 py-2.5 text-center text-sm font-semibold text-purple-800 dark:border-primary/60 dark:text-primary",
        className,
      )}
    >
      {/* The fill: a left-anchored wipe, zero width at rest so it draws
          nothing behind the resting label. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 z-0 w-0 bg-primary transition-[width] duration-slow ease-slide group-hover:w-full motion-reduce:transition-none"
      />

      {/* Resting label — slides right and fades as the fill arrives. */}
      <span className="relative z-10 inline-block transition-all duration-base ease-slide group-hover:translate-x-10 group-hover:opacity-0 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:opacity-100">
        {children}
      </span>

      {/* Hover label — arrives from the left on the filled ground. */}
      <span
        aria-hidden
        className="absolute inset-0 z-10 flex -translate-x-10 items-center justify-center gap-2 text-primary-foreground opacity-0 transition-all duration-base ease-slide group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
      >
        {children}
        <ArrowRight className="size-4" />
      </span>
    </span>
  );
}
