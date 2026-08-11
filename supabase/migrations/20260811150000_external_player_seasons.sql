-- Championship cold-start priors (Sprint 15.6): raw external player-season
-- stats from FootyStats PDFs, one-shot captured 2026-08-05 for COV/HUL/IPS
-- (see docs/Promoted Team Data/ and scripts/extract-footystats.ts).
--
-- Named for what it is, not what it isn't: FootyStats is not Opta, and the
-- table only ever holds one provider's raw numbers, never a translated
-- value — translation (league lambda) is a model concern applied in
-- xp-model.ts, not stored here, so the raw input and its derivation never
-- drift apart. This table does not touch `rate_priors` (the fitted
-- empirical-Bayes prior table already in use since v1.1.0) and is not
-- consumed anywhere until generate-predictions is wired to read it.
--
-- `player_code` is nullable and every row is kept regardless of match
-- outcome — an unmatched player is reported via `matched_by = 'unmatched'`,
-- never silently dropped. A plain (non-primary-key) unique constraint is
-- used rather than a primary key including `player_code`, because Postgres
-- primary keys cannot contain null columns while a unique constraint can
-- (multiple nulls don't conflict).
create table public.external_player_seasons (
  id                   bigint generated always as identity primary key,
  provider             text not null,
  league               text not null,
  season               text not null,
  player_code          integer,
  player_name_source   text not null,
  origin_club          text not null,
  position             text,

  -- How player_code was resolved. 'auto' = token-overlap match against
  -- players.first_name/second_name/web_name scoped to origin_club, score
  -- >= 0.8; 'manual' = hand-verified by name (nickname, typo, or an
  -- apostrophe FootyStats' PDF export strips); 'unmatched' = no
  -- corresponding row in `players` found at all — kept for visibility
  -- rather than dropped. See scripts/match-and-gate.ts.
  matched_by           text not null check (matched_by in ('auto', 'manual', 'unmatched')),
  match_confidence     text check (match_confidence in ('high', 'medium')),

  matches_played       integer,
  matches_started      integer,
  minutes              integer,
  minutes_per_appearance numeric(5,1),

  -- Raw per-90 rates as printed on the PDF. No translated_* columns —
  -- translation happens once, in xp-model.ts, using the fitted lambda in
  -- MODEL_PARAMS.leagueTranslation, so this table always answers "what did
  -- FootyStats print" and nothing else.
  xg90                 numeric(5,3),
  npxg90               numeric(5,3),
  xa90                 numeric(5,3),
  goals90              numeric(5,3),
  assists90            numeric(5,3),
  tackles90            numeric(5,3),
  interceptions90      numeric(5,3),
  clearances90         numeric(5,3),
  shots_blocked90      numeric(5,3),
  crosses90            numeric(5,3),
  cards90              numeric(5,3),
  saves90              numeric(5,3),
  save_pct             numeric(5,2),
  goals_conceded90     numeric(5,3),
  clean_sheet_pct      numeric(5,2),

  captured_at          date not null,
  source_file          text not null,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (provider, league, season, player_code)
);

create trigger external_player_seasons_set_updated_at before update on public.external_player_seasons
  for each row execute function public.set_updated_at();

alter table public.external_player_seasons enable row level security;
create policy "Public read" on public.external_player_seasons for select to anon, authenticated using (true);
