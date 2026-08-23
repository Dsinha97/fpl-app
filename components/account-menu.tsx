"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase/client";
import { THEME_LABEL, ThemeModeIcon, useThemeMode, type ThemeMode } from "@/components/theme";

// Sprint 14.3 — replaces AuthStatus + the standalone ThemeToggle button with
// one circular menu, so the header carries one control instead of four
// (email, "FPL Account" link, Sign out, theme toggle). Same dismissible-
// popover convention as components/nav-links.tsx and info-tooltip.tsx:
// click-toggle + outside-click (mousedown) + Escape, one wrapper ref — "the
// whole app has one convention for a dismissible popover".
//
// The menu is always rendered, signed in or out, so the theme controls are
// never unreachable — only their contents change.

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

const THEME_ORDER: ThemeMode[] = ["light", "dark", "system"];

export function AccountMenu() {
  const { user, loading, teamName } = useAuth();
  const { mode, setMode } = useThemeMode();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

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

  if (loading) return <div className="h-8 w-8" aria-hidden="true" />;

  // First two letters of the FPL team name — "DS United" -> "DS". Falls back
  // to a generic person icon signed out, or signed in without a Manager ID
  // claimed yet (no team name to initial).
  const initials = teamName ? teamName.slice(0, 2).toUpperCase() : null;

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={user ? "Account menu" : "Sign in and theme menu"}
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 text-xs font-semibold text-zinc-600 transition-colors hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
      >
        {initials ?? <PersonIcon />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-purple-800/50 dark:bg-[#2A0A45]"
        >
          {user ? (
            <div className="border-b border-zinc-100 px-2 pb-2 dark:border-purple-900/40">
              <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100" title={user.email ?? undefined}>
                {teamName ?? user.email}
              </p>
              {teamName && (
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
              )}
            </div>
          ) : (
            <div className="border-b border-zinc-100 px-2 pb-2 text-xs text-zinc-500 dark:border-purple-900/40 dark:text-zinc-400">
              Not signed in
            </div>
          )}

          {user && (
            <Link
              href="/settings/?tab=account"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="block rounded-md px-2 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-purple-950/40"
            >
              Manage account
            </Link>
          )}

          {/* Moved out of the main nav (Sprint 22) — a data-freshness page
              belongs beside account settings, not competing with the 10
              primary destinations for a nav slot. */}
          <Link
            href="/status/"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="block rounded-md px-2 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-purple-950/40"
          >
            Status
          </Link>

          <div className="px-2 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Theme
          </div>
          <div className="flex gap-1 px-2 pb-2">
            {THEME_ORDER.map((m) => (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                title={THEME_LABEL[m]}
                className={`flex flex-1 flex-col items-center gap-1 rounded-md border py-1.5 text-[11px] transition-colors ${
                  mode === m
                    ? "border-purple-600 bg-purple-50 text-purple-800 dark:border-[#00FF87] dark:bg-[#00FF87]/10 dark:text-[#00FF87]"
                    : "border-transparent text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-purple-950/40"
                }`}
              >
                <ThemeModeIcon mode={m} />
                {THEME_LABEL[m]}
              </button>
            ))}
          </div>

          {user ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void supabase.auth.signOut();
              }}
              className="mt-1 block w-full rounded-md px-2 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-purple-950/40"
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/signin/"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="mt-1 block rounded-md px-2 py-2 text-sm font-medium text-purple-800 transition-colors hover:bg-purple-50 dark:text-[#00FF87] dark:hover:bg-purple-950/40"
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
