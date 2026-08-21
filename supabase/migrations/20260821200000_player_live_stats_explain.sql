-- Player detail panel follow-up (Sprint 13 continuation).
--
-- event/{id}/live/ already returns an exact per-stat points breakdown per
-- player (identifier/value/points, one entry per fixture for a DGW) —
-- sync-live-gameweek stored only the raw `stats` counts and dropped
-- `explain`. Storing FPL's own breakdown verbatim means the player detail
-- panel's live points table is FPL's arithmetic, not a second
-- reimplementation of scoring_rules' thresholds (CLAUDE.md: "one quantity,
-- one implementation").

alter table public.player_live_stats add column explain jsonb;

comment on column public.player_live_stats.explain is
  'FPL''s own event/{id}/live/ explain array, verbatim: [{fixture, stats: '
  '[{identifier, value, points, points_modification}]}]. Read-only provenance '
  'for the player detail panel''s live breakdown — never recomputed from '
  'scoring_rules.';
