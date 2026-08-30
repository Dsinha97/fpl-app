// sync-league-picks
//
// Sprint 10 (exact slice) — on-demand ingestion of one classic league's
// standings plus every member's picks for one gameweek, so mini-league
// effective ownership can be computed exactly rather than sampled. Modelled
// on sync-manager, which already does the same "page a list, then fetch
// picks with bounded concurrency" shape for one entry's own history.
//
// Invoked from the frontend when a user opens a league's ownership view:
//   POST { "league_id": 314, "event": 1 }
// `event` defaults to the current gameweek (gameweeks.is_current) — the one
// whose picks are actually locked in.
//
// Capped per docs/sprints/sprint-10.md: a huge system league (314 "Overall",
// or an invitational built off a YouTube channel with tens of thousands of
// members) is not pulled in full. The cap lives in game_settings
// (league_ownership_entry_cap) so it can be raised once real rate-limit
// behaviour against the unauthenticated FPL API is known — raising it here
// is a config change, not a redeploy.

import { getClassicLeagueStandings, getEntryPicks, mapLimit } from "../_shared/fpl.ts";
import { currentSeason, jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { chunk, int } from "../_shared/coerce.ts";

const FUNCTION_NAME = "sync-league-picks";
const PICKS_CONCURRENCY = 5;
const STANDINGS_CONCURRENCY = 5;
const DEFAULT_ENTRY_CAP = 2000;

interface EntryRow {
  entry: number;
  entryName: string;
  playerName: string;
  rank: number;
  rankSort: number;
  lastRank: number;
  total: number;
  eventTotal: number;
}

async function parseBody(req: Request): Promise<{ leagueId: number; event: number | null }> {
  const url = new URL(req.url);
  let leagueIdRaw: unknown = url.searchParams.get("league_id");
  let eventRaw: unknown = url.searchParams.get("event");

  if (leagueIdRaw === null && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    leagueIdRaw = (body as Record<string, unknown>).league_id;
    eventRaw = (body as Record<string, unknown>).event ?? eventRaw;
  }

  const leagueId = int(leagueIdRaw);
  if (leagueId === null || leagueId <= 0) throw new Error("league_id must be a positive integer");
  return { leagueId, event: int(eventRaw) };
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();

  let leagueId: number;
  let requestedEvent: number | null;
  try {
    ({ leagueId, event: requestedEvent } = await parseBody(req));
  } catch (err) {
    return jsonResponse({ ok: false, error: (err as Error).message }, 400);
  }

  const run = await SyncRun.start(db, FUNCTION_NAME);

  try {
    const season = await currentSeason(db);

    let event = requestedEvent;
    if (event === null) {
      const { data: gw, error: gwError } = await db
        .from("gameweeks")
        .select("id")
        .eq("season", season)
        .eq("is_current", true)
        .maybeSingle();
      if (gwError) throw new Error(`gameweeks: ${gwError.message}`);
      if (!gw) throw new Error("no current gameweek — pass event explicitly");
      event = gw.id as number;
    }

    const { data: capRow } = await db
      .from("game_settings")
      .select("value")
      .eq("season", season)
      .eq("key", "league_ownership_entry_cap")
      .maybeSingle();
    const entryCap = int(capRow?.value) ?? DEFAULT_ENTRY_CAP;

    // ------------------------------------------------------------ standings
    //
    // Sprint 29 follow-up: pages used to be fetched one at a time, awaited
    // sequentially — up to 40 round-trips for a 2000-entry cap, with
    // standings only written to the database after the *entire* loop
    // finished. A slow or rate-limited large league could run long enough
    // to hit a platform execution-time limit and lose everything already
    // fetched. Now pages are fetched in waves of STANDINGS_CONCURRENCY (same
    // concurrency picks already use below), and each wave is upserted as
    // soon as it's fetched — a failure partway through leaves the standings
    // already written intact, and a real 2000-entry league now costs 8
    // concurrent-waves-of-5 round-trips instead of 40 sequential ones.
    //
    // Speculative paging: since FPL's endpoint doesn't report a total page
    // count up front, each wave requests the next STANDINGS_CONCURRENCY page
    // numbers without knowing which one is actually last. A page beyond the
    // real end throws (caught below) — worst case this wastes up to
    // STANDINGS_CONCURRENCY-1 extra requests on the final wave, not a full
    // second sequential pass.
    const entries: EntryRow[] = [];
    // A large league's rank ordering shifts live (rank changes are
    // continuous, not per-gameweek), so two pages fetched concurrently in
    // the same wave can genuinely contain the same entry — found while
    // testing league 314 (9.9M entries): a duplicate entry_id within one
    // upsert batch fails the whole batch ("ON CONFLICT DO UPDATE command
    // cannot affect row a second time"). Tracked globally, not per-wave, in
    // case a shift moves an entry across a wave boundary instead.
    const seenEntryIds = new Set<number>();

    let nextPage = 1;
    let hasNext = true;
    let cappedAt: number | null = null;

    while (hasNext && entries.length < entryCap) {
      const pageNumbers = Array.from({ length: STANDINGS_CONCURRENCY }, (_, i) => nextPage + i);
      const pages = await mapLimit(pageNumbers, STANDINGS_CONCURRENCY, async (p) => {
        try {
          return await getClassicLeagueStandings(leagueId, p);
        } catch {
          return null; // past the real last page, or a transient failure — either way, stop here
        }
      });

      const waveEntries: EntryRow[] = [];
      let stop = false;
      for (const standings of pages) {
        if (!standings) {
          stop = true;
          break;
        }
        for (const r of standings.standings.results) {
          if (seenEntryIds.has(r.entry)) continue;
          seenEntryIds.add(r.entry);
          waveEntries.push({
            entry: r.entry,
            entryName: r.entry_name,
            playerName: r.player_name,
            rank: r.rank,
            rankSort: r.rank_sort,
            lastRank: r.last_rank,
            total: r.total,
            eventTotal: r.event_total,
          });
        }
        if (!standings.standings.has_next) {
          stop = true;
          break;
        }
      }

      // Trim this wave to whatever's left under the cap before writing —
      // entries beyond the cap are never fetched again on a later run, so
      // there's no reason to write rows this call is about to discard.
      const remainingCapacity = entryCap - entries.length;
      const waveToWrite = waveEntries.slice(0, Math.max(0, remainingCapacity));
      entries.push(...waveToWrite);

      for (const batch of chunk(waveToWrite, 500)) {
        const { error } = await db.from("league_entries").upsert(
          batch.map((e) => ({
            season,
            league_id: leagueId,
            entry_id: e.entry,
            entry_name: e.entryName,
            player_name: e.playerName,
            rank: e.rank,
            rank_sort: e.rankSort,
            last_rank: e.lastRank,
            total: e.total,
            event_total: e.eventTotal,
            synced_at: new Date().toISOString(),
          })),
          { onConflict: "season,league_id,entry_id" },
        );
        if (error) throw new Error(`league_entries: ${error.message}`);
      }

      nextPage += STANDINGS_CONCURRENCY;
      hasNext = !stop;
      if (hasNext && entries.length >= entryCap) cappedAt = entries.length;
    }

    const entriesToWrite = entries;

    // ---------------------------------------------------------------- picks
    // A member's picks are one fact shared across every league they're in
    // (see the migration's comment) — skip any entry already synced for this
    // event by an earlier call, whether from this league or another.
    //
    // Sprint 29 follow-up: found while testing the standings speedup above
    // against league 314 (9.9M entries, capped at 2000) — a single `.in()`
    // over 2000 entry ids serialises into a query string long enough to trip
    // an HTTP/2 protocol error before it reaches Postgres. Chunked the same
    // way lib/leagues.ts's loadLeagueEntryPicks already chunks the entry-id
    // list for its own `.in()` reads.
    const already = new Set<number>();
    for (const idBatch of chunk(entriesToWrite.map((e) => e.entry), 200)) {
      const { data: existing, error: existingError } = await db
        .from("league_entry_picks")
        .select("entry_id")
        .eq("season", season)
        .eq("event", event)
        .in("entry_id", idBatch);
      if (existingError) throw new Error(`league_entry_picks read: ${existingError.message}`);
      for (const r of existing ?? []) already.add(r.entry_id as number);
    }

    const toFetch = entriesToWrite.filter((e) => !already.has(e.entry));
    let picksWritten = 0;
    let picksFailed = 0;

    const results = await mapLimit(toFetch, PICKS_CONCURRENCY, async (e) => {
      try {
        const picks = await getEntryPicks(e.entry, event!);
        return { entry: e.entry, picks };
      } catch {
        return { entry: e.entry, picks: null };
      }
    });

    const pickRows = results.flatMap(({ entry, picks }) => {
      if (!picks) {
        picksFailed += 1;
        return [];
      }
      return picks.picks.map((p) => ({
        season,
        entry_id: entry,
        event: event!,
        position: p.position,
        element: p.element,
        multiplier: p.multiplier,
        is_captain: p.is_captain,
        is_vice_captain: p.is_vice_captain,
        synced_at: new Date().toISOString(),
      }));
    });

    for (const batch of chunk(pickRows, 500)) {
      const { error } = await db
        .from("league_entry_picks")
        .upsert(batch, { onConflict: "season,entry_id,event,position" });
      if (error) throw new Error(`league_entry_picks write: ${error.message}`);
      picksWritten += batch.length;
    }

    const rowsWritten = entriesToWrite.length + picksWritten;
    await run.finish("success", {
      season,
      rowsWritten,
      details: {
        league_id: leagueId,
        event,
        entries: entriesToWrite.length,
        entry_cap: entryCap,
        capped: cappedAt !== null,
        picks_written: picksWritten,
        picks_reused: already.size,
        picks_failed: picksFailed,
      },
    });

    return jsonResponse({
      ok: true,
      season,
      event,
      league_id: leagueId,
      entries: entriesToWrite.length,
      capped: cappedAt !== null,
      picks_written: picksWritten,
      picks_reused: already.size,
      picks_failed: picksFailed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed for league ${leagueId}: ${message}`);
    await run.finish("error", { error: message, details: { league_id: leagueId } });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
