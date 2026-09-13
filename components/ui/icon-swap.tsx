"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Two icons in one cell, cross-faded with a blur-and-scale.
 *
 * `References/Components/icon-swap.md` as Tailwind: both icons occupy the
 * same grid area, the outgoing one leaves at `scale(0.25)` behind a 2px blur
 * while the incoming one arrives at rest. Being one grid cell is the part
 * that matters beyond the motion — the control's width is the wider of the
 * two icons at every frame, so nothing beside it moves. A `☰`/`×` text swap
 * (what `MobileNav` did) changes width mid-transition and nudges the
 * wordmark next to it.
 *
 * `animateOnMount` is for the case where the swap spans two elements rather
 * than two states of one: the drawer's close button mounts already meaning
 * "close", so without it the morph would be over before the first paint.
 */
export function IconSwap({
  showSecond,
  first,
  second,
  animateOnMount = false,
  className,
}: {
  /** False shows `first`, true shows `second`. */
  showSecond: boolean;
  first: ReactNode;
  second: ReactNode;
  /** Start on `first` for one frame, then transition — see above. */
  animateOnMount?: boolean;
  className?: string;
}) {
  const [mounted, setMounted] = useState(!animateOnMount);

  useEffect(() => {
    if (mounted) return;
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [mounted]);

  const showB = mounted ? showSecond : false;
  const icon =
    "col-start-1 row-start-1 transition-[opacity,filter,transform] duration-base ease-in-out motion-reduce:transition-none";
  const shown = "opacity-100 blur-0 scale-100";
  const hidden = "opacity-0 blur-[2px] scale-[0.25]";

  return (
    <span aria-hidden className={cn("relative inline-grid place-items-center", className)}>
      <span className={cn(icon, showB ? hidden : shown)}>{first}</span>
      <span className={cn(icon, showB ? shown : hidden)}>{second}</span>
    </span>
  );
}
