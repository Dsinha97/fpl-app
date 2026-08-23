"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown } from "lucide-react";
import { useDismissablePopover } from "@/components/ui/use-anchored-panel";
import { Monogram, Wordmark } from "@/components/brand";

/**
 * Sprint 22 — eleven flat top-level links overwhelmed a new user, so they're
 * grouped by what the owner is doing: watching a live/upcoming gameweek,
 * planning a move, or looking something up. `Status` moved out entirely,
 * into `AccountMenu` (a data-freshness page belongs beside account
 * settings, not competing for a nav slot). `News` sits in Live rather than
 * Statistics — it's matchday/deadline-relevant reading, not reference data.
 */
export const NAV_GROUPS = [
  {
    label: "Live",
    items: [
      { href: "/deadline", label: "Deadline" },
      { href: "/team", label: "My Team" },
      { href: "/news", label: "News" },
    ],
  },
  {
    label: "Strategy",
    items: [
      { href: "/builder", label: "Builder" },
      { href: "/scenarios", label: "Scenarios" },
      { href: "/transfers", label: "Transfers" },
      { href: "/chips", label: "Chips" },
    ],
  },
  {
    label: "Statistics",
    items: [
      { href: "/players", label: "Players" },
      { href: "/compare", label: "Compare" },
      { href: "/fixtures", label: "Fixtures" },
    ],
  },
] as const;

/** Strip the trailing slash that `trailingSlash: true` adds, so "/team/" matches "/team". */
const normalize = (path: string) => (path !== "/" ? path.replace(/\/$/, "") : path);

const activeLinkClass =
  "bg-purple-50 font-medium text-purple-800 dark:bg-purple-950/60 dark:text-[#00FF87]";
const inactiveLinkClass =
  "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-purple-950/40";

/**
 * The `hidden lg:flex` desktop row only — split out from the mobile trigger
 * (below) so `app/layout.tsx` can place them independently. They used to be
 * one component returning a two-element fragment, which meant moving the
 * mobile trigger to the header's left edge would have dragged this row in
 * front of the logo too, since fragment siblings share one DOM position
 * regardless of which breakpoint currently shows which one.
 *
 * Each group is a `@base-ui/react/menu` dropdown — the same primitive
 * `ActionMenu` (`components/ui/action-menu.tsx`) already uses, so keyboard
 * nav, focus management and outside-dismiss come for free instead of a
 * fourth hand-rolled popover.
 */
/**
 * One group's menu — its own component so each group tracks whether *it*
 * was opened by hover or by a click, independent of its siblings.
 *
 * Sprint 25: hover-opens the group (translucent popup, a quick preview),
 * and a click "solidifies" it (opaque, as if pinned open) — a controlled
 * `Menu.Root` with `openOnHover` on the trigger, matching-hover on the
 * popup itself (via a shared `onOpenChange`) so drift onto the menu items
 * doesn't close it. `modal={false}` matters here — the default `true`
 * would lock page scroll on mere hover, which a click-only menu never
 * triggered. `openOnHover`/`delay`/`closeDelay` live on `Menu.Trigger`;
 * verified against the installed @base-ui/react types before relying on
 * them. Note `components/ui/action-menu.tsx`'s comment that a *controlled*
 * menu's plain click was unreliable under Base UI's press-then-drag model —
 * that menu opts out of hover entirely to dodge it; this one wants hover,
 * so the solidify-on-click path is worth a manual check, not just a read.
 */
