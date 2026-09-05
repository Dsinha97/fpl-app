"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { InfoTooltip } from "@/components/info-tooltip";
import { PipelineStatus } from "@/components/pipeline-status";
import { listDrafts, saveDraft, uniqueDraftName } from "@/lib/drafts";
import { loadSeasonContext } from "@/lib/season-context";
import {
  importedDraftName,
  resolveImportTarget,
  teamStateFromMyTeamJson,
  type SellPriceMismatch,
} from "@/lib/fpl-squad";

// Sprint 14.3 — one settings page with two tabs, replacing the standalone
// /settings/fpl route (now a redirect, below) and giving "claim your Manager
// ID" a home outside /team, which is otherwise a squad-display page. Tab
// pattern copied from app/fixtures/page.tsx (tabButton / type Tab /
// aria-current) rather than a new mechanism, and the tab itself is read from
// window.location.search the way every draft-aware page already reads
// ?draft= (lib/drafts.ts's resolveRequestedDraft) — not useSearchParams,
// which would need a Suspense boundary this static export has no precedent
// for.

type Tab = "account" | "import" | "status";

function readRequestedTab(search: string): Tab {
  const tab = new URLSearchParams(search).get("tab");
  // Sprint 33 — /status merged in here as a third tab (see PipelineStatus).
  return tab === "import" || tab === "status" ? tab : "account";
}

// ------------------------------------------------------------ account tab

