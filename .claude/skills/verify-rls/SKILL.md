---
name: verify-rls
description: Verify a Row Level Security policy by simulating anon and authenticated roles inside a rolled-back transaction. Use when asked to "check RLS", "verify this policy", "test row level security", or after any migration that adds or changes a policy.
---

# Verify RLS

CLAUDE.md calls this "the load-bearing check" — never trust a new RLS policy without
running it, and never test only the role the feature you're building happens to exercise.

## Procedure

1. Copy `template.sql` and fill in the placeholders:
   - `{{TABLE}}` — the table being checked
   - `{{OWNER_COLUMN}}` — usually `user_id`
   - `{{ROW_OWNER_ID}}` — a real UUID that owns a row in the table
   - `{{OTHER_USER_ID}}` — a different real UUID who should NOT see that row
2. Run it through the Supabase MCP `execute_sql` tool exactly as-is — it's wrapped in
   `begin ... rollback`, so nothing persists.
3. It simulates `anon` and a different `authenticated` user in turn, and attempts a read
   and a write against the target row for each.
4. Expect **zero rows / zero writes** in both simulated roles unless the table is
   intentionally public-read (pre-Sprint-14 tables use `to anon, authenticated using
   (true)` by design — check CLAUDE.md before treating that as a failure).
5. If anything leaks, the policy is wrong — fix the migration and re-run before moving on,
   not after shipping.
