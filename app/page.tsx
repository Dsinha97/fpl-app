"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Monogram } from "@/components/brand";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { BackgroundPaths } from "@/components/ui/background-paths";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { TapToReveal } from "@/components/info-tooltip";
import { LandingPreview } from "@/components/landing-preview";

/**
 * What the visitor is told about data freshness.
 *
 * DSI-118: "Data pipeline: connected" is an engineer's answer to a question
 * no FPL manager asked. What a manager wants to know before trusting a
 * projection is which gameweek the numbers are for and when they were last
 * pulled — so this reads the real `is_next` gameweek rather than asserting
 * health. `unreachable` stays, because a visitor seeing no numbers deserves
 * to know the difference between "empty" and "broken".
 */
type Pipeline =
  | { state: "checking" }
  | { state: "ready"; gameweek: string; syncedAt: string | null }
  | { state: "error" };

function freshness(iso: string | null): string | null {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins < 60) return `synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `synced ${hrs}h ago`;
  return `synced ${Math.round(hrs / 24)}d ago`;
}

export default function Home() {
  const [pipeline, setPipeline] = useState<Pipeline>({ state: "checking" });
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const [gwRes, runRes] = await Promise.all([
        supabase
          .from("gameweeks")
          .select("name")
          .eq("is_next", true)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("sync_runs")
          .select("finished_at")
          .eq("status", "success")
          .order("finished_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (gwRes.error || !gwRes.data) {
        setPipeline({ state: "error" });
        return;
      }
      setPipeline({
        state: "ready",
        gameweek: gwRes.data.name as string,
        syncedAt: (runRes.data?.finished_at as string | null) ?? null,
      });
    })();
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
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden font-sans">
      <BackgroundPaths />

      <main className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-5 px-6 py-12 text-center">
        <Monogram size={72} />
        <h1 className="text-4xl font-extrabold tracking-tight text-purple-950 dark:text-white">
          FPL <span className="text-purple-700 dark:text-primary">DECISION</span>
        </h1>
        <p className="text-sm font-semibold tracking-[0.2em] text-purple-800 dark:text-purple-400">
          ANALYTICS HUB
        </p>
        <p className="max-w-md text-zinc-600 dark:text-zinc-400">
          Transfers, captaincy, chips, and fixtures — decided with data, not vibes.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link href="/team" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <InteractiveHoverButton>Import your FPL squad</InteractiveHoverButton>
          </Link>
          {/* DSI-118: this had a `border-zinc-300` that all but vanished on the
              dark page, so the secondary action read as unstyled text. A
              token border and brighter label make it a recognisable second
              option without competing with the primary. */}
          <Link
            href="/players"
            className="rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-zinc-200"
          >
            Explore players
          </Link>
        </div>

        {/* DSI-118: "many users do not know where to find that ID" — so show
            the URL it comes from rather than only naming it. TapToReveal
            rather than a hover tooltip, per the app's touch-first rule. */}
        <div className="max-w-md text-xs text-zinc-500 dark:text-zinc-400">
          You&apos;ll just need the numeric Manager ID from your team&apos;s URL.{" "}
          <TapToReveal
            label="Where do I find my Manager ID?"
            triggerClassName="font-medium text-purple-800 underline underline-offset-2 dark:text-primary"
            trigger="Where do I find it?"
          >
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">Your Manager ID</p>
            <p className="mt-1.5">
              Sign in at fantasy.premierleague.com and open the <em>Points</em> tab. The address
              bar reads:
            </p>
            <p className="mt-1.5 break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">
              fantasy.premierleague.com/entry/<span className="font-bold text-purple-800 dark:text-primary">1234567</span>/event/1
            </p>
            <p className="mt-1.5">
              The highlighted number is your Manager ID. It is public — it identifies a team, and
              gives nobody access to your account.
            </p>
          </TapToReveal>
        </div>

        {/* DSI-118's headline finding: "high bounce risk; no visual product
            preview". Sits directly under the CTA row, where the audit asked
            for it. */}
        <LandingPreview />

        <p className="mt-4 text-xs text-zinc-400" role="status">
          {pipeline.state === "checking" && "Checking data…"}
          {pipeline.state === "error" && (
            <span className="text-danger">Data pipeline unreachable — projections may be stale.</span>
          )}
          {pipeline.state === "ready" && (
            <>
              Live for <span className="font-medium text-zinc-600 dark:text-zinc-300">{pipeline.gameweek}</span>
              {freshness(pipeline.syncedAt) && <> · {freshness(pipeline.syncedAt)}</>}
            </>
          )}
        </p>
      </main>
    </div>
  );
}