function AccountTab() {
  const { user, entryId, teamName, profileLoading, refreshProfile } = useAuth();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  useEffect(() => {
    // entryId arrives asynchronously from AuthProvider's own Supabase fetch,
    // not from anything this component can know at first render — syncing it
    // into the input once it resolves is exactly what an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (entryId !== null) setInput(String(entryId));
  }, [entryId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const id = Number(input.trim());
    if (!Number.isInteger(id) || id <= 0) {
      setStatus({ kind: "error", message: "Enter your numeric FPL Manager ID (from your team page URL)." });
      return;
    }
    if (!user) return;

    setBusy(true);
    setStatus(null);
    try {
      const { error: fnError } = await supabase.functions.invoke("sync-manager", {
        body: { entry_id: id },
      });
      if (fnError) {
        if (fnError instanceof FunctionsHttpError) {
          const body = await fnError.context.json().catch(() => null);
          throw new Error(body?.error ?? "sync failed");
        }
        throw fnError;
      }

      const { error: profileError } = await supabase
        .from("user_profiles")
        .upsert({ user_id: user.id, entry_id: id }, { onConflict: "user_id" });
      if (profileError) throw new Error(profileError.message);

      const { data: manager } = await supabase
        .from("managers")
        .select("team_name")
        .eq("entry_id", id)
        .maybeSingle();

      await refreshProfile();
      setStatus({
        kind: "ok",
        message: manager?.team_name
          ? `Linked to "${manager.team_name}". This name is now used across the app.`
          : "Linked, but FPL hasn't returned a team name for this ID yet.",
      });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Signed in as</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{user?.email}</p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          FPL Manager ID
          <InfoTooltip label="What does linking a Manager ID do?">
            Once linked, your FPL team name replaces your email wherever this app refers to you —
            the account menu, imported draft names, and the rivals table on /team. Find your
            Manager ID in the URL when you view your team on fantasy.premierleague.com.
          </InfoTooltip>
        </h2>

        {teamName && !profileLoading && (
          <p className="mt-1 text-sm text-zinc-500">
            Currently linked to <span className="font-medium text-zinc-800 dark:text-zinc-200">{teamName}</span>.
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 1234567"
            className="w-40 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus-visible:border-purple-700 focus-visible:ring-2 focus-visible:ring-ring dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus-visible:border-[#00FF87]"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-purple-950 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
          >
            {busy ? "Linking…" : entryId ? "Update" : "Link"}
          </button>
        </form>

        {status && (
          <p
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              status.kind === "ok"
                ? "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                : "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- import tab

type ImportStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      draftId: string;
      playerCount: number;
      budget: number;
      mismatches: SellPriceMismatch[];
    };

function myTeamUrlHint(entryId: number | null): string {
  return `fantasy.premierleague.com/api/my-team/${entryId ?? "<your Manager ID>"}/`;
}

function ImportTab() {
  const { teamName, entryId } = useAuth();
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<ImportStatus>({ kind: "idle" });

  const onImport = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = raw.trim();
    if (!trimmed) return;
    setStatus({ kind: "busy" });

    try {
      let ctx;
      try {
        ctx = await loadSeasonContext();
      } catch {
        setStatus({ kind: "error", message: "Couldn't determine the current season — try again shortly." });
        return;
      }
      const { season, nextEvent, rules } = ctx;

      const playersRes = await supabase.from("players").select("id, now_cost").eq("season", season).limit(1000);
      const nowCostById = new Map<number, number>(
        (playersRes.data ?? []).map((p) => [p.id as number, p.now_cost as number]),
      );

      // Named from the linked FPL team ("DS United (FPL)") rather than a fixed
      // "Imported squad" — the name itself comes from importedDraftName so
      // /team's importer and this one agree, which is what lets
      // resolveRequestedDraft find "this manager's import".
      //
      // Sprint 29.2: re-importing now overwrites the existing import rather
      // than minting a new draft each time — resolveImportTarget finds it by
      // entryId (or name, for a squad imported before entryId existed);
      // uniqueDraftName's " (2)" disambiguator only applies on a genuine
      // first import.
      const existingDrafts = listDrafts();
      const targetDraftId = resolveImportTarget(existingDrafts, entryId, teamName);
      const draftName = targetDraftId
        ? importedDraftName(teamName, entryId)
        : uniqueDraftName(importedDraftName(teamName, entryId));

      const result = teamStateFromMyTeamJson(
        trimmed,
        {
          event: nextEvent,
          nowCostOf: (id) => nowCostById.get(id),
          knownPlayerIds: new Set(nowCostById.keys()),
          entryId,
        },
        rules,
        draftName,
      );

      if (result.error || !result.state) {
        setStatus({ kind: "error", message: result.error ?? "Import failed" });
        return;
      }

      if (targetDraftId) {
        result.state.draftId = targetDraftId;
        // Sprint 29 follow-up: same as /team's importer — a fresh FPL pull
        // can't know the owner's forward chip plan, pinned flag, or
        // free-text notes/strategy, so carry those forward from the draft
        // being overwritten instead of losing them to emptyTeamState's
        // defaults. Squad/captain/budget/activeChip/freeTransfers still come
        // fresh from this import, deliberately not carried forward.
        const existing = existingDrafts.find((d) => d.draftId === targetDraftId);
        if (existing) {
          result.state.chipPlan = existing.chipPlan;
          result.state.pinned = existing.pinned;
          result.state.notes = existing.notes;
          result.state.strategy = existing.strategy;
        }
      }

      const saved = saveDraft(result.state);
      setStatus({
        kind: "done",
        draftId: saved.draftId,
        playerCount: saved.players.length,
        budget: saved.budget,
        mismatches: result.sellPriceMismatches,
      });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Why paste, not log in?
        <InfoTooltip label="Why is this a paste, not a login?">
          FPL&apos;s API now authenticates with a bearer token minted from a browser-only login
          session — this app has no way to obtain one without risking signing you out of your own
          FPL account. Fetching the page yourself, while already signed in, and pasting the result
          needs no credential at all.
        </InfoTooltip>
      </h2>
      <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        Opening{" "}
        <code className="rounded bg-zinc-100 px-1 text-[11px] dark:bg-[#2A0A45]">
          {myTeamUrlHint(entryId)}
        </code>{" "}
        directly in a tab won&apos;t work even signed in — it returns an &quot;Authentication
        credentials were not provided&quot; error, because that bearer token is only ever sent from
        inside the FPL app itself. The DevTools Network tab below reads the same response the FPL
        app already has it send.
      </p>

      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
        <li>
          Open and sign in at{" "}
          <a
            href="https://fantasy.premierleague.com/my-team"
            target="_blank"
            rel="noreferrer"
            className="text-purple-800 underline dark:text-[#00FF87]"
          >
            fantasy.premierleague.com/my-team
          </a>
          .
        </li>
        <li>
          Open DevTools (<code className="rounded bg-zinc-100 px-1 text-xs dark:bg-[#2A0A45]">F12</code>)
          and select the <strong>Network</strong> tab.
        </li>
        <li>Reload the page, then filter the request list for &quot;my-team&quot;.</li>
        <li>
          Click the request ending in{" "}
          <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-[#2A0A45]">
            {myTeamUrlHint(entryId)}
          </code>
          , open its <strong>Response</strong> tab, and copy the whole JSON body.
        </li>
        <li>Paste it below and import.</li>
      </ol>

      <form onSubmit={onImport} className="mt-4 space-y-2">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={6}
          placeholder='{"picks": [...], "chips": [...], "transfers": {...}}'
          className="w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus-visible:border-purple-700 focus-visible:ring-2 focus-visible:ring-ring dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus-visible:border-[#00FF87]"
        />
        <button
          type="submit"
          disabled={status.kind === "busy" || !raw.trim()}
          className="rounded-md bg-purple-950 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
        >
          {status.kind === "busy" ? "Importing…" : "Import as draft"}
        </button>
      </form>

      {status.kind === "error" && (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {status.message}
        </p>
      )}

      {status.kind === "done" && (
        <div className="mt-3 space-y-2">
          <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
            Imported {status.playerCount} players, £{(status.budget / 10).toFixed(1)}m total budget.
          </p>
          {status.mismatches.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              {status.mismatches.length} pick(s) had a sell-price our formula computed differently
              from FPL&apos;s own figure — worth a look, not blocking:{" "}
              {status.mismatches
                .map((m) => `#${m.playerId} (ours £${(m.ours / 10).toFixed(1)}m vs FPL £${(m.fpl / 10).toFixed(1)}m)`)
                .join(", ")}
            </p>
          )}
          <a
            href={`/builder/?draft=${status.draftId}`}
            className="inline-block rounded-md bg-purple-950 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-800 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
          >
            Open in Builder →
          </a>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-400">
        This creates a new, independent draft — your other drafts are untouched.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- page

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("account");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(readRequestedTab(window.location.search));
  }, []);

  // Sprint 33 — the Pipeline tab is the exception to this page's sign-in
  // wall, and it has to be. /status was readable signed-out (sync_runs and
  // the row counts are public-read under RLS), so folding it in behind the
  // gate would have quietly taken a public page private. Read the tab from
  // the URL here rather than from `tab` state: this effect and the one above
  // both run on mount, and `tab` is still its "account" default when a
  // signed-out visitor arrives on ?tab=status.
  useEffect(() => {
    if (loading || user) return;
    if (readRequestedTab(window.location.search) === "status") return;
    router.replace("/signin/");
  }, [loading, user, router]);

  const signedOut = !loading && !user;
  if (signedOut && tab !== "status") return null;

  const tabButton = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      aria-current={tab === id ? "page" : undefined}
      className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tab === id
          ? "bg-purple-950 text-white dark:bg-emerald-950/60 dark:text-[#00FF87] dark:ring-1 dark:ring-[#00FF87]/40"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-purple-950/50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <main className={`mx-auto w-full flex-1 px-4 py-10 ${tab === "status" ? "max-w-5xl" : "max-w-xl"}`}>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {signedOut ? "Pipeline" : "Account"}
      </h1>

      {/* Signed out, the other two tabs are not reachable, so offering them
          would be a dead end rather than a choice. */}
      {!signedOut && (
        <div className="mt-4 flex gap-1 rounded-lg border border-zinc-200 p-1 dark:border-purple-900/40">
          {tabButton("account", "Account details")}
          {tabButton("import", "Import squad")}
          {tabButton("status", "Pipeline")}
        </div>
      )}

      {/* Each tab mounts only while showing — PipelineStatus issues a count
          query per table, and someone changing their Manager ID should not
          pay for that. */}
      {tab === "account" && <AccountTab />}
      {tab === "import" && <ImportTab />}
      {tab === "status" && <PipelineStatus />}
    </main>
  );
}
