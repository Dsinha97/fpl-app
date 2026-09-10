-- Drop the `league_type` CHECK on manager_leagues.
--
-- Sprint 21 wrote `check (league_type in ('s', 'x'))` because those were the
-- only two values the API had ever returned. On 2026-09-10 a rival sync failed:
--
--   manager_leagues: new row for relation "manager_leagues" violates
--   check constraint "manager_leagues_league_type_check"
--
-- Probed against the live API rather than guessed at. Entry 6804945 holds 35
-- classic leagues: 28 `x`, 6 `s`, and **one `c`** (league 1508153). So FPL has
-- a third value and this schema forbade it.
--
-- The damage was out of all proportion to the cause. `manager_leagues` is
-- upserted early in syncManagerData, before season history, gameweek history,
-- chips, transfers and picks — so one unrecognised league_type on one league
-- aborted that manager's ENTIRE sync. A cosmetic classification field took
-- down the data the app actually scores with.
--
-- Dropping rather than widening to `('s','x','c')`, deliberately:
--
--   * FPL owns this value, not us. Widening the list re-arms exactly the same
--     trap for whatever the fourth value turns out to be, and the next failure
--     would look just as much like a mystery as this one did.
--   * The value's only consumer is a display grouping. The cost of an
--     unexpected one is a league in the wrong bucket, not a wrong number —
--     nothing scored depends on it.
--   * It matches the precedent this codebase already set for third-party
--     enums: `TeamState.activeChip` is deliberately an untyped string because
--     "FPL owns the value", with `chipLabel` falling back to the raw slug
--     rather than throwing. Same reasoning, same shape.
--
-- The UI is updated alongside so an unknown type is *shown* rather than
-- silently filtered out of both groups (components/manager-leagues.tsx).

alter table public.manager_leagues
  drop constraint if exists manager_leagues_league_type_check;

comment on column public.manager_leagues.league_type is
  'FPL''s own league classification, stored as sent. Known values: s = system '
  '(general/broadcaster), x = invitational, c = observed 2026-09-10, purpose '
  'undocumented. Deliberately unconstrained: FPL owns this enum, and a CHECK '
  'here once aborted whole manager syncs over a display field.';
