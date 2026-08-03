-- Phase 1, step 5: scheduled ingestion via pg_cron + pg_net.
--
-- Jobs authenticate with the publishable key, which is public by design and
-- already shipped in the browser bundle. The alternative would be storing the
-- secret key in the database; these functions only read public FPL data and
-- write public tables, and every one of them is idempotent, so the worst an
-- unauthorised caller achieves is triggering a sync that was going to happen
-- anyway.
--
-- Cadence follows the build plan: "Avoid unnecessarily aggressive polling."
-- sync-player-history and sync-live-gameweek are self-gating, so their short
-- intervals cost one cheap query on most invocations.

create extension if not exists pg_cron  with schema pg_catalog;
create extension if not exists pg_net   with schema extensions;

create or replace function public.invoke_sync(p_function text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id bigint;
begin
  select net.http_post(
    url     := 'https://fyxyqxpscmqjyjxsyhms.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer sb_publishable_EyX73kWWpruC-B_QZbcZ9A_Ax6a1OKx'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_sync(text) from public, anon, authenticated;

-- Remove any prior schedules so this migration is re-runnable.
do $$
declare
  j record;
begin
  for j in select jobname from cron.job where jobname like 'fpl-%' loop
    perform cron.unschedule(j.jobname);
  end loop;
end;
$$;

select cron.schedule('fpl-sync-bootstrap',      '*/30 * * * *', $$select public.invoke_sync('sync-bootstrap')$$);
select cron.schedule('fpl-sync-fixtures',       '0 * * * *',    $$select public.invoke_sync('sync-fixtures')$$);
select cron.schedule('fpl-sync-player-history', '*/10 * * * *', $$select public.invoke_sync('sync-player-history')$$);
select cron.schedule('fpl-sync-live-gameweek',  '*/2 * * * *',  $$select public.invoke_sync('sync-live-gameweek')$$);
