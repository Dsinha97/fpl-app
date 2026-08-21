# RSS news ingestion

A second, independent ingestion pipeline (Sprint 20) that pulls third-party editorial
reporting — press conferences, expected minutes, predicted lineups, confirmed transfers —
and links it back to the players and clubs already in the database. See
[data-pipeline.md](data-pipeline.md) for the FPL-API snapshotting pipeline this sits
alongside; the two are deliberately not merged.

## Why a second pipeline, not an extension of `change_feed`

`change_feed` unions rows that are **verified database facts** — a price genuinely changed,
FPL's own availability flag genuinely flipped. RSS headlines are **third-party editorial**
with a **probabilistic** player/club link. Rendering them through the same view or the same
row shape would blur that distinction — CLAUDE.md's "say what the number means" applies to a
match confidence as much as to a score. So `news_feed` is a second view, and `/news`'s Feeds
tab renders RSS rows as a visibly separate list from the change feed, not interleaved with it.

## Schema

`supabase/migrations/20260821160000_sprint20_news_feeds.sql`:

- **`news_sources`** — table-driven feed config (slug, url, `include_categories`/
  `exclude_categories`, `enabled`, `poll_minutes`). A feed is added or disabled with a row,
  no redeploy — same principle as squad rules coming from `game_settings` rather than being
  hardcoded.
- **`news_items`** — title + link + excerpt only (~300 chars, tags stripped), no full
  article body. `published_estimated` flags a row whose `pubDate` failed to parse, where
  `fetched_at` was substituted instead.
- **`news_item_entities`** — one row per (item, entity) link. `entity_id` is
  `teams.code`/`players.code` — season-stable, the same key `change_feed` already uses for
  `player_code`. Carries an explicit `confidence` and `matched_via` tier (see below).
- **`news_feed`** view — items joined to source display fields, entities aggregated into a
  jsonb array. Same public-read/service-write RLS shape as every other ingested table
  (`external_player_seasons`), verified with the `verify-rls` skill.
- 30-day retention, deleted at the end of each sync run.

## The feed list, and what actually works

The owner's original list had seven feeds. Probing all seven live (2026-08-21, full evidence
in [sprints/sprint-20.md](../sprints/sprint-20.md)) found three that don't work as given:

- **Two Fantasy Football Scout sub-feeds** (`/tag/fantasy-premier-league/feed/`,
  `/category/scout-picks/feed/`) return HTTP 200 but serve an HTML page, not RSS — 0 items.
  Fixed by registering three logical FFS sources sharing FFS's one working feed URL
  (`/feed/`), distinguished by `include_categories` filters on that feed's own `<category>`
  tags (`Team News`, `Scout Picks`, `Team Reveals`, …) — same editorial slice, one fetch.
- **Transfermarkt's news RSS** returns HTTP 405 behind a bot wall, not a feed at all. Seeded
  `enabled = false`; BBC/Sky/Guardian already cover confirmed transfers.

Working feeds: Fantasy Football Scout (three logical sources), BBC Sport football, The
Guardian football (filtered to the `Premier League` category — the unfiltered feed also
carries World Cup/Fifa-politics/women's-football items), Sky Sports football.

## Entity resolution — `supabase/functions/_shared/entities.ts`

Four tiers, each carrying an explicit confidence and `matched_via` label. Feed-supplied
categories are the *primary* signal, ahead of headline text matching — the Guardian tags
articles with the club name, FFS tags them `arsenal team news`; parsing the headline is the
fallback for feeds with no categories at all (BBC).

| Tier | Rule | Confidence |
|---|---|---|
| `feed_category` | Item category (or the title, if the feed has none) matches a club alias | 1.0 |
| `full_name` | Folded `first second` or `known_name` appears in the title/excerpt | 0.9 |
| `surname_team_confirmed` | Surname hit, and the player's own club already resolved on the item | 0.85 |
| `surname` | Surname hit, unique across the season's player pool | 0.6 |

**Ambiguous surnames produce no row at all**, not a guess — two same-surnamed players in a
season means neither gets linked from a bare surname mention. This matters because
`lib/gw1-lineups.ts` found 23 of 262 name resolutions wrong on a far more curated source (a
predicted-lineup video); a wire-service headline gets no benefit of the doubt.

The accent-folding helper (`fold()`) is a copy of `lib/player-search.ts`'s — Supabase bundles
each function directory independently, so `supabase/functions/**` cannot import from `lib/`.
Keep the two in sync if either changes.

## Where headlines surface

- **`/news`** — Feeds tab, all sources with a sub-pill filter, entity chips resolved to
  display names client-side. Duplicate items (an article satisfying more than one FFS
  category filter, since the three logical sources share one URL) are de-duplicated by `url`
  when "All" is selected.
- **Player detail panel** (`components/player-detail.tsx`) — an optional "In the news"
  section, capped at 3 headlines, rendered only when the caller passed `player.headlines` —
  same convention as `reliability`/`system` (undefined hides it; the panel never fetches its
  own data). `/team` and `/builder` each run one squad-wide query
  (`lib/news-feed.ts`'s `loadSquadHeadlines`) rather than a per-panel fetch.
- **`/deadline`** — a "Team news" `CollapsibleCard`, same placement as the existing
  "Price & news watch" card, filtered to the squad's players and their clubs.

Only links at confidence ≥ 0.85 (`CONFIDENT_ENTITY_THRESHOLD` in `lib/news-feed.ts`) surface
outside the Feeds tab itself — a wrong headline attached to a squad player is worse than none.

## Gotchas hit building this

- **`new Date("… BST")` is `Invalid Date`** — JS `Date` only recognises `GMT`/`UTC` and
  numeric offsets, not zone abbreviations. Sky's feed uses bare `BST`. `parsePubDate` in
  `_shared/rss.ts` rewrites the trailing abbreviation to a numeric offset first; on failure
  it returns `null` so the row is written with `published_estimated = true` and `fetched_at`
  as a fallback, rather than an invalid timestamp.
- **Decode-then-strip order matters for HTML excerpts.** The Guardian's feed escapes its own
  markup (`&lt;p&gt;…&lt;/p&gt;`) rather than embedding real `<p>` tags. Stripping tags before
  decoding entities (the original order) never matches escaped markup, so the excerpt showed
  literal `<p>`/`<a href="…">` text. `stripTags` now decodes twice before stripping.
- **A feed URL returning 200 doesn't mean it's RSS.** Both dead FFS sub-feeds return HTML
  pages at 200 — `parseFeed` returns `[]` rather than throwing, and `sync-news` records that
  as a per-source error without aborting the run.
- **A `<guid>` isn't always stable — found live, 2026-08-21, 46% of rows.** BBC's guid is the
  article URL with a `#fragment` that changes with the item's position in the feed (`#17`,
  `#4`, `#5`...), so every refetch inserted a new row under the `(source_id, guid)` unique
  constraint. `normaliseGuid` (`_shared/rss.ts`) strips a URL-shaped guid's fragment and BBC's
  own `at_medium`/`at_campaign` tracking params — **and only those**: FantasyFootballScout's
  guid uses a real, identifying `?p=<id>` query param that must not be stripped, verified by
  checking no normalisation group ever merged two different article titles. `sync-news` also
  dedupes its own fetch batch by (normalised) guid before upserting — the same trap
  `ingest-fpl-archive` hit with repeated CSV rows and fixed the same way (last occurrence
  wins; a plain array can't apply two conflicting rows in one upsert statement). A migration
  cleaned up the 150 pre-fix duplicate rows, verified in a rolled-back transaction first (316 →
  166 rows, zero orphaned `news_item_entities`) before applying for real.
