// fpl-session
//
// Stores (POST) or revokes (DELETE) the owner's pasted FPL session, at rest
// encrypted (AES-256-GCM, ../_shared/crypto.ts) under FPL_SESSION_ENC_KEY.
//
// Automated FPL credential login is blocked by the identity provider's own
// configuration (PingOne, no password grant, the only reachable flow opens
// with bot-detection) — see docs/roadmap.md, "Sprint 14". This is the
// buildable alternative instead: sign in to FPL in your own browser exactly
// as you always do — Google, 2FA, whatever — then copy the Cookie header
// your browser sends on an authenticated request to fantasy.premierleague.com
// (devtools -> Network -> any /api/ request -> Request Headers -> Cookie)
// and paste it here once. No FPL password ever reaches this function or is
// ever written anywhere, encrypted or not.
//
// Unlike sync-manager (which writes only public FPL data, so any caller
// triggering it is harmless), this function verifies the caller's Supabase
// JWT — it is reading and writing a table keyed by Supabase user.

import { jsonResponse, preflight, serviceClient } from "../_shared/sync.ts";
import { verifyUser } from "../_shared/auth.ts";
import { encryptSecret } from "../_shared/crypto.ts";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const user = await verifyUser(req);
  if (!user) return jsonResponse({ ok: false, error: "Sign in required" }, 401);

  const db = serviceClient();

  if (req.method === "DELETE") {
    const { error } = await db.from("fpl_sessions").delete().eq("user_id", user.id);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    return jsonResponse({ ok: true, revoked: true });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const body = await req.json().catch(() => ({}));
  const session = typeof (body as { session?: unknown }).session === "string"
    ? (body as { session: string }).session.trim()
    : "";

  if (session.length === 0) {
    return jsonResponse({ ok: false, error: "Paste your FPL session cookie value first" }, 400);
  }

  let encrypted: { ciphertext: string; iv: string };
  try {
    encrypted = await encryptSecret(session);
  } catch (err) {
    // Deliberately never logs `session` itself — only that encryption
    // failed, e.g. a missing/malformed FPL_SESSION_ENC_KEY secret.
    console.error(`fpl-session encrypt failed: ${(err as Error).message}`);
    return jsonResponse({ ok: false, error: "Server is not configured to store this yet" }, 500);
  }

  const { error } = await db.from("fpl_sessions").upsert(
    {
      user_id: user.id,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      expires_at: null,
    },
    { onConflict: "user_id" },
  );
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true });
});
