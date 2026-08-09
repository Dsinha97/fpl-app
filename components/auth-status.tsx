"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase/client";

/** Sign-in / sign-out affordance, next to the theme toggle in every header. */
export function AuthStatus() {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (!user) {
    return (
      <Link
        href="/signin"
        className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className="hidden max-w-[10rem] truncate text-zinc-500 sm:inline dark:text-zinc-400"
        title={user.email ?? undefined}
      >
        {user.email}
      </span>
      <Link
        href="/settings/fpl"
        className="hidden whitespace-nowrap text-xs text-zinc-500 underline decoration-dotted hover:text-purple-800 sm:inline dark:text-zinc-400 dark:hover:text-[#00FF87]"
      >
        FPL Account
      </Link>
      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
      >
        Sign out
      </button>
    </div>
  );
}
