"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export const NAV = [
  { href: "/deadline", label: "Deadline" },
  { href: "/team", label: "My Team" },
  { href: "/builder", label: "Builder" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/transfers", label: "Transfers" },
  { href: "/chips", label: "Chips" },
  { href: "/players", label: "Players" },
  { href: "/compare", label: "Compare" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/news", label: "News" },
  { href: "/status", label: "Status" },
] as const;

/** Strip the trailing slash that `trailingSlash: true` adds, so "/team/" matches "/team". */
const normalize = (path: string) => (path !== "/" ? path.replace(/\/$/, "") : path);

/**
 * The `hidden lg:flex` desktop row only — split out from the mobile trigger
 * (below) so `app/layout.tsx` can place them independently. They used to be
 * one component returning a two-element fragment, which meant moving the
 * mobile trigger to the header's left edge would have dragged this 10-item
 * row in front of the logo too, since fragment siblings share one DOM
 * position regardless of which breakpoint currently shows which one.
 */
export function DesktopNav() {
  const pathname = normalize(usePathname() ?? "/");

  return (
    <div className="hidden gap-4 text-sm lg:flex">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active
                ? "border-current font-medium text-purple-800 dark:text-[#00FF87]"
                : "border-transparent text-zinc-600 hover:text-purple-800 dark:text-zinc-400 dark:hover:text-[#00FF87]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

/** The `lg:hidden` hamburger trigger + bottom-sheet drawer. See `DesktopNav` above for why this is a separate component. */
export function MobileNav() {
  const pathname = normalize(usePathname() ?? "/");
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Same click-toggle + outside-click + Escape pattern as InfoTooltip, so the
  // whole app has one convention for a dismissible popover. The sheet and its
  // backdrop below stay inside `wrapper`'s DOM subtree (fixed positioning is
  // just a paint-time thing, not a containment one), so this containment
  // check still holds even though the sheet visually detaches from the
  // trigger to dock at the bottom of the viewport.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // A background scroll behind an open bottom sheet is disorienting, and on
    // a phone it's very easy to catch page content instead of the sheet.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Close the sheet after following a link rather than leaving it open
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
          {/* Backdrop: clicking it is a click "outside" the sheet's
              content but still inside `wrapper`'s DOM subtree, so the
              mousedown listener above wouldn't close it on its own —
              needs its own handler. */}
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/40"
          />
          {/* A trigger anywhere in the header is one tap; the 11 links
              inside used to drop down from wherever that trigger sat,
              landing in the hardest-to-reach band of the screen
              regardless of grip. Docking to the bottom edge puts every
              link in the easy thumb zone instead. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-zinc-200 bg-white p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-2xl dark:border-purple-800/50 dark:bg-[#2A0A45]"
          >
            <div
              aria-hidden="true"
              className="mx-auto mb-2 h-1 w-10 rounded-full bg-zinc-300 dark:bg-purple-800"
            />
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-md px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? "bg-purple-50 font-medium text-purple-800 dark:bg-purple-950/60 dark:text-[#00FF87]"
                      : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-purple-950/40"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
