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
// verdict, and the difference is the reasoning rather than the tool.
//
// Class A (cron-only) functions: sync-bootstrap, sync-fixtures,
// sync-player-history, sync-live-gameweek, sync-news, sync-claimed-managers,
// generate-predictions, ingest-fpl-archive. The browser-invoked pair
// (sync-manager, sync-league-picks) uses verifyUser + a rate limit instead —
// see _shared/auth.ts and _shared/rate-limit.ts.

const HEADER = "x-cron-secret";

/**
 * Constant-time comparison. A naive `===` on a secret leaks its prefix
 * through response timing; the cost of doing it properly here is nil.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // Length is not itself secret, but bail *after* a fixed-cost pass so the
  // comparison below always runs over the same number of bytes.
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Returns a 401 `Response` when the caller is not cron, or null to proceed.
 * Call it immediately after `preflight(req)`, before any work.
 *
 * **Fails closed when CRON_SECRET is unset.** That is the deliberate choice
 * and it is also the failure mode to respect: deploy a function that requires
 * the header before `invoke_sync` sends it and every scheduled sync 401s,
 * silently, into `sync_runs` rows nobody is watching. The ordering in
 * docs/sprints/sprint-32.md exists for exactly this reason — secret, then
 * migration, then functions, then verify against `sync_runs`.
 */
export function verifyCron(req: Request): Response | null {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    // Loud in the function logs, silent in the response — an attacker learns
    // nothing about why they were turned away.
    console.error("CRON_SECRET is not set; rejecting every caller. See sprint-32.md step 1.");
    return unauthorized();
  }

  const supplied = req.headers.get(HEADER);
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
