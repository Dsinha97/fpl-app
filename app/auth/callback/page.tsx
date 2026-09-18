"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

// Raw provider error codes from the OAuth redirect, not Supabase's own
// AuthError.code (see friendlyAuthError in app/signin/page.tsx, which maps a
// different shape) — mapped to plain language per this app's "say what the
// word means" convention rather than echoed as-is.
function friendlyOAuthCallbackError(code: string): string {
  switch (code) {
    case "access_denied":
      return "You cancelled sign-in at Google.";
    default:
      return "Something went wrong signing you in.";
  }
}

/**
 * Landing page for both the magic-link and Google redirects.
 * `detectSessionInUrl: true` (see lib/supabase/client.ts) makes supabase-js
 * exchange the PKCE code in the URL for a session automatically on load —
 * this page just waits for that to land via onAuthStateChange, rather than
 * re-implementing the exchange.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    // Magic link has no "decline" — Google does: cancelling at the consent
    // screen redirects here with ?error=access_denied&error_description=…
    // and no code at all, so neither onAuthStateChange nor getSession below
    // would ever fire, leaving "Signing you in…" spinning forever without
    // this check.
    //
    // This has to run inside the effect, not a useState lazy initializer:
    // the page is statically prerendered (no `window` at build time), so a
    // lazy initializer that reads location.search renders the error
    // synchronously on the client's first paint while the prerendered HTML
    // still says "Signing you in…" — a genuine hydration mismatch, caught by
    // testing this exact URL shape in the browser rather than assumed safe.
    const params = new URLSearchParams(window.location.search);
    const oauthErrorCode = params.get("error");
    if (oauthErrorCode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(friendlyOAuthCallbackError(oauthErrorCode));
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) router.replace("/team/");
    });

    // The exchange can already have completed before this effect subscribes
    // (fast networks), in which case no further SIGNED_IN event fires — so
    // also check the session directly.
    supabase.auth.getSession().then(({ data, error: err }) => {
      if (err) {
        setError("Something went wrong signing you in.");
        return;
      }
      if (data.session) router.replace("/team/");
    });

    // The token exchange can stall silently (network, provider outage) with
    // neither onAuthStateChange nor getSession ever resolving, leaving
    // "Signing you in…" spinning forever with no way out for the reader.
    const stallTimer = window.setTimeout(() => setStalled(true), 10_000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(stallTimer);
    };
  }, [router]);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      {error ? (
        <>
          <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
          <a
            href="/signin/"
            className="mt-4 text-sm text-purple-800 underline dark:text-primary"
          >
            Try again
          </a>
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-500">Signing you in…</p>
          {stalled && (
            <>
              <p className="mt-2 text-sm text-zinc-500">Taking longer than usual — try again.</p>
              <a
                href="/signin/"
                className="mt-2 text-sm text-purple-800 underline dark:text-primary"
              >
                Back to sign in
              </a>
            </>
          )}
        </>
      )}
    </main>
  );
}
