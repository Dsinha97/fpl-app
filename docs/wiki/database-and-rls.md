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
[fpl-authentication.md](fpl-authentication.md) (`fpl_sessions`' zero-policy design in full).
