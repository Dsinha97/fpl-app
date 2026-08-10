"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { InfoTooltip } from "@/components/info-tooltip";
import { saveDraft } from "@/lib/drafts";
import { DEFAULT_RULES, type SquadRules } from "@/lib/team-state";
import { teamStateFromMyTeamJson, type SellPriceMismatch } from "@/lib/fpl-squad";

// Sprint 14.2 — importing a real squad by pasting the my-team response.
//
// §F tried server-side authentication against FPL's auth-gated
// /api/my-team/{id}/ and it cannot work: FPL moved from cookie sessions to a
// bearer token minted from an OIDC refresh token that lives only in the
// browser's localStorage, so a pasted Cookie header authenticates nothing —
// confirmed live, every attempt returned 401. Escalating to a refresh-token
// exchange was rejected on rotation risk: FPL retires the browser's copy of
// the token on first exchange, which could sign the owner out of their own
// FPL session. Pasting the *response* instead needs no credential at all —
// the owner is already signed in, in their own browser. See
// docs/roadmap.md, "Sprint 14.2".

type Status =
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

const MY_TEAM_URL_HINT = "fantasy.premierleague.com/api/my-team/<your Manager ID>/";

export default function FplImportPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const onImport = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = raw.trim();
    if (!trimmed) return;
    setStatus({ kind: "busy" });

    try {
      const { data: gw } = await supabase
        .from("gameweeks")
        .select("season, id")
        .eq("is_next", true)
        .limit(1)
        .maybeSingle();

      if (!gw) {
        setStatus({ kind: "error", message: "Couldn't determine the current season — try again shortly." });
        return;
      }

      const [playersRes, settingsRes, typesRes] = await Promise.all([
        supabase.from("players").select("id, now_cost").eq("season", gw.season).limit(1000),
        supabase
          .from("game_settings")
          .select("key, value")
          .eq("season", gw.season)
          .in("key", ["squad_total_spend", "squad_team_limit", "squad_squadsize"]),
        supabase.from("element_types").select("id, squad_select").eq("season", gw.season),
      ]);

      const nowCostById = new Map<number, number>(
        (playersRes.data ?? []).map((p) => [p.id as number, p.now_cost as number]),
      );
      const settings = new Map(
        (settingsRes.data ?? []).map((s) => [s.key as string, Number(s.value)]),
      );
      const quota: Record<number, number> = {};
      for (const t of typesRes.data ?? []) quota[t.id as number] = Number(t.squad_select ?? 0);
      const rules: SquadRules = {
        totalSpend: settings.get("squad_total_spend") ?? DEFAULT_RULES.totalSpend,
        teamLimit: settings.get("squad_team_limit") ?? DEFAULT_RULES.teamLimit,
        squadSize: settings.get("squad_squadsize") ?? DEFAULT_RULES.squadSize,
        positionQuota: Object.keys(quota).length > 0 ? quota : DEFAULT_RULES.positionQuota,
      };

      const result = teamStateFromMyTeamJson(
        trimmed,
        {
          event: gw.id,
          nowCostOf: (id) => nowCostById.get(id),
          knownPlayerIds: new Set(nowCostById.keys()),
        },
        rules,
        "Imported squad",
      );

      if (result.error || !result.state) {
        setStatus({ kind: "error", message: result.error ?? "Import failed" });
        return;
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

  // A redirect belongs in an effect, not the render body — calling
  // router.replace() while rendering triggers React's "setState on a
  // different component during render" warning, confirmed live: it only
  // fires on the signed-out branch, which a signed-in-only test pass never
  // exercises. Same fix as app/signin/page.tsx.
  useEffect(() => {
    if (!loading && !user) router.replace("/signin/");
  }, [loading, user, router]);

  if (!loading && !user) {
    return null;
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Import your FPL squad
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Real purchase prices, bank, and chip availability — as a new draft you can open in the
        Builder.
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Why paste, not log in?
          <InfoTooltip label="Why is this a paste, not a login?">
            FPL&apos;s API now authenticates with a bearer token minted from a browser-only login
            session — this app has no way to obtain one without risking signing you out of your
            own FPL account. Fetching the page yourself, while already signed in, and pasting the
            result needs no credential at all.
          </InfoTooltip>
        </h2>

        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>
            While signed in at{" "}
            <a
              href="https://fantasy.premierleague.com/my-team"
              target="_blank"
              rel="noreferrer"
              className="text-purple-800 underline dark:text-[#00FF87]"
            >
              fantasy.premierleague.com
            </a>
            , open a new tab to{" "}
            <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-[#2A0A45]">
              {MY_TEAM_URL_HINT}
            </code>
          </li>
          <li>Select all the JSON that page shows and copy it.</li>
          <li>Paste it below and import.</li>
        </ol>

        <form onSubmit={onImport} className="mt-4 space-y-2">
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={6}
            placeholder='{"picks": [...], "chips": [...], "transfers": {...}}'
            className="w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100 dark:focus:border-[#00FF87]"
          />
          <button
            type="submit"
            disabled={status.kind === "busy" || !raw.trim()}
            className="rounded-md bg-purple-950 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-800 disabled:opacity-50 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
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
              Imported {status.playerCount} players, £{(status.budget / 10).toFixed(1)}m total
              budget.
            </p>
            {status.mismatches.length > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                {status.mismatches.length} pick(s) had a sell-price our formula computed
                differently from FPL&apos;s own figure — worth a look, not blocking:{" "}
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
      </div>

      <p className="mt-4 text-xs text-zinc-400">
        This creates a new, independent draft — your other drafts are untouched. Nothing here is
        sent anywhere except into this browser&apos;s (and, if signed in, your account&apos;s)
        draft storage.
      </p>
    </main>
  );
}
