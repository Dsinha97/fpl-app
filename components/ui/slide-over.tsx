"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { SlideOverProps } from "@/components/ui/slide-over-panel";

/**
 * A dockable panel over a dimmed backdrop. The implementation, and every
 * behaviour worth documenting, is `SlideOverPanel` (`./slide-over-panel`).
 *
 * This wrapper exists for the bundle (Sprint 40, DSI-56). The panel is
 * animated with `motion`, which is ~135 KB of JS, and the mobile nav renders a
 * SlideOver from the root layout, so every route paid for `motion` on first
 * load, even routes where nothing ever slides. The panel now arrives as a separate
 * chunk: prefetched once the browser is idle, and mounted the first time
 * `open` goes true. Once mounted it stays mounted, because `AnimatePresence`
 * has to see `open` go false to play the exit.
 *
 * Nothing interactive waits on the chunk unless someone opens a panel within the
 * first idle moment of a cold load, and then the panel appears when the chunk
 * lands, still with its entrance animation.
 */
const loadPanel = () => import("@/components/ui/slide-over-panel");

const SlideOverPanel = dynamic(() => loadPanel().then((m) => m.SlideOverPanel), {
  ssr: false,
  loading: () => null,
});

export function SlideOver(props: SlideOverProps) {
  const [everOpened, setEverOpened] = useState(props.open);
  // React's documented "adjust state while rendering" pattern, not an effect,
  // so the panel mounts on the same render `open` first flips true.
  if (props.open && !everOpened) setEverOpened(true);

  useEffect(() => {
    const prefetch = () => void loadPanel();
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(prefetch, 1500);
    return () => clearTimeout(t);
  }, []);

  return everOpened ? <SlideOverPanel {...props} /> : null;
}
