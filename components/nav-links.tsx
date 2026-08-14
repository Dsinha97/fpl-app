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
  { href: "/changes", label: "Changes" },
  { href: "/status", label: "Status" },
] as const;

/** Strip the trailing slash that `trailingSlash: true` adds, so "/team/" matches "/team". */
const normalize = (path: string) => (path !== "/" ? path.replace(/\/$/, "") : path);

export function NavLinks() {
  const pathname = normalize(usePathname() ?? "/");
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Same click-toggle + outside-click + Escape pattern as InfoTooltip, so the
  // whole app has one convention for a dismissible popover.
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
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Close the drawer after following a link rather than leaving it open
  // behind the new page.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      {/* Ten items plus the logo and theme toggle don't fit a phone or
          tablet width — below lg this collapses to a hamburger drawer
          instead of the overflow-x-auto scroller it used to be, which
          was reachable but not discoverable. */}
      <div className="hidden gap-4 text-sm lg:flex">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 py-1 transition-colors ${
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

      {/* `ml-auto` so the trigger (and the ThemeToggle sitting right after it
          in layout.tsx) land at the header's right edge — anchoring the
          drawer under a button stuck mid-header let it run off the right
          side of the viewport. */}
      <div ref={wrapper} className="relative ml-auto lg:hidden">
        <button
          type="button"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-purple-950/60"
        >
          <span aria-hidden="true">{open ? "×" : "☰"}</span>
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Navigation"
            className="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-purple-800/50 dark:bg-[#2A0A45]"
          >
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors ${
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
        )}
      </div>
    </>
  );
}
