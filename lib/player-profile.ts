// Player card: the data the deep-dive modal needs and no page already holds.
//
// `PlayerDetail` (components/player-detail.tsx) deliberately never fetches —
// every field arrives on `player`, and `undefined` hides a section. That
// contract is what lets the pitch popover render from /team, /builder,
// /deadline and the builder picker with no data coupling, and it is kept.
//
// The modal breaks it, on purpose: a per-gameweek history, a season history
// and a price history are not things a squad page has any reason to have
// loaded. What is preserved is the *shape* of the contract — each loader is
// independent and fires only when its tab is first opened, so opening the
// card costs one query, not four.
//
// Memoised with the TTL-promise pattern from lib/player-pool.ts: reopening
// the same player inside the window is free, and a failed fetch is evicted so
// the next caller gets a fresh try rather than a cached rejection.

import { supabase } from "./supabase/client";
import type { ScorableLine } from "./fpl-scoring-rules";

const TTL_MS = 5 * 60 * 1000;
const PAGE_ROWS = 1000;

/** One player-fixture. A double gameweek is two lines sharing an `event`. */
export interface GameweekLine extends ScorableLine {
  event: number;
  fixture: number;
  opponent_team: number;
  was_home: boolean;
  team_h_score: number | null;
  team_a_score: number | null;
  bps: number;
  ict_index: number | null;
  /** The player's price that gameweek, in FPL tenths. */
  value: number;
  transfers_in: number;
  transfers_out: number;
}

/** One past season's totals. Keyed on `player_code`, which survives a rollover. */
export interface SeasonLine {
  season_name: string;
  start_cost: number | null;
  end_cost: number | null;
  total_points: number | null;
  minutes: number | null;
  goals_scored: number | null;
  assists: number | null;
  clean_sheets: number | null;
  bonus: number | null;
  ict_index: number | null;
}

/** One recorded price move. `player_price_history` is change-on-write. */
export interface PriceChange {
  price: number;
  cost_change_event: number | null;
  observed_at: string;
}

/** Season totals reduced from the gameweek lines. */
export interface SeasonTotals {
  points: number;
  minutes: number;
  goals: number;
  assists: number;
  bonus: number;
  ict: number;
  /** Fixtures in which the player actually appeared — the PPG denominator. */
  appearances: number;
  /** Points per appearance, or null with no appearances to divide by. */
  ppg: number | null;
}

/**
 * Season totals from the gameweek lines, so the card has one source for a
 * number rather than two that can disagree. `players.total_points` and these
 * should match; if they ever don't, this one is the itemised version the
 * Gameweeks tab shows, and agreeing with the tab beside it matters more.
 */
export function seasonTotals(lines: GameweekLine[]): SeasonTotals {
  let points = 0, minutes = 0, goals = 0, assists = 0, bonus = 0, ict = 0, appearances = 0;
  for (const l of lines) {
    points += l.total_points ?? 0;
    minutes += l.minutes ?? 0;
    goals += l.goals_scored ?? 0;
    assists += l.assists ?? 0;
    bonus += l.bonus ?? 0;
    ict += Number(l.ict_index ?? 0);
    if ((l.minutes ?? 0) > 0) appearances++;
  }
  return {
    points, minutes, goals, assists, bonus,
    ict: Math.round(ict * 10) / 10,
    appearances,
    ppg: appearances > 0 ? Math.round((points / appearances) * 10) / 10 : null,
  };
}

/**
 * The context the profile shows below its metrics: set-piece duty,
 * availability, club system, and this gameweek's minutes expectation.
 *
 * Loaded here rather than taken from the caller's `PlayerData` so the profile
 * reads identically from every page. The popover's contract is "the caller
 * supplies it, undefined hides it", which is right for a panel four pages
 * render with different data to hand — but it made the deep-dive card show
 * different sections depending on which page you opened it from, which is
 * not a property a "full profile" should have.
 */
export interface PlayerExtras {
  status: string | null;
  news: string | null;
  chanceOfPlaying: number | null;
  penaltyOrder: number | null;
  freeKickOrder: number | null;
  cornerOrder: number | null;
  /** Club tactical system, context only — never folded into xP. */
  system: string | null;
  expectedMinutes: number | null;
  startProbability: number | null;
  headlines: import("./news-feed").NewsHeadline[];
}

const extrasCache = new Map<string, CacheEntry<PlayerExtras | null>>();