function DesktopNavGroup({
  group,
  pathname,
}: {
  group: (typeof NAV_GROUPS)[number];
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);
  const active = group.items.some((item) => pathname === item.href);

  return (
    <Menu.Root
      open={open}
      modal={false}
      onOpenChange={(nextOpen, details) => {
        setOpen(nextOpen);
        if (nextOpen && details.reason === "trigger-press") setSolid(true);
        if (!nextOpen) setSolid(false);
      }}
    >
      <Menu.Trigger
        openOnHover
        delay={120}
        closeDelay={150}
        className={`flex items-center gap-1 whitespace-nowrap rounded-md border-b-2 px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          active
            ? "border-current font-medium text-purple-800 dark:text-[#00FF87]"
            : "border-transparent text-zinc-600 hover:text-purple-800 dark:text-zinc-400 dark:hover:text-[#00FF87]"
        }`}
      >
        {group.label}
        <ChevronDown
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Menu.Popup
            className={`min-w-40 origin-[var(--transform-origin)] rounded-md border border-border py-1 text-popover-foreground shadow-xl outline-none transition-[opacity,scale,background-color] duration-150 ease-out motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 ${
              solid ? "bg-popover" : "bg-popover/80 backdrop-blur-md"
            }`}
          >
            {group.items.map((item) => {
              const itemActive = pathname === item.href;
              return (
                <Menu.Item key={item.href} render={<Link href={item.href} />}>
                  <span
                    aria-current={itemActive ? "page" : undefined}
                    className={`block px-3 py-1.5 text-sm ${
                      itemActive
                        ? "font-medium text-purple-800 dark:text-[#00FF87]"
                        : "text-popover-foreground"
                    }`}
                  >
                    {item.label}
                  </span>
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function DesktopNav() {
  const pathname = normalize(usePathname() ?? "/");

  return (
    <div className="hidden gap-1 text-sm lg:flex">
      {NAV_GROUPS.map((group) => (
        <DesktopNavGroup key={group.label} group={group} pathname={pathname} />
      ))}
    </div>
  );
}

/** One expanding group section inside the mobile drawer — plain conditional
 * render for now; Sprint 24 upgrades this to the shared grid-rows accordion
 * alongside every other expander in the app. */
function MobileNavGroup({
  group,
  pathname,
  onNavigate,
}: {
  group: (typeof NAV_GROUPS)[number];
  pathname: string;
  onNavigate: () => void;
}) {
  const active = group.items.some((item) => pathname === item.href);
  const [open, setOpen] = useState(active);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between rounded-md px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          active
            ? "text-purple-800 dark:text-[#00FF87]"
            : "text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {group.label}
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      {/* CSS Grid 0fr→1fr rather than mount/unmount (Sprint 24) — the same
          pattern every other expander in the app uses, so the drawer's
          groups animate instead of snapping open. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="pb-1 pl-2">
            {group.items.map((item) => {
              const itemActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={itemActive ? "page" : undefined}
                  className={`block rounded-md px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    itemActive ? activeLinkClass : inactiveLinkClass
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The `lg:hidden` hamburger trigger + left-side drawer. See `DesktopNav` above for why this is a separate component. */
export function MobileNav() {
  const pathname = normalize(usePathname() ?? "/");
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  // Same click-toggle + outside-click + Escape convention as everywhere else
  // in the app (`useDismissablePopover`), plus the drawer/backdrop's own
  // body-scroll lock — a background scroll behind an open drawer is
  // disorienting, and on a phone it's very easy to catch page content
  // instead of the drawer.
  useDismissablePopover(open, () => setOpen(false), [wrapper, drawer]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Close the drawer after following a link rather than leaving it open
  // behind the new page.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(false), [pathname]);

  return (
    /* No `ml-auto` here — this used to be the header's other `ml-auto`
       alongside AccountMenu's, and two auto margins in one flex row split
       the leftover space between them instead of pushing either all the
       way to an edge. That left the trigger floating mid-header rather
       than at either side. Rendered first in layout.tsx so it's the
       leftmost item — reachable from a left-hand grip without reaching
       across the wordmark, and the account avatar keeps the right edge to
       itself via its own `ml-auto` in layout.tsx. */
    <div ref={wrapper} className="relative lg:hidden">
      <button
        type="button"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-md text-xl leading-none text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-zinc-300 dark:hover:bg-purple-950/60"
      >
        <span aria-hidden="true">{open ? "×" : "☰"}</span>
      </button>

      {open && (
        <>
          {/* Backdrop: clicking it is a click "outside" the drawer's
              content but still inside `wrapper`'s DOM subtree, so the
              mousedown listener in `useDismissablePopover` wouldn't close
              it on its own — needs its own handler. */}
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/40"
          />
          {/* A trigger at the header's left edge is one tap; docking the
              drawer to the same edge it opened from (rather than the
              bottom, as an earlier version did) keeps the tap and its
              result at the same side of the screen instead of opposite
              ends of the viewport. */}
          <div
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-50 w-[min(20rem,85vw)] overflow-y-auto border-r border-zinc-200 bg-white p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-2xl dark:border-purple-800/50 dark:bg-[#2A0A45]"
          >
            {/* Sprint 25: the app's own wordmark, Gmail-sidebar style,
                rather than a plain "Navigation" label — and no dedicated
                close button, since a backdrop tap, Escape, or the hamburger
                itself (which is already an "×" while open) all close this
                drawer; a fourth affordance was redundant. */}
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 border-b border-zinc-200 px-2 py-3 dark:border-purple-800/50"
            >
              <Monogram size={24} />
              <Wordmark />
            </Link>
            <div className="space-y-0.5 pt-1">
              {NAV_GROUPS.map((group) => (
                <MobileNavGroup
                  key={group.label}
                  group={group}
                  pathname={pathname}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
