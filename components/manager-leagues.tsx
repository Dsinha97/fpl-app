// The manager's classic leagues (Sprint 21) — grouped by FPL's own
// `league_type` field, the only split the API actually gives ('s' = system,
// covering both general leagues FPL creates itself like Overall/Gameweek 1
// and broadcaster tie-ins, and 'x' = invitational, a private code-joined
// league). No finer split is invented — see docs/sprints/sprint-21.md for
// why a hardcoded "broadcaster" id list was rejected.

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

export function ManagerLeagues({ leagues }: { leagues: ManagerLeagueRow[] }) {
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
        {GROUPS.map(({ type, title }) => {
          const rows = leagues.filter((l) => l.league_type === type);
          if (rows.length === 0) return null;
          return (
            <div key={type}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h3>
              <ul className="mt-1.5 divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-card dark:divide-purple-900/30 dark:border-purple-900/40">
                {rows.map((l) => {
                  const move = movement(l);
                  return (
                    <li
                      key={l.league_id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
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
