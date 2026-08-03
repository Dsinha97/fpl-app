"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { fdrClasses, fdrLabel, fdrTheme } from "@/lib/fdr";

interface FixtureRow {
  event: number;
  team_h: number;
  team_a: number;
  team_h_difficulty: number | null;
  team_a_difficulty: number | null;
}

interface TeamRow {
  id: number;
  name: string;
  short_name: string;
}

interface Cell {
  opp: string;
  home: boolean;
  fdr: number;
}

const HORIZONS = [5, 8, 10, 38] as const;

export default function FixturesPage() {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [fixtures, setFixtures] = useState<FixtureRow[]>([]);
  const [nextGw, setNextGw] = useState<number | null>(null);
  const [horizon, setHorizon] = useState<number>(8);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: gw, error: gwError } = await supabase
          .from("gameweeks")
          .select("season, id")
          .eq("is_next", true)
          .limit(1)
          .maybeSingle();
        if (gwError) throw new Error(gwError.message);
        if (!gw) throw new Error("No upcoming gameweek found.");

        const [teamsRes, fixturesRes] = await Promise.all([
          supabase
            .from("teams")
            .select("id, name, short_name")
            .eq("season", gw.season)
            .order("name"),
          supabase
            .from("fixtures")
            .select("event, team_h, team_a, team_h_difficulty, team_a_difficulty")
            .eq("season", gw.season)
            .gte("event", gw.id),
        ]);
        if (teamsRes.error) throw new Error(teamsRes.error.message);
        if (fixturesRes.error) throw new Error(fixturesRes.error.message);

        setTeams(teamsRes.data ?? []);
        setFixtures((fixturesRes.data ?? []) as FixtureRow[]);
        setNextGw(gw.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const { gwCols, rows } = useMemo(() => {
    if (nextGw === null) return { gwCols: [] as number[], rows: [] };

    const lastGw = Math.min(nextGw + horizon - 1, 38);
    const cols: number[] = [];
    for (let g = nextGw; g <= lastGw; g++) cols.push(g);

    const shortOf = new Map(teams.map((t) => [t.id, t.short_name]));
    const byTeam = new Map<number, Map<number, Cell[]>>();

    for (const f of fixtures) {
      if (f.event === null || f.event < nextGw || f.event > lastGw) continue;

      const push = (teamId: number, cell: Cell) => {
        if (!byTeam.has(teamId)) byTeam.set(teamId, new Map());
        const m = byTeam.get(teamId)!;
        if (!m.has(f.event)) m.set(f.event, []);
        m.get(f.event)!.push(cell);
      };

      push(f.team_h, {
        opp: shortOf.get(f.team_a) ?? "?",
        home: true,
        fdr: f.team_h_difficulty ?? 3,
      });
      push(f.team_a, {
        opp: shortOf.get(f.team_h) ?? "?",
        home: false,
        fdr: f.team_a_difficulty ?? 3,
      });
    }

    const rows = teams
      .map((t) => {
        const cells = byTeam.get(t.id) ?? new Map<number, Cell[]>();
        const fdrs = cols.flatMap((g) => (cells.get(g) ?? []).map((c) => c.fdr));
        const avg = fdrs.length > 0 ? fdrs.reduce((a, b) => a + b, 0) / fdrs.length : null;
        return { team: t, cells, avg };
      })
      .sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99));

    return { gwCols: cols, rows };
  }, [teams, fixtures, nextGw, horizon]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Fixture Matrix
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Official FDR per fixture · sorted easiest run first · H = home, lowercase = away
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Horizon</span>
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                horizon === h
                  ? "bg-purple-950 text-white dark:bg-[#00FF87] dark:text-slate-950"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              {h === 38 ? "All" : `${h} GWs`}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {Object.entries(fdrTheme).map(([fdr, t]) => (
          <span
            key={fdr}
            className={`rounded px-2 py-0.5 font-medium ${t.bgLight} ${t.bgDark} ${t.textLight} ${t.textDark}`}
          >
            {fdr} · {t.label}
          </span>
        ))}
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading fixtures…</p>}

      {!loading && !error && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-zinc-950">Team</th>
                <th className="px-2 py-2 text-center">Avg</th>
                {gwCols.map((g) => (
                  <th key={g} className="px-1 py-2 text-center">
                    GW{g}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ team, cells, avg }) => (
                <tr
                  key={team.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                    {team.short_name}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-zinc-500">
                    {avg !== null ? avg.toFixed(1) : "—"}
                  </td>
                  {gwCols.map((g) => {
                    const cellFixtures = cells.get(g) ?? [];
                    return (
                      <td key={g} className="px-0.5 py-1 text-center">
                        {cellFixtures.length === 0 ? (
                          <span
                            className="block rounded bg-zinc-100 px-1 py-1 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
                            title={`GW${g}: blank — no fixture`}
                          >
                            —
                          </span>
                        ) : (
                          <span className="flex flex-col gap-0.5">
                            {cellFixtures.map((c, i) => (
                              <span
                                key={i}
                                title={`GW${g} · ${team.short_name} ${
                                  c.home ? "vs" : "@"
                                } ${c.opp} · FDR ${c.fdr} — ${fdrLabel(c.fdr)}`}
                                className={`block rounded px-1 py-1 font-semibold ${fdrClasses(c.fdr)}`}
                              >
                                {c.home ? c.opp.toUpperCase() : c.opp.toLowerCase()}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-400">
        Uses the official FPL difficulty rating for now — the custom analytical FDR arrives in
        Phase 5 once team strength data populates with played matches.
      </p>
    </main>
  );
}
