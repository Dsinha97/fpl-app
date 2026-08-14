-- Sprint 14 — encrypted server-side storage for the FPL OIDC refresh token.
--
-- One row per user, holding an AES-256-GCM ciphertext + IV (never the
-- plaintext token) so supabase/functions/fpl-session and fpl-my-team can mint
-- bearer tokens without the browser ever holding the FPL refresh token
-- itself. RLS is enabled with no policies: only the service-role client
-- inside the edge functions (which bypasses RLS) reads or writes this table
-- — no authenticated or anon role has any access.

create table public.fpl_sessions (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  ciphertext text not null,
  iv         text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fpl_sessions enable row level security;

create trigger fpl_sessions_set_updated_at before update on public.fpl_sessions
  for each row execute function public.set_updated_at();
