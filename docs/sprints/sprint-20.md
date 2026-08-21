# Sprint 20 — RSS News Ingestion

**Built** 2026-08-21. Adds real editorial reporting — press conferences, expected minutes,
predicted lineups, confirmed transfers — pulled from RSS and linked back to the players and
clubs already in the database. The only prior notion of "news" was FPL's own `players.news`
blurb (diffed into `player_news`, surfaced as `change_feed`'s `kind: 'news'`): it says a
player's availability changed, never why, and it lands hours after the press conference that
caused it.

## Feed reality check

The owner supplied seven feeds. Probing all seven live before designing against them (per
CLAUDE.md's "verify, don't assume") found **three that do not work as given**:

| Feed | Result |
|---|---|
| Fantasy Football Scout — all news (`/feed/`) | ✅ 200, RSS, 12 items, rich `<category>` tags |
| FFS `/tag/fantasy-premier-league/feed/` | ❌ 200 but serves an **HTML page** — 0 `<item>` elements. `?feed=rss2` also HTML |
| FFS `/category/scout-picks/feed/` | ❌ same failure — HTML, 0 items |
| BBC Sport football | ✅ 200, RSS, 85 items, no `<category>` tags |
| The Guardian — football | ✅ 200, RSS, 66 items, `<category domain="…">…</category>` incl. club names |
| Sky Sports (`/rss/11095`) | ✅ 200, RSS, 20 items, content-type-only categories (`Liveblog`, `News Story`) |
| Transfermarkt UK news | ❌ **HTTP 405**, "Human Verification" bot wall — not a feed at all |

Consequences:

- **The two dead FFS sub-feeds became category filters on the one working FFS feed.** Its
  items already carry `Team News`, `fpl team news`, `fpl press conferences`, `Scout Picks`,
  `Team Reveals`, `best differentials`, per-club tags (`arsenal team news`), and player-name
  tags (`Haaland`, `Bruno G`). `news_sources` seeds three logical FFS sources sharing one
  URL, distinguished by `include_categories` — one fetch instead of three.
- **Transfermarkt is seeded `enabled = false`**, with the 405 recorded in `notes`.
  BBC/Sky/Guardian already cover confirmed transfers.
- **Feed-supplied categories became the primary entity-resolution signal**, ahead of
  headline keyword matching — Guardian tags articles with the club name, FFS tags them
  `arsenal team news`. Parsing the headline is the fallback (BBC carries no categories at
  all), not the primary path. This mattered given `lib/gw1-lineups.ts`: 23 of 262 name
  resolutions were wrong on a far more curated source (a predicted-lineup video), so a
  wire-service headline gets no benefit of the doubt.

A second, unrelated bug surfaced only once real feed data was loaded in the browser: **Sky's
`pubDate` carries a bare `BST` zone abbreviation** —
`new Date("Wed, 19 Aug 2026 12:59:00 BST")` is `Invalid Date`, because JS `Date` only
recognises `GMT`/`UTC` and numeric offsets, not zone names. `parsePubDate` in
`_shared/rss.ts` rewrites the trailing abbreviation to a numeric offset first; on failure it
returns `null` so the caller sets `published_estimated = true` and falls back to fetch time
rather than writing an `Invalid Date`.

A third bug was caught in the browser after shipping the first deploy: **the Guardian's feed
escapes its own markup** (`&lt;p&gt;…&lt;/p&gt;`) rather than embedding real `<p>` tags.
`stripTags` originally stripped real tags *then* decoded entities — for pre-escaped markup
that order never matches anything, so the excerpt showed literal `<p>`/`<a href="…">` text.
Fixed by decoding twice before stripping (harmless for feeds that use real tags, since
CDATA'd markup has no entities to double-decode); redeployed and re-verified in `news_feed`.

## Schema — `20260821160000_sprint20_news_feeds.sql`

- **`news_sources`** — table-driven feed list (slug, url, `include_categories`/
  `exclude_categories`, `enabled`) so a feed is added or disabled with a row, no redeploy.
  Seeded with the six working sources plus Transfermarkt disabled.
- **`news_items`** — title + link + excerpt only (tags stripped, ~300 chars), no full
  `<content:encoded>` body — the app links out rather than republishing articles.
  `published_estimated` flags a fetch-time fallback. `unique (source_id, guid)`.
- **`news_item_entities`** — one row per (item, entity) link, `entity_id` keyed on
  `teams.code`/`players.code` (season-stable, same convention `change_feed` uses), carrying
  an explicit `confidence` and `matched_via` tier.
- **`news_feed`** view — items joined to source display fields with entities aggregated into
  a jsonb array, mirroring `change_feed`'s shape.
- Same public-read/service-write RLS shape as every other ingested table
  (`external_player_seasons`); verified with the `verify-rls` skill (rolled-back transaction,
  both `anon` and `authenticated`, zero rows writable on any of the three tables).
- 30-day retention, deleted at the end of each `sync-news` run (`news_item_entities` cascades).
- Scheduled every 20 minutes via the existing `invoke_sync`/`cron.schedule` plumbing —
  `fpl-sync-news`.

## Entity resolution — `_shared/entities.ts`

Four tiers, each carrying an explicit confidence and `matched_via` label:

| Tier | Rule | Confidence |
|---|---|---|
| `feed_category` | Item category (or, if none exist, the title) matches a club alias | 1.0 |
| `full_name` | Folded `first second` or `known_name` appears in title/excerpt | 0.9 |
| `surname_team_confirmed` | Surname hit, and the player's own club already resolved on the item | 0.85 |
| `surname` | Surname hit, unique across the season's player pool | 0.6 |

Surnames ambiguous within the season (two Silvas) produce **no row** at all — not a guess.
Verified with an offline `npx tsx` harness against the four saved feed XML files before any
deploy: item counts matched exactly (12/85/66/20), Sky's BST dates parsed correctly, an
Arsenal-tagged FFS item resolved the club at 1.0 plus Saka/Bruno G at 0.85/0.9, and a bare
"Silva is a doubt…" headline resolved to zero player rows. Harness kept out of the commit.

## Edge Function — `sync-news`

Same shape as `sync-fixtures`: `preflight`/`serviceClient`/`SyncRun`/`jsonResponse` from
`_shared/sync.ts`. The retry/backoff/timeout logic previously private to `_shared/fpl.ts` was
extracted to `_shared/http.ts` so RSS fetches share it rather than duplicating it (CLAUDE.md's
"one quantity, one implementation"). One source failing does not abort the run for the rest —
per-source errors are collected and the run finishes `partial` rather than `error` when at
least one source succeeds. A source whose URL 200s but isn't RSS at all (the two dead FFS
sub-feeds, before the category-filter fix) parses to zero items rather than throwing.

First live run: 6/6 sources fetched, 145 items, 166 entity links, 0 errors.

## Frontend

- **`/changes` renamed to `/news`** — it now also carries the Feeds tab, so "changes"
  undersold the page. `app/changes/page.tsx` is a `useEffect`-based redirect stub (never in
  the render body — a documented gotcha) so old links keep working under `trailingSlash:
  true`. Three references updated: `nav-links.tsx`, `/deadline`'s "See every change" link,
  the page itself.
- **`/news`'s existing filter pills gained a `🗞 Feeds` tab** with source sub-pills
  (All/Scout/BBC/Guardian/Sky). RSS rows render separately from `change_feed` rows, not
  merged into one union — `change_feed` is verified database fact, RSS is third-party
  editorial with a probabilistic link, and blending them would launder that difference
  (CLAUDE.md's "say what the number means"). Entity chips resolve to team short names/player
  web names via a client-side lookup, not raw numeric ids.
  - Caught in the browser after the first deploy: FFS's three logical sources share one feed
    URL, so an item satisfying more than one category filter (e.g. tagged both `Team News`
    and the unfiltered catch-all) was upserted once per source and appeared twice under the
    "All" pill. Fixed by de-duplicating by `url` client-side, keeping the newest occurrence.
- **`lib/news-feed.ts`** — `NewsRow`/`NewsEntity` shapes, `sourceBadge`, `confidentEntities`
  (threshold 0.85), `loadSquadHeadlines` (one shared query for a whole squad's confident
  player headlines, used by both `/team` and `/builder`) — same fetch/render split as
  `lib/change-feed.ts`.
- **Player detail panel** (`components/player-detail.tsx`) gained an optional "In the news"
  section, capped at 3 headlines, rendered only when `player.headlines` is populated — same
  convention as `reliability`/`system` (undefined hides the section; the panel never fetches
  its own data). Wired in both `/team` and `/builder`, each doing one squad-wide
  `loadSquadHeadlines` query rather than a per-panel fetch.
- **`/deadline` gained a "Team news" `CollapsibleCard`**, same tier/placement as the existing
  "Price & news watch" card, filtered to the squad's players and their clubs, confidence ≥
  0.85, last 7 days.

## Verification

- Offline parser harness (`npx tsx`) against saved feed XML — item counts, Sky BST dates,
  entity tiers — before any deploy.
- `verify-rls` on all three tables plus the view — both roles, zero rows writable.
- Manual `sync-news` invocation, `sync_runs` row confirmed `success`, `news_items` counts per
  source spot-checked.
- Browser: `/news` (all tabs, both themes, mobile width, no console errors), `/deadline` and
  `/team` (signed-out smoke test — no crashes on the new headline/team-news code paths when
  no squad is loaded). Two real bugs (the Guardian excerpt-escaping issue and the FFS
  cross-source duplicate) were caught this way, not by review, and fixed before shipping.
- `ship-check` (tsc, lint, build) — all three pass.

## Explicitly not in scope

- Outbound alerting on news (Sprint 16's reserved theme).
- Any use of news as an xP model input.
- Scraping the two dead FFS pages directly (their RSS is gone, not just filtered differently).
- Full signed-in verification of the `/team`/`/builder`/`/deadline` headline surfaces (the
  magic-link testing quota is one-per-session; structural/no-crash verification was done
  signed-out instead).
