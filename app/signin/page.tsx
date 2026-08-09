"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";

/**
 * Magic-link / email-OTP sign-in. No password anywhere in this app — the
 * static export has no server to hash one against, and a passwordless flow
 * needs no reset screen either. `emailRedirectTo` must end in the trailing
 * slash `trailingSlash: true` gives every route, or the callback 404s.
 */
export default function SignInPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) {
    router.replace("/team/");
    return null;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? `${window.location.origin}/auth/callback/` : undefined,
      },
    });

    setSending(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Enter your email and we&apos;ll send a magic link — no password to set or remember.
      </p>

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
