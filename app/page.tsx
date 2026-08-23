"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Monogram } from "@/components/brand";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";

type Status = "checking" | "connected" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("checking");
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    supabase
      .from("health_check")
      .select("status")
      .limit(1)
      .single()
      .then(({ error }) => setStatus(error ? "error" : "connected"));
  }, []);

  // The marketing splash below is only useful once, before the owner has
  // ever signed in — every return visit should land on the actual decision
  // surface, not a hero banner. Redirect belongs in an effect, never in the
  // render body itself, or React warns on every signed-out render too
  // (CLAUDE.md gotcha: router.replace() in a render body).
  useEffect(() => {
    if (!loading && session) router.replace("/deadline");
  }, [loading, session, router]);

  if (loading || session) return null;

  return (
    <div className="flex flex-col flex-1 items-center justify-center font-sans">
      <main className="flex w-full max-w-3xl flex-col items-center gap-6 px-6 py-24 text-center">
        <Monogram size={72} />
        <h1 className="text-4xl font-extrabold tracking-tight text-purple-950 dark:text-white">
          FPL <span className="text-purple-700 dark:text-[#00FF87]">DECISION</span>
        </h1>
        <p className="text-sm font-semibold tracking-[0.2em] text-purple-800 dark:text-purple-400">
          ANALYTICS HUB
        </p>
        <p className="max-w-md text-zinc-600 dark:text-zinc-400">
          Transfers, captaincy, chips, and fixtures — decided with data, not vibes.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link
            href="/team"
            className="rounded-md bg-purple-950 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
          >
            Import your FPL squad →
          </Link>
          <Link
            href="/players"
            className="rounded-md border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
          >
            Explore players
          </Link>
        </div>
        <p className="max-w-md text-xs text-zinc-400">
          You&apos;ll just need the numeric Manager ID from your team&apos;s URL on
          fantasy.premierleague.com.
        </p>
        <p
          className={`mt-4 text-xs ${
            status === "connected"
              ? "text-zinc-400"
              : status === "error"
                ? "text-red-500"
                : "text-zinc-400"
          }`}
        >
          {status === "connected"
            ? "Data pipeline: connected"
            : status === "error"
              ? "Data pipeline: unreachable"
              : "Checking data pipeline…"}
        </p>
      </main>
    </div>
  );
}
