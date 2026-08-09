-- Sprint 14 — Authentication & Team Sync: ownership schema.
--
-- The first tables in this schema with RLS policies beyond "Public read".
-- Every table here carries a `user_id` owned by `auth.users` and is scoped to
-- `auth.uid()` in both directions (using + with check), unlike every prior
-- table which is public-read / service-write only. See docs/roadmap.md,
-- "Sprint 14", for why this shape rather than the roadmap's original
-- `team_drafts` / `draft_players` / `draft_lineups` split: a draft is always
-- read and written whole (nothing queries by a contained player), so
-- `team_drafts.players` is jsonb rather than a normalised child table with a
-- hard FK to `players(season, id)` that a season rollover would strand —
-- exactly the trap `manager_picks` already has.

-- --------------------------------------------------------- user_profiles
-- Links a Supabase user to the FPL manager they've claimed. One row per
-- user, created on first save rather than on sign-up, since claiming an
-- entry is optional.

create table public.user_profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  entry_id   integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_profiles_set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------- team_drafts
-- One row per draft, mirroring lib/team-state.ts's TeamState shape as jsonb.
-- draft_id is the client-generated crypto.randomUUID() from lib/drafts.ts, so
-- it is already globally unique and is the primary key directly rather than
-- a separate surrogate id.
--
-- deleted_at is a tombstone, not an actual delete: without it, a delete made
-- on one device would be resurrected the next time another device pulls and
-- merges (lib/draft-sync.ts's mergeDrafts only ever compares updatedAt).

create table public.team_drafts (
  draft_id   uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  payload    jsonb not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index team_drafts_user_id_idx on public.team_drafts (user_id);

create trigger team_drafts_set_updated_at before update on public.team_drafts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- draft_snapshots
-- The save-history timeline, mirroring lib/drafts.ts's DraftSnapshot. Trimmed
-- to HISTORY_LIMIT (20) per draft by the application, the same way the
-- localStorage version is trimmed — no DB-side cap, so this stays a plain
-- append-only log the app prunes rather than something a trigger has to get
-- exactly right.

create table public.draft_snapshots (
  id         bigint generated always as identity primary key,
  draft_id   uuid not null references public.team_drafts (draft_id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  at         timestamptz not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create index draft_snapshots_draft_id_idx on public.draft_snapshots (draft_id, at);

-- ----------------------------------------------------------- manager_rivals
-- Replaces the global `select * from managers` scan app/team/page.tsx used
-- for its rivals table — harmless with one connected manager, wrong the
-- moment there are accounts, since it would show every user's entry to
-- every other user. This is an explicitly-added set instead.

create table public.manager_rivals (
  user_id    uuid    not null references auth.users (id) on delete cascade,
  entry_id   integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, entry_id)
);

-- ------------------------------------------------------------------ RLS
--
-- Every table: RLS enabled, four policies scoped to auth.uid() = user_id in
-- both directions. Unlike the "Public read" tables elsewhere in this schema,
-- these have no anon access at all — a signed-out visitor sees nothing.

alter table public.user_profiles    enable row level security;
alter table public.team_drafts      enable row level security;
alter table public.draft_snapshots  enable row level security;
alter table public.manager_rivals   enable row level security;

create policy "Select own" on public.user_profiles
  for select to authenticated using (auth.uid() = user_id);
create policy "Insert own" on public.user_profiles
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Update own" on public.user_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own" on public.user_profiles
  for delete to authenticated using (auth.uid() = user_id);

create policy "Select own" on public.team_drafts
  for select to authenticated using (auth.uid() = user_id);
create policy "Insert own" on public.team_drafts
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Update own" on public.team_drafts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own" on public.team_drafts
  for delete to authenticated using (auth.uid() = user_id);

create policy "Select own" on public.draft_snapshots
  for select to authenticated using (auth.uid() = user_id);
create policy "Insert own" on public.draft_snapshots
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Delete own" on public.draft_snapshots
  for delete to authenticated using (auth.uid() = user_id);

create policy "Select own" on public.manager_rivals
  for select to authenticated using (auth.uid() = user_id);
create policy "Insert own" on public.manager_rivals
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Delete own" on public.manager_rivals
  for delete to authenticated using (auth.uid() = user_id);
