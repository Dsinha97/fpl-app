"use client";

import { useCallback, useEffect, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { useAuth } from "@/components/auth-provider";
import {
  loadSyncHealth,
  STALE_AFTER_HOURS,
  SYNC_HEALTH_NOTE,
  type ManagerHealthState,
  type SyncHealth,
} from "@/lib/sync-health";

const STATE_LABEL: Record<ManagerHealthState, string> = {
  never: "Never completed",
  overdue: `Overdue (>${STALE_AFTER_HOURS}h)`,
  ok: "Up to date",
};

const STATE_STYLE: Record<ManagerHealthState, string> = {
  never: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  overdue: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ok: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Sync health — what has quietly not happened.
 *
 * Built after three bugs in one session shared a shape: work that silently
 * does not run, and shows up as *absence* rather than as an error. A rival
 * with no gameweek history looked exactly like a rival whose history is
 * legitimately empty, and nothing on any screen distinguished them.
 *
 * The governing rule, and the reason this reads oddly verbose for a status
 * panel: **it never renders empty.** Every branch says something — healthy,
 * unknown, or broken. A blank panel is indistinguishable from a broken one,
 * which is precisely the failure being fixed.
 */
export function SyncHealthPanel() {
  const { user, loading: authLoading } = useAuth();
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedIn = !!user;

  const load = useCallback(async () => {
    setError(null);
    try {
      setHealth(await loadSyncHealth(signedIn));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [signedIn]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const managers = health?.managers ?? null;
  const problems = managers?.filter((m) => m.state !== "ok") ?? [];
  const healthy = managers?.filter((m) => m.state === "ok").length ?? 0;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Sync health</h2>
        <InfoTooltip label="What this panel means">{SYNC_HEALTH_NOTE}</InfoTooltip>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {!error && !health && (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      )}

      {health && (
        <div className="mt-3 space-y-4">
          {/* ---------------------------------------- tracked managers */}
          <div className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-purple-900/40">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Tracked managers
            </h3>

            {/* Signed out is not the same as healthy, and must not read like
                it. Both source tables are owner-scoped, so there is genuinely
                nothing to say rather than nothing to report. */}
            {managers === null ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Sign in to see whether your own team and rivals are syncing — the list is private
                to each account, so there is nothing to show here signed out.
              </p>
            ) : managers.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                No managers tracked yet. Claim your team on My Team, or add a rival, and they will
                appear here.
              </p>
            ) : problems.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                ✅ All {managers.length} tracked manager{managers.length === 1 ? "" : "s"} have
                completed a sync within the last {STALE_AFTER_HOURS}h.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {problems.length} of {managers.length} need attention
                  {healthy > 0 && (
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {" "}
                      · {healthy} up to date
                    </span>
                  )}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {problems.map((m) => (
                    <li key={m.entryId} className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATE_STYLE[m.state]}`}
                      >
                        {STATE_LABEL[m.state]}
                      </span>
                      <span className="text-zinc-800 dark:text-zinc-200">
                        {m.teamName ?? `Entry ${m.entryId}`}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {m.source === "both" ? "yours + rival" : m.source}
                        {m.lastSuccessAt && ` · last complete ${ago(m.lastSuccessAt)}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  These correct themselves — the cron re-syncs anything in this state on its next
                  run. The same manager still listed tomorrow means the sync is failing, not
                  waiting.
                </p>
              </>
            )}
          </div>

          {/* --------------------------------------------- failed runs */}
          <div className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-purple-900/40">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Failed and partial runs · last {health.failureWindowHours}h
            </h3>
            {health.failures.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                ✅ No failed or partial runs.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {health.failures.map((f) => (
                  <li key={`${f.functionName}-${f.startedAt}`} className="flex flex-wrap gap-x-2">
                    <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {f.functionName}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        f.status === "error" ? STATE_STYLE.never : STATE_STYLE.overdue
                      }`}
                    >
                      {f.status}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {ago(f.startedAt)}
                    </span>
                    {f.error && (
                      <span className="w-full text-xs text-zinc-600 dark:text-zinc-400">
                        {f.error.slice(0, 200)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
