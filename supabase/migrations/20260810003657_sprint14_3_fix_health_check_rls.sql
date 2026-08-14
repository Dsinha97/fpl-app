-- Sprint 14.3 follow-up — health_check's read policy was scoped to `anon`
-- only (from create_health_check), so a signed-in read of app/status got
-- zero rows instead of the health row: a policy granted `to anon` does not
-- cover the `authenticated` role. Broaden the read policy to both roles;
-- still select-only, no write policy.

drop policy "Allow public read of health_check" on public.health_check;

create policy "Public read" on public.health_check
  for select to anon, authenticated using (true);
