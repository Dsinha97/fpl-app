-- Re-seed the dev-only test account. Run with Supabase MCP `execute_sql`,
-- NEVER `apply_migration` — this row carries a password hash and must not
-- enter shared migration history.
--
-- Replace <TEST_USER_PASSWORD> with the value from .env.local before running.
-- Fixed uuid so the id in SKILL.md, verify-rls and docs stays valid.

with new_user as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    '6254e573-8cea-402c-b330-b2a8f3cae5d7',
    'authenticated', 'authenticated',
    'test@fpldecision.com',
    extensions.crypt('<TEST_USER_PASSWORD>', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"FPL Test Account"}'::jsonb,
    '', '', '', ''
  )
  returning id, email
), new_identity as (
  -- Newer GoTrue rejects the password grant without a matching identity row.
  insert into auth.identities (provider_id, user_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  select u.email, u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email,
                            'email_verified', true, 'phone_verified', false),
         'email', now(), now(), now()
  from new_user u
  returning user_id
), new_profile as (
  -- Claim manager 274486 so signed-in pages render real data, not empty states.
  insert into public.user_profiles (user_id, entry_id)
  select id, 274486 from new_user
  returning user_id
)
select id as test_user_id, email from new_user;

-- Tear-down (cascades to identities, user_profiles, drafts, rivals):
-- delete from auth.users where email = 'test@fpldecision.com';
