"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown } from "lucide-react";

/**
 * Sprint 22 — eleven flat top-level links overwhelmed a new user, so they're
 * grouped by what the owner is doing: watching a live/upcoming gameweek,
 * planning a move, or looking something up. `Status` moved out entirely,
 * into `AccountMenu` (a data-freshness page belongs beside account
 * settings, not competing for a nav slot). `News` sits in Live rather than
 * Statistics — it's matchday/deadline-relevant reading, not reference data.
 *
 * Sprint 29 — `Review` moved from Live to Strategy: it's a post-mortem on a
 * gameweek that's already finished (what a past decision actually cost),
 * not this gameweek's live state — Live is for "what's happening now",
 * Strategy is for "what should I do", and a backward-looking report reads
 * naturally next to the forward-looking planning tools, after `Chips`.
 */
export const NAV_GROUPS = [
  {
    label: "Live",
    items: [
      { href: "/deadline", label: "Deadline" },
      { href: "/team", label: "My Team" },
      { href: "/leagues", label: "Leagues" },
      { href: "/news", label: "News" },
    ],
  },
  {
    label: "Strategy",
    items: [
      { href: "/builder", label: "Builder" },
      { href: "/scenarios", label: "Scenarios" },
      { href: "/transfers", label: "Transfers" },
      // Sprint 33 — Chips merged into Transfers as its "Chip timing" tab
      // (same draft, same engine), and Review into My Team, under the
      // gameweek selector that was already a past-gameweek view. Both
      // survive as redirect stubs.
    ],
  },
  {
    label: "Statistics",
    items: [
      { href: "/players", label: "Players" },
      // Sprint 38 — the players you've marked to come back to. Signed-in
      // only; the page says so rather than rendering an empty list.
      { href: "/shortlist", label: "Shortlist" },
      // Sprint 33 — Compare merged into Players as a slide-over panel, so it
      // is no longer a destination of its own. /compare survives only as a
      // redirect stub for old links.
      { href: "/fixtures", label: "Fixtures" },
    ],
  },
] as const;

/** Strip the trailing slash that `trailingSlash: true` adds, so "/team/" matches "/team". */
const normalize = (path: string) => (path !== "/" ? path.replace(/\/$/, "") : path);

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
            ? "border-current font-medium text-purple-800 dark:text-primary"
            : "border-transparent text-zinc-600 hover:text-purple-800 dark:text-zinc-400 dark:hover:text-primary"
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
                        ? "font-medium text-purple-800 dark:text-primary"
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

/*
 * Sprint 41 — `MobileNav` (the hamburger + left drawer) is gone. Below `lg`
 * navigation is the bottom tab bar plus the `/more` hub
 * (`components/bottom-tabs.tsx`), both reading `NAV_GROUPS` above.
 */
