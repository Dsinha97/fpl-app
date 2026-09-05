-- Sprint 32 — who invoked a sync, and how often they are allowed to.
--
-- `sync_runs` already recorded every execution with `function_name` and
-- `started_at`, which is most of the substrate a rate limit needs. What it
-- lacked was *who*. Adding it here means the limit is counted off the same
-- table as the audit trail rather than a second store — one table, one
-- implementation.
--
-- Null for everything cron drives, which is all of Class A. Only the two
-- browser-invoked functions (sync-manager, sync-league-picks) ever set it.

alter table public.sync_runs
  add column invoked_by uuid null references auth.users(id) on delete set null;

comment on column public.sync_runs.invoked_by is
  'Supabase user who triggered this run, for the Sprint 32 per-user rate limit. Null for cron-driven runs.';

-- The limit's query shape: count this user's runs of this function since a
-- timestamp. Without the index that is a scan of the whole audit table on
-- every Refresh click.
create index sync_runs_invoker_idx
  on public.sync_runs (function_name, invoked_by, started_at desc);

-- ---------------------------------------------------------------- rejections
--
-- `sync_runs` is an audit of *runs*, and a refused call is not a run. The two
-- honest options were to write a distinct status or to keep rejections out of
-- the audit entirely; this takes the first, because a record of who is
-- hammering what is the whole diagnostic value of having `invoked_by` at all.
-- Extending the constraint rather than working around it.

alter table public.sync_runs drop constraint sync_runs_status_check;
alter table public.sync_runs add constraint sync_runs_status_check
  check (status in ('running', 'success', 'partial', 'error', 'skipped', 'rejected'));

-- 'skipped' is carried through unchanged — 20260803005016_phase1_player_history
-- already added it. Restated in full rather than patched, so this file says
-- what the constraint *is* rather than what it gained.

-- ------------------------------------------------------------------ privacy
--
-- `sync_runs` carries a public-read policy (anon and authenticated) because
-- /status renders the pipeline log signed-out. That policy predates this
-- column and must not be allowed to hand out user ids: RLS is row-level, so
-- the column-level grant is what scopes this one.
--
-- The obvious form of this does not work, and it fails *open*:
--
--   revoke select (invoked_by) on public.sync_runs from anon, authenticated;
--
-- anon and authenticated hold table-level SELECT here, and a column-level
-- REVOKE cannot subtract from a table-level grant — Postgres keeps the
-- broader privilege and the column stays readable. Checked against the live
-- database in a rolled-back transaction rather than reasoned about:
-- has_column_privilege('anon', ..., 'invoked_by', 'select') was still true
-- afterwards. The version of this that looks right defeats the whole point of
-- the column, silently.
--
-- So: drop the table-level grant and re-grant every column except the new
-- one. RLS still governs which *rows* come back; this governs which columns
-- exist at all for those roles.
--
-- /status (app/status/page.tsx, now the Pipeline tab on /settings) selects an
-- explicit column list matching this grant, so nothing in the frontend
-- breaks. A `select *` as anon now fails, which is the intended and visible
-- consequence.

revoke select on public.sync_runs from anon, authenticated;
grant select (id, function_name, season, started_at, finished_at, status,
              rows_written, http_status, cursor, error, details)
  on public.sync_runs to anon, authenticated;

-- ------------------------------------------------------------- the limit
--
-- Derived, not invented (CLAUDE.md: when a term cannot be dropped, make it an
-- input; never tune a coefficient until the answer looks reasonable). The
-- number comes from what legitimate use of these two buttons has actually
-- done, measured on this table on 2026-09-05:
--
--   sync-manager      432 runs since 2026-08-03, median gap 164s,
--                     busiest 10-minute window 27 calls
--   sync-league-picks  12 runs since 2026-08-21, median gap 150s,
--                     busiest 10-minute window 4 calls
--
-- 30 per 10 minutes clears the busiest window ever observed with headroom,
-- while capping a single account at 180/hour per function instead of the
-- unbounded surface this replaces. It lives here rather than in the function
-- so it can be raised without a redeploy — same reasoning as
-- league_ownership_entry_cap, which is already a row in this table.

insert into public.game_settings (season, key, value)
select season, 'sync_rate_limit', '{"max_calls": 30, "window_seconds": 600}'::jsonb
from (select distinct season from public.gameweeks) s
on conflict (season, key) do nothing;
