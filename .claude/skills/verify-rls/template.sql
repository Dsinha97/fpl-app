-- Verify RLS on {{TABLE}} does not leak {{ROW_OWNER_ID}}'s row to {{OTHER_USER_ID}}.
-- Fill in the placeholders, then run this whole block through execute_sql.
-- It always rolls back -- nothing here persists.

begin;

-- Simulate an anonymous request.
select set_config('request.jwt.claims', '', true);
set local role anon;

select count(*) as anon_visible_rows
from {{TABLE}}
where {{OWNER_COLUMN}} = '{{ROW_OWNER_ID}}';
-- expect 0 unless this table is public-read by design

-- Simulate a different authenticated user.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '{{OTHER_USER_ID}}', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select count(*) as other_user_visible_rows
from {{TABLE}}
where {{OWNER_COLUMN}} = '{{ROW_OWNER_ID}}';
-- expect 0 for owner-scoped tables

-- Attempted write as the other user (should be rejected / 0 rows affected).
update {{TABLE}}
set {{OWNER_COLUMN}} = {{OWNER_COLUMN}}
where {{OWNER_COLUMN}} = '{{ROW_OWNER_ID}}';

rollback;
