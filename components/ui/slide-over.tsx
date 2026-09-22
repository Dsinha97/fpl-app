"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  type PanInfo,
} from "motion/react";
import { useDismissablePopover } from "@/components/ui/use-anchored-panel";

/** Numeric mirror of `--duration-slower` / `--ease-slide` (`app/globals.css`).
 *  `motion` transitions take JS values, not CSS custom properties — if the
 *  tokens in globals.css change, update these to match. */
const ENTER_DURATION = 0.4;
const EASE_SLIDE: [number, number, number, number] = [0.22, 1, 0.36, 1];
/** A drag-commit exit continues the fling rather than restarting the slower
 *  canned entrance/exit — see the doc comment on `wasDragged` below. */
const FLING_DURATION = 0.2;

/** Fraction of the panel's own extent a drag must cross to commit to close,
 *  regardless of velocity. Mirrors iOS sheet-dismiss conventions. */
const CLOSE_DISTANCE_FRACTION = 0.35;
/** px/s in the dismiss direction that commits regardless of distance — a
 *  fast flick from anywhere dismisses, like an iOS sheet. */
const CLOSE_VELOCITY = 500;

/**
 * A dockable panel over a dimmed backdrop.
 *
 * Sprint 33 — this existed already, inlined inside `MobileNav`
 * (`components/nav-links.tsx`), which was the only true slide-over in the
 * app. Merging `/compare` into `/players` needed a second one on the other
 * edge, and the choice was to copy forty-odd lines or to lift the original.
 * One implementation (CLAUDE.md), so: lifted, and `MobileNav` now renders
 * through it too.
 *
 * Dismissal is the app-wide `useDismissablePopover` convention — outside
 * mousedown plus Escape — with the backdrop carrying its own click handler,
 * because a click on it is "outside the panel" while still being inside the
 * subtree the hook watches. On a touch device it can also be dragged shut in
 * the direction it came from (a left panel drags left, a right panel drags
 * right, a bottom sheet drags down) — see the drag section below.
 */
