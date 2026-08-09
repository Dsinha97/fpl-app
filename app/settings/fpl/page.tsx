"use client";

import { FormEvent, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { InfoTooltip } from "@/components/info-tooltip";

// Sprint 14, §F — the FPL session handoff. Automated FPL credential login is
// blocked by the identity provider's own configuration (PingOne, no
// password grant; the only reachable flow opens with bot-detection) — see
// docs/roadmap.md, "Sprint 14". This page is the buildable alternative: the
// owner signs in to FPL in their own browser exactly as they always do, then
// pastes the resulting session here once. It is encrypted at rest
// (supabase/functions/fpl-session) and used server-side
// (supabase/functions/fpl-my-team) to read real purchase prices, bank and
// free transfers — no FPL password ever reaches this app.

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

export default function FplSettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [session, setSession] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const invoke = async (method: "POST" | "DELETE" | "GET", fn: string, body?: unknown) => {
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession();
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${fn}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authSession?.access_token ?? ""}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return res.json();
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = session.trim();
    if (!trimmed) return;
    setStatus({ kind: "busy" });
    try {
      const result = await invoke("POST", "fpl-session", { session: trimmed });
      if (result.ok) {
        setSession("");
        setStatus({ kind: "ok", message: "Saved. Use “Test connection” to confirm it works." });
      } else {
        setStatus({ kind: "error", message: result.error ?? "Save failed" });
      }
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const onRevoke = async () => {
    setStatus({ kind: "busy" });
    try {
      const result = await invoke("DELETE", "fpl-session");
      setStatus(
        result.ok
          ? { kind: "ok", message: "Revoked. Nothing is stored anymore." }
          : { kind: "error", message: result.error ?? "Revoke failed" },
      );
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const onTest = useCallback(async () => {
    setStatus({ kind: "busy" });
    try {
      const result = await invoke("GET", "fpl-my-team");
      if (result.ok) {
        setStatus({
          kind: "ok",
          message: `Connected — bank £${((result.myTeam?.transfers?.bank ?? 0) / 10).toFixed(1)}m, ` +
            `${result.myTeam?.transfers?.limit ?? "?"} free transfer(s).`,
        });
      } else if (result.error === "lapsed") {
        // Temporary diagnostics from fpl-my-team while the paste-a-cookie
        // flow is new — upstream status/content-type only, never the cookie
        // or FPL's response body.
        const diag = result.upstream_status
          ? ` (FPL responded ${result.upstream_status}, content-type "${result.upstream_content_type}")`
          : result.reason === "no_session_saved"
            ? " (nothing saved server-side yet)"
            : "";
        setStatus({
          kind: "error",
          message: (result.message ?? "Session has lapsed — paste a fresh one.") + diag,
        });
      } else {
        setStatus({ kind: "error", message: result.message ?? result.error ?? "Test failed" });
      }
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  if (!loading && !user) {
    router.replace("/signin/");
    return null;
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        FPL Account
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Connects your real FPL session so imported squads show your actual purchase prices, bank,
        and free transfers instead of today&apos;s price for every player.
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Why not just log in here?
          <InfoTooltip label="Why not a normal login form?">
            FPL&apos;s identity provider (PingOne) has no password endpoint this app can call, and
            its one reachable login flow opens with bot-detection — automating past that is out of
            scope. Signing in yourself, in your own browser, avoids both: there is no bot to detect
            because it really is you, and no password ever reaches this app.
          </InfoTooltip>
        </h2>

        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>
            Sign in at{" "}
            <a
              href="https://fantasy.premierleague.com/my-team"
              target="_blank"
              rel="noreferrer"
              className="text-purple-800 underline dark:text-[#00FF87]"
            >
              fantasy.premierleague.com
            </a>{" "}
            as you normally do.
          </li>
          <li>Open devtools (F12) → Network tab, then reload the page.</li>
          <li>
            Click any request to <code className="rounded bg-zinc-100 px-1 dark:bg-[#2A0A45]">/api/</code>,
            open Request Headers, and copy the entire <code className="rounded bg-zinc-100 px-1 dark:bg-[#2A0A45]">Cookie</code> value.
          </li>
          <li>Paste it below and save.</li>
        </ol>

        <form onSubmit={onSave} className="mt-4 space-y-2">
          <textarea
            value={session}
            onChange={(e) => setSession(e.target.value)}
            rows={3}
            placeholder="Paste the full Cookie header value here"
            className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus:border-[#00FF87]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={status.kind === "busy" || !session.trim()}
              className="rounded-md bg-purple-950 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-800 disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => void onTest()}
              disabled={status.kind === "busy"}
              className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
            >
              Test connection
            </button>
            <button
              type="button"
              onClick={() => void onRevoke()}
              disabled={status.kind === "busy"}
              className="rounded-md border border-red-300 px-4 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              Revoke
            </button>
          </div>
        </form>

        {status.kind === "ok" && (
          <p className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
            {status.message}
          </p>
        )}
        {status.kind === "error" && (
          <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {status.message}
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-zinc-400">
        Stored encrypted, readable only by this app&apos;s server-side function — never by your
        browser, never by any other user. Revoke removes it entirely. FPL sessions eventually
        expire on their own; if a squad import starts showing stale prices, come back and paste a
        fresh one.
      </p>
    </main>
  );
}
