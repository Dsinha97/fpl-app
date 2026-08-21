-- Tighten sync-fixtures' cadence.
--
-- Discovered during the GW1 kickoff dry run (docs/sprints/sprint-13.md):
-- sync-fixtures only ran hourly, so fixtures.started stayed false for up to
-- ~55 minutes after a real kickoff — which meant sync-live-gameweek's own
-- gate (which trusts fixtures.started) stayed shut for that whole window
-- even though matches were live. sync-fixtures now self-gates on
-- kickoff_time rather than running unconditionally (see the function's own
-- comment for why it can't gate on started/finished the way
-- sync-live-gameweek does), so raising its cadence to match
-- sync-live-gameweek's 2-minute schedule costs one cheap query on the ~95%
-- of ticks where nothing is imminent or live, the same shape every other
-- self-gating sync in 20260803010912_phase1_scheduling.sql already uses.

select cron.unschedule('fpl-sync-fixtures');
select cron.schedule('fpl-sync-fixtures', '*/2 * * * *', $$select public.invoke_sync('sync-fixtures')$$);
