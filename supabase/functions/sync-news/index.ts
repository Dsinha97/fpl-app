// sync-news
//
// Pulls RSS/Atom items from every enabled row in news_sources, filters each
// feed to its configured categories, upserts into news_items, and links
// player/team entities via _shared/entities.ts's tiered resolution. Table-
// driven rather than a hardcoded feed list (CLAUDE.md: squad rules come from
// the database — same principle applies here) so a feed can be added or
// disabled with a row, no redeploy.
//
// One source failing (e.g. a feed going down) does not abort the run for the
// rest — errors are collected per source and the run finishes "partial"
// rather than "error" when at least one source succeeded.
//
// Runs every 20 minutes (see the cron.schedule in
// 20260821160000_sprint20_news_feeds.sql).

import { currentSeason, jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { chunk } from "../_shared/coerce.ts";
import { fetchWithRetry } from "../_shared/http.ts";
import { parseFeed, parsePubDate, stripTags, type FeedItem } from "../_shared/rss.ts";
import { resolveEntities, type PlayerRow, type TeamRow } from "../_shared/entities.ts";
import { verifyCron } from "../_shared/cron-auth.ts";

const FUNCTION_NAME = "sync-news";
const USER_AGENT = "fpl-app/0.1 (+https://fpldecision.com)";
const EXCERPT_MAX = 300;
const RETENTION_DAYS = 30;

interface NewsSource {
  id: number;
  slug: string;
  url: string;
  include_categories: string[];
  exclude_categories: string[];
}

function buildNewsItemRow(sourceId: number, item: FeedItem, fetchedAt: string) {
  const published = parsePubDate(item.pubDateRaw);
  return {
    source_id: sourceId,
    guid: item.guid,
    url: item.url,
    title: item.title,
    excerpt: item.descriptionHtml ? stripTags(item.descriptionHtml).slice(0, EXCERPT_MAX) : null,
    author: item.author,
    published_at: (published ?? new Date(fetchedAt)).toISOString(),
    published_estimated: published === null,
    categories: item.categories,
    fetched_at: fetchedAt,
  };
}

function passesFilter(categories: string[], include: string[], exclude: string[]): boolean {
  const folded = categories.map((c) => c.toLowerCase());
  if (exclude.length > 0 && folded.some((c) => exclude.some((x) => c.includes(x.toLowerCase())))) {
    return false;
  }
  if (include.length === 0) return true;
  return folded.some((c) => include.some((i) => c.includes(i.toLowerCase())));
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();

  // Sprint 32 — cron-only: nothing in a browser has any business calling
  // this. Checked before any work at all, which is what closes the
  // `?force=1` escape hatch rather than merely guarding it — the URL below
  // is not even parsed until this passes.
  const denied = await verifyCron(req, db);
  if (denied) return denied;

  const run = await SyncRun.start(db, FUNCTION_NAME);

  try {
    const season = await currentSeason(db);

    const { data: sourceRows, error: sourceError } = await db
      .from("news_sources")
      .select("id, slug, url, include_categories, exclude_categories")
      .eq("enabled", true);
    if (sourceError) throw new Error(`news_sources: ${sourceError.message}`);
    const sources = (sourceRows ?? []) as NewsSource[];

    const [{ data: teamRows, error: teamError }, { data: playerRows, error: playerError }] = await Promise.all([
      db.from("teams").select("code, short_name").eq("season", season),
      db.from("players").select("code, team_code, web_name, first_name, second_name, known_name").eq("season", season),
    ]);
    if (teamError) throw new Error(`teams: ${teamError.message}`);
    if (playerError) throw new Error(`players: ${playerError.message}`);
    const teams = (teamRows ?? []) as TeamRow[];
    const players = (playerRows ?? []) as PlayerRow[];

    const sourceErrors: Record<string, string> = {};
    let itemsWritten = 0;
    let entitiesWritten = 0;
    let sourcesFetched = 0;

    for (const source of sources) {
      try {
        const xml = await fetchWithRetry(source.url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml" },
        });
        const parsed = parseFeed(xml);
        // A source whose URL 200s but isn't RSS at all (an HTML page, e.g.
        // fantasyfootballscout.co.uk's dead tag/category feeds) parses to
        // zero items rather than throwing — worth recording, not fatal.
        if (parsed.length === 0) {
          sourceErrors[source.slug] = "0 items parsed — feed may not be serving RSS";
          continue;
        }

        const kept = parsed.filter((item) =>
          passesFilter(item.categories, source.include_categories, source.exclude_categories),
        );

        const fetchedAt = new Date().toISOString();
        // Keyed by guid — normaliseGuid (_shared/rss.ts) collapses a feed's
        // per-request-varying guid decoration (BBC's changing #fragment) down
        // to the article, so the same article can legitimately appear twice
        // in one `kept` list. A plain array upsert can't apply two rows to
        // the same (source_id, guid) inside one statement — same trap
        // ingest-fpl-archive hit with repeated CSV rows; same fix, last
        // occurrence wins.
        const rowsByGuid = new Map<
          string,
          ReturnType<typeof buildNewsItemRow>
        >();
        for (const item of kept) {
          rowsByGuid.set(item.guid, buildNewsItemRow(source.id, item, fetchedAt));
        }
        const rows = [...rowsByGuid.values()];

        const written: { id: number; title: string; excerpt: string | null; categories: string[] }[] = [];
        for (const batch of chunk(rows, 100)) {
          const { data, error } = await db
            .from("news_items")
            .upsert(batch, { onConflict: "source_id,guid" })
            .select("id, title, excerpt, categories");
          if (error) throw new Error(`news_items: ${error.message}`);
          written.push(...(data ?? []));
        }
        itemsWritten += written.length;
        sourcesFetched++;

        // Entity links are cheap in-memory string matching, so every item
        // returned by this run is re-resolved rather than diffing for
        // "newly inserted only" — matched_via/confidence only depend on the
        // item's own text plus the current player/team pool, so re-resolving
        // an unchanged item reproduces the same rows and upsert makes that a
        // no-op.
        const entityRows = written.flatMap((item) =>
          resolveEntities(item, teams, players).map((m) => ({
            news_item_id: item.id,
            season,
            entity_type: m.entity_type,
            entity_id: m.entity_id,
            confidence: m.confidence,
            matched_via: m.matched_via,
          })),
        );
        for (const batch of chunk(entityRows, 200)) {
          const { error } = await db
            .from("news_item_entities")
            .upsert(batch, { onConflict: "news_item_id,entity_type,entity_id,season" });
          if (error) throw new Error(`news_item_entities: ${error.message}`);
        }
        entitiesWritten += entityRows.length;
      } catch (err) {
        sourceErrors[source.slug] = err instanceof Error ? err.message : String(err);
      }
    }

    // Retention: news_item_entities cascades on delete, so this is one
    // statement, not two.
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    const { error: deleteError } = await db.from("news_items").delete().lt("published_at", cutoff);
    if (deleteError) console.error(`news_items retention delete failed: ${deleteError.message}`);

    const hadErrors = Object.keys(sourceErrors).length > 0;
    const status = !hadErrors ? "success" : sourcesFetched > 0 ? "partial" : "error";

    await run.finish(status, {
      season,
      rowsWritten: itemsWritten + entitiesWritten,
      error: hadErrors ? JSON.stringify(sourceErrors) : undefined,
      details: { sources: sources.length, sourcesFetched, itemsWritten, entitiesWritten, sourceErrors },
    });

    return jsonResponse({
      ok: !hadErrors || sourcesFetched > 0,
      season,
      sourcesFetched,
      sourcesTotal: sources.length,
      itemsWritten,
      entitiesWritten,
      sourceErrors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed: ${message}`);
    await run.finish("error", { error: message });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
