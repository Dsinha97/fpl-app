"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { InfoTooltip } from "@/components/info-tooltip";
import { listDrafts, resolveRequestedDraft } from "@/lib/drafts";
import { loadSeasonContext } from "@/lib/season-context";
import {
  CHIP_LABELS,
  runChipEngine,
  type ChipDefinitionRow,
  type ChipKind,
  type ChipValuation,
  type EventFixtureCounts,
  type EventPrediction,
} from "@/lib/chips";
import {
  DEFAULT_RULES,
  type PlayerMeta,
  type SquadRules,
  type TeamState,
} from "@/lib/team-state";
import { availabilityFromStatus, type ScoredPlayer } from "@/lib/scoring";

interface PlayerRow {
  id: number;
  web_name: string;
  team_id: number;
  element_type: number;
  now_cost: number | null;
  selected_by_percent: number | null;
  status: string | null;
  chance_of_playing_next_round: number | null;
  penalties_order: number | null;
}

/** The API caps every response at 1000 rows however big `.limit()` asks — see CLAUDE.md. */
const PAGE_ROWS = 1000;
const FALLBACK_SEASON_WINDOW = 8;
const CHIP_ORDER: ChipKind[] = ["wildcard", "freehit", "bboost", "3xc"];

const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

export default function ChipsPage() {
  const [drafts, setDrafts] = useState<TeamState[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);

  const [rowById, setRowById] = useState<Map<number, PlayerRow>>(new Map());
  const [pool, setPool] = useState<ScoredPlayer[]>([]);
  const [predsByPlayer, setPredsByPlayer] = useState<Map<number, Map<number, EventPrediction>>>(new Map());
  const [chipDefinitions, setChipDefinitions] = useState<ChipDefinitionRow[]>([]);
  const [fixturesPerEvent, setFixturesPerEvent] = useState<Map<number, EventFixtureCounts>>(new Map());
  const [rules, setRules] = useState<SquadRules>(DEFAULT_RULES);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [windowEnd, setWindowEnd] = useState(FALLBACK_SEASON_WINDOW);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The inline model-note banner below — collapsed by default so it doesn't
   * eat the whole screen on mobile. Same text is always in the header
   * tooltip too; see the comment at the banner itself. */
  const [noteOpen, setNoteOpen] = useState(false);

  useEffect(() => {
    const list = listDrafts();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(list);
    // Builder and Scenario Lab link here with ?draft=<id>; fall back to the
    // most recently saved draft when the id is absent or stale.
    const requested = resolveRequestedDraft(list, window.location.search);
    setDraftId(requested?.draftId ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const ctx = await loadSeasonContext();
        const gw = { season: ctx.season, id: ctx.nextEvent };
        setWindowStart(ctx.nextEvent);
        setWindowEnd(ctx.windowEnd);
        setRules(ctx.rules);

        const [playersRes, chipsRes, fixturesRes] = await Promise.all([
          supabase
            .from("players")
            .select(
              "id, web_name, team_id, element_type, now_cost, selected_by_percent, status, chance_of_playing_next_round, penalties_order",
            )
            .eq("season", gw.season)
            .limit(1000),
          // Every chip, both season halves — unlike /transfers this page must
          // show the second half as blocked rather than filter it away.
          supabase
            .from("chip_definitions")
            .select("name, start_event, stop_event")
            .eq("season", gw.season),
          supabase
            .from("fixtures")
            .select("event, team_h, team_a")
            .eq("season", gw.season)
            .order("event"),
        ]);
        if (playersRes.error) throw new Error(playersRes.error.message);

        setChipDefinitions(
          (chipsRes.data ?? []).map((r) => ({
            name: r.name as string,
            startEvent: r.start_event as number,
            stopEvent: r.stop_event as number,
          })),
        );

        // Blank/double counts, measured — never hardcoded. Feeds CHIP_MODEL_NOTE.
        const counts = new Map<number, EventFixtureCounts>();
        const clubsByEvent = new Map<number, Set<number>>();
        for (const f of fixturesRes.data ?? []) {
          const e = f.event as number | null;
          if (e === null) continue;
          const cur = counts.get(e) ?? { fixtureSlots: 0, distinctClubs: 0 };
          cur.fixtureSlots += 1;
          counts.set(e, cur);
          let s = clubsByEvent.get(e);
          if (!s) clubsByEvent.set(e, (s = new Set()));
          s.add(f.team_h as number);
          s.add(f.team_a as number);
        }
        for (const [e, s] of clubsByEvent) counts.get(e)!.distinctClubs = s.size;
        setFixturesPerEvent(counts);

        // Paged deliberately — see PAGE_ROWS. Carries the columns /transfers
        // doesn't need: expected_minutes, start_probability and availability,
        // which the lineup/captain maths inside lib/chips.ts requires per event.
        const preds = new Map<number, Map<number, EventPrediction>>();
        for (let from = 0; ; from += PAGE_ROWS) {
          const { data: page, error: pageError } = await supabase
            .from("player_predictions")
            .select("player_id, event, expected_minutes, start_probability, availability, fdr, xp")
            .eq("season", gw.season)
            .gte("event", gw.id)
            .order("player_id")
            .order("event")
            .range(from, from + PAGE_ROWS - 1);
          if (pageError) throw new Error(pageError.message);
          for (const r of page ?? []) {
            const id = r.player_id as number;
            let byEvent = preds.get(id);
            if (!byEvent) preds.set(id, (byEvent = new Map()));
            byEvent.set(r.event as number, {
              expectedMinutes: r.expected_minutes as number | null,
              startProbability: r.start_probability as number | null,
              availability: (r.availability as number | null) ?? 0,
              fdr: r.fdr as number | null,
              xp: r.xp as number | null,
            });
          }
          if ((page?.length ?? 0) < PAGE_ROWS) break;
        }
        setPredsByPlayer(preds);

        const rows = (playersRes.data ?? []) as PlayerRow[];
        setRowById(new Map(rows.map((p) => [p.id, p])));

        const scored: ScoredPlayer[] = rows.map((p) => {
          const availability = availabilityFromStatus(p.status, p.chance_of_playing_next_round);
          return {
            id: p.id,
            webName: p.web_name,
            elementType: p.element_type,
            teamId: p.team_id,
            teamShort: null,
            price: p.now_cost ?? 0,
            ownership: p.selected_by_percent,
            pointsPerGame: null,
            xp: { 1: null, 3: null, 5: null, 8: null, 19: null, season: null },
            expectedMinutes: null,
            startProbability: null,
            availability,
            fdrRun: [],
          };
        });
        setPool(scored);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const team = useMemo(() => drafts.find((d) => d.draftId === draftId) ?? null, [drafts, draftId]);

  const lookup = useMemo(() => {
    return (id: number): PlayerMeta | undefined => {
      const p = rowById.get(id);
      if (!p) return undefined;
      return { id: p.id, elementType: p.element_type, teamId: p.team_id, nowCost: p.now_cost ?? 0, webName: p.web_name };
    };
  }, [rowById]);

  const isPenaltyTaker = useMemo(() => {
    return (id: number) => rowById.get(id)?.penalties_order === 1;
  }, [rowById]);

  const availabilityOf = useMemo(() => {
    const byId = new Map(pool.map((p) => [p.id, p.availability]));
    return (id: number) => byId.get(id) ?? 0;
  }, [pool]);

  const predAt = useMemo(() => {
    return (playerId: number, event: number) => predsByPlayer.get(playerId)?.get(event);
  }, [predsByPlayer]);

  const result = useMemo(() => {
    if (!team || pool.length === 0 || windowStart === null) return null;
    if (team.players.length !== rules.squadSize) return null;
    return runChipEngine({
      team,
      pool,
      lookup,
      predAt,
      availabilityOf,
      isPenaltyTaker,
      rules,
      chipDefinitions,
      fixturesPerEvent,
      windowStart,
      windowEnd,
    });
  }, [
    team,
    pool,
    lookup,
    predAt,
    availabilityOf,
    isPenaltyTaker,
    rules,
    chipDefinitions,
    fixturesPerEvent,
    windowStart,
    windowEnd,
  ]);

  const byChipEvent = useMemo(() => {
    const map = new Map<ChipKind, Map<number, ChipValuation>>();
    if (!result) return map;
    for (const chip of CHIP_ORDER) {
      map.set(chip, new Map(result.valuationsByChip[chip].map((v) => [v.event, v])));
    }
    return map;
  }, [result]);

  const events = useMemo(() => {
    if (windowStart === null) return [];
    return Array.from({ length: windowEnd - windowStart + 1 }, (_, i) => windowStart + i);
  }, [windowStart, windowEnd]);

  const topOf = (chip: ChipKind, n = 5) =>
    (result?.valuationsByChip[chip] ?? [])
      .filter((v) => v.blocked === null)
      .slice()
      .sort((a, b) => b.gain - a.gain)
      .slice(0, n);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Chip Strategy
            {result && (
              <InfoTooltip label="What do these numbers assume?">
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{result.note}</p>
              </InfoTooltip>
            )}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Which gameweek is each chip worth the most — and how much better than the alternative.
          </p>
        </div>
        {drafts.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            Squad
            <select
              value={draftId ?? ""}
              onChange={(e) => setDraftId(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
            >
              {drafts.map((d) => (
                <option key={d.draftId} value={d.draftId}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-zinc-500">Loading player data…</p>}

      {!loading && drafts.length === 0 && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 text-center dark:border-purple-900/40 dark:bg-[#1E0234]">
          <p className="text-sm text-zinc-500">
            No saved squads yet. Build one in the{" "}
            <Link
              href="/builder"
              className="font-medium text-purple-700 underline-offset-2 hover:underline dark:text-[#00FF87]"
            >
              Team Builder
            </Link>{" "}
            first.
          </p>
        </div>
      )}

      {team && !loading && team.players.length !== rules.squadSize && (
        <p className="mt-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          {team.name} has {team.players.length} of {rules.squadSize} players. Chip values need a
          complete squad.
        </p>
      )}

      {result && team && (
        <>
          {/* fixture-flatness disclosure, spelled out rather than only in the
              tooltip — collapsed by default so the note doesn't push every
              schedule below the fold on a phone. */}
          <div className="mt-4 overflow-hidden rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40">
            <button
              onClick={() => setNoteOpen((v) => !v)}
              aria-expanded={noteOpen}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs leading-relaxed text-amber-800 dark:text-amber-300"
            >
              <span
                aria-hidden="true"
                className={`shrink-0 text-amber-600 transition-transform dark:text-amber-400 ${noteOpen ? "" : "rotate-180"}`}
              >
                ⌃
              </span>
              <span className={`min-w-0 flex-1 ${noteOpen ? "" : "truncate"}`}>{result.note}</span>
            </button>
          </div>

          {/* per-half schedules — FPL grants each chip once per half, so these
              are two independent decisions, not one combined total. */}
          {result.schedules.map((half) => (
            <section
              key={half.label}
              className="mt-5 rounded-xl border border-purple-300 bg-white p-4 dark:border-[#00FF87]/40 dark:bg-[#1E0234]"
            >
              <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Chip schedule · {half.label}
              </h2>

              {half.oneOff && (
                <>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {half.oneOff.entries
                      .slice()
                      .sort((a, b) => a.event - b.event)
                      .map((e) => (
                        <div
                          key={e.chip}
                          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-purple-900/40"
                        >
                          <span className="font-medium text-zinc-800 dark:text-zinc-200">
                            {CHIP_LABELS[e.chip]}
                          </span>
                          <span className="ml-1.5 text-zinc-500">GW{e.event}</span>
                          <span className="ml-1.5 tabular-nums text-purple-800 dark:text-[#00FF87]">
                            {signed(e.gain)}
                          </span>
                        </div>
                      ))}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Bench Boost + Triple Captain + Free Hit total {signed(half.oneOff.total)} xP.{" "}
                    {half.oneOff.margin < 1
                      ? `The next-best combination of gameweeks is within ${half.oneOff.margin.toFixed(1)} points — treat this as illustrative, not a recommendation.`
                      : `${half.oneOff.margin.toFixed(1)} points clear of the next-best combination of gameweeks.`}
                  </p>
                </>
              )}

              {/* Wildcard shown on its own — a cumulative gain over the rest of
                  the half, not a single gameweek, so it is never summed with
                  the one-off total above. */}
              {half.wildcard && (
                <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3 dark:border-purple-900/40">
                  <div className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-purple-900/40">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">Wildcard</span>
                    <span className="ml-1.5 text-zinc-500">GW{half.wildcard.event}</span>
                    <span className="ml-1.5 tabular-nums text-purple-800 dark:text-[#00FF87]">
                      {signed(half.wildcard.gain)}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500">
                    cumulative through GW{half.stopEvent} — not added to the total above
                  </span>
                </div>
              )}

              {!half.oneOff && !half.wildcard && (
                <p className="mt-2 text-xs text-zinc-500">Nothing evaluable in this half yet.</p>
              )}
            </section>
          ))}

          {/* per-chip shortlists */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {CHIP_ORDER.map((chip) => {
              const top = topOf(chip);
              const window = result.windows.find((w) => w.chip === chip && w.blocked === null);
              const blockedWindows = result.windows.filter((w) => w.chip === chip && w.blocked !== null);
              return (
                <section
                  key={chip}
                  className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]"
                >
                  <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {CHIP_LABELS[chip]}
                  </h3>
                  {top.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-500">
                      {window ? "Nothing evaluable in this window yet." : "No open window this season."}
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {top.map((v, i) => (
                        <li key={v.event} className="flex items-baseline justify-between gap-2">
                          <span className="text-zinc-700 dark:text-zinc-300">
                            {i === 0 && (
                              <span className="mr-1.5 rounded bg-purple-950 px-1.5 py-0.5 text-[10px] font-medium text-white dark:bg-[#00FF87] dark:text-slate-950">
                                Best
                              </span>
                            )}
                            GW{v.event}
                          </span>
                          <span className="tabular-nums font-semibold text-purple-800 dark:text-[#00FF87]">
                            {signed(v.gain)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {top.length >= 2 && Math.abs(top[0].gain - top[1].gain) < 0.5 && (
                    <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                      Top {Math.min(top.length, 3)} gameweeks are within{" "}
                      {(top[0].gain - top[Math.min(top.length, 3) - 1].gain).toFixed(1)} points of each
                      other — this is not a strong recommendation.
                    </p>
                  )}
                  {top[0]?.explanation.map((line, i) => (
                    <p key={i} className="mt-2 text-[11px] text-zinc-500">
                      {line}
                    </p>
                  ))}
                  {blockedWindows.map((w) => (
                    <p key={`${w.startEvent}-${w.stopEvent}`} className="mt-2 text-[11px] text-zinc-400">
                      GW{w.startEvent}–{w.stopEvent}: {w.blocked}
                    </p>
                  ))}
                </section>
              );
            })}
          </div>

          {/* full calendar */}
          <section className="mt-5 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Gameweek by gameweek
            </h2>
            <table className="mt-2 w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                  <th className="py-1.5 pr-2">GW</th>
                  {CHIP_ORDER.map((chip) => (
                    <th key={chip} className="py-1.5 pr-2 text-right">
                      {CHIP_LABELS[chip]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={event}
                    className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30"
                  >
                    <td className="py-1 pr-2 text-zinc-500">{event}</td>
                    {CHIP_ORDER.map((chip) => {
                      const v = byChipEvent.get(chip)?.get(event);
                      return (
                        <td
                          key={chip}
                          className="py-1 pr-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300"
                          title={v?.blocked ?? undefined}
                        >
                          {v && !v.blocked ? signed(v.gain) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
