"use client";

import Link from "next/link";
import {
  Activity,
  ArrowLeftRight,
  ChevronRight,
  Download,
  FlaskConical,
  Hammer,
  LogIn,
  Newspaper,
  Settings,
  Star,
  CalendarRange,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { MORE_GROUPS } from "@/components/bottom-tabs";

/**
 * Sprint 41 — the phone's navigation hub. The bottom tab bar holds the three
 * destinations used every gameweek; this page holds the rest, as a full
 * screen rather than a drawer, so every route is one tap from here with a
 * line saying what it is for. The route list itself still comes from
 * `NAV_GROUPS` (via `MORE_GROUPS`) — this file only adds the icon and the
 * one-line description, so a new route can't be in the desktop nav and
 * missing here.
 */

const ROUTE_META: Record<string, { icon: LucideIcon; description: string }> = {
  "/leagues": { icon: Trophy, description: "Mini-league tables and effective ownership" },
  "/news": { icon: Newspaper, description: "Injury news, price changes and feeds" },
  "/builder": { icon: Hammer, description: "Build a squad from scratch within the rules" },
  "/scenarios": { icon: FlaskConical, description: "Compare saved drafts side by side" },
  "/transfers": { icon: ArrowLeftRight, description: "Transfer plan, hits and chip timing" },
  "/shortlist": { icon: Star, description: "Players you've marked to come back to" },
  "/fixtures": { icon: CalendarRange, description: "Schedule, difficulty ticker and league table" },
};

const rowClass =
  "flex min-h-14 items-center gap-3 px-4 py-3 transition-colors active:bg-zinc-100 dark:active:bg-purple-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function HubRow({
  href,
  icon: Icon,
  label,
  description,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  description?: string;
}) {
  return (
    <li>
      <Link href={href} className={rowClass}>
        <Icon aria-hidden="true" className="size-5 shrink-0 text-purple-700 dark:text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
          {description && (
            <span className="block text-sm text-zinc-500 dark:text-zinc-400">{description}</span>
          )}
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
      </Link>
    </li>
  );
}

function HubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-4 pb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {/* One surface per group with hairline dividers between rows — not a
          card per row, which would nest padding and eat the readable width. */}
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-purple-900/40 dark:border-purple-900/40 dark:bg-card">
        {children}
      </ul>
    </section>
  );
}

export default function MorePage() {
  const { user } = useAuth();

  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">More</h1>

      {MORE_GROUPS.map((group) => (
        <HubSection key={group.label} title={group.label}>
          {group.items.map((item) => {
            const meta = ROUTE_META[item.href];
            return (
              <HubRow
                key={item.href}
                href={item.href}
                icon={meta?.icon ?? ChevronRight}
                label={item.label}
                description={meta?.description}
              />
            );
          })}
        </HubSection>
      ))}

      <HubSection title="Account">
        {user ? (
          <HubRow href="/settings/?tab=account" icon={Settings} label="Manage account" />
        ) : (
          <HubRow
            href="/signin/"
            icon={LogIn}
            label="Sign in"
            description="Save drafts and your shortlist across devices"
          />
        )}
        <HubRow
          href="/settings/?tab=import"
          icon={Download}
          label="Import squad"
          description="Bring in your FPL team by Manager ID"
        />
        <HubRow
          href="/settings/?tab=status"
          icon={Activity}
          label="Pipeline health"
          description="When each data source last synced"
        />
      </HubSection>
    </main>
  );
}
