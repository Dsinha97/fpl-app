-- Phase 1, step 3: change-detected player snapshots.
--
-- Writing a row per player per poll would be ~7.8M rows/season and will not
-- fit the free tier. These tables only receive a row when the value actually
-- differs from the last recorded observation, which captures the same
-- information in ~25k rows. Ownership is the exception: it changes every
-- poll, so it is time-gated to one observation per player per day instead.
--
-- Detection runs in SQL (record_player_snapshots) rather than in the Edge
-- Function: comparing 564 current rows against their latest snapshot is one
-- round trip in Postgres versus fetching everything into Deno to diff it.

create table public.player_price_history (
  id                bigint generated always as identity primary key,
  season            text    not null,
  player_code       integer not null,
  price             integer not null,
  cost_change_event integer,
  observed_at       timestamptz not null default now()
);

create index player_price_history_latest_idx
  on public.player_price_history (season, player_code, observed_at desc);

create table public.player_status_history (
  id                           bigint generated always as identity primary key,
  season                       text    not null,
  player_code                  integer not null,
  status                       text,
  chance_of_playing_this_round integer,
  chance_of_playing_next_round integer,
  observed_at                  timestamptz not null default now()
);

create index player_status_history_latest_idx
  on public.player_status_history (season, player_code, observed_at desc);

create table public.player_news (
  id          bigint generated always as identity primary key,
  season      text    not null,
  player_code integer not null,
  news        text,
  news_added  timestamptz,
  observed_at timestamptz not null default now()
);

create index player_news_latest_idx on public.player_news (season, player_code, observed_at desc);
create index player_news_recent_idx on public.player_news (season, observed_at desc);

create table public.player_ownership_history (
  id                  bigint generated always as identity primary key,
  season              text    not null,
  player_code         integer not null,
  selected_by_percent numeric,
  transfers_in_event  bigint,
  transfers_out_event bigint,
  observed_at         timestamptz not null default now()
);

create index player_ownership_history_latest_idx
  on public.player_ownership_history (season, player_code, observed_at desc);

-- --------------------------------------------------------------- detection

create or replace function public.record_player_snapshots(p_season text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prices    integer;
  v_status    integer;
  v_news      integer;
  v_ownership integer;
begin
  -- Price: insert when now_cost differs from the last recorded price.
  with latest as (
    select distinct on (player_code) player_code, price
      from public.player_price_history
     where season = p_season
     order by player_code, observed_at desc
  ), ins as (
    insert into public.player_price_history (season, player_code, price, cost_change_event)
    select p.season, p.code, p.now_cost, p.cost_change_event
      from public.players p
      left join latest l on l.player_code = p.code
     where p.season = p_season
       and p.now_cost is not null
       and (l.player_code is null or l.price is distinct from p.now_cost)
    returning 1
  )
  select count(*) into v_prices from ins;

  -- Availability: status or either chance-of-playing figure changing.
  with latest as (
    select distinct on (player_code)
           player_code, status, chance_of_playing_this_round, chance_of_playing_next_round
      from public.player_status_history
     where season = p_season
     order by player_code, observed_at desc
  ), ins as (
    insert into public.player_status_history
      (season, player_code, status, chance_of_playing_this_round, chance_of_playing_next_round)
    select p.season, p.code, p.status,
           p.chance_of_playing_this_round, p.chance_of_playing_next_round
      from public.players p
      left join latest l on l.player_code = p.code
     where p.season = p_season
       and (l.player_code is null
            or l.status is distinct from p.status
            or l.chance_of_playing_this_round is distinct from p.chance_of_playing_this_round
            or l.chance_of_playing_next_round is distinct from p.chance_of_playing_next_round)
    returning 1
  )
  select count(*) into v_status from ins;

  -- News: only when the text itself changes. Players with no news are skipped
  -- entirely unless they previously had some (i.e. an injury clearing).
  with latest as (
    select distinct on (player_code) player_code, news
      from public.player_news
     where season = p_season
     order by player_code, observed_at desc
  ), ins as (
    insert into public.player_news (season, player_code, news, news_added)
    select p.season, p.code, p.news, p.news_added
      from public.players p
      left join latest l on l.player_code = p.code
     where p.season = p_season
       and (   (l.player_code is null and p.news is not null)
            or (l.player_code is not null and l.news is distinct from p.news))
    returning 1
  )
  select count(*) into v_news from ins;

  -- Ownership: time-gated to roughly daily, since it moves on every poll.
  with latest as (
    select distinct on (player_code) player_code, observed_at
      from public.player_ownership_history
     where season = p_season
     order by player_code, observed_at desc
  ), ins as (
    insert into public.player_ownership_history
      (season, player_code, selected_by_percent, transfers_in_event, transfers_out_event)
    select p.season, p.code, p.selected_by_percent,
           p.transfers_in_event, p.transfers_out_event
      from public.players p
      left join latest l on l.player_code = p.code
     where p.season = p_season
       and (l.player_code is null or l.observed_at < now() - interval '20 hours')
    returning 1
  )
  select count(*) into v_ownership from ins;

  return jsonb_build_object(
    'price_history',     v_prices,
    'status_history',    v_status,
    'news',              v_news,
    'ownership_history', v_ownership
  );
end;
$$;

revoke all on function public.record_player_snapshots(text) from public, anon, authenticated;

alter table public.player_price_history     enable row level security;
alter table public.player_status_history    enable row level security;
alter table public.player_news              enable row level security;
alter table public.player_ownership_history enable row level security;

create policy "Public read" on public.player_price_history     for select to anon, authenticated using (true);
create policy "Public read" on public.player_status_history    for select to anon, authenticated using (true);
create policy "Public read" on public.player_news              for select to anon, authenticated using (true);
create policy "Public read" on public.player_ownership_history for select to anon, authenticated using (true);
