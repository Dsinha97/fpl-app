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
        "event, fixture, opponent_team, was_home, team_h_score, team_a_score, minutes, total_points, goals_scored, assists, clean_sheets, goals_conceded, own_goals, penalties_saved, penalties_missed, yellow_cards, red_cards, saves, bonus, bps, defensive_contribution, value, transfers_in, transfers_out",
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
