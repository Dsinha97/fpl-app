-- Sprint 32 — `invoke_sync` sends the cron secret.
--
-- ============================ DEPLOYMENT ORDER ============================
-- This is STEP 2 of 4, and the order is not advisory. From sprint-32.md:
--
--   1. Create the Vault secret `cron_secret`, generated inside Postgres so
--      the value never exists anywhere else (see step 1's migration).
--   2. Apply THIS migration. Cron now sends a header the deployed functions
--      still ignore. Harmless — that is the point of doing it second.
--   3. Deploy the Class A functions, which then require the header.
--   4. Verify against `sync_runs` before walking away. `sync-live-gameweek`
--      runs every 2 minutes and is the fastest signal.
--
-- Deploying 3 before 2 makes every scheduled sync 401 — *silently*, into
-- sync_runs rows nobody is watching. That is the exact failure mode Sprint 31
-- named when it rejected Vault for the publishable key, and it is the reason
-- this file exists separately from the function deploy.
--
-- Rollback reverses 3 then 2, in that order, for the same reason.
-- ==========================================================================
--
-- Why Vault here when Sprint 31 said no to Vault for the publishable key: the
-- publishable key has an identical public copy in the browser bundle, so
-- hiding the repo's copy changed nothing about who could call the endpoint.
-- This secret has no public copy anywhere, so hiding it *is* the mechanism.
-- Same tool, opposite verdict, and the difference is the reasoning.
--
-- Both ends read Vault: this function to send the header, and
-- _shared/cron-auth.ts to check it. There is deliberately no CRON_SECRET
-- function env var — that would need the plaintext to exist in a third place
-- on the way to matching this one, and two copies that must match by hand is
-- a silent 401 waiting on a typo.
--
-- The publishable-key Authorization header stays. It is what satisfies the
-- platform's own gateway; the cron secret is what the function checks.

create or replace function public.invoke_sync(p_function text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id bigint;
  v_secret     text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret';

  if v_secret is null then
    -- Loud, and refuses to make the call. A sync that never fires is a
    -- missing sync_runs row; a sync fired without the header is a 401 that
    -- looks like the function is broken. The first is easier to diagnose.
    raise exception 'vault secret "cron_secret" is not set - see sprint-32.md step 1';
  end if;

  select net.http_post(
    url     := 'https://fyxyqxpscmqjyjxsyhms.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer sb_publishable_EyX73kWWpruC-B_QZbcZ9A_Ax6a1OKx',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_sync(text) from public, anon, authenticated;

-- ------------------------------------------------- the checking half
--
-- The Edge Functions cannot read Vault directly. PostgREST only serves the
-- schemas it is configured to expose (public, graphql_public by default) and
-- vault is not among them, so a db.schema("vault").from("decrypted_secrets")
-- from a function fails at the API layer whatever the service role's table
-- privileges say. Checked before relying on it rather than after.
--
-- Exposing vault to PostgREST to work around that would widen the REST
-- surface to the secret store for the sake of one lookup. This shape is
-- better anyway: the function asks a yes/no question and gets a yes/no
-- answer, so the secret never leaves Postgres even to the caller checking it.

create or replace function public.verify_cron_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if p_secret is null or length(p_secret) = 0 then
    return false;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret';

  if v_secret is null then
    return false;
  end if;

  -- Compare digests, not the raw values. Postgres has no timing-safe
  -- comparison primitive, and = on text short-circuits at the first differing
  -- byte, which leaks the length of a correct prefix to anyone willing to
  -- measure. Two sha256 digests differ from byte 0 for any wrong input.
  return extensions.digest(v_secret, 'sha256') = extensions.digest(p_secret, 'sha256');
end;
$$;

-- Only the service role (the Edge Functions) may ask. Nothing reachable with
-- the publishable key can call this, so it is not an oracle for guessing the
-- secret from the open internet.
revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;
