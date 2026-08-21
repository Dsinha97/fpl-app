// Shared shape and presentation helpers for the `news_feed` view (RSS
// headlines from Sprint 20's sync-news pipeline). Mirrors lib/change-feed.ts's
// split — pages fetch and render, this owns shape/formatting — so /news,
// /deadline's team-news strip, and the player detail panel don't each grow
// their own copy.
//
// Deliberately not merged into change_feed: those rows are verified database
// facts (a price actually changed); these are third-party editorial with a
// probabilistic entity link. Rendering them through one shared row shape
// would blur that distinction — CLAUDE.md's "say what the number means"
// applies to a match confidence as much as to a score.

export interface NewsEntity {
  season: string;
  entity_type: "team" | "player";
  entity_id: number;
  confidence: number;
  matched_via: "feed_category" | "full_name" | "surname_team_confirmed" | "surname";
}

export interface NewsRow {
  id: number;
  url: string;
  title: string;
  excerpt: string | null;
  author: string | null;
  published_at: string;
  published_estimated: boolean;
  categories: string[];
  source_slug: string;
  source_name: string;
  source_homepage: string;
  source_category: "fpl" | "mainstream";
  entities: NewsEntity[];
}

/** Below this, a link is shown only as a chip on /news, never on a player card or /deadline. */
export const CONFIDENT_ENTITY_THRESHOLD = 0.85;

export const SOURCE_BADGE: Record<string, string> = {
  "ffs-all": "FFS",
  "ffs-team-news": "FFS",
  "ffs-scout-picks": "FFS",
  "bbc-football": "BBC",
  "guardian-football": "Guardian",
  "sky-football": "Sky",
  "transfermarkt-news": "Transfermarkt",
};

export function sourceBadge(row: Pick<NewsRow, "source_slug" | "source_name">): string {
  return SOURCE_BADGE[row.source_slug] ?? row.source_name;
}

/** Confident entity links only — what a player card or the deadline strip should show. */
export function confidentEntities(row: NewsRow): NewsEntity[] {
  return row.entities.filter((e) => e.confidence >= CONFIDENT_ENTITY_THRESHOLD);
}

/**
 * The trimmed shape PlayerDetail's "In the news" section actually renders —
 * a NewsRow minus everything the panel has no room for. Built by pages that
 * already fetched news_feed for the squad (see the `/deadline` team-news
 * strip's query), not fetched by the panel itself.
 */
export interface NewsHeadline {
  url: string;
  title: string;
  source_slug: string;
  source_name: string;
  published_at: string;
}

export function headlineFrom(row: NewsRow): NewsHeadline {
  return {
    url: row.url,
    title: row.title,
    source_slug: row.source_slug,
    source_name: row.source_name,
    published_at: row.published_at,
  };
}

/**
 * One query for a whole squad's confident player headlines from the last 7
 * days, grouped by `players.code` (newest first) — the shape PlayerDetail's
 * "In the news" section needs. Shared by /team and /builder so the query and
 * confidence filter live in one place rather than two copies of the same
 * fetch (CLAUDE.md: one quantity, one implementation).
 */
export async function loadSquadHeadlines(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  playerCodes: number[],
): Promise<Map<number, NewsHeadline[]>> {
  const byCode = new Map<number, NewsHeadline[]>();
  if (playerCodes.length === 0) return byCode;

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await supabase
    .from("news_feed")
    .select("*")
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(300);

  const codes = new Set(playerCodes);
  for (const row of (data ?? []) as NewsRow[]) {
    for (const e of confidentEntities(row)) {
      if (e.entity_type !== "player" || !codes.has(e.entity_id)) continue;
      const list = byCode.get(e.entity_id);
      const headline = headlineFrom(row);
      if (list) list.push(headline);
      else byCode.set(e.entity_id, [headline]);
    }
  }
  return byCode;
}
