"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CalendarClock, LayoutGrid, Shirt, Users, type LucideIcon } from "lucide-react";
import { NAV_GROUPS } from "@/components/nav-links";

/**
 * Sprint 41 — the phone's primary navigation. Below `lg` the header's
 * hamburger drawer is gone: three destinations the owner opens every
 * gameweek sit under the thumb, and everything else lives one tap away on the
 * full-page `/more` hub rather than behind a drawer of collapsed accordions
 * (two taps to reach anything, and the drawer opened at the top-left — the
 * one corner a right-handed thumb can't reach).
 *
 * Four tabs, not five: each target is ~94px wide at 375px, well past the 44px
 * floor, with room for a label under every icon. Labels are not optional —
 * an icon-only Deadline tab is a guess.
 */

type Tab = { href: string; label: string; icon: LucideIcon };

const TABS: readonly Tab[] = [
  { href: "/deadline", label: "Deadline", icon: CalendarClock },
  { href: "/team", label: "My Team", icon: Shirt },
  { href: "/players", label: "Players", icon: Users },
  { href: "/more", label: "More", icon: LayoutGrid },
];

/**
 * `bottom` for anything else fixed to the bottom edge (a compare bar, a
 * toast): above the tab bar where it shows, flush to the edge where it
 * doesn't. A literal class string so Tailwind sees it.
 */
export const ABOVE_BOTTOM_TABS =
  "bottom-[calc(4rem+env(safe-area-inset-bottom))] transition-[bottom] duration-200 ease-out motion-reduce:transition-none [html[data-tabs=away]_&]:bottom-0 lg:bottom-0";

/** Routes the tab bar owns directly; every other nav route is reached via More. */
export const TAB_HREFS = new Set(TABS.map((t) => t.href));

/** The `NAV_GROUPS` routes that have no tab of their own — what /more lists. */
export const MORE_GROUPS = NAV_GROUPS.map((group) => ({
  label: group.label,
  items: group.items.filter((item) => !TAB_HREFS.has(item.href)),
})).filter((group) => group.items.length > 0);

const MORE_HREFS = new Set<string>([
  "/more",
  "/settings",
  "/signin",
  ...MORE_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
]);

/** Strip the trailing slash that `trailingSlash: true` adds. */
const normalize = (path: string) => (path !== "/" ? path.replace(/\/$/, "") : path);

/*
 * Focus flows. A dedicated task (the full player profile, an edit with its
 * own confirm bar) hides the general navigation so the screen has one job
 * and the bottom edge belongs to that task's actions. A counter, not a
 * boolean, so two overlapping flows can't un-hide the bar for each other.
 */
let focusFlows = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((fn) => fn());

/** Hide the bottom tab bar while `active` is true (e.g. while a full-screen sheet is open). */
export function useHideBottomTabs(active: boolean) {
  useEffect(() => {
    if (!active) return;
    focusFlows += 1;
    emit();
    return () => {
      focusFlows -= 1;
      emit();
    };
  }, [active]);
}

/**
 * Translucent bar that slides away on scroll down (Gmail) and returns on any
 * scroll up or at the page edges. */
function useScrolledAway() {
  const [away, setAway] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    // No rAF throttle: it never fires on a hidden document, and this handler
    // is a few comparisons plus a bail-out setState.
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      const nearTop = y <= 64;
      const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 48;
      if (nearTop || nearBottom || dy < -4) setAway(false);
      else if (dy > 8) setAway(true);
      if (Math.abs(dy) > 4) lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return [away, () => setAway(false)] as const;
}

export function BottomTabs() {
  const pathname = normalize(usePathname() ?? "/");
  const hidden = useSyncExternalStore(
    subscribe,
    () => focusFlows > 0,
    () => false,
  );
  const [away, reveal] = useScrolledAway();

  // Other fixed bottom bars (see ABOVE_BOTTOM_TABS) follow the tab bar down.
  useEffect(() => {
    document.documentElement.dataset.tabs = away ? "away" : "shown";
    return () => {
      delete document.documentElement.dataset.tabs;
    };
  }, [away]);

  if (hidden) return null;

  return (
    <nav
      aria-label="Primary"
      onFocusCapture={reveal}
      className={`fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] lg:hidden border-zinc-200/60 bg-white/60 backdrop-blur-xl backdrop-saturate-150 dark:border-purple-300/10 dark:bg-card/55 [@media(prefers-reduced-transparency:reduce)]:bg-white [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none dark:[@media(prefers-reduced-transparency:reduce)]:bg-card transition-transform duration-200 ease-out motion-reduce:transition-none ${
        away ? "translate-y-full" : "translate-y-0"
      }`}
    >
      <ul className="mx-auto flex h-16 max-w-xl items-stretch">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/more" ? MORE_HREFS.has(pathname) : pathname === href;
          return (
            <li key={href} className="flex flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`group flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  active
                    ? "text-purple-800 dark:text-primary"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {/* The pill behind the icon is the active marker, and the
                    part that presses in — feedback lands on touch-down, not
                    on the navigation that follows it. */}
                <span
                  className={`flex h-8 w-14 items-center justify-center rounded-full transition-[background-color,transform] duration-fast ease-out group-active:scale-90 motion-reduce:transition-none ${
                    active ? "bg-purple-100 dark:bg-primary/15" : ""
                  }`}
                >
                  <Icon aria-hidden="true" className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
