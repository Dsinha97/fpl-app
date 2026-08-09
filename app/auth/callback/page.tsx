"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

/**
 * Landing page for the magic-link redirect. `detectSessionInUrl: true` (see
 * lib/supabase/client.ts) makes supabase-js exchange the PKCE code in the URL
 * for a session automatically on load — this page just waits for that to
 * land via onAuthStateChange, rather than re-implementing the exchange.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) router.replace("/team/");
    });

    // The exchange can already have completed before this effect subscribes
    // (fast networks), in which case no further SIGNED_IN event fires — so
    // also check the session directly.
    supabase.auth.getSession().then(({ data, error: err }) => {
      if (err) {
        setError(err.message);
        return;
      }
      if (data.session) router.replace("/team/");
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      {error ? (
        <>
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Sign-in failed: {error}
          </p>
          <a
            href="/signin/"
            className="mt-4 text-sm text-purple-800 underline dark:text-[#00FF87]"
          >
            Try again
          </a>
        </>
      ) : (
        <p className="text-sm text-zinc-500">Signing you in…</p>
      )}
    </main>
  );
}
