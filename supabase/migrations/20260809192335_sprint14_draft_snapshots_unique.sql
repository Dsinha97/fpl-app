-- Sprint 14 follow-up — enforce one snapshot per draft per timestamp.
--
-- draft_snapshots_draft_id_idx (non-unique, from sprint14_auth_ownership) let
-- two snapshots land at the same `at` for the same draft when a sync raced
-- with itself, silently duplicating history. Replace it with a unique index
-- so a repeat write at the same instant is rejected instead of appended
-- twice.

drop index if exists public.draft_snapshots_draft_id_idx;

create unique index draft_snapshots_draft_id_at_idx
  on public.draft_snapshots (draft_id, at);
