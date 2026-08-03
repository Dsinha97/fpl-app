"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface RunRow {
  function_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_written: number;
  error: string | null;
  details: Record<string, unknown> | null;
}

interface Counts {
  players: number;
  teams: number;
  fixtures: number;
  gameweeks: number;
  priceHistory: number;
  statusHistory: number;
  news: number;
  ownership: number;
  seasonHistory: number;
  gameweekStats: number;
  fixtureChanges: number;
}

const FUNCTIONS = [
  "sync-bootstrap",
  "sync-fixtures",
  "sync-player-history",
  "sync-live-gameweek",
  "sync-manager",
] as const;

const STATUS_STYLES: Record<string, string> = {
  success: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  skipped: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
};

function ago(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

function duration(row: RunRow): string {
  if (!row.finished_at) return "—";
  const ms = new Date(row.finished_at).getTime() - new Date(row.started_at).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

const countOf = (table: string) =>
  supabase.from(table).select("*", { count: "exact", head: true });

export default function StatusPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    // Latest run per function.
    const latest = await Promise.all(
      FUNCTIONS.map(async (fn) => {
        const { data } = await supabase
          .from("sync_runs")
          .select("function_name, status, started_at, finished_at, rows_written, error, details")
          .eq("function_name", fn)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data as RunRow | null;
      }),
    );

    const [
      players, teams, fixtures, gameweeks, priceHistory, statusHistory,
      news, ownership, seasonHistory, gameweekStats, fixtureChanges,
    ] = await Promise.all([
      countOf("players"), countOf("teams"), countOf("fixtures"), countOf("gameweeks"),
      countOf("player_price_history"), countOf("player_status_history"),
      countOf("player_news"), countOf("player_ownership_history"),
      countOf("player_season_history"), countOf("player_gameweek_stats"),
      countOf("fixture_changes"),
    ]);

    setCounts({
      players: players.count ?? 0,
      teams: teams.count ?? 0,
      fixtures: fixtures.count ?? 0,
      gameweeks: gameweeks.count ?? 0,
      priceHistory: priceHistory.count ?? 0,
      statusHistory: statusHistory.count ?? 0,
      news: news.count ?? 0,
      ownership: ownership.count ?? 0,
      seasonHistory: seasonHistory.count ?? 0,
      gameweekStats: gameweekStats.count ?? 0,
      fixtureChanges: fixtureChanges.count ?? 0,
    });

    setRuns(latest.filter((r): r is RunRow => r !== null));
    setLoading(false);
  }, []);

  useEffect(() => {
    // On-mount fetch. This is a static export, so there is no server component
    // to load from; an effect is the only place this can happen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Pipeline Status
        </h1>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Last run per function
        </h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Function</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Rows</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.function_name}
                  className="border-b border-zinc-100 text-zinc-800 last:border-0 dark:border-zinc-900 dark:text-zinc-200"
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.function_name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[r.status] ?? STATUS_STYLES.running
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{ago(r.started_at)}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-500">{duration(r)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.rows_written.toLocaleString()}</td>
                  <td className="px-3 py-2 max-w-xs truncate text-xs text-zinc-500">
                    {r.error ?? (r.details ? JSON.stringify(r.details) : "")}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                    No sync runs recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {counts && (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Warehouse contents
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[
              { label: "Players", value: counts.players },
              { label: "Teams", value: counts.teams },
              { label: "Fixtures", value: counts.fixtures },
              { label: "Gameweeks", value: counts.gameweeks },
              { label: "Price observations", value: counts.priceHistory },
              { label: "Status observations", value: counts.statusHistory },
              { label: "News items", value: counts.news },
              { label: "Ownership observations", value: counts.ownership },
              { label: "Prior-season records", value: counts.seasonHistory },
              { label: "Gameweek stats", value: counts.gameweekStats },
              { label: "Fixture changes", value: counts.fixtureChanges },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="text-xs text-zinc-500">{c.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
                  {c.value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-8 text-xs text-zinc-400">
        Bootstrap every 30 min · fixtures hourly · player history every 10 min (self-gating, one
        full pass per day) · live gameweek every 2 min (only while matches are in progress).
      </p>
    </main>
  );
}