export function loadPlayerExtras(
  season: string,
  playerId: number,
  playerCode: number,
  event: number | null,
): Promise<PlayerExtras | null> {
  return memoise(extrasCache, `${season}:${playerId}:${event ?? "-"}`, async () => {
    const { loadSquadHeadlines } = await import("./news-feed");

    const [playerRes, predRes, headlines] = await Promise.all([
      supabase
        .from("players")
        .select("status, news, chance_of_playing_next_round, penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order, team_id")
        .eq("season", season)
        .eq("id", playerId)
        .maybeSingle(),
      event === null
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from("player_predictions")
            .select("expected_minutes, start_probability")
            .eq("season", season)
            .eq("player_id", playerId)
            .eq("event", event)
            .limit(1)
            .maybeSingle(),
      loadSquadHeadlines(supabase, [playerCode]).catch(() => new Map()),
    ]);

    if (playerRes.error) throw new Error(playerRes.error.message);
    const row = playerRes.data;
    if (!row) return null;

    // Club system comes from the team's Premier League manager profile, via
    // `teams.tactical_manager_id` — the same join /builder makes, and the
    // same one-line summary, rather than a second formatting of it.
    // Context beside the numbers, never applied to them.
    let system: string | null = null;
    const teamId = row.team_id as number | null;
    if (teamId !== null) {
      const { toTacticalProfile, tacticalSummary } = await import("./tactical-profile");
      const { data: team } = await supabase
        .from("teams")
        .select("tactical_manager_id")
        .eq("season", season)
        .eq("id", teamId)
        .maybeSingle();
      const managerKey = team?.tactical_manager_id as string | null | undefined;
      if (managerKey) {
        const { data: mgr } = await supabase
          .from("pl_managers")
          .select("season, manager_key, name, current_club, preferred_formation, buildup_style, pressing_intensity, tactical_traits, modifiers")
          .eq("season", season)
          .eq("manager_key", managerKey)
          .maybeSingle();
        if (mgr) system = tacticalSummary(toTacticalProfile(mgr as never));
      }
    }

    const pred = predRes.data as { expected_minutes: number | null; start_probability: number | null } | null;

    return {
      status: (row.status as string | null) ?? null,
      news: (row.news as string | null) ?? null,
      chanceOfPlaying: (row.chance_of_playing_next_round as number | null) ?? null,
      penaltyOrder: (row.penalties_order as number | null) ?? null,
      freeKickOrder: (row.direct_freekicks_order as number | null) ?? null,
      cornerOrder: (row.corners_and_indirect_freekicks_order as number | null) ?? null,
      system,
      expectedMinutes: pred?.expected_minutes ?? null,
      startProbability: pred?.start_probability ?? null,
      headlines: (headlines as Map<number, import("./news-feed").NewsHeadline[]>).get(playerCode) ?? [],
    };
  });
}

/** Season in/out totals, and the source they came from. */
export interface TransferTotals {
  gwIn: number | null;
  gwOut: number | null;
  seasonIn: number;
  seasonOut: number;
  /**
   * Which source the gameweek figures came from. A finalised event total and
   * a ~2-hourly ownership sample are different quantities, so the card says
   * which one it is rather than presenting them interchangeably.
   */
  gwSource: "finalised" | "sampled" | null;
}

interface CacheEntry<T> {
  at: number;
  promise: Promise<T>;
}

function memoise<T>(cache: Map<string, CacheEntry<T>>, key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  const promise = fetcher().catch((err: unknown) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

const gameweekCache = new Map<string, CacheEntry<GameweekLine[]>>();
const seasonCache = new Map<string, CacheEntry<SeasonLine[]>>();
const priceCache = new Map<string, CacheEntry<PriceChange[]>>();

async function fetchGameweeks(season: string, playerId: number): Promise<GameweekLine[]> {
  const rows: GameweekLine[] = [];
  // One player can't reach 1000 rows in a season, but the API caps every
  // response at 1000 whatever .limit() asks for, and paging until a short
  // page comes back is the house pattern — not a row-count judgement call.
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from("player_gameweek_stats")
      .select(
        "event, fixture, opponent_team, was_home, team_h_score, team_a_score, minutes, total_points, goals_scored, assists, clean_sheets, goals_conceded, own_goals, penalties_saved, penalties_missed, yellow_cards, red_cards, saves, bonus, bps, defensive_contribution, ict_index, value, transfers_in, transfers_out",
      )
      .eq("season", season)
      .eq("player_id", playerId)
      .order("event")
      .order("fixture")
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...(page as unknown as GameweekLine[]));
    if (page.length < PAGE_ROWS) break;
  }
  return rows;
}

