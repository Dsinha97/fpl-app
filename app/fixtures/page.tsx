"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FdrLegendContent, InfoTooltip } from "@/components/info-tooltip";
import { FdrMatrix } from "@/components/fdr-matrix";
import { LeagueTable, type StandingsTeam } from "@/components/league-table";
import {
  FixtureSchedule,
  localZone,
  type ScheduleFixture,
  type ScheduleGameweek,
} from "@/components/fixture-schedule";
import { ClubTacticsGrid, type ClubTactics } from "@/components/club-tactics";
import { toTacticalProfile, type PlManagerRow } from "@/lib/tactical-profile";

interface FixtureRow extends ScheduleFixture {
  team_h_difficulty: number | null;
  team_a_difficulty: number | null;
}

type Tab = "schedule" | "fdr" | "table" | "clubs";

export default function FixturesPage() {
  const [teams, setTeams] = useState<StandingsTeam[]>([]);
  const [fixtures, setFixtures] = useState<FixtureRow[]>([]);
  const [gameweeks, setGameweeks] = useState<ScheduleGameweek[]>([]);
  const [nextGw, setNextGw] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("schedule");
  const [clubTactics, setClubTactics] = useState<ClubTactics[]>([]);
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

        const [teamsRes, fixturesRes, gwsRes, managersRes] = await Promise.all([
          supabase
            .from("teams")
            .select(
              "id, code, name, short_name, tactical_manager_id, position, played, win, draw, loss, points, form",
            )
            .eq("season", gw.season)
            .order("name"),
          // No event filter: the schedule tab shows completed gameweeks too.
          supabase
            .from("fixtures")
            .select(
              "id, event, kickoff_time, provisional_start_time, team_h, team_a, team_h_score, team_a_score, started, finished, minutes, team_h_difficulty, team_a_difficulty",
            )
            .eq("season", gw.season),
          supabase
            .from("gameweeks")
            .select("id, name, deadline_time, finished")
            .eq("season", gw.season)
            .order("id"),
          // Clubs tab (Sprint 12.5) — a 20-club reference, independent of the
          // schedule/FDR data above.
          supabase
            .from("pl_managers")
            .select(
              "manager_key, name, current_club, preferred_formation, buildup_style, pressing_intensity, source_file, tactical_traits, modifiers",
            )
            .eq("season", gw.season),
        ]);
        if (teamsRes.error) throw new Error(teamsRes.error.message);
        if (fixturesRes.error) throw new Error(fixturesRes.error.message);
        if (gwsRes.error) throw new Error(gwsRes.error.message);
        if (managersRes.error) throw new Error(managersRes.error.message);

        const teamRows = (teamsRes.data ?? []) as (StandingsTeam & {
          tactical_manager_id: string | null;
        })[];
        setTeams(teamRows);
        setFixtures((fixturesRes.data ?? []) as FixtureRow[]);
        setGameweeks((gwsRes.data ?? []) as ScheduleGameweek[]);
        setNextGw(gw.id);

        const byKey = new Map(
          ((managersRes.data ?? []) as PlManagerRow[]).map((r) => [r.manager_key, toTacticalProfile(r)]),
        );
        const clubs: ClubTactics[] = teamRows
          .map((t): ClubTactics | null => {
            const profile = t.tactical_manager_id ? byKey.get(t.tactical_manager_id) : undefined;
            if (!profile) return null;
            return {
              teamId: t.id,
              teamName: t.name,
              teamShort: t.short_name,
              teamCode: t.code ?? null,
              profile,
            };
          })
          .filter((r): r is ClubTactics => r !== null)
          .sort((a, b) => a.teamName.localeCompare(b.teamName));
        setClubTactics(clubs);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const tabButton = (id: Tab, label: string, icon: string) => (
    <button
      onClick={() => setTab(id)}
      aria-current={tab === id ? "page" : undefined}
      className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        tab === id
          ? "bg-purple-950 text-white dark:bg-emerald-950/60 dark:text-[#00FF87] dark:ring-1 dark:ring-[#00FF87]/40"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-purple-950/50"
      }`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Fixtures &amp; FDR
        <InfoTooltip>
          <FdrLegendContent />
        </InfoTooltip>
      </h1>

      <div className="mt-4 flex gap-1 rounded-lg border border-zinc-200 p-1 dark:border-purple-900/40">
        {tabButton("schedule", "Schedule", "✓")}
        {tabButton("fdr", "FDR", "▦")}
        {tabButton("table", "Table", "≡")}
        {tabButton("clubs", "Clubs", "🎽")}
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading fixtures…</p>}

      {!loading && !error && tab === "schedule" && (
        <>
          <p className="mt-4 text-sm text-zinc-500">
            Upcoming gameweeks first, completed ones collapsed. Times shown in {localZone()}; final
            scores replace the kickoff time once a match is over.
          </p>
          <FixtureSchedule
            fixtures={fixtures}
            teams={teamsById}
            gameweeks={gameweeks}
            nextGw={nextGw}
          />
        </>
      )}

      {!loading && !error && tab === "fdr" && (
        <FdrMatrix teams={teams} fixtures={fixtures} nextGw={nextGw} />
      )}

      {!loading && !error && tab === "table" && (
        <LeagueTable teams={teams} fixtures={fixtures} nextGw={nextGw} />
      )}

      {!loading && !error && tab === "clubs" && (
        <div className="mt-6">
          <ClubTacticsGrid clubs={clubTactics} />
        </div>
      )}
    </main>
  );
}
