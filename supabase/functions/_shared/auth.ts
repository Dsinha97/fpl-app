// Verifies a Supabase JWT sent from the browser. Most Edge Functions in this
// app (sync-manager, sync-bootstrap, ...) write only public data from public
// FPL endpoints and deliberately skip this — a sync triggered by any visitor
// is harmless. fpl-session and fpl-my-team are different: they read and
// write data keyed by Supabase user, so they must know who is actually
// calling before touching anything.

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
