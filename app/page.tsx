"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Monogram } from "@/components/brand";
import { supabase } from "@/lib/supabase/client";

type Status = "checking" | "connected" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    supabase
      .from("health_check")
      .select("status")
      .limit(1)
      .single()
      .then(({ error }) => setStatus(error ? "error" : "connected"));
  }, []);

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
            className="rounded-md bg-purple-950 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-800 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
          >
            Connect your team →
          </Link>
          <Link
            href="/players"
            className="rounded-md border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
          >
            Explore players
          </Link>
        </div>
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