export function SlideOver({
  open,
  onClose,
  side = "right",
  label,
  width = "min(28rem, 92vw)",
  maxHeight = "min(70vh, 32rem)",
  fullHeight = false,
  triggerRef,
  dragHandleRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Which edge the panel docks to. Dock it to the edge its trigger sits on:
   *  a tap and its result at opposite ends of a phone screen reads as two
   *  unrelated events. Also the axis and direction of the swipe-to-dismiss
   *  gesture below — the panel always closes back the way it opened. */
  side?: "left" | "right" | "bottom";
  /** Accessible name for the dialog. */
  label: string;
  /** Any CSS width. The default keeps a phone's remaining page visible.
   *  Ignored for `side="bottom"`, which is always full-width. */
  width?: string;
  /** Max height for `side="bottom"`. Content shorter than this shrinks the sheet. */
  maxHeight?: string;
  /**
   * `side="bottom"` only: fill the screen instead of sizing to content.
   *
   * The default cap exists so /builder's slot picker leaves the pitch
   * visible behind it — you need to see which slot you are filling. A full
   * profile has no such backdrop to preserve and several screens of content,
   * so capping it at 70vh would nest a scroller inside a scroller.
   *
   * Uses `100dvh`, never `100vh`: on a phone `100vh` is the viewport with
   * the URL bar hidden, so a bottom-pinned action bar sits below the fold
   * until the user scrolls.
   */
  fullHeight?: boolean;
  /** The control that opens this, so clicking it to *close* isn't also
   *  treated as an outside-click that closes it first. */
  triggerRef?: React.RefObject<HTMLElement | null>;
  /**
   * `side="left" | "right"` only: a ref the caller wires to its own header's
   * `onPointerDown` to start the close-drag from there instead of the whole
   * panel. Needed whenever the panel's content scrolls on the same axis as
   * the dismiss drag (the compare panel's table scrolls horizontally, same
   * axis as its right-edge close-drag) — dragging the header can never
   * conflict with a scroll gesture inside the content below it. `side="left"`
   * (the nav menu) has no such content and drags from anywhere on the panel,
   * so this is only meaningful for `side="right"`. `side="bottom"` never
   * needs it: it has its own built-in grab handle below.
   */
  dragHandleRef?: React.RefObject<((e: React.PointerEvent) => void) | null>;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Not `useIsTouchDevice()`: that hook defaults `false` and corrects itself
  // in an effect one render later, which is the right SSR-safe shape for
  // something that exists in the initially-hydrated tree. This panel never
  // does — it only ever mounts client-side, well after hydration, in
  // response to the click that opens it — so there's no mismatch to guard
  // against, and a lazy-evaluated initial state reads the real value on the
  // very first render instead of racing it. That race was a real bug here:
  // `drag` starting `false` and flipping true a render later meant the
  // gesture recognizer's own setup missed the window and never engaged.
  const [isTouch] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );
  const reduceMotion = useReducedMotion();
  const dragControls = useDragControls();
  const [extent, setExtent] = useState(0);
  // The single source of truth for the panel's drag offset along its axis —
  // bound to the element via `style` below, read and written by `drag`, and
  // also the target `initial`/`animate`/`exit` animate on mount/unmount, so
  // a drag-commit exit continues smoothly from wherever the gesture left it
  // rather than restarting from 0.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  // Set in onDragEnd before onClose() fires, so the exit transition the next
  // render picks up (AnimatePresence keeps the panel mounted through its
  // exit) is the fast fling-out rather than the slower canned one — a
  // flung-away panel shouldn't restart a 400ms glide. State, not a ref: this
  // value is read during render to choose the exit transition, and refs
  // can't be read there.
  const [wasDragged, setWasDragged] = useState(false);

  useDismissablePopover(open, onClose, triggerRef ? [panel, triggerRef] : [panel]);

  // A background that scrolls behind an open panel is disorienting, and on a
  // phone it is very easy to catch page content instead of the panel.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Measured, not hardcoded, since width/maxHeight are caller-configurable.
  // Two passes for the same reason `useAnchoredPanel` takes two: content
  // (and webfonts) can still be settling on first paint.
  useLayoutEffect(() => {
    if (!open) return;
    const bottom = side === "bottom";
    const measure = () => {
      const el = panel.current;
      if (!el) return;
      setExtent(bottom ? el.offsetHeight : el.offsetWidth);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [open, side]);

  useEffect(() => {
    if (!dragHandleRef) return;
    dragHandleRef.current = (e: React.PointerEvent) => dragControls.start(e);
    return () => {
      dragHandleRef.current = null;
    };
  }, [dragHandleRef, dragControls]);

  // Deliberately not an early `if (!open) return null` — that would unmount
  // `AnimatePresence` itself the instant `open` goes false, along with it
  // any chance of playing an exit animation. `AnimatePresence` needs to stay
  // mounted and see its child go from present to absent to animate that
  // transition; the conditional lives on the children below instead.
  const bottom = side === "bottom";
  const axis: "x" | "y" = bottom ? "y" : "x";
  const edge = bottom
    ? `inset-x-0 bottom-0 border-t border-zinc-200 dark:border-purple-800/50${fullHeight ? "" : " rounded-t-2xl"}`
    : side === "right"
      ? "inset-y-0 right-0 border-l border-zinc-200 dark:border-purple-800/50"
      : "inset-y-0 left-0 border-r border-zinc-200 dark:border-purple-800/50";

  // The entrance offset (how far off-screen it starts) versus the exit
  // target (how far it travels to leave) can differ: a bottom sheet only
  // rises 40% on the way in, content permitting, but a close always sends it
  // fully off-screen, matching iOS.
  const initial =
    side === "left" ? { x: "-100%", opacity: 0 } : side === "right" ? { x: "100%", opacity: 0 } : { y: "40%", opacity: 0 };
  const exit =
    side === "left" ? { x: "-100%", opacity: 0 } : side === "right" ? { x: "100%", opacity: 0 } : { y: "100%", opacity: 0 };

  const enterTransition = { duration: reduceMotion ? 0.01 : ENTER_DURATION, ease: EASE_SLIDE };
  const exitTransition = {
    duration: reduceMotion ? 0.01 : wasDragged ? FLING_DURATION : ENTER_DURATION,
    ease: EASE_SLIDE,
  };

  // A real numeric range, not a degenerate point: the close direction gets
  // the panel's full extent to travel (tracks the finger 1:1 all the way
  // off-screen), the "wrong" direction (dragging a left panel right, into
  // the page) gets a thin sliver so it reads as hitting a soft wall, not a
  // broken gesture. `dragElastic` stays low uniformly — the range itself is
  // the travel, not overflow past it. Reduced motion shrinks the wrong-
  // direction sliver further, less free travel rather than removing the
  // gesture outright. Zero before `extent` is measured, so nothing is
  // draggable until it is.
  const wrongWaySlack = reduceMotion ? 12 : Math.max(extent * 0.15, 24);
  const dragConstraints =
    extent <= 0
      ? { top: 0, bottom: 0, left: 0, right: 0 }
      : side === "left"
        ? { left: -extent, right: wrongWaySlack }
        : side === "right"
          ? { left: -wrongWaySlack, right: extent }
          : { top: -wrongWaySlack, bottom: extent };
  const dragElastic = 0.1;

  const motionValue = bottom ? my : mx;

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const offset = axis === "x" ? info.offset.x : info.offset.y;
    const velocity = axis === "x" ? info.velocity.x : info.velocity.y;
    // Sign must agree with the dismiss direction — a fast flick the wrong
    // way (e.g. right on a left panel) must never accidentally close it.
    const sign = side === "left" ? -1 : 1;
    const signedOffset = offset * sign;
    const signedVelocity = velocity * sign;
    const shouldClose =
      (extent > 0 && signedOffset > extent * CLOSE_DISTANCE_FRACTION) || signedVelocity > CLOSE_VELOCITY;

    if (shouldClose) {
      setWasDragged(true);
      onClose();
    } else {
      // Not a range boundary — 0 is just a point inside the legal drag
      // range — so nothing snaps it back on its own. Spring it back to rest
      // explicitly.
      animate(motionValue, 0, { type: "spring", stiffness: 500, damping: 35 });
    }
  };

  return (
    <AnimatePresence
      onExitComplete={() => {
        setWasDragged(false);
      }}
    >
      {open && (
        <>
          <motion.div
            key="backdrop"
            aria-hidden="true"
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.15 }}
          />
          <motion.div
            key="panel"
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            style={{ ...(bottom ? (fullHeight ? { height: "100dvh" } : { maxHeight }) : { width }), x: mx, y: my }}
            className={`fixed z-50 flex flex-col overflow-y-auto overscroll-contain bg-white p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-2xl dark:bg-surface-3 ${edge}`}
            initial={initial}
            // Transition lives inside each target object rather than the
            // top-level `transition` prop, so enter and exit can use
            // different durations: a drag-commit exit (`wasDragged`) is a
            // fast continued fling, not the slower canned glide the initial
            // mount uses. `x`/`y` here animate the same motion values bound
            // via `style` above, so a drag-commit exit continues smoothly
            // from wherever the gesture released rather than resetting to 0.
            animate={{ x: 0, y: 0, opacity: 1, transition: enterTransition }}
            exit={{ ...exit, transition: exitTransition }}
            drag={isTouch ? axis : false}
            dragListener={side === "left"}
            dragControls={dragControls}
            dragConstraints={dragConstraints}
            dragElastic={dragElastic}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
          >
            {bottom && (
              // The drag surface for the sheet: content below scrolls, this
              // never does, so the two gestures never fight each other.
              <motion.span
                aria-hidden
                onPointerDown={(e) => dragControls.start(e)}
                className="mx-auto mb-2 h-1 w-10 shrink-0 touch-none rounded-full bg-border"
              />
            )}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
