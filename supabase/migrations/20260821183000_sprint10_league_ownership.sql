-- Sprint 10 (exact slice) — mini-league ownership.
--
-- The GW1 deadline (2026-08-21 17:30 UTC) made every entry's picks public and
-- league 314's standings non-empty for the first time — see docs/roadmap.md's
-- "GW1 live-data unlock" entry. This is the exact-EO slice of Sprint 10: any
-- classic league the owner belongs to (manager_leagues), not a sampled
-- top-1k template, which stays blocked until 314 is rank-ordered by a scored
-- gameweek.
--
-- Deliberately two tables, not a widening of manager_leagues/manager_picks:
--
-- - league_entries holds every member of a league snapshotted by
--   sync-league-picks, most of whom have never connected to this app and so
--   have no row in `managers` — an FK to managers would be wrong, and
--   writing stub `managers` rows would conflate "a manager who signed in
--   here" with "a name scraped off a public standings page".
-- - league_entry_picks is keyed by (season, entry_id, event), not
--   (season, league_id, entry_id, event) — an entry's picks are one fact
--   regardless of how many of the owner's 13 leagues they're also in, so
--   they're stored once and joined to league_entries per league at read
--   time, rather than duplicated per league membership.
--
-- Same public-read/service-write shape as manager_leagues: this is public
-- FPL data about other entries' league standings and picks, not something
-- owned by an authenticated user.

create table public.league_entries (
  season       text not null,
  league_id    integer not null,
  entry_id     integer not null,
  entry_name   text,
  player_name  text,
  rank         integer,
  rank_sort    integer,
  last_rank    integer,
  -- Season-to-date total and the standings page's own "latest event" total,
  -- as FPL reports them — not reconciled against a specific gameweek here;
  -- a reader cross-references gameweeks.is_current for "which event is this".
  total        integer,
  event_total  integer,
  synced_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (season, league_id, entry_id)
);

create table public.league_entry_picks (
  season           text not null,
  entry_id         integer not null,
  event            integer not null,
  position         integer not null,
  element          integer not null,
  multiplier       integer not null,
  is_captain       boolean not null default false,
  is_vice_captain  boolean not null default false,
  synced_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (season, entry_id, event, position)
);

create index league_entry_picks_lookup on public.league_entry_picks (season, event, entry_id);

create trigger league_entries_set_updated_at before update on public.league_entries
  for each row execute function public.set_updated_at();
create trigger league_entry_picks_set_updated_at before update on public.league_entry_picks
  for each row execute function public.set_updated_at();

alter table public.league_entries enable row level security;
create policy "Public read" on public.league_entries for select to anon, authenticated using (true);

alter table public.league_entry_picks enable row level security;
create policy "Public read" on public.league_entry_picks for select to anon, authenticated using (true);

-- Per-league page/entry cap, so a huge system league (314 "Overall", or a
-- YouTube channel's invitational with tens of thousands of members) doesn't
-- get pulled in full by a function meant for the owner's ~15-to-few-hundred
-- person leagues. Raise only once real FPL rate-limit behaviour is known —
-- see docs/sprints/sprint-10.md.
insert into public.game_settings (season, key, value)
select season, 'league_ownership_entry_cap', '2000'::jsonb
from (select distinct season from public.gameweeks) s
on conflict (season, key) do nothing;
