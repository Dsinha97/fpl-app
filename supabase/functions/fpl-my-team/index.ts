// fpl-my-team
//
// Reads the signed-in user's claimed entry (user_profiles.entry_id) and
// their decrypted FPL session, then calls the verified-live endpoint
//   GET https://fantasy.premierleague.com/api/my-team/{entry_id}/
// for real purchase prices, bank and free transfers — this is what
// IMPORTED_SQUAD_NOTE (lib/fpl-squad.ts) says would replace its now_cost
// fallback. Confirmed live on 2026-08-09: unauthenticated it returns
// `403 {"detail":"Authentication credentials were not provided."}`, a real
// Django-REST endpoint that needs only a session — which is what makes this
// handoff viable at all.
//
// Deliberately NOT `/drf/my-team/<id>` — the path the widely-cited 2019
// guide uses. That prefix is dead and returns a misleading `200`: a
// 10,032-byte SPA shell with content-type text/html, Fastly's response for
// any unmatched path. See docs/roadmap.md, "Sprint 14", for the full probe.

import { jsonResponse, preflight, serviceClient } from "../_shared/sync.ts";
import { verifyUser } from "../_shared/auth.ts";
import { decryptSecret } from "../_shared/crypto.ts";

const USER_AGENT = "fpl-app/0.1 (+https://fpl-app.deepayansinha.workers.dev)";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const user = await verifyUser(req);
  if (!user) return jsonResponse({ ok: false, error: "Sign in required" }, 401);

  const db = serviceClient();

  const { data: profile } = await db
    .from("user_profiles")
    .select("entry_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.entry_id) {
    return jsonResponse({ ok: false, error: "Claim your FPL entry on /team first" }, 400);
  }

  const { data: sessionRow } = await db
    .from("fpl_sessions")
    .select("ciphertext, iv")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sessionRow) {
    return jsonResponse(
      {
        ok: false,
        error: "lapsed",
        message: "No FPL session saved yet — add one in Settings → FPL Account.",
      },
      401,
    );
  }

  let cookie: string;
  try {
    cookie = await decryptSecret(sessionRow.ciphertext, sessionRow.iv);
  } catch (err) {
    console.error(`fpl-my-team decrypt failed: ${(err as Error).message}`);
    return jsonResponse({ ok: false, error: "Could not read the saved session" }, 500);
  }

  let res: Response;
  try {
    res = await fetch(`https://fantasy.premierleague.com/api/my-team/${profile.entry_id}/`, {
      headers: { Cookie: cookie, "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: `Could not reach FPL: ${(err as Error).message}` }, 502);
  }

  // Expiry is a first-class state, not a crash: a lapsed session gets a
  // 401/403 from FPL's Django-REST layer, or — the trap this app's own probe
  // caught — a misleading 200 whose content-type is text/html rather than
  // JSON (the SPA shell served for any unmatched/unauthenticated path on
  // this host). Both read as "lapsed" here, never as silently-empty data
  // that would make an imported squad's sell prices quietly wrong.
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 401 || res.status === 403 || !contentType.includes("application/json")) {
    return jsonResponse(
      {
        ok: false,
        error: "lapsed",
        message: "Your FPL session has expired — paste a fresh one in Settings → FPL Account.",
      },
      401,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return jsonResponse(
      { ok: false, error: `FPL returned ${res.status}`, detail: text.slice(0, 200) },
      502,
    );
  }

  const myTeam = await res.json();
  return jsonResponse({ ok: true, entry_id: profile.entry_id, myTeam });
});
