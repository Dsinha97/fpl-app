// The manager's classic leagues (Sprint 21) — grouped by FPL's own
// `league_type` field, the only split the API actually gives ('s' = system,
// covering both general leagues FPL creates itself like Overall/Gameweek 1
// and broadcaster tie-ins, and 'x' = invitational, a private code-joined
// league). No finer split is invented — see docs/sprints/sprint-21.md for
// why a hardcoded "broadcaster" id list was rejected.
//
// 2026-09-10: FPL turned out to have at least a third value — one `c` league
// was found on a live entry. This used to filter to the two known types and
// drop anything else on the floor, so such a league would simply not appear,
// with nothing to say it had been hidden. Unknown types now get their own
// group. A league in a vaguely-named bucket is a much smaller problem than a
// league the reader has no way of knowing exists.

import { ChevronRight } from "lucide-react";

export interface ManagerLeagueRow {
  league_id: number;
  name: string;
  league_type: string;
  entry_rank: number | null;
  entry_last_rank: number | null;
  rank_count: number | null;
}

const GROUPS: { type: string; title: string }[] = [
  { type: "x", title: "Invitational leagues" },
  { type: "s", title: "General & broadcaster leagues" },
];

const KNOWN_TYPES = new Set(GROUPS.map((g) => g.type));
const OTHER_TYPE = "__other";

/** The two known groups, plus a catch-all only when something needs it. */
function groupsFor(leagues: ManagerLeagueRow[]): { type: string; title: string }[] {
  const hasUnknown = leagues.some((l) => !KNOWN_TYPES.has(l.league_type));
  return hasUnknown ? [...GROUPS, { type: OTHER_TYPE, title: "Other leagues" }] : GROUPS;
}

function rankLabel(l: ManagerLeagueRow): string {
  // FPL zeroes entry_rank pre-season (verified 2026-08-21) — a "#0" reads as
  // a real rank rather than "not published yet", so this renders "—" for
  // any non-positive or missing value instead of the raw number.
  return l.entry_rank && l.entry_rank > 0 ? `#${l.entry_rank}` : "—";
}

/** Movement since the last time FPL recorded a rank — null when either side is unpublished. */
function movement(l: ManagerLeagueRow): number | null {
  if (!l.entry_rank || l.entry_rank <= 0 || !l.entry_last_rank || l.entry_last_rank <= 0) return null;
  return l.entry_last_rank - l.entry_rank; // positive = moved up (lower rank number)
}

interface ManagerLeaguesProps {
  leagues: ManagerLeagueRow[];
  /** Sprint 29.1 — /leagues reuses this same grouping as a clickable picker
   *  rather than a second implementation of "invitational vs general" (see
   *  GROUPS above). /team omits these two props and keeps its original
   *  read-only rows. */
  onSelect?: (leagueId: number) => void;
  selectedLeagueId?: number | null;
}

export function ManagerLeagues({ leagues, onSelect, selectedLeagueId }: ManagerLeaguesProps) {
  if (leagues.length === 0) return null;

  const prePublished = leagues.every((l) => l.rank_count === null && (!l.entry_rank || l.entry_rank <= 0));

  return (
    <div>
      {prePublished && (
        <p className="text-xs text-zinc-500">
          Ranks show once FPL publishes standings, after the first gameweek is scored.
        </p>
      )}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {groupsFor(leagues).map(({ type, title }) => {
          const rows = type === OTHER_TYPE
            ? leagues.filter((l) => !KNOWN_TYPES.has(l.league_type))
            : leagues.filter((l) => l.league_type === type);
          if (rows.length === 0) return null;
          return (
            <div key={type}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h3>
              <ul className="mt-1.5 divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-card dark:divide-purple-900/30 dark:border-purple-900/40">
                {rows.map((l) => {
                  const move = movement(l);
                  const selected = selectedLeagueId === l.league_id;
                  const content = (
                    <>
                      <span className="truncate text-zinc-800 dark:text-zinc-200">{l.name}</span>
                      <span className="flex shrink-0 items-center gap-1 tabular-nums text-zinc-500">
                        {rankLabel(l)}
                        {move !== null && move !== 0 && (
                          <span
                            className={move > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
                            title={`${move > 0 ? "Up" : "Down"} ${Math.abs(move)} since last recorded`}
                          >
                            {move > 0 ? "▲" : "▼"}
                            {Math.abs(move)}
                          </span>
                        )}
                      </span>
                    </>
                  );
                  return (
                    <li key={l.league_id}>
                      {onSelect ? (
                        // A clickable row and a static one (below) used to render
                        // identical markup — nothing but a hover background told
                        // them apart, which only shows up on mouse-over. The
                        // trailing chevron is a permanent, at-rest affordance;
                        // cursor-pointer is redundant with the native button
                        // default but keeps the intent visible in the class list.
                        <button
                          type="button"
                          onClick={() => onSelect(l.league_id)}
                          aria-pressed={selected}
                          className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-purple-950/30 ${
                            selected ? "bg-purple-50 dark:bg-purple-950/40" : ""
                          }`}
                        >
                          <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                            {content}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
