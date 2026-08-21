// Thin client for the official FPL API.
//
// The FPL API is unauthenticated but does throttle, so every call goes through
// a single place with a timeout, bounded retries, and exponential backoff —
// now shared with sync-news's RSS fetches via _shared/http.ts, rather than a
// second copy of the same retry loop.

import { fetchWithRetry, HttpError } from "./http.ts";

const FPL_BASE = "https://fantasy.premierleague.com/api";
// Courtesy contact point sent to FPL on every request. Points at the live site
// rather than the repository, which is private and would 404 for anyone who
// followed it.
const USER_AGENT = "fpl-app/0.1 (+https://fpl-app.deepayansinha.workers.dev)";

export class FplHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "FplHttpError";
  }
}

export async function fplFetch<T>(
  path: string,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  try {
    const text = await fetchWithRetry(`${FPL_BASE}${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      retries: opts.retries,
      timeoutMs: opts.timeoutMs,
    });
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof HttpError) throw new FplHttpError(err.status, err.message);
    throw err;
  }
}

// ---------------------------------------------------------------- types
// Only the fields we read explicitly. Everything else rides along in `raw`.

export interface BootstrapTeam {
  id: number;
  code: number;
  name: string;
  short_name: string;
  [k: string]: unknown;
}

export interface BootstrapElementType {
  id: number;
  singular_name: string;
  singular_name_short: string;
  plural_name: string;
  plural_name_short: string;
  [k: string]: unknown;
}

export interface BootstrapEvent {
  id: number;
  name: string;
  deadline_time: string;
  [k: string]: unknown;
}

export interface BootstrapElement {
  id: number;
  code: number;
  team: number;
  element_type: number;
  [k: string]: unknown;
}

export interface BootstrapChip {
  name: string;
  number: number;
  start_event: number;
  stop_event: number | null;
  chip_type?: string;
  [k: string]: unknown;
}

export interface Bootstrap {
  teams: BootstrapTeam[];
  element_types: BootstrapElementType[];
  events: BootstrapEvent[];
  elements: BootstrapElement[];
  chips: BootstrapChip[];
  /**
   * Total FPL entries right now — a moving target, not a season constant. It
   * reads ~2.9M in early August and climbs toward ~11M by GW1, a ~4x swing.
   * Captured into game_settings alongside `updated_at` (which the table's
   * trigger already stamps), so a reader can see when the figure was sampled
   * rather than mistake a pre-season snapshot for a settled field size.
   */
  total_players: number;
  game_settings: Record<string, unknown>;
  game_config: {
    scoring: Record<string, number | Record<string, number> | null>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export const getBootstrap = () => fplFetch<Bootstrap>("/bootstrap-static/");

// -------------------------------------------------------- manager entry

export interface EntryLeague {
  id: number;
  name: string;
  /** 's' = system (general/broadcaster leagues FPL creates), 'x' = invitational (code-joined). */
  league_type: string;
  scoring: string;
  start_event: number;
  entry_rank: number | null;
  entry_last_rank: number | null;
  rank_count: number | null;
  [k: string]: unknown;
}

export interface Entry {
  id: number;
  name: string;
  player_first_name: string | null;
  player_last_name: string | null;
  entered_events: number[];
  leagues?: {
    classic?: EntryLeague[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface EntryHistory {
  current: Record<string, unknown>[];
  past: {
    season_name: string;
    total_points: number;
    rank: number;
    rank_percentage?: string;
    [k: string]: unknown;
  }[];
  chips: { name: string; time: string; event: number }[];
}

export interface EntryPicks {
  active_chip: string | null;
  entry_history: Record<string, unknown>;
  picks: {
    element: number;
    position: number;
    multiplier: number;
    is_captain: boolean;
    is_vice_captain: boolean;
    [k: string]: unknown;
  }[];
}

export type EntryTransfer = Record<string, unknown>;

export const getEntry = (entryId: number) => fplFetch<Entry>(`/entry/${entryId}/`);

export const getEntryHistory = (entryId: number) =>
  fplFetch<EntryHistory>(`/entry/${entryId}/history/`);

export const getEntryTransfers = (entryId: number) =>
  fplFetch<EntryTransfer[]>(`/entry/${entryId}/transfers/`);

/** Returns null when picks are not yet published for the event (404). */
export async function getEntryPicks(entryId: number, event: number): Promise<EntryPicks | null> {
  try {
    return await fplFetch<EntryPicks>(`/entry/${entryId}/event/${event}/picks/`);
  } catch (err) {
    if (err instanceof FplHttpError && err.status === 404) return null;
    throw err;
  }
}

// -------------------------------------------------------------- leagues

export interface LeagueStandingEntry {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  rank_sort: number;
  last_rank: number;
  total: number;
  event_total: number;
  [k: string]: unknown;
}

export interface ClassicLeagueStandingsPage {
  league: { id: number; name: string; max_entries: number | null; [k: string]: unknown };
  standings: {
    has_next: boolean;
    page: number;
    results: LeagueStandingEntry[];
  };
}

/** One page (50 entries) of a classic league's standings. */
export const getClassicLeagueStandings = (leagueId: number, page: number) =>
  fplFetch<ClassicLeagueStandingsPage>(`/leagues-classic/${leagueId}/standings/?page_standings=${page}`);

// ------------------------------------------------------------- fixtures

export interface Fixture {
  id: number;
  code: number;
  event: number | null;
  kickoff_time: string | null;
  team_h: number;
  team_a: number;
  [k: string]: unknown;
}

export const getFixtures = () => fplFetch<Fixture[]>("/fixtures/");

// ------------------------------------------------------ element summary

export interface ElementSummary {
  fixtures: Record<string, unknown>[];
  history: Record<string, unknown>[];
  history_past: Record<string, unknown>[];
}

export const getElementSummary = (elementId: number) =>
  fplFetch<ElementSummary>(`/element-summary/${elementId}/`);

// ------------------------------------------------------------ live data

export interface LiveElement {
  id: number;
  stats: Record<string, unknown>;
  explain: unknown[];
}

export const getLive = (event: number) =>
  fplFetch<{ elements: LiveElement[] }>(`/event/${event}/live/`);

// --------------------------------------------------------- concurrency
/**
 * Map over items with at most `limit` requests in flight. Used to keep the
 * 564-call player-history pass fast without hammering the FPL API.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}
