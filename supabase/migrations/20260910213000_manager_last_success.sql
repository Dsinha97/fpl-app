-- `managers.last_success_at` — when this manager last synced *completely*.
--
-- Found 2026-09-10, immediately after fixing two other silent-staleness bugs,
-- and it is the same family as both.
--
-- sync-claimed-managers decides whether a manager is due from
-- `managers.updated_at`. But `updated_at` is trigger-maintained and means "this
-- row was touched", and `syncManagerData` writes the `managers` row FIRST —
-- it has to, because manager_leagues, manager_picks, manager_transfers,
-- manager_chips, manager_season_history and manager_gameweek_history all carry
-- a foreign key to `managers (entry_id)`. So a sync that dies at step two
-- leaves behind a row that says "just synced" and a manager with no data, and
-- the 24-hour staleness check then refuses to retry it for a day.
--
-- That is exactly what happened to entry 6804945: it failed on a league_type
-- CHECK, was marked fresh, and could not be retried. Worse, the state could
-- not even be corrected by hand — `managers_set_updated_at` overwrites any
-- attempt to backdate the row, so the trigger had to be disabled inside a
-- transaction to force the retry.
--
-- `synced_at` cannot carry this meaning either: it is NOT NULL DEFAULT now(),
-- so a brand-new row created by a sync that then failed would still read as
-- freshly synced. And it is already displayed on /team as "Last synced", so
-- quietly redefining it would change what that line claims.
--
-- Hence a new, NULLABLE column. Null means "never completed", which is a state
-- the old design could not represent at all, and which the due-check reads as
-- always due.

alter table public.managers
  add column if not exists last_success_at timestamptz;

comment on column public.managers.last_success_at is
  'End of the last fully successful syncManagerData run. NULL = never '
  'completed. Distinct from updated_at (row touched, trigger-maintained) and '
  'from synced_at (set when the managers row itself was written, which happens '
  'before the rest of the sync can fail).';

-- Backfill from `synced_at` for rows that are demonstrably complete — every
-- existing manager was verified healthy on 2026-09-10 — so the first cron run
-- after this does not re-sync the whole set at once.
update public.managers set last_success_at = synced_at where last_success_at is null;

create index if not exists managers_last_success_idx on public.managers (last_success_at);
