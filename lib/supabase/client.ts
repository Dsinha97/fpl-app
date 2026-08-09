import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Auth options below are supabase-js's own defaults today, made explicit
// because Sprint 14 is the first thing in this app that actually uses a
// session — persistSession/autoRefreshToken stop being incidental the moment
// sign-in is real, and flowType: "pkce" is required for the magic-link
// callback (app/auth/callback) to exchange its code client-side, since a
// static export has no server to do it for us.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
