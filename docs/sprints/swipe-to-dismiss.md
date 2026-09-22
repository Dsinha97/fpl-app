# Swipe-to-dismiss gestures — built 2026-09-21

No new sprint number — an animate-skill pass prompted by the owner asking for the interface to
"behave like a mobile app": swipe the player card down, the nav menu left, the compare menu right.

## Context

`components/ui/slide-over.tsx` already backs all three named surfaces on mobile — `MobileNav`
(`side="left"`), the mobile player-card/profile bottom sheet (`side="bottom"`), and the compare
panel on `/players` (`side="right"`) — lifted into one shared primitive in Sprint 33 specifically so
there'd be one implementation, not three. Each surface's dismiss-swipe direction already matched its
entrance direction for free ("exit the way it entered"), so one change to the shared primitive,
direction-derived from the existing `side` prop, covered all three requests in one pass rather than
three separate ones.

The repo had no gesture/animation library. `motion` (motion.dev) was added rather than hand-rolling
drag/velocity/rubber-band physics with raw Pointer Events — the `animate` skill's own tool-selection
order puts "springs, layout animations, exit animations, gesture-driven values" at `motion`, and this
is exactly that case.

`SlideOver` previously unmounted instantly on close (`if (!open) return null`), with a comment
explaining that was deliberate: a CSS `fill-mode: both` animation that never completes (a
backgrounded tab, a paused compositor) can leave a panel stuck invisible-but-present. `AnimatePresence`
is JS/promise-driven rather than CSS-fill-mode-driven, which sidesteps that specific failure mode
while still giving a real exit animation to drag into.

## What shipped

**`motion` dependency and `AnimatePresence` rewrite** (`components/ui/slide-over.tsx`) — backdrop and
panel are now `motion.div`s inside `AnimatePresence`, with the conditional moved from an early
`return null` to the JSX children (`{open && (...)}`) so `AnimatePresence` stays mounted to actually
see the open→closed transition and animate it, rather than being torn down with it. Entrance/exit
values mirror the existing `sheet-rise`/`panel-slide-left`/`panel-slide-right` CSS keyframes
(`app/globals.css`) so the visual entrance is unchanged; `--duration-slower`/`--ease-slide` are
mirrored as JS constants since `motion` transitions take JS values, not CSS custom properties.

**Direction-aware drag-to-dismiss** — `side="left"` drags left to close, `side="right"` drags right,
`side="bottom"` drags down, via a real numeric `dragConstraints` range (the close direction gets the
panel's full extent, the wrong direction a thin resistance sliver) bound to a `useMotionValue` via
`style`, not a degenerate zero-width point constraint. The point-constraint version — the more
"canonical" textbook pattern — measurably misbehaved in this repo's environment (see Verification);
the real-range-plus-explicit-imperative-snap-back version did not. A drag commits past 35% of the
panel's extent or a 500px/s flick in the dismiss direction (both gated on sign, so a fast flick the
wrong way never closes it); short of that, `animate(motionValue, 0, spring)` snaps it back explicitly,
since 0 is just a point inside a real range and nothing returns it there on its own.

**Scroll-conflict handling, per surface** — the bottom sheet's previously-decorative grab handle now
drives the drag via `dragControls`/`dragListener={false}`, so the scrollable content below it never
sees the gesture. The compare panel's table scrolls horizontally, the same axis as its close-drag, so
only its header (`app/players/page.tsx`) is wired as the drag handle, not the whole panel — same
mental model as the sheet's handle. The nav panel has no scrollable content and drags from anywhere.

**Touch gating** — `drag` is `false` on non-touch (`pointer: coarse` read once at mount, not via the
existing `useMinWidth`-style hook, since that hook's SSR-safe `false`-then-effect-corrects-later shape
raced the gesture recognizer's own setup here — see Verification), so desktop mouse interaction
(click-outside dismissal, text selection inside the compare table) is untouched.

**Reduced motion** — `useReducedMotion()` flattens `dragElastic` toward a stiffer, lower-give value and
collapses transition durations, rather than removing the gesture — the existing "gentler, not gone"
convention.

## What was written up, not implemented

Named as candidates during research, not built this pass:

1. A global `-webkit-tap-highlight-color`/`touch-action: manipulation` reset — four components
   currently opt in individually.
2. The desktop player-modal dialog (`DesktopDialog` in `components/player-modal.tsx`) still has no
   exit animation; bringing it onto the same `AnimatePresence` pattern would keep it from reading as
   dated next to the panels above (desktop-only, no gesture-dismiss concern).

## Verification

`npx tsc --noEmit`, `npm run lint`, and `npm run build` all passed clean.

The drag mechanism specifically fought the test tooling rather than the app: this session's Browser
pane went hidden partway through verification, and a headless Playwright context showed the same
symptom — Chromium suspends `requestAnimationFrame` for a backgrounded/non-composited tab, which
starves any rAF-driven library (Framer Motion's drag/spring system included) of the samples it needs,
independent of the component code. That's what the original point-constraint implementation's
"decaying transform, no `onDragEnd`" trace turned out to be — not a real bug, but confirmed hard to
tell apart from one under this kind of throttling. One clean Playwright run, before the tab
backgrounded, did confirm the mechanism itself: `onDragStart`/`onDrag`/`onDragEnd` fired with correct
offset/velocity, and a below-threshold drag correctly sprang back rather than closing. Manually
verified in the visible browser: the nav menu's entrance animation and backdrop-click dismissal both
render and behave correctly. The swipe *feel* specifically — commit threshold, spring tuning, elastic
resistance — was not independently confirmed on a real device or a visible tab this session; worth a
quick manual pass before trusting the tuning numbers as final.
