// Rejects anything that is not the database's own cron.
//
// Sprint 32. Every `sync-*` function authenticated with the publishable key
// and nothing else, and that key is public by design — an identical copy
// ships in the browser bundle on fpldecision.com. So "callable by anyone
// holding the publishable key" meant, in practice, callable by anyone who
// opens devtools, and would mean callable by anyone scraping the repo once it
// goes public. The blast radius is bounded (every sync is idempotent, reads
// public FPL data, writes public tables) but the cost is real: Supabase
// invocations and egress on this project's bill, plus FPL API traffic
// attributed to this project, which is how a project gets throttled.
//
// The fix is a second header that has no public copy. Note the deliberate
// contrast with Sprint 31, which *rejected* Vault for the publishable key:
// hiding a value that already ships in the browser changes nothing about who
// can call the endpoint. Here the value has no public copy anywhere, so
// hiding it is the entire mechanism rather than theatre. Same tool, opposite
// verdict, and the difference is the reasoning.
//
// Class A (cron-only) functions: sync-bootstrap, sync-fixtures,
// sync-player-history, sync-live-gameweek, sync-news, sync-claimed-managers,
// generate-predictions, ingest-fpl-archive. The browser-invoked pair
// (sync-manager, sync-league-picks) uses verifyUser + a rate limit instead —
// see _shared/auth.ts and _shared/rate-limit.ts.
//
// ---------------------------------------------------------------------------
// Where the secret lives, and why this is an RPC
//
// The scope doc assumed `CRON_SECRET` as a deployed function secret. That
// works, but it requires the plaintext to exist in a third place — a shell
// command, a dashboard field, someone's clipboard — on the way to matching
// the Vault copy `invoke_sync` reads. CLAUDE.md's rule is that secrets are
// referenced by name only and never pasted anywhere, and a value that has to
// be typed into two places to match is also a silent 401 waiting on a typo.
//
// So the secret is generated *inside* Postgres and never leaves it. Nobody
// holds it: not the deployer, not this repo, not a CI variable.
// `invoke_sync` (security definer) reads it to send the header; this asks
// `public.verify_cron_secret` whether the header matches and gets a boolean.
//
// The indirection is not optional. Reading Vault straight from here does not
// work: PostgREST only serves the schemas it is configured to expose
// (`public`, `graphql_public`), and `vault` is not one of them, so
// `db.schema("vault")` fails at the API layer whatever the service role's
// table privileges say — checked before relying on it. Exposing `vault` to
// PostgREST to avoid one RPC would widen the REST surface to the secret store,
// which is a bad trade. It is the better shape regardless: a yes/no question
// gets a yes/no answer, and the secret is never sent to the thing checking it.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const HEADER = "x-cron-secret";

/**
 * Returns a 401 `Response` when the caller is not cron, or null to proceed.
 * Call it immediately after `serviceClient()`, before any work — before the
 * URL is parsed, so `?force=1` is closed rather than merely guarded.
 *
 * **Fails closed on anything unexpected**, including the RPC being absent or
 * erroring. That is the deliberate choice, and it is also the failure mode to
 * respect: deploy a function that requires the header before `invoke_sync`
 * sends it and every scheduled sync 401s, silently, into `sync_runs` rows
 * nobody is watching. The ordering in docs/sprints/sprint-32.md exists for
 * exactly this reason — secret, then migrations, then functions, then verify
 * against `sync_runs`.
 *
 * Not cached. One RPC per invocation is the honest cost of never holding the
 * secret in this process, and the busiest of these functions runs every two
 * minutes — not a rate worth trading a cached copy of a secret for.
 */
export async function verifyCron(req: Request, db: SupabaseClient): Promise<Response | null> {
  const supplied = req.headers.get(HEADER);
  if (!supplied) return unauthorized();

  const { data, error } = await db.rpc("verify_cron_secret", { p_secret: supplied });

  if (error) {
    // Loud in the function logs, silent in the response — an attacker learns
    // nothing about why they were turned away.
    console.error(`verify_cron_secret failed: ${error.message}`);
    return unauthorized();
  }

  return data === true ? null : unauthorized();
}

function unauthorized(): Response {
  // No CORS headers: a cron-only function has no browser caller to inform.
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
