// sync-manager
//
// On-demand ingestion of one FPL entry: profile, past-season history,
// current-season gameweek history, picks, transfers, and chips.
//
// Invoked from the frontend when a user connects (or refreshes) a Manager ID:
//   POST { "entry_id": 123456 }
//
// Pre-season the picks endpoint 404s and transfers are empty; both are
// handled as "nothing to write yet", not errors, so the same function works
// unchanged all season.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  FplHttpError,
  getEntry,
  getEntryHistory,
  getEntryPicks,
  getEntryTransfers,
} from "../_shared/fpl.ts";
import { jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { int, num, str, ts } from "../_shared/coerce.ts";

const FUNCTION_NAME = "sync-manager";
const PICKS_CONCURRENCY = 5;

async function currentSeason(db: SupabaseClient): Promise<string> {
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

async function parseEntryId(req: Request): Promise<number> {
  const url = new URL(req.url);
  let raw: unknown = url.searchParams.get("entry_id");

  if (raw === null && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    raw = (body as Record<string, unknown>).entry_id;
  }

  const id = int(raw);
  if (id === null || id <= 0) {
    throw new FplHttpError(400, "entry_id must be a positive integer");
  }
  return id;
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();

  let entryId: number;
  try {
    entryId = await parseEntryId(req);
  } catch (err) {
    return jsonResponse({ ok: false, error: (err as Error).message }, 400);
  }

  const run = await SyncRun.start(db, FUNCTION_NAME);
  const counts: Record<string, number> = {};

  try {
    const season = await currentSeason(db);

    let entry;
    try {
      entry = await getEntry(entryId);
    } catch (err) {
      if (err instanceof FplHttpError && err.status === 404) {
        await run.finish("error", { season, error: `entry ${entryId} not found` });
        return jsonResponse({ ok: false, error: `Manager ID ${entryId} not found on FPL` }, 404);
      }
      throw err;
    }

    const [history, transfers] = await Promise.all([
      getEntryHistory(entryId),
      getEntryTransfers(entryId),
    ]);

    // -------------------------------------------------------------- manager

    {
      const { error } = await db.from("managers").upsert({
        entry_id: entry.id,
        team_name: str(entry.name),
        first_name: str(entry.player_first_name),
        last_name: str(entry.player_last_name),
        region_name: str(entry.player_region_name),
        region_iso: str(entry.player_region_iso_code_short),
        favourite_team: int(entry.favourite_team),
        joined_time: ts(entry.joined_time),
        started_event: int(entry.started_event),
        years_active: int(entry.years_active),
        current_event: int(entry.current_event),
        summary_overall_points: int(entry.summary_overall_points),
        summary_overall_rank: int(entry.summary_overall_rank),
        summary_event_points: int(entry.summary_event_points),
        summary_event_rank: int(entry.summary_event_rank),
        last_deadline_bank: int(entry.last_deadline_bank),
        last_deadline_value: int(entry.last_deadline_value),
        last_deadline_total_transfers: int(entry.last_deadline_total_transfers),
        entered_events: entry.entered_events ?? [],
        raw: entry,
        synced_at: new Date().toISOString(),
      }, { onConflict: "entry_id" });
      if (error) throw new Error(`managers: ${error.message}`);
      counts.managers = 1;
    }

    // -------------------------------------------------------------- leagues
    // entry.leagues.classic rides on the same payload already fetched above
    // — no second FPL call. h2h leagues are not modelled; nothing in this
    // app scores anything but classic points.

    {
      const classic = entry.leagues?.classic ?? [];
      if (classic.length > 0) {
        const { error } = await db.from("manager_leagues").upsert(
          classic.map((l) => ({
            entry_id: entryId,
            league_id: l.id,
            name: str(l.name),
            league_type: l.league_type,
            scoring: str(l.scoring),
            start_event: int(l.start_event),
            entry_rank: int(l.entry_rank),
            entry_last_rank: int(l.entry_last_rank),
            rank_count: int(l.rank_count),
            synced_at: new Date().toISOString(),
          })),
          { onConflict: "entry_id,league_id" },
        );
        if (error) throw new Error(`manager_leagues: ${error.message}`);
      }
      counts.leagues = classic.length;
    }

    // ------------------------------------------------------- season history

    if (history.past.length > 0) {
      const { error } = await db.from("manager_season_history").upsert(
        history.past.map((p) => ({
          entry_id: entryId,
          season_name: p.season_name,
          total_points: int(p.total_points),
          rank: int(p.rank),
          rank_percentage: num(p.rank_percentage),
        })),
        { onConflict: "entry_id,season_name" },
      );
      if (error) throw new Error(`manager_season_history: ${error.message}`);
    }
    counts.season_history = history.past.length;

    // ----------------------------------------------------- gameweek history

    if (history.current.length > 0) {
      const { error } = await db.from("manager_gameweek_history").upsert(
        history.current.map((c) => ({
          season,
          entry_id: entryId,
          event: int(c.event),
          points: int(c.points),
          total_points: int(c.total_points),
          rank: int(c.rank),
          overall_rank: int(c.overall_rank),
          percentile_rank: int(c.percentile_rank),
          bank: int(c.bank),
          value: int(c.value),
          event_transfers: int(c.event_transfers),
          event_transfers_cost: int(c.event_transfers_cost),
          points_on_bench: int(c.points_on_bench),
          raw: c,
        })),
        { onConflict: "season,entry_id,event" },
      );
      if (error) throw new Error(`manager_gameweek_history: ${error.message}`);
    }
    counts.gameweek_history = history.current.length;

    // ----------------------------------------------------------------- chips

    if (history.chips.length > 0) {
      const { error } = await db.from("manager_chips").upsert(
        history.chips.map((c) => ({
          season,
          entry_id: entryId,
          event: c.event,
          name: c.name,
          played_at: ts(c.time),
        })),
        { onConflict: "season,entry_id,event" },
      );
      if (error) throw new Error(`manager_chips: ${error.message}`);
    }
    counts.chips = history.chips.length;

    // ------------------------------------------------------------- transfers

    if (transfers.length > 0) {
      const { error } = await db.from("manager_transfers").upsert(
        transfers.map((t) => ({
          season,
          entry_id: entryId,
          event: int(t.event),
          element_in: int(t.element_in),
          element_in_cost: int(t.element_in_cost),
          element_out: int(t.element_out),
          element_out_cost: int(t.element_out_cost),
          transfer_time: ts(t.time),
          raw: t,
        })),
        {
          onConflict: "entry_id,season,event,transfer_time,element_in,element_out",
          ignoreDuplicates: true,
        },
      );
      if (error) throw new Error(`manager_transfers: ${error.message}`);
    }
    counts.transfers = transfers.length;

    // ----------------------------------------------------------------- picks
    // Fetch every entered event's picks with bounded concurrency. Events whose
    // picks are not yet published (404 -> null) are skipped silently.

    const events = entry.entered_events ?? [];
    let picksWritten = 0;

    for (let i = 0; i < events.length; i += PICKS_CONCURRENCY) {
      const batch = events.slice(i, i + PICKS_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (event) => ({ event, picks: await getEntryPicks(entryId, event) })),
      );

      for (const { event, picks } of results) {
        if (!picks) continue;

        const { error } = await db.from("manager_picks").upsert(
          picks.picks.map((p) => ({
            season,
            entry_id: entryId,
            event,
            position: p.position,
            element: p.element,
            multiplier: p.multiplier,
            is_captain: p.is_captain,
            is_vice_captain: p.is_vice_captain,
          })),
          { onConflict: "season,entry_id,event,position" },
        );
        if (error) throw new Error(`manager_picks (GW${event}): ${error.message}`);
        picksWritten += picks.picks.length;

        // active_chip and entry_history ride on the picks payload.
        if (picks.active_chip || picks.entry_history) {
          const eh = picks.entry_history ?? {};
          const { error: ehError } = await db.from("manager_gameweek_history").upsert({
            season,
            entry_id: entryId,
            event,
            points: int(eh.points),
            total_points: int(eh.total_points),
            rank: int(eh.rank),
            overall_rank: int(eh.overall_rank),
            percentile_rank: int(eh.percentile_rank),
            bank: int(eh.bank),
            value: int(eh.value),
            event_transfers: int(eh.event_transfers),
            event_transfers_cost: int(eh.event_transfers_cost),
            points_on_bench: int(eh.points_on_bench),
            active_chip: str(picks.active_chip),
            raw: eh,
          }, { onConflict: "season,entry_id,event" });
          if (ehError) throw new Error(`manager_gameweek_history (GW${event}): ${ehError.message}`);
        }
      }
    }
    counts.picks = picksWritten;

    const rowsWritten = Object.values(counts).reduce((a, b) => a + b, 0);
    await run.finish("success", {
      season,
      rowsWritten,
      details: { entry_id: entryId, ...counts },
    });

    return jsonResponse({ ok: true, season, entry_id: entryId, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed for entry ${entryId}: ${message}`);
    await run.finish("error", { error: message, details: { entry_id: entryId, ...counts } });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