/**
 * Every player-fixture this season, oldest first. The Gameweeks tab reverses
 * it for display; the TRANSFERS block on Overview reduces it rather than
 * running a query of its own.
 */
export function loadPlayerGameweeks(season: string, playerId: number): Promise<GameweekLine[]> {
  return memoise(gameweekCache, `${season}:${playerId}`, () => fetchGameweeks(season, playerId));
}

/**
 * Past-season totals, newest first.
 *
 * Keyed on `player_code`, not `player_id`: FPL reassigns `element.id` between
 * seasons, so an id-keyed history would silently attribute one player's past
 * to another after a rollover.
 */
export function loadPlayerSeasons(playerCode: number): Promise<SeasonLine[]> {
  return memoise(seasonCache, String(playerCode), async () => {
    const { data, error } = await supabase
      .from("player_season_history")
      .select("season_name, start_cost, end_cost, total_points, minutes, goals_scored, assists, clean_sheets, bonus, ict_index")
      .eq("player_code", playerCode)
      .order("season_name", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SeasonLine[];
  });
}

/** The most recent price moves, newest first. Empty if never repriced. */
export function loadPlayerPrices(season: string, playerCode: number): Promise<PriceChange[]> {
  return memoise(priceCache, `${season}:${playerCode}`, async () => {
    const { data, error } = await supabase
      .from("player_price_history")
      .select("price, cost_change_event, observed_at")
      .eq("season", season)
      .eq("player_code", playerCode)
      .order("observed_at", { ascending: false })
      .range(0, 19);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PriceChange[];
  });
}

const sampleCache = new Map<string, CacheEntry<{ in: number; out: number } | null>>();

/**
 * This gameweek's transfers in/out from the most recent ownership sample.
 *
 * `player_gameweek_stats` only carries a gameweek's transfer totals once the
 * sync has written that gameweek's rows, which happens after it is played —
 * so mid-week, before a deadline, the finalised figure does not exist yet and
 * the card would show a dash for a number FPL is publishing live. This is the
 * live one. It is a ~2-hourly *sample*, not a settled total, which is why
 * `transferTotals` records which source a figure came from rather than
 * letting the two pass for each other.
 */
export function loadCurrentTransferSample(
  season: string,
  playerCode: number,
): Promise<{ in: number; out: number } | null> {
  return memoise(sampleCache, `${season}:${playerCode}`, async () => {
    const { data, error } = await supabase
      .from("player_ownership_history")
      .select("transfers_in_event, transfers_out_event")
      .eq("season", season)
      .eq("player_code", playerCode)
      .order("observed_at", { ascending: false })
      .range(0, 0);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    if (!row) return null;
    return {
      in: (row.transfers_in_event as number | null) ?? 0,
      out: (row.transfers_out_event as number | null) ?? 0,
    };
  });
}

/**
 * Transfer totals reduced from the gameweek lines — no query of its own.
 *
 * `currentEvent` names the gameweek in flight. Its rows only exist in
 * `player_gameweek_stats` once the sync has written them, so when they are
 * absent the caller should fall back to an ownership sample
 * (`transfers_in_event` / `transfers_out_event` via lib/price-watch.ts) and
 * pass it here — the two mean different things and `gwSource` records which
 * one the number is.
 */
export function transferTotals(
  lines: GameweekLine[],
  currentEvent: number | null,
  sampled?: { in: number; out: number } | null,
): TransferTotals {
  let seasonIn = 0;
  let seasonOut = 0;
  let gwIn: number | null = null;
  let gwOut: number | null = null;

  for (const line of lines) {
    seasonIn += line.transfers_in ?? 0;
    seasonOut += line.transfers_out ?? 0;
    if (currentEvent !== null && line.event === currentEvent) {
      // A double gameweek has two rows for one event — sum them.
      gwIn = (gwIn ?? 0) + (line.transfers_in ?? 0);
      gwOut = (gwOut ?? 0) + (line.transfers_out ?? 0);
    }
  }

  if (gwIn === null && sampled) {
    return { gwIn: sampled.in, gwOut: sampled.out, seasonIn, seasonOut, gwSource: "sampled" };
  }
  return { gwIn, gwOut, seasonIn, seasonOut, gwSource: gwIn === null ? null : "finalised" };
}
