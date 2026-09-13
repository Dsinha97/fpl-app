"use client";

import { useEffect, useState } from "react";

/**
 * Whether the viewport is at or above a breakpoint.
 *
 * Needed where the *surface* changes rather than the styling: /builder's slot
 * picker is an anchored popover beside the pitch on a desktop and a bottom
 * sheet on a phone, and those are different components, not one component with
 * different classes. Anything expressible in CSS should stay in CSS — this is
 * for the cases that are not.
 *
 * Returns `false` until mounted, so the server and the first client render
 * agree: a static export prerenders with no viewport at all, and branching on
 * a guessed width is a hydration mismatch. The mobile branch is the safe
 * default to render first — it does not depend on an anchor element existing.
 */
export function useMinWidth(px: number): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [px]);

  return matches;
}

/** Tailwind's `sm` breakpoint, which is where the pitch itself changes shape. */
export const SM = 640;
