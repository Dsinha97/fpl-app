// Verifies a Supabase JWT sent from the browser.
//
// This used to say that most functions deliberately skip it because "a sync
// triggered by any visitor is harmless". That premise expired in Sprint 32.
// It was an argument about *disclosure* — the data really is public — but not
// about *abuse*: an unauthenticated endpoint that pulls from the FPL API and
// writes to Postgres costs invocations, egress and FPL traffic on this
// project's bill, and a public repo gets its endpoints scraped mechanically
// in a way a minified bundle does not.
//
// Every function is now gated, by one of two mechanisms depending on who
// legitimately calls it:
//
//   - Cron-only (the eight `sync-*`/`generate-*`/`ingest-*` functions no
//     browser has any business calling) → `verifyCron` in _shared/cron-auth.ts.
//   - Browser-invoked (`sync-manager`, `sync-league-picks`) → `verifyUser`
//     below, plus a per-user rate limit in _shared/rate-limit.ts, because
//     "anyone with an account" is not by itself a bound when accounts are free.
//
// `fpl-session` and `fpl-my-team` have always called this: they read and
// write data keyed by Supabase user, so they must know who is calling before
// touching anything.

import { createClient } from "jsr:@supabase/supabase-js@2";

export async function verifyUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice("Bearer ".length);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not set");

  // A plain anon-key client, not the service client — auth.getUser validates
  // the JWT's signature against Supabase Auth rather than trusting it blind.
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { id: data.user.id };
}
