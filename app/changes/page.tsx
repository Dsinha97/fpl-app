"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface FeedRow {
  season: string;
  kind: "price_rise" | "price_fall" | "status" | "news" | "fixture";
  observed_at: string;
  player_code: number | null;
  web_name: string | null;
  team_short: string | null;
  detail: Record<string, unknown>;
}

const STATUS_LABEL: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not in squad",
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "price", label: "📈 Prices" },
  { key: "availability", label: "🟡 Availability" },
  { key: "news", label: "📰 News" },
  { key: "fixture", label: "📅 Fixtures" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function ago(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

const money = (tenths: unknown): string =>
  typeof tenths === "number" ? `£${(tenths / 10).toFixed(1)}m` : "?";

function describe(row: FeedRow): { icon: string; text: string } {
  const d = row.detail;
  switch (row.kind) {
    case "price_rise":
      return { icon: "📈", text: `${money(d.old)} → ${money(d.new)}` };
    case "price_fall":
      return { icon: "📉", text: `${money(d.old)} → ${money(d.new)}` };
    case "status": {
      const oldS = STATUS_LABEL[String(d.old_status)] ?? String(d.old_status);
      const newS = STATUS_LABEL[String(d.new_status)] ?? String(d.new_status);
      const chance = d.new_chance !== null && d.new_chance !== undefined
        ? ` (${d.new_chance}% next round)`
        : "";
      const ruledOut = d.new_status === "i" || d.new_status === "s" || d.new_status === "u";
      return { icon: ruledOut ? "🔴" : "🟡", text: `${oldS} → ${newS}${chance}` };
    }
    case "news": {
      const text = d.new === null || d.new === "" ? "News cleared" : String(d.new);
      return { icon: "📰", text };
    }
    case "fixture": {
      const match = `${d.home ?? "?"} v ${d.away ?? "?"}`;
      const what = d.field === "event"
        ? `moved GW${d.old} → GW${d.new}`
        : `kickoff ${String(d.old ?? "?").slice(0, 16)} → ${String(d.new ?? "?").slice(0, 16)}`;
      return { icon: "📅", text: `${match} — ${what}` };
    }
  }
}

export default function ChangesPage() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error: feedError } = await supabase
          .from("change_feed")
          .select("*")
          .order("observed_at", { ascending: false })
          .limit(200);
        if (feedError) throw new Error(feedError.message);
        setRows((data ?? []) as FeedRow[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => {
      switch (filter) {
        case "price":
          return r.kind === "price_rise" || r.kind === "price_fall";
        case "availability":
          return r.kind === "status";
        case "news":
          return r.kind === "news";
        case "fixture":
          return r.kind === "fixture";
        default:
          return true;
      }
    });
  }, [rows, filter]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        What Changed?
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Price moves, availability, injury news, and fixture changes — most recent first.
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              filter === f.key
                ? "bg-purple-950 text-white dark:bg-[#00FF87] dark:text-slate-950"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:bg-purple-950/60"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading changes…</p>}

      {!loading && !error && (
        <ul className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-purple-900/30 dark:border-purple-900/40 dark:bg-[#1E0234]">
          {visible.map((row, i) => {
            const { icon, text } = describe(row);
            return (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 text-base" aria-hidden="true">
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-800 dark:text-zinc-200">
                    {row.web_name && (
                      <span className="font-medium">
                        {row.web_name}
                        {row.team_short ? ` (${row.team_short})` : ""}
                        {" · "}
                      </span>
                    )}
                    {text}
                  </p>
                </div>
                <time
                  title={new Date(row.observed_at).toLocaleString()}
                  className="shrink-0 text-xs text-zinc-400"
                >
                  {ago(row.observed_at)}
                </time>
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-zinc-500">
              Nothing yet — changes appear here as the pipeline observes them. Price changes
              typically land daily around 01:30 UTC once the season starts.
            </li>
          )}
        </ul>
      )}
    </main>
  );
}
