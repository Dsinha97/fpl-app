// Which tracked managers have never finished a sync, and what failed lately.
//
// Written 2026-09-10, after three bugs in one session turned out to be the
// same shape: **work that silently does not happen, and renders as absence
// rather than as an error.**
//
//   1. Rivals were never re-synced after being added, so three of them sat
//      frozen at the day before GW1 with no gameweek history at all.
//   2. A CHECK constraint on `league_type` aborted a manager's entire sync
//      over one cosmetic field.
//   3. A sync that failed part-way marked itself fresh, blocking its own
//      retry for 24 hours.
//
// None of the three produced a visible error. A rival with no data looks
// exactly like a rival whose data is legitimately empty, and nothing anywhere
// said "this did not finish". `managers.last_success_at` finally makes the
// difference queryable, and this module is what asks the question.
//
// THE RULE THIS PANEL EXISTS TO ENFORCE: it must never be silently empty. When
// everything is healthy it says so in as many words. A blank panel is
// indistinguishable from a broken one, which is the exact failure it is here
// to catch.

import { supabase } from "./supabase/client";

/**
 * Mirrors `STALE_AFTER_MS` in supabase/functions/sync-claimed-managers.
 *
 * Deliberately duplicated rather than shared: `supabase/functions/**` is Deno
 * and cannot be imported from `lib/`. Same trade `_shared/rate-limit.ts` makes
 * with its `FALLBACK`, and it carries the same obligation — **if the cron's
 * threshold changes, change this too**, or the panel will report a manager as
 * healthy that the cron considers overdue (or the reverse).
 */
export const STALE_AFTER_HOURS = 24;

export const SYNC_HEALTH_NOTE =
  "A manager is tracked if you have claimed it or added it as a rival. \"Never completed\" means no " +
  "sync has ever run all the way through for that manager — its row may exist and still hold no " +
  "gameweek history, which is the failure this panel was built to make visible. \"Overdue\" means " +
  `the last complete sync was more than ${STALE_AFTER_HOURS}h ago; the cron re-syncs on the same ` +
  "threshold, so a manager sitting here for long means the sync is failing rather than waiting. " +
  "Both states are self-correcting — the next run picks them up — so one overdue manager is not a " +
  "problem, and the same one overdue tomorrow is.";

export type ManagerHealthState = "never" | "overdue" | "ok";

export interface TrackedManagerHealth {
  entryId: number;
  teamName: string | null;
  lastSuccessAt: string | null;
  state: ManagerHealthState;
  /** Why this manager is tracked at all — claimed, added as a rival, or both. */
  source: "claimed" | "rival" | "both";
}

export interface FailedRun {
  functionName: string;
  status: string;
  startedAt: string;
  error: string | null;
}

export interface SyncHealth {
  /** Null when signed out: both source tables are owner-scoped by RLS, so a
   *  signed-out visitor genuinely cannot be told anything — which is different
   *  from "nothing is wrong" and is reported as such. */
  managers: TrackedManagerHealth[] | null;
  failures: FailedRun[];
  /** How far back `failures` looks. */
  failureWindowHours: number;
}

const FAILURE_WINDOW_HOURS = 24;

/**
 * Tracked managers and their sync state.
 *
 * Both `user_profiles` and `manager_rivals` are owner-scoped, so this returns
 * only what the signed-in user tracks — no extra filtering needed here, and
 * none that could be forgotten.
 */
async function loadTrackedManagers(): Promise<TrackedManagerHealth[]> {
  const [{ data: profiles }, { data: rivals }] = await Promise.all([
    supabase.from("user_profiles").select("entry_id").not("entry_id", "is", null),
    supabase.from("manager_rivals").select("entry_id"),
  ]);

  const claimed = new Set((profiles ?? []).map((r) => r.entry_id as number));
  const rival = new Set((rivals ?? []).map((r) => r.entry_id as number));
  const ids = [...new Set([...claimed, ...rival])];
  if (ids.length === 0) return [];

  const { data: rows, error } = await supabase
    .from("managers")
    .select("entry_id, team_name, last_success_at")
    .in("entry_id", ids);
  if (error) throw new Error(error.message);

  const byId = new Map(
    (rows ?? []).map((r) => [
      r.entry_id as number,
      {
        teamName: (r.team_name as string) ?? null,
        lastSuccessAt: (r.last_success_at as string) ?? null,
      },
    ]),
  );

  const staleBefore = Date.now() - STALE_AFTER_HOURS * 3_600_000;

  return ids
    .map((entryId): TrackedManagerHealth => {
      const row = byId.get(entryId);
      // No `managers` row at all is the same story as a row that never
      // completed: nothing has successfully run for this entry.
      const lastSuccessAt = row?.lastSuccessAt ?? null;
      const state: ManagerHealthState = !lastSuccessAt
        ? "never"
        : new Date(lastSuccessAt).getTime() < staleBefore
          ? "overdue"
          : "ok";
      return {
        entryId,
        teamName: row?.teamName ?? null,
        lastSuccessAt,
        state,
        source:
          claimed.has(entryId) && rival.has(entryId)
            ? "both"
            : claimed.has(entryId)
              ? "claimed"
              : "rival",
      };
    })
    .sort((a, b) => {
      // Problems first — this panel is read to find them, not to admire the
      // healthy ones.
      const rank = { never: 0, overdue: 1, ok: 2 };
      return rank[a.state] - rank[b.state] || (a.teamName ?? "").localeCompare(b.teamName ?? "");
    });
}

/** Failed and partial runs in the recent past. `sync_runs` is public-read. */
async function loadFailures(): Promise<FailedRun[]> {
  const since = new Date(Date.now() - FAILURE_WINDOW_HOURS * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("sync_runs")
    .select("function_name, status, started_at, error")
    .in("status", ["error", "partial"])
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    functionName: r.function_name as string,
    status: r.status as string,
    startedAt: r.started_at as string,
    error: (r.error as string) ?? null,
  }));
}

export async function loadSyncHealth(signedIn: boolean): Promise<SyncHealth> {
  const [managers, failures] = await Promise.all([
    signedIn ? loadTrackedManagers() : Promise.resolve(null),
    loadFailures(),
  ]);
  return { managers, failures, failureWindowHours: FAILURE_WINDOW_HOURS };
}
