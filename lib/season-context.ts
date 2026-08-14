// Shared "what gameweek are we planning for, and what are today's squad rules"
// loader. The is_next gameweek -> element_types + game_settings -> SquadRules
// fetch was copy-pasted across app/team, app/builder, app/settings and (with an
// extra player_xp_horizons read) app/chips — one implementation here, per
// CLAUDE.md's "one quantity, one implementation" rule.

import { supabase } from "./supabase/client";
import { DEFAULT_RULES, type SquadRules } from "./team-state";

/** Same floor `/chips` and `seasonHorizonNote` already use when the model
 * hasn't published a real window yet. */
const FALLBACK_SEASON_WINDOW = 8;

export interface SeasonContext {
  season: string;
  /** `gameweeks.id` where `is_next = true`. */
  nextEvent: number;
  gameweekName: string;
  deadlineTime: string;
  rules: SquadRules;
  /** `windowEnd - windowStart + 1`, floored at `FALLBACK_SEASON_WINDOW`. */
  seasonWindow: number;
  windowStart: number;
  windowEnd: number;
}

export async function loadSeasonContext(): Promise<SeasonContext> {
  const { data: gw, error: gwError } = await supabase
    .from("gameweeks")
    .select("season, id, name, deadline_time")
    .eq("is_next", true)
    .limit(1)
    .maybeSingle();
  if (gwError) throw new Error(gwError.message);
  if (!gw) throw new Error("No upcoming gameweek found.");

  const [typesRes, settingsRes, xpRes] = await Promise.all([
    supabase.from("element_types").select("id, squad_select").eq("season", gw.season),
    supabase
      .from("game_settings")
      .select("key, value")
      .eq("season", gw.season)
      .in("key", ["squad_total_spend", "squad_team_limit", "squad_squadsize"]),
    supabase
      .from("player_xp_horizons")
      .select("first_event, last_event")
      .eq("season", gw.season)
      .limit(1),
  ]);

  // Squad rules come from the database, never hardcoded — FPL has changed
  // budget and squad size between seasons.
  const quota: Record<number, number> = {};
  for (const t of typesRes.data ?? []) quota[t.id as number] = Number(t.squad_select ?? 0);
  const settings = new Map((settingsRes.data ?? []).map((s) => [s.key as string, Number(s.value)]));
  const rules: SquadRules = {
    totalSpend: settings.get("squad_total_spend") ?? DEFAULT_RULES.totalSpend,
    teamLimit: settings.get("squad_team_limit") ?? DEFAULT_RULES.teamLimit,
    squadSize: settings.get("squad_squadsize") ?? DEFAULT_RULES.squadSize,
    positionQuota: Object.keys(quota).length > 0 ? quota : DEFAULT_RULES.positionQuota,
  };

  const horizonsFirstRow = (xpRes.data ?? [])[0] as
    | { first_event: number | null; last_event: number | null }
    | undefined;
  const windowEnd =
    horizonsFirstRow?.first_event != null && horizonsFirstRow?.last_event != null
      ? horizonsFirstRow.last_event
      : gw.id + FALLBACK_SEASON_WINDOW - 1;

  return {
    season: gw.season,
    nextEvent: gw.id,
    gameweekName: gw.name,
    deadlineTime: gw.deadline_time,
    rules,
    seasonWindow: windowEnd - gw.id + 1,
    windowStart: gw.id,
    windowEnd,
  };
}
