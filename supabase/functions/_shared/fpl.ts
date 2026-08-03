// Thin client for the official FPL API.
//
// The FPL API is unauthenticated but does throttle, so every call goes through
// a single place with a timeout, bounded retries, and exponential backoff.

const FPL_BASE = "https://fantasy.premierleague.com/api";
const USER_AGENT = "fpl-app/0.1 (+https://github.com/Dsinha97/fpl-app)";

export class FplHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "FplHttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fplFetch<T>(
  path: string,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${FPL_BASE}${path}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        // 4xx other than 429 will not fix themselves; fail fast.
        const retryable = res.status === 429 || res.status >= 500;
        const err = new FplHttpError(res.status, `GET ${path} returned ${res.status}`);
        if (!retryable) throw err;
        lastError = err;
      } else {
        return await res.json() as T;
      }
    } catch (err) {
      if (err instanceof FplHttpError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
    }

    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }

  throw lastError;
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
  game_settings: Record<string, unknown>;
  game_config: {
    scoring: Record<string, number | Record<string, number> | null>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export const getBootstrap = () => fplFetch<Bootstrap>("/bootstrap-static/");

// -------------------------------------------------------- manager entry

export interface Entry {
  id: number;
  name: string;
  player_first_name: string | null;
  player_last_name: string | null;
  entered_events: number[];
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
