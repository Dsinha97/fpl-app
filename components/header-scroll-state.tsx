"use client";

import { useEffect } from "react";

/**
 * Marks the sticky header `data-scrolled` once the page has moved, so it can
 * contract (the `group-data-[scrolled]:` variants in `app/layout.tsx`).
 *
 * Two thresholds, not one: contracting shortens the in-flow header, which can
 * pull `scrollY` back under a single cut-off and flip it straight back —
 * a flicker loop at the boundary. The gap between 48 and 16 absorbs it.
 * No rAF gating: it never fires on a hidden document, and this is one
 * attribute toggle.
 */
const SHRINK_AT = 48;
const GROW_AT = 16;

export function HeaderScrollState() {
  useEffect(() => {
    const header = document.getElementById("site-header");
    if (!header) return;
    const update = () => {
      const y = window.scrollY;
      if (y > SHRINK_AT) header.setAttribute("data-scrolled", "");
      else if (y < GROW_AT) header.removeAttribute("data-scrolled");
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return null;
}
