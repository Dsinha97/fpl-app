-- The xP model's own probability that a player features at all (v1.7.0,
-- Sprint 43): the start state plus the cameo state of `minuteStates`
-- (supabase/functions/_shared/xp-model.ts). Stored so lib/lineup.ts's bench
-- odds read the model's figure instead of re-deriving it as
-- expected_minutes / 72, the pre-v1.7.0 rule ("one quantity, one
-- implementation"). Nullable: rows written before generate-predictions
-- v1.7.0 have no value, and readers fall back to the old rule for them.
--
-- Additive only. Both tables keep their existing public-read/service-write
-- policies, which are table-level and need no change for a new column. The
-- archive gets it too because generate-predictions writes the archive from
-- the same row objects as player_predictions.

alter table public.player_predictions
  add column if not exists appearance_probability numeric;

alter table public.player_prediction_archive
  add column if not exists appearance_probability numeric;

comment on column public.player_predictions.appearance_probability is
  'P(any minutes) from the xP model''s start + cameo minute states (v1.7.0+). Null before v1.7.0.';
comment on column public.player_prediction_archive.appearance_probability is
  'P(any minutes) from the xP model''s start + cameo minute states (v1.7.0+). Null before v1.7.0.';
