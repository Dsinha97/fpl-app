"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";

/**
 * Google OAuth is the primary path — Supabase's built-in email sender has a
 * project-wide hourly cap ("over_email_send_rate_limit") that is only
 * changeable with a custom SMTP setup, which this app deliberately doesn't
 * have (sender verification wants a domain we don't own — see
 * docs/roadmap.md, "Sprint 14"). Magic link stays as a fallback that needs
 * no provider setup, with its two most common failure codes explained
 * instead of echoed as Supabase's raw error string.
 */
function friendlyAuthError(error: AuthError): string {
  switch (error.code) {
    case "over_email_send_rate_limit":
      return "This app's email sender has hit its hourly limit — use Continue with Google above instead, or try email again in a bit.";
    case "email_address_invalid":
      return "That email address was rejected — double-check it, or use Continue with Google above.";
    default:
      return error.message;
  }
}

/**
 * Sign-in: Google OAuth first, email magic link as a fallback. No password
 * anywhere in this app — the static export has no server to hash one
 * against, and a passwordless flow needs no reset screen either.
 * `redirectTo`/`emailRedirectTo` must end in the trailing slash
 * `trailingSlash: true` gives every route, or the callback 404s.
 */
export default function SignInPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  // A redirect belongs in an effect, not the render body — calling
  // router.replace() while rendering is a setState-on-a-different-component
  // during render, which React flags (and which a signed-out-only test pass
  // never exercises, since it only fires on the "already signed in" branch).
  useEffect(() => {
    if (!loading && user) router.replace("/team/");
  }, [loading, user, router]);

  if (!loading && user) {
    return null;
  }

  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/auth/callback/` : undefined;

  const onGoogle = async () => {
    setGoogleBusy(true);
    setError(null);
    // This navigates the whole page away to Google, so there is no "finally"
    // to reset googleBusy on success — only the error path returns here.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setError(error.message);
      setGoogleBusy(false);
    }
  };

  // Shares one project-wide hourly quota across every real user — see
  // CLAUDE.md's "Magic-link testing shares one project-wide email quota" for
  // why testing this path should send at most once per session and prefer
  // the Google button above for anything repeated.
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });

    setSending(false);
    if (error) setError(friendlyAuthError(error));
    else setSent(true);
  };

  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-zinc-500">No password to set or remember.</p>

      <button
        type="button"
        onClick={() => void onGoogle()}
        disabled={googleBusy}
        className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:hover:bg-purple-950/60"
      >
        <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62Z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18Z"
          />
          <path
            fill="#FBBC05"
            d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33Z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
          />
        </svg>
        {googleBusy ? "Redirecting…" : "Continue with Google"}
      </button>

      <div className="mt-5 flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-purple-900/40" />
        or use email
        <span className="h-px flex-1 bg-zinc-200 dark:bg-purple-900/40" />
      </div>

      {sent ? (
        <p className="mt-6 rounded-md border border-purple-200 bg-purple-50 px-3 py-3 text-sm text-purple-900 dark:border-purple-800/50 dark:bg-purple-950/40 dark:text-purple-200">
          Check <span className="font-medium">{email}</span> for a sign-in link. It expires after a
          short while, so use it soon.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus:border-[#00FF87]"
          />
          <button
            type="submit"
            disabled={sending}
            className="w-full rounded-md bg-purple-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-800 disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
          >
            {sending ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </main>
  );
}
