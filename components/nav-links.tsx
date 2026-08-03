"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/team", label: "My Team" },
  { href: "/builder", label: "Builder" },
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

  return (
    <div className="flex gap-4 overflow-x-auto text-sm">
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
  );
}
