import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Service-role client. Bypasses RLS, so it is only ever constructed inside an
 * Edge Function — never shipped to the browser.
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");

  return createClient(url, key, { auth: { persistSession: false } });
}

export type SyncStatus = "success" | "partial" | "error" | "skipped";

/**
 * The season currently being ingested. Derived once by sync-bootstrap and
 * read back from `gameweeks` by every other function, so a season rollover
 * only needs to be got right in one place.
 */
export async function currentSeason(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from("gameweeks")
    .select("season")
    .order("deadline_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`gameweeks: ${error.message}`);
  if (!data) throw new Error("no gameweeks in database - run sync-bootstrap first");
  return data.season;
}

/**
 * Whether a fixture in the given gameweek is currently in progress (started,
 * not finished) — the "is a match live right now" check sync-live-gameweek
 * and sync-claimed-managers both gate on, so there is one implementation of
 * "matchday" rather than each function deciding it separately.
 */
export async function hasLiveFixture(
  db: SupabaseClient,
  season: string,
  event: number,
): Promise<boolean> {
  const { count, error } = await db
    .from("fixtures")
    .select("id", { count: "exact", head: true })
    .eq("season", season)
    .eq("event", event)
    .eq("started", true)
    .eq("finished", false);
  if (error) throw new Error(`fixtures: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * Records one execution of an ingestion function in `sync_runs`, so a broken
 * sync is distinguishable from a genuinely quiet news day.
 */
export class SyncRun {
  private constructor(
    private readonly db: SupabaseClient,
    readonly id: number | null,
    readonly functionName: string,
  ) {}

  /**
   * `invokedBy` is the Supabase user id for the two browser-invoked
   * functions, and null for everything cron drives. It is what the Sprint 32
   * per-user rate limit counts on, so a run that omits it is invisible to the
   * limit — which is correct for cron and wrong for anything else.
   */
  static async start(
    db: SupabaseClient,
    functionName: string,
    season?: string,
    invokedBy?: string,
  ) {
    const { data, error } = await db
      .from("sync_runs")
      .insert({
        function_name: functionName,
        season: season ?? null,
        status: "running",
        invoked_by: invokedBy ?? null,
      })
      .select("id")
      .single();

    // Never let bookkeeping failure take down the actual sync.
    if (error) console.error(`sync_runs insert failed: ${error.message}`);

    return new SyncRun(db, data?.id ?? null, functionName);
  }

  async finish(
    status: SyncStatus,
    opts: {
      season?: string;
      rowsWritten?: number;
      error?: string;
      details?: Record<string, unknown>;
      cursor?: Record<string, unknown>;
    } = {},
  ) {
    if (this.id === null) return;

    const { error } = await this.db
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        rows_written: opts.rowsWritten ?? 0,
        error: opts.error ?? null,
        details: opts.details ?? null,
        cursor: opts.cursor ?? null,
        ...(opts.season ? { season: opts.season } : {}),
      })
      .eq("id", this.id);

    if (error) console.error(`sync_runs update failed: ${error.message}`);
  }
}

/**
 * Origins allowed to invoke the browser-facing functions.
 *
 * Sprint 32. This used to be `Access-Control-Allow-Origin: "*"` on every
 * response from every function, including the eight nothing in a browser has
 * any business calling.
 *
 * Read this as defence in depth and nothing more: CORS is enforced by
 * browsers, so it does not inconvenience `curl` in the slightest. It is not a
 * substitute for verifyCron/verifyUser and must never be treated as one — it
 * only removes the case where someone else's *page* drives these endpoints
 * with a visitor's credentials.
 */
const ALLOWED_ORIGINS = new Set([
  "https://fpldecision.com",
  "https://www.fpldecision.com",
  "http://localhost:3000",
]);

function corsHeadersFor(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    // Vary matters: without it a cache can serve one origin's allowed
    // response to another origin.
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

/**
 * Wraps a handler so its responses carry CORS headers — but only for the
 * browser-invoked functions, which opt in by wrapping, and only for an
 * allowlisted origin.
 *
 * A cron-only function is deliberately *not* wrapped: it emits no CORS
 * headers at all, so a page cannot read its response even if it manages to
 * issue the request.
 */
export function withCors(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const res = await handler(req);
    const cors = corsHeadersFor(req);
    if (!cors) return res;

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}

/**
 * Standard OPTIONS handling; returns null for non-preflight requests.
 *
 * The headers come from `withCors` now, so an unwrapped (cron-only) function
 * answers a preflight with a bare 204 that no browser will accept — which is
 * the intent.
 */
export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  return null;
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
