-- Sprint 20: RSS news ingestion.
--
-- The app's only prior notion of "news" is FPL's own players.news blurb
-- (player_news / change_feed's `kind: 'news'`) — it says a player's
-- availability changed, never why, and it lands hours after the press
-- conference that caused it. This adds real editorial reporting: press
-- conferences, expected minutes, predicted lineups, confirmed transfers,
-- pulled from RSS and linked back to players/teams already in the DB.
--
-- Table-driven feed list (news_sources) rather than hardcoded in the
-- function, so a feed can be added or disabled with a row, no redeploy.
-- Two of the seven feeds the owner supplied do not serve RSS at all — see
-- docs/sprints/sprint-20.md for the probe evidence — so the "FPL tag" and
-- "Scout Picks" requests are delivered as category filters on Fantasy
-- Football Scout's one working feed instead of three separate URLs.
--
-- Same shape as every other ingested table (external_player_seasons):
-- public-read / service-write, no insert policy — writes only happen
-- through the service-role client in sync-news, which bypasses RLS.

create table public.news_sources (
  id                 smallint generated always as identity primary key,
  slug               text not null unique,
  name               text not null,
  url                text not null,
  homepage           text not null,
  category           text not null check (category in ('fpl', 'mainstream')),
  -- An item is kept only if it has no categories (nothing to filter on) or
  -- at least one category matches, case-insensitively, one of these
  -- substrings. Empty array = no include filter (everything passes).
  include_categories text[] not null default '{}',
  exclude_categories text[] not null default '{}',
  poll_minutes       integer not null default 20,
  enabled            boolean not null default true,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger news_sources_set_updated_at before update on public.news_sources
  for each row execute function public.set_updated_at();

alter table public.news_sources enable row level security;
create policy "Public read" on public.news_sources for select to anon, authenticated using (true);

insert into public.news_sources
  (slug, name, url, homepage, category, include_categories, exclude_categories, poll_minutes, enabled, notes)
values
  ('ffs-all', 'Fantasy Football Scout — All News',
   'https://www.fantasyfootballscout.co.uk/feed/',
   'https://www.fantasyfootballscout.co.uk/', 'fpl', '{}', '{}', 20, true,
   'Unfiltered — press conferences, predicted lineups, injury updates.'),

  ('ffs-team-news', 'Fantasy Football Scout — Team News',
   'https://www.fantasyfootballscout.co.uk/feed/',
   'https://www.fantasyfootballscout.co.uk/', 'fpl',
   array['team news', 'press conferences'], '{}', 20, true,
   'The requested "FPL tag" feed (fantasy-premier-league/feed/) 404s as RSS '
   || '(serves HTML, 0 items) — probed 2026-08-21. This is the same editorial '
   || 'slice via category filter on the main feed instead.'),

  ('ffs-scout-picks', 'Fantasy Football Scout — Scout Picks',
   'https://www.fantasyfootballscout.co.uk/feed/',
   'https://www.fantasyfootballscout.co.uk/', 'fpl',
   array['scout picks', 'team reveals', 'best picks', 'best differentials'], '{}', 20, true,
   'The requested category/scout-picks/feed/ also 404s as RSS (same probe). '
   || 'Category filter on the main feed instead.'),

  ('bbc-football', 'BBC Sport Football', 'https://feeds.bbci.co.uk/sport/football/rss.xml',
   'https://www.bbc.co.uk/sport/football', 'mainstream', '{}', '{}', 20, true,
   'No <category> tags on this feed — entity resolution falls back to name matching.'),

  ('guardian-football', 'The Guardian — Football', 'https://www.theguardian.com/football/rss',
   'https://www.theguardian.com/football', 'mainstream', array['Premier League'], '{}', 20, true,
   'Restricted to the Premier League category — the unfiltered feed also carries '
   || 'World Cup, Fifa politics and women''s football items (probed 2026-08-21).'),

  ('sky-football', 'Sky Sports — Football News', 'https://www.skysports.com/rss/11095',
   'https://www.skysports.com/football', 'mainstream', '{}', '{}', 20, true,
   'pubDate carries BST/GMT abbreviations new Date() cannot parse — '
   || 'see parsePubDate in _shared/rss.ts.'),

  ('transfermarkt-news', 'Transfermarkt — UK News', 'https://www.transfermarkt.co.uk/rss/news',
   'https://www.transfermarkt.co.uk/', 'mainstream', '{}', '{}', 20, false,
   'Disabled: returns HTTP 405 behind a "Human Verification" bot wall, not a feed '
   || '(probed 2026-08-21). BBC/Sky/Guardian already cover confirmed transfers.');

create table public.news_items (
  id                   bigint generated always as identity primary key,
  source_id            smallint not null references public.news_sources (id),
  guid                 text not null,
  url                  text not null,
  title                text not null,
  -- Tags stripped, entities decoded, truncated to ~300 chars. Title + link +
  -- excerpt only — no full <content:encoded> body; the app links out for the
  -- full article rather than republishing it.
  excerpt              text,
  author               text,
  published_at         timestamptz not null,
  -- True when the feed's pubDate failed to parse (e.g. Sky's bare "BST"
  -- suffix) and fetched_at was substituted — so the UI can mark it "~"
  -- rather than presenting a guess as an exact time.
  published_estimated  boolean not null default false,
  categories           text[] not null default '{}',
  fetched_at           timestamptz not null default now(),
  unique (source_id, guid)
);

create index news_items_published_idx on public.news_items (published_at desc);

alter table public.news_items enable row level security;
create policy "Public read" on public.news_items for select to anon, authenticated using (true);

create table public.news_item_entities (
  news_item_id  bigint not null references public.news_items (id) on delete cascade,
  season        text not null,
  entity_type   text not null check (entity_type in ('team', 'player')),
  -- teams.code / players.code — season-stable, same key change_feed already
  -- uses for player_code, so a headline and a price change line up on the
  -- same id.
  entity_id     integer not null,
  confidence    numeric not null check (confidence between 0 and 1),
  matched_via   text not null check (
    matched_via in ('feed_category', 'full_name', 'surname_team_confirmed', 'surname')
  ),
  created_at    timestamptz not null default now(),
  primary key (news_item_id, entity_type, entity_id, season)
);

create index news_item_entities_lookup_idx
  on public.news_item_entities (season, entity_type, entity_id);

alter table public.news_item_entities enable row level security;
create policy "Public read" on public.news_item_entities for select to anon, authenticated using (true);

-- One feed row per item, with source display fields joined in and entity
-- links aggregated into a jsonb array — mirrors change_feed's shape so the
-- frontend reads one relation instead of three.
create or replace view public.news_feed
with (security_invoker = true) as
select
  ni.id,
  ni.url,
  ni.title,
  ni.excerpt,
  ni.author,
  ni.published_at,
  ni.published_estimated,
  ni.categories,
  ns.slug as source_slug,
  ns.name as source_name,
  ns.homepage as source_homepage,
  ns.category as source_category,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'season', e.season,
        'entity_type', e.entity_type,
        'entity_id', e.entity_id,
        'confidence', e.confidence,
        'matched_via', e.matched_via
      )
    ) filter (where e.news_item_id is not null),
    '[]'::jsonb
  ) as entities
from public.news_items ni
join public.news_sources ns on ns.id = ni.source_id
left join public.news_item_entities e on e.news_item_id = ni.id
group by ni.id, ns.slug, ns.name, ns.homepage, ns.category
order by ni.published_at desc;

grant select on public.news_feed to anon, authenticated;

-- Runs every 20 minutes, same invoke_sync/cron.schedule plumbing every other
-- sync-* function uses (see 20260803010912_phase1_scheduling.sql).
select cron.schedule('fpl-sync-news', '*/20 * * * *', $$select public.invoke_sync('sync-news')$$);
