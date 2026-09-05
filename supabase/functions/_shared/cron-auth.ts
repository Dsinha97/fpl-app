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
// Where the secret lives, and why it is not a function env var
//
// The scope doc assumed `CRON_SECRET` as a deployed function secret. That
// works, but it requires the plaintext to exist in a third place — a shell
// command, a dashboard field, someone's clipboard — on the way to matching
// the Vault copy that `invoke_sync` reads. CLAUDE.md's rule is that secrets
// are referenced by name only and never pasted anywhere, and a value that has
// to be typed into two places to match is also a silent-401 waiting on a
// typo.
//
// So the secret is generated *inside* Postgres and read from Vault at both
// ends: `invoke_sync` (security definer) reads it to send the header, and
// this reads it to check the header. It is never known outside the database —
// not by the deployer, not by this repo, not by a CI variable. `service_role`
// already has select on `vault.decrypted_secrets` (verified, not assumed),
// and these functions hold service_role regardless, so this grants the
// function nothing it did not already have.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const HEADER = "x-cron-secret";
const SECRET_NAME = "cron_secret";

/**
 * Cached for the life of the isolate. Deno reuses an isolate across
 * invocations, so this is one read per cold start rather than one per
 * request. Only ever holds a value this process could read anyway.
 */
let cached: string | null = null;

/**
 * Constant-time comparison. A naive `===` on a secret leaks its prefix
 * through response timing; the cost of doing it properly here is nil.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // Length is not itself secret, but fold it in and still walk the full
  // width so the loop's cost does not depend on where the first difference
  // falls.
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function loadSecret(db: SupabaseClient): Promise<string | null> {
  if (cached !== null) return cached;
  const { data, error } = await db
    .schema("vault")
    .from("decrypted_secrets")
    .select("decrypted_secret")
    .eq("name", SECRET_NAME)
    .maybeSingle();
  if (error) {
    console.error(`vault read failed: ${error.message}`);
    return null;
  }
  const secret = (data?.decrypted_secret as string | undefined) ?? null;
  if (secret) cached = secret;
  return secret;
}

/**
 * Returns a 401 `Response` when the caller is not cron, or null to proceed.
 * Call it immediately after `serviceClient()`, before any work — before the
 * URL is parsed, so `?force=1` is closed rather than merely guarded.
 *
 * **Fails closed when the Vault secret is missing.** That is the deliberate
 * choice and it is also the failure mode to respect: deploy a function that
 * requires the header before `invoke_sync` sends it and every scheduled sync
 * 401s, silently, into `sync_runs` rows nobody is watching. The ordering in
 * docs/sprints/sprint-32.md exists for exactly this reason — secret, then
 * migration, then functions, then verify against `sync_runs`.
 */
export async function verifyCron(req: Request, db: SupabaseClient): Promise<Response | null> {
  const supplied = req.headers.get(HEADER);
  const expected = await loadSecret(db);

  if (!expected) {
    // Loud in the function logs, silent in the response — an attacker learns
    // nothing about why they were turned away.
    console.error(
      `vault secret "${SECRET_NAME}" is not set; rejecting every caller. See sprint-32.md step 1.`,
    );
    return unauthorized();
  }

  if (!supplied || !timingSafeEqual(supplied, expected)) return unauthorized();
  return null;
}

function unauthorized(): Response {
  // No CORS headers: a cron-only function has no browser caller to inform.
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
