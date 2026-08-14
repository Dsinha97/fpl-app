-- Defense in depth: fpl_sessions has RLS enabled with zero policies, which
-- already denies all client access by default. Make that an explicit,
-- declared policy rather than an implicit consequence of "no policy exists"
-- — a future migration that adds *any* permissive policy to this table
-- (e.g. copy-pasting the auth.uid() = user_id pattern from user_profiles)
-- would otherwise silently expose the encrypted FPL session ciphertext to
-- its owning user. Only the service-role client inside the fpl-session /
-- fpl-my-team edge functions (which bypasses RLS entirely) should ever
-- touch this table.

create policy "No client access"
  on public.fpl_sessions
  for all
  to authenticated, anon
  using (false)
  with check (false);
