-- DSI-187 — precompute the price-watch reading on write.
--
-- `loadPriceProgress` (lib/price-watch.ts) used to download every
-- player_ownership_history row for the season on each /players or /transfers
-- visit (154,524 rows on 2026-11-03, ~15k more per day) just to sum, per
-- player, the net transfers since that player's last price change. This table
-- holds that sum, one row per player, so the browser reads ~700 rows.
--
-- The accumulation below is the same recurrence as
-- `netTransfersSinceLastPriceChange` in lib/price-watch.ts and must stay equal
-- to it: `transfers_in_event` is a per-gameweek counter FPL zeroes at every
-- deadline, so a decrease between consecutive samples is a reset and the new
-- sample's own net IS the accumulation since it; otherwise the step is the
-- delta. scripts/price-watch-parity.ts asserts the two agree on live data.
--
-- Nothing here is fitted. The fitted, ownership-scaled thresholds, the
-- verdict ladder and the forward projection stay in TypeScript and are applied
-- to these stored figures at read time.
--
-- Disk IO: this runs on every ownership/price insert (a sync tick, ~48/day),
-- reads only rows at-or-after each player's anchor, and writes only the rows
-- whose figures changed. It is wrapped so that a failure here can never roll
-- back the sampling insert: that history cannot be recovered.

create table public.price_watch (
  season              text        not null,
  player_code         integer     not null,
  -- Time of the player's most recent player_price_history row.
  anchor_at           timestamptz not null,
  -- Ownership samples at-or-after the anchor.
  sample_count        integer     not null,
  -- Net transfers since the anchor; null under two samples, as in the app.
  net_transfers       bigint,
  -- selected_by_percent of the latest sample (null with no samples).
  latest_percent      numeric,
  -- observed_at of the latest sample.
  as_of               timestamptz,
  -- Net transfers per hour over the trailing 24h of samples; null under three
  -- samples or a zero-length span. Measured at rate_computed_at.
  rate_per_hour       double precision,
  rate_computed_at    timestamptz not null default now(),
  primary key (season, player_code)
);

alter table public.price_watch enable row level security;
create policy "Public read" on public.price_watch
  for select to anon, authenticated using (true);

create or replace function public.refresh_price_watch(p_season text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with anchors as (
    select player_code, max(observed_at) as anchor_at
      from public.player_price_history
     where season = p_season
     group by player_code
  ), s as (
    select o.player_code, o.observed_at,
           coalesce(o.transfers_in_event, 0)                                   as i,
           coalesce(o.transfers_in_event, 0) - coalesce(o.transfers_out_event, 0) as n,
           o.selected_by_percent
      from public.player_ownership_history o
      join anchors a on a.player_code = o.player_code
     where o.season = p_season
       and o.observed_at >= a.anchor_at
  ), stepped as (
    select s.*,
           case
             when row_number() over w = 1 then null
             when i < lag(i) over w         then n
             else n - lag(n) over w
           end as step
      from s
    window w as (partition by player_code order by observed_at)
  ), whole as (
    select player_code,
           count(*)                                         as sample_count,
           case when count(*) >= 2 then sum(step)::bigint end as net_transfers,
           (array_agg(selected_by_percent order by observed_at desc))[1] as last_percent,
           max(observed_at)                                 as as_of
      from stepped
     group by player_code
  ), win as (
    select player_code, observed_at, i, n,
           case
             when row_number() over w = 1 then null
             when i < lag(i) over w         then n
             else n - lag(n) over w
           end as step
      from s
     where observed_at >= now() - interval '24 hours'
    window w as (partition by player_code order by observed_at)
  ), rate as (
    select player_code,
           case
             when count(*) >= 3
              and max(observed_at) > min(observed_at)
             then sum(step)::double precision
                  / (extract(epoch from (max(observed_at) - min(observed_at))) / 3600.0)
           end as rate_per_hour
      from win
     group by player_code
  ), computed as (
    select a.player_code, a.anchor_at,
           coalesce(w.sample_count, 0)::integer as sample_count,
           w.net_transfers,
           -- The app reads a null percent as 0 (Number(null)), so this does too.
           case when w.sample_count is null then null else coalesce(w.last_percent, 0) end as latest_percent,
           w.as_of,
           r.rate_per_hour
      from anchors a
      left join whole w on w.player_code = a.player_code
      left join rate  r on r.player_code = a.player_code
  ), up as (
    insert into public.price_watch as t
      (season, player_code, anchor_at, sample_count, net_transfers,
       latest_percent, as_of, rate_per_hour, rate_computed_at)
    select p_season, c.player_code, c.anchor_at, c.sample_count, c.net_transfers,
           c.latest_percent, c.as_of, c.rate_per_hour, now()
      from computed c
    on conflict (season, player_code) do update
       set anchor_at        = excluded.anchor_at,
           sample_count     = excluded.sample_count,
           net_transfers    = excluded.net_transfers,
           latest_percent   = excluded.latest_percent,
           as_of            = excluded.as_of,
           rate_per_hour    = excluded.rate_per_hour,
           rate_computed_at = excluded.rate_computed_at
     where (t.anchor_at, t.sample_count, t.net_transfers, t.latest_percent, t.as_of, t.rate_per_hour)
           is distinct from
           (excluded.anchor_at, excluded.sample_count, excluded.net_transfers,
            excluded.latest_percent, excluded.as_of, excluded.rate_per_hour)
    returning 1
  )
  select count(*) into v_changed from up;

  return v_changed;
end;
$$;

revoke all on function public.refresh_price_watch(text) from public, anon, authenticated;

-- Keep it current. Statement-level, so a bulk sampling insert refreshes once.
create or replace function public.price_watch_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season text;
begin
  for v_season in select distinct season from new_rows loop
    begin
      perform public.refresh_price_watch(v_season);
    exception when others then
      -- Never fail the sampling insert over a derived cache.
      raise warning 'refresh_price_watch(%) failed: %', v_season, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

revoke all on function public.price_watch_after_insert() from public, anon, authenticated;

create trigger player_ownership_history_price_watch
  after insert on public.player_ownership_history
  referencing new table as new_rows
  for each statement execute function public.price_watch_after_insert();

create trigger player_price_history_price_watch
  after insert on public.player_price_history
  referencing new table as new_rows
  for each statement execute function public.price_watch_after_insert();

-- Backfill.
do $$
declare
  v_season text;
begin
  for v_season in select distinct season from public.player_price_history loop
    perform public.refresh_price_watch(v_season);
  end loop;
end;
$$;
