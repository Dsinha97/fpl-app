-- Predictions depend on fresh prices and availability flags, so this runs a
-- few minutes after sync-bootstrap rather than alongside it.
select cron.schedule(
  'fpl-generate-predictions',
  '5,35 * * * *',
  $$select public.invoke_sync('generate-predictions')$$
);
