-- Sprint 38 — the player shortlist.
--
-- Named "shortlist", not "watchlist", deliberately. "Watchlist" already means
-- something else in this schema: the bounded set of players sampled every ~2h
-- for price movement (20260830191442_sprint29_price_watchlist.sql, and
-- game_settings.price_watch_*). That one is a sampling budget chosen by the
-- system; this one is a set of players the owner picked. Two meanings for one
-- word in one app is a bug with a delay on it, so the user-facing feature
-- takes the term FPL players actually use.
--
-- Owner-scoped, following the Sprint 14 shape: `user_id` referencing
-- auth.users, and `auth.uid() = user_id` in BOTH directions. Per CLAUDE.md,
-- enabling the policy is not the same as verifying it — this was checked by
-- simulating a second user inside a rolled-back transaction, confirming zero
-- rows read and zero rows written across the boundary.
--
-- Keyed on `player_code`, not `players.id`: FPL reassigns element ids between
-- seasons, so an id-keyed shortlist would silently point at a different
-- footballer after a rollover. `season` is still part of the key, because a
-- shortlist is a statement about a season's squad-building, not a permanent
-- favourite.

create table public.user_shortlist (
  user_id     uuid not null references auth.users (id) on delete cascade,
  season      text not null,
  player_code integer not null,
  -- Why this player is on the list. The whole point of a shortlist is the
  -- thinking behind it, which is gone by the next deadline otherwise.
  note        text,
  created_at  timestamptz not null default now(),
  primary key (user_id, season, player_code)
);

create index user_shortlist_user_season_idx on public.user_shortlist (user_id, season);

alter table public.user_shortlist enable row level security;

create policy "Select own" on public.user_shortlist
  for select to authenticated using (auth.uid() = user_id);
create policy "Insert own" on public.user_shortlist
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Update own" on public.user_shortlist
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own" on public.user_shortlist
  for delete to authenticated using (auth.uid() = user_id);
