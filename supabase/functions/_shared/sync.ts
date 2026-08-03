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

export type SyncStatus = "success" | "partial" | "error";

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

  static async start(db: SupabaseClient, functionName: string, season?: string) {
    const { data, error } = await db
      .from("sync_runs")
      .insert({ function_name: functionName, season: season ?? null, status: "running" })
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

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
