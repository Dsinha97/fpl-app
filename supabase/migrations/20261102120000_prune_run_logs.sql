-- Disk IO relief (Supabase "depleting Disk IO Budget", Nov 2026).
-- sync_runs grows by one insert + one update per cron tick (~200k rows, the
-- largest table) and cron.job_run_details by one row per tick; neither is read
-- beyond the recent past (lib/sync-health.ts, rate-limit windows of minutes).
-- Keep 14 days of both, pruned once a day.

create or replace function public.prune_run_logs()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.sync_runs where started_at < now() - interval '14 days';
  delete from cron.job_run_details where end_time < now() - interval '14 days';
$$;

revoke all on function public.prune_run_logs() from public, anon, authenticated;

select cron.schedule('prune-run-logs', '17 3 * * *', 'select public.prune_run_logs()');
