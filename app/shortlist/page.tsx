"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ModelNote } from "@/components/ui/model-note";
import { PlayerModal } from "@/components/player-modal";
import { loadShortlist, removeFromShortlist } from "@/lib/shortlist";
import {
  loadPriceProgress,
  priceVerdictLabel,
  PRICE_WATCH_MODEL_NOTE,
  type PriceProgress,
} from "@/lib/price-watch";
import { loadPositionRanks, type PositionRanks } from "@/lib/player-ranks";
import type { PlayerData } from "@/components/player-card";

/**
 * The players you've marked to come back to.
 *
 * Exists because a shortlist button with nowhere to read the shortlist is a
 * write-only hole. The price outlook is the column that earns the page: the
 * whole reason to shortlist a player is to decide when to buy him.
 */

const POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

interface Row {
  id: number;
  code: number;
  web_name: string;
  element_type: number;
  team_id: number;
  now_cost: number | null;
  selected_by_percent: number | null;
  form: number | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
  note: string | null;
}

export default function ShortlistPage() {
  const { user, loading: authLoading } = useAuth();
  const [season, setSeason] = useState<string | null>(null);
  const [nextEvent, setNextEvent] = useState<number | null>(null);
  const [loadedRows, setRows] = useState<Row[] | null>(null);
  const [teamShort, setTeamShort] = useState<Map<number, string>>(new Map());
  const [priceProgress, setPriceProgress] = useState<Map<number, PriceProgress>>(new Map());
  const [ranks, setRanks] = useState<PositionRanks | undefined>(undefined);
  const [openCode, setOpenCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived, not stored: signed out there is nothing to fetch, so this
  // resolves to empty rather than writing state inside an effect. Memoised
  // because `openPlayer` depends on it and a fresh [] every render would
  // recompute that on every render.
  const rows = useMemo(
    () => (!authLoading && !user ? [] : loadedRows),
    [authLoading, user, loadedRows],
  );

  const refresh = useCallback(async () => {
    const { data: gw, error: gwError } = await supabase
      .from("gameweeks")
      .select("season, id")
      .eq("is_next", true)
      .limit(1)
      .maybeSingle();
    if (gwError) throw new Error(gwError.message);
    if (!gw) throw new Error("No upcoming gameweek found.");

    const seasonId = gw.season as string;
    setSeason(seasonId);
    setNextEvent(gw.id as number);

    const entries = await loadShortlist(seasonId);
    if (entries.size === 0) {
      setRows([]);
      return;
    }

    const codes = [...entries.keys()];
    const [playersRes, teamsRes] = await Promise.all([
      supabase
        .from("players")
        .select(
          "id, code, web_name, element_type, team_id, now_cost, selected_by_percent, form, status, news, chance_of_playing_next_round",
        )
        .eq("season", seasonId)
        .in("code", codes),
      supabase.from("teams").select("id, short_name").eq("season", seasonId),
    ]);
    if (playersRes.error) throw new Error(playersRes.error.message);
    if (teamsRes.error) throw new Error(teamsRes.error.message);

    setTeamShort(
      new Map((teamsRes.data ?? []).map((t) => [t.id as number, t.short_name as string])),
    );
    setRows(
      (playersRes.data ?? [])
        .map((p) => ({ ...(p as unknown as Row), note: entries.get(p.code as number)?.note ?? null }))
        // Newest shortlisted first, matching the order loadShortlist returns.
        .sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code)),
    );

    // Both non-blocking: the table is useful before either lands.
    loadPriceProgress(seasonId, codes).then(setPriceProgress).catch(() => undefined);
    loadPositionRanks(seasonId).then(setRanks).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    // Inline async IIFE — the shape every load effect in this app uses.
    (async () => {
      try {
        await refresh();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [user, authLoading, refresh]);

  const openPlayer = useMemo((): PlayerData | null => {
    if (openCode === null || !rows) return null;
    const r = rows.find((x) => x.code === openCode);
    if (!r) return null;
    return {
      id: r.id,
      code: r.code,
      web_name: r.web_name,
      team_code: null,
      team_short: teamShort.get(r.team_id) ?? null,
      element_type: r.element_type,
      now_cost: r.now_cost ?? 0,
      ownership: r.selected_by_percent,
      form: r.form,
      status: r.status,
      news: r.news,
      chance_of_playing_next_round: r.chance_of_playing_next_round,
    };
  }, [openCode, rows, teamShort]);

  const drop = async (code: number) => {
    if (!season) return;
    setRows((prev) => prev?.filter((r) => r.code !== code) ?? prev);
    try {
      await removeFromShortlist(season, code);
    } catch {
      refresh().catch(() => undefined);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">Shortlist</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Players you&apos;ve marked to come back to, with how close each is to a price change.
      </p>

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {!authLoading && !user && (
        <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-purple-900/60">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Your shortlist is tied to your account, so it follows you between devices.
          </p>
          <Link
            href="/signin/"
            className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Sign in
          </Link>
        </div>
      )}

      {user && rows === null && (
        <div className="mt-6 flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {user && rows !== null && rows.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-purple-900/60 dark:text-zinc-400">
          Nothing shortlisted yet. Open any player&apos;s full profile from{" "}
          <Link href="/players/" className="font-medium text-primary hover:underline">
            the player explorer
          </Link>{" "}
          and add them.
        </p>
      )}

      {user && rows !== null && rows.length > 0 && (
        <>
          <ul className="mt-6 flex min-w-0 flex-col gap-2">
            {rows.map((r) => {
              const pp = priceProgress.get(r.code);
              const pct = pp?.progressRaw ?? null;
              return (
                <li
                  key={r.code}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-purple-900/60"
                >
                  <button
                    type="button"
                    onClick={() => setOpenCode(r.code)}
                    className="min-w-0 flex-1 text-left [touch-action:manipulation]"
                  >
                    <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {r.web_name}
                    </span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {teamShort.get(r.team_id) ?? "—"} · {POSITIONS[r.element_type]} · £
                      {((r.now_cost ?? 0) / 10).toFixed(1)}m
                      {r.note ? ` · ${r.note}` : ""}
                    </span>
                  </button>

                  {pp && pp.verdict !== "unknown" && pp.direction !== "flat" && (
                    <Badge
                      tone={pp.direction === "rise" ? "positive" : "negative"}
                      size="sm"
                      className="shrink-0 tabular-nums"
                      title={`${priceVerdictLabel(pp.verdict, pp.direction)} — ${Math.abs((pct ?? 0) * 100).toFixed(0)}% of the net transfers your threshold says a ${pp.direction} takes. Not a probability.`}
                    >
                      {pp.direction === "rise" ? "▲" : "▼"} {Math.abs((pct ?? 0) * 100).toFixed(0)}%
                    </Badge>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => drop(r.code)}
                    aria-label={`Remove ${r.web_name} from shortlist`}
                    className="shrink-0"
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>

          <ModelNote className="mt-4">{PRICE_WATCH_MODEL_NOTE}</ModelNote>
        </>
      )}

      {openPlayer && season && (
        <PlayerModal
          player={openPlayer}
          season={season}
          teamShortById={teamShort}
          currentEvent={nextEvent}
          ranks={ranks}
          priceProgress={openCode !== null ? priceProgress.get(openCode) : undefined}
          onClose={() => {
            setOpenCode(null);
            // The modal owns the shortlist toggle, so a removal made inside it
            // has to be reflected here rather than left stale.
            refresh().catch(() => undefined);
          }}
        />
      )}
    </main>
  );
}
