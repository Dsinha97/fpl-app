# Database & Row Level Security

Two RLS shapes coexist in this schema, by design — knowing which applies to a table matters before
trusting a query result.

## Shape 1 — public reference/derived data (pre-Sprint-14)

`SELECT` open `to anon, authenticated`, writes service-role only. Covers `teams`, `players`,
`fixtures`, `player_predictions`, `player_rate_profile`, `pl_managers`, and most of the schema — this
is public FPL data, so there's no user to scope it to.

**One historical gap, found and fixed live.** `health_check`'s very first migration granted `SELECT`
`to anon` only — written before the `to anon, authenticated` convention existed. Signing in flips a
client's role to `authenticated`, the policy stops matching, and the query silently returns zero rows
— surfaced as "Data pipeline: unreachable" for any signed-in visitor, and only ever caught because
someone tested signed-in (every earlier verification pass ran signed out). A sweep of every RLS table
for the same shape found exactly one other case: `fpl_sessions`, which has **zero** policies **by
design** (see below), not by the same mistake. — [sprint-14.md §14.3](../sprints/sprint-14.md)

## Shape 2 — owner-scoped data (Sprint 14 onward)

`user_profiles`, `team_drafts`, `draft_snapshots`, `manager_rivals` — every one scoped
`auth.uid() = user_id` **in both directions**: no anon access, and no cross-user access even when
authenticated. Verified live, not just read from the policy text: two throwaway `auth.users` rows in
a rolled-back transaction, user B's `select count(*)` against all three tables returned 0, and B's
`update … where draft_id = <A's id>` affected 0 rows.

Sprint 36 added three more in the same shape — `user_notification_prefs`, `notification_outbox` and
`telegram_link_codes` — verified with twelve checks in a rolled-back transaction across two
authenticated users and `anon`. One of them is worth singling out because it is not an RLS check at
all:

**A unique index can be the security boundary.** `user_notification_prefs.telegram_chat_id` is the
inbound allowlist for the Telegram bot, so "two users claim one chat" is not a data-integrity
nicety — it is the case where a stranger's `/team` command returns someone else's squad. A user
repointing their own row at another user's chat id is blocked by the unique index, which makes the
state unrepresentable rather than merely unauthorised. Tested rather than argued. See
[notifications-and-bot.md](notifications-and-bot.md#rls-the-row-that-is-actually-a-security-boundary).

`fpl_sessions` goes further: RLS enabled, **zero policies at all** — not even the row's own owner can
read it through the anon/authenticated client, only the service-role client inside an Edge Function.
This is deliberate, since the table holds an encrypted FPL session — see
[fpl-authentication.md](fpl-authentication.md).

## The rule this repo follows

**Don't mix the two shapes without a reason**, and **verify a new policy, don't just enable it** —
simulate a second role with `set_config('request.jwt.claims', ...)` inside a rolled-back
`execute_sql` transaction and confirm zero rows/writes leak, before trusting it. A page tested only
signed-out can hide a policy gap that only affects `authenticated` — the `health_check` bug above is
the concrete example.

## RLS is row-level — a column needs a column grant

`sync_runs` is public-read because the Pipeline tab renders the log signed-out. Sprint 32's
`invoked_by` column would therefore have published Supabase user ids to anonymous readers, and no
policy could have stopped it: **RLS grants or denies rows, not columns.** The fix is a column-level
grant, `revoke select (invoked_by) on public.sync_runs from anon, authenticated`. Consumers select
an explicit column list, so a `select *` as anon now fails — the intended and visible consequence.
Verified after deploy: the Pipeline tab's own columns read fine, `invoked_by` returns
`permission denied for table sync_runs`. See
[edge-function-security.md](edge-function-security.md#the-privacy-consequence-the-scope-doc-did-not-anticipate).

## Don't put a CHECK constraint on somebody else's enum

`manager_leagues.league_type` carried `check (league_type in ('s','x'))` and FPL also emits `c`.
Because that column is upserted early in the manager sync, one unrecognised value in one cosmetic
field aborted an entire manager's sync — history, chips, transfers and picks included. The
constraint was **dropped rather than widened**, because widening re-arms the same trap for the
fourth value. Full account:
[data-pipeline.md](data-pipeline.md#a-check-constraint-on-somebody-elses-enum).

## A trigger-maintained timestamp cannot mean "last succeeded"

`managers.updated_at` is maintained by `managers_set_updated_at` and means "row touched". Since
`syncManagerData` must write the `managers` row first (six tables FK to it), a sync that died at
step two marked itself fresh and blocked its own retry for 24 hours — and could not be corrected by
hand, because the trigger overwrites any attempt to backdate the row. `managers.last_success_at` is
a **nullable** column written last and only on full success, so null is a representable "never
completed". Same page as above.

## `team_drafts.players` is `jsonb`, not a normalised child table

A draft is always read and written whole, so a `draft_players` table would only add a hard FK to
`players(season, id)` that a season rollover would strand — the exact trap `manager_picks` already
carries (below).

## Season-rollover trap

`manager_picks` FKs to `players(season, id)`, which holds only the current season — so a table
shaped like it can never store *past*-season behaviour even where the FPL API might expose it. This
is one of the concrete reasons manager transfer/captain/chip history is blocked rather than merely
unbuilt — see [manager-profile.md](manager-profile.md) and
[blocked-and-data-gaps.md](blocked-and-data-gaps.md).

See also: [data-pipeline.md](data-pipeline.md) (what writes these tables and when),
[fpl-authentication.md](fpl-authentication.md) (`fpl_sessions`' zero-policy design in full),
[edge-function-security.md](edge-function-security.md) (the other half of the access boundary — who
may invoke the functions that hold the service role).
