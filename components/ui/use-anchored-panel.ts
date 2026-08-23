"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Shared positioning logic for a `fixed`-position floating panel anchored to
 * a trigger element, clamped to stay fully inside the viewport on both axes.
 *
 * Originally written once for `FilterDisclosure` (horizontal clamp only,
 * since its panel always opens below the trigger) and copied a second time
 * into `TapToReveal` with a vertical-only flip and no horizontal clamp —
 * which is why the `FT` tooltip in the sticky context bar could run off the
 * right edge of a phone screen. This hook is the one implementation both
 * consume, with both axes clamped.
 *
 * Positioning is `fixed` and computed in absolute viewport coordinates from
 * the trigger's own `getBoundingClientRect()` — not an offset relative to a
 * wrapper element, which drifts on narrow viewports (see `FilterDisclosure`'s
 * original comment for why that version still overflowed on real phones).
 */
export function useAnchoredPanel<
  TTrigger extends HTMLElement,
  TPanel extends HTMLElement,
>(open: boolean, opts: { align?: "left" | "right"; gap?: number; margin?: number } = {}) {
  const { align = "left", gap = 8, margin = 8 } = opts;
  const trigger = useRef<TTrigger>(null);
  const panel = useRef<TPanel>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const reposition = () => {
      const t = trigger.current;
      const p = panel.current;
      if (!t || !p) return;

      const tRect = t.getBoundingClientRect();
      const pRect = p.getBoundingClientRect();

      // Horizontal: prefer aligning to the trigger's left (or right) edge,
      // clamped so the panel never runs off either side of the viewport. A
      // viewport narrower than the panel plus both margins has no legal
      // position — clamp to the left margin rather than let max < min invert.
      const maxLeft = window.innerWidth - margin - pRect.width;
      const preferredLeft = align === "right" ? tRect.right - pRect.width : tRect.left;
      const left = Math.max(margin, Math.min(preferredLeft, maxLeft));

      // Vertical: prefer below the trigger; flip above only when there's
      // truly not enough room below, using the panel's real measured height
      // now that it's actually in the DOM (rather than an estimate).
      const spaceBelow = window.innerHeight - tRect.bottom - gap;
      const openAbove = spaceBelow < pRect.height && tRect.top - gap > spaceBelow;
      const top = openAbove
        ? Math.max(margin, Math.round(tRect.top - gap - pRect.height))
        : Math.round(tRect.bottom + gap);

      setCoords({ top, left: Math.round(left) });
    };

    // Two passes: fonts/webfonts can still be settling on first paint, which
    // changes the panel's measured size after the first layout pass.
    reposition();
    const raf = requestAnimationFrame(reposition);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", reposition);
    };
  }, [open, align, gap, margin]);

  return { triggerRef: trigger, panelRef: panel, coords };
}

/**
 * Shared outside-click + Escape dismissal, used by every click-toggled
 * popover in the app (`TapToReveal`, `FilterDisclosure`, `MobileNav`,
 * `AccountMenu`). `containers` are the elements a click *inside* should not
 * count as "outside" — typically the trigger's wrapper and, for a portal'd
 * or `fixed`-positioned panel, the panel itself (which may not be a DOM
 * descendant of the wrapper).
 */
export function useDismissablePopover(open: boolean, onDismiss: () => void, containers: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      const inside = containers.some((ref) => ref.current?.contains(e.target as Node));
      if (!inside) onDismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss]);
}
