// Sprint 29.1 — mini-league standings and effective ownership, wiring for
// the engine and pipeline lib/ownership.ts and supabase/functions/
// sync-league-picks already shipped in Sprint 10's exact slice but nothing
// rendered (docs/roadmap.md). This is the data-loading layer for /leagues:
// paged reads of league_entries/league_entry_picks (the API caps every
// response at 1000 rows — CLAUDE.md — and a 2000-entry league is 30,000
// picks rows), plus the on-demand sync call.

import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";
import type { LeaguePickRow } from "./ownership";

const PAGE_SIZE = 1000;

export interface LeagueStandingRow {
  entryId: number;
  entryName: string;
  playerName: string;
  rank: number | null;
  lastRank: number | null;
  total: number | null;
  eventTotal: number | null;
}

/** Pages through league_entries until a short page comes back — never trusts
 *  a single 1000-row page to be the whole league. */
export async function loadLeagueStandings(
  season: string,
  leagueId: number,
): Promise<LeagueStandingRow[]> {
  const rows: LeagueStandingRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("league_entries")
      .select("entry_id, entry_name, player_name, rank, last_rank, total, event_total")
      .eq("season", season)
      .eq("league_id", leagueId)
      .order("rank_sort", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      rows.push({
        entryId: r.entry_id as number,
        entryName: r.entry_name as string,
        playerName: r.player_name as string,
        rank: r.rank as number | null,
        lastRank: r.last_rank as number | null,
        total: r.total as number | null,
        eventTotal: r.event_total as number | null,
      });
    }
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

/**
 * league_entry_picks has no league_id column by design (one entry's picks
 * for a gameweek is one fact, joined per-league at read time — see
 * lib/ownership.ts's header comment) — so this takes the entry ids from
 * loadLeagueStandings and pages the picks by `.in("entry_id", ...)` and
 * `.range()`, chunking the entry-id list so the `.in()` filter itself stays
 * a reasonable size.
 */
export async function loadLeagueEntryPicks(
  season: string,
  entryIds: number[],
  event: number,
): Promise<LeaguePickRow[]> {
  const rows: LeaguePickRow[] = [];
  const ENTRY_CHUNK = 200;
  for (let i = 0; i < entryIds.length; i += ENTRY_CHUNK) {
    const idsChunk = entryIds.slice(i, i + ENTRY_CHUNK);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("league_entry_picks")
        .select("entry_id, element, multiplier, is_captain")
        .eq("season", season)
        .eq("event", event)
        .in("entry_id", idsChunk)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        rows.push({
          entryId: r.entry_id as number,
          element: r.element as number,
          multiplier: r.multiplier as number,
          isCaptain: r.is_captain as boolean,
        });
      }
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return rows;
}

export interface SyncLeaguePicksResult {
  ok: boolean;
  season?: string;
  event?: number;
  entries?: number;
  capped?: boolean;
  picksWritten?: number;
  picksReused?: number;
  picksFailed?: number;
  error?: string;
}

/** Invokes sync-league-picks — the on-demand ingest, never called from the
 *  app before this page (docs/roadmap.md's honest note that the pipeline
 *  shipped with nothing calling it). */
export async function syncLeaguePicks(leagueId: number, event: number): Promise<SyncLeaguePicksResult> {
  const { data, error } = await supabase.functions.invoke("sync-league-picks", {
    body: { league_id: leagueId, event },
  });
  if (error) {
    // Sprint 32: the function now answers 401 (signed out) and 429 (over the
    // per-user rate limit) with a message worth reading, and supabase-js
    // hides it — `error.message` on a non-2xx is the generic "Edge Function
    // returned a non-2xx status code". Unwrap it, same as /team's
    // sync-manager call already does, or the sync button reports nothing
    // useful at exactly the two moments it has something to say.
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      return { ok: false, error: body?.error ?? error.message };
    }
    return { ok: false, error: error.message };
  }
  const d = data as Record<string, unknown>;
  if (!d.ok) return { ok: false, error: (d.error as string) ?? "Sync failed" };
  return {
    ok: true,
    season: d.season as string,
    event: d.event as number,
    entries: d.entries as number,
    capped: d.capped as boolean,
    picksWritten: d.picks_written as number,
    picksReused: d.picks_reused as number,
    picksFailed: d.picks_failed as number,
  };
}
