-- Backfill: fpl-sync-claimed-managers exists on the remote project
-- (jobid 8, */2 * * * *, select public.invoke_sync('sync-claimed-managers'))
-- but was scheduled directly against the database and had no migration
-- file in this repo — discovered while working on Sprint 29's price
-- watchlist. This makes the schedule reproducible from source, matching
-- production exactly. No-op against the live project (the job already
-- exists); recreates it identically on a fresh environment.

select cron.unschedule('fpl-sync-claimed-managers')
 where exists (select 1 from cron.job where jobname = 'fpl-sync-claimed-managers');

select cron.schedule(
  'fpl-sync-claimed-managers',
  '*/2 * * * *',
  $$select public.invoke_sync('sync-claimed-managers')$$
);
