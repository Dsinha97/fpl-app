"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { InfoTooltip } from "@/components/info-tooltip";
import { fmtCountdown } from "@/lib/countdown";
import { listDrafts, onDraftsChanged, resolveRequestedDraft } from "@/lib/drafts";
import { loadSeasonContext, type SeasonContext } from "@/lib/season-context";
import { totalSpend } from "@/lib/squad-budget";
import type { TeamState } from "@/lib/team-state";
import { freeTransfersDisplay } from "@/lib/transfers";

/**
 * The audit's one genuinely good finding: a deadline-driven tool with no
 * persistent deadline/bank/FT anywhere in its chrome — those numbers only
 * ever lived inside individual pages (/deadline, /transfers, /team), and the
 * header itself wasn't even sticky. This closes that gap without adding a
 * new data shape: it's `loadSeasonContext` (already the shared "what
 * gameweek, what deadline" loader) plus whichever draft
 * `resolveRequestedDraft` (lib/drafts.ts) already picks for every other
 * draft-aware page, read straight from localStorage — no extra network
 * round trip beyond the one `loadSeasonContext` call.
 */
export function ContextBar() {
  const { entryId, teamName } = useAuth();
  const [ctx, setCtx] = useState<SeasonContext | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [drafts, setDrafts] = useState<TeamState[]>([]);

  useEffect(() => {
    loadSeasonContext()
      .then(setCtx)
      .catch(() => setCtx(null));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(listDrafts());
    return onDraftsChanged(() => setDrafts(listDrafts()));
  }, []);

  const draft = useMemo(
    () => resolveRequestedDraft(drafts, "", { entryId, teamName }),
    [drafts, entryId, teamName],
  );

  const countdown = ctx ? fmtCountdown(ctx.deadlineTime, now) : null;
  const hasSquad = !!draft && draft.players.length > 0;
  const bank = hasSquad ? draft!.budget - totalSpend(draft!.players) : null;

  if (!ctx) return null;

  return (
    <div className="border-b border-zinc-200 bg-card-supporting px-4 py-1.5 text-xs dark:border-purple-900/40">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 text-zinc-600 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="uppercase tracking-wide">{ctx.gameweekName}</span>
          <span
            className={`font-semibold tabular-nums ${
              countdown?.passed
                ? "text-red-700 dark:text-red-400"
                : "text-purple-800 dark:text-primary"
            }`}
          >
            {countdown?.text}
          </span>
        </span>

        {!hasSquad && (
          <Link
            href="/team"
            className="rounded font-semibold text-purple-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-primary"
          >
            Import your FPL team →
          </Link>
        )}

        {hasSquad && (
          <span className="flex items-center gap-1">
            Bank
            <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
              £{(bank! / 10).toFixed(1)}m
            </span>
          </span>
        )}

        {hasSquad &&
          (() => {
            const ft = freeTransfersDisplay(draft!);
            return ft.kind === "unlimited" ? (
              <span className="flex items-center gap-1">
                FT
                <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                  ∞
                </span>
                <InfoTooltip label="Why are free transfers unlimited?">
                  <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    A Wildcard or Free Hit is active — FPL charges no points hit for any number of
                    changes while it&apos;s in play.
                  </p>
                </InfoTooltip>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                FT
                <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                  {ft.n}
                </span>
                <InfoTooltip label="Where do I change free transfers?">
                  <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    Defaults to 1. Set the real count on{" "}
                    <span className="font-medium">My Team</span> or{" "}
                    <span className="font-medium">Deadline</span> — FPL doesn&apos;t publish it
                    without a login this app can&apos;t perform.
                  </p>
                </InfoTooltip>
              </span>
            );
          })()}
      </div>
    </div>
  );
}
