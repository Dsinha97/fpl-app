// Per-user rate limiting for the two functions a browser legitimately calls.
//
// Sprint 32. `verifyUser` turns "anyone on the internet" into "anyone with an
// account", which is necessary but not sufficient — accounts are free. This
// is what actually bounds the cost.
//
// Counted off `sync_runs`, which already records every execution with
// `function_name` and `started_at`; Sprint 32's migration adds the column it
// was missing, `invoked_by`. One table, one implementation, and the limit is
// queryable next to the audit trail rather than living in a second store.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/** What `game_settings` holds under `sync_rate_limit`. */
export interface RateLimit {
  maxCalls: number;
  windowSeconds: number;
}

/**
 * Fallback if the `game_settings` row is missing — the same numbers the
 * migration seeds, repeated here so a missing row degrades to the documented
 * limit rather than to no limit at all. The row is the source of truth; this
 * is not a second one to be tuned independently.
 */
const FALLBACK: RateLimit = { maxCalls: 30, windowSeconds: 600 };

export async function loadRateLimit(db: SupabaseClient, season: string): Promise<RateLimit> {
  const { data, error } = await db
    .from("game_settings")
    .select("value")
    .eq("season", season)
    .eq("key", "sync_rate_limit")
    .maybeSingle();

  if (error || !data?.value) return FALLBACK;
  const v = data.value as Record<string, unknown>;
  const maxCalls = Number(v.max_calls);
  const windowSeconds = Number(v.window_seconds);
  if (!Number.isFinite(maxCalls) || !Number.isFinite(windowSeconds)) return FALLBACK;
  return { maxCalls, windowSeconds };
}

export interface RateLimitVerdict {
  allowed: boolean;
  limit: RateLimit;
  used: number;
}

/**
 * Counts this user's runs of this function inside the window.
 *
 * A failure to *count* allows the call. That is deliberate: the limit exists
 * to bound cost, not to guard data, and a database hiccup should not take the
 * Refresh button down for a legitimate signed-in user.
 */
export async function checkRateLimit(
  db: SupabaseClient,
  functionName: string,
  userId: string,
  limit: RateLimit,
): Promise<RateLimitVerdict> {
  const since = new Date(Date.now() - limit.windowSeconds * 1000).toISOString();

  const { count, error } = await db
    .from("sync_runs")
    .select("id", { count: "exact", head: true })
    .eq("function_name", functionName)
    .eq("invoked_by", userId)
    .gte("started_at", since);

  if (error) {
    console.error(`rate limit count failed, allowing: ${error.message}`);
    return { allowed: true, limit, used: 0 };
  }

  const used = count ?? 0;
  return { allowed: used < limit.maxCalls, limit, used };
}

/**
 * Records a refused call. `sync_runs` is an audit of runs and a rejection is
 * not a run, so this writes a distinct `rejected` status rather than
 * pretending otherwise — the record of who is hammering what is the whole
 * diagnostic value of having the column.
 */
export async function recordRejection(
  db: SupabaseClient,
  functionName: string,
  userId: string,
  verdict: RateLimitVerdict,
): Promise<void> {
  const { error } = await db.from("sync_runs").insert({
    function_name: functionName,
    status: "rejected",
    invoked_by: userId,
    finished_at: new Date().toISOString(),
    error: `rate limited: ${verdict.used}/${verdict.limit.maxCalls} in ${verdict.limit.windowSeconds}s`,
  });
  if (error) console.error(`sync_runs rejection insert failed: ${error.message}`);
}

/**
 * The message the user actually sees. `/team`'s Refresh and `/leagues`' sync
 * are visible buttons — an over-limit call has to say so rather than failing
 * into a generic error.
 */
export function rateLimitMessage(limit: RateLimit): string {
  const minutes = Math.round(limit.windowSeconds / 60);
  return `Too many refreshes — the limit is ${limit.maxCalls} every ${minutes} minute${
    minutes === 1 ? "" : "s"
  }. Your data is still there; try again shortly.`;
}
