"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { InfoTooltip } from "@/components/info-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { listDrafts, resolveRequestedDraft, saveDraft } from "@/lib/drafts";
import { loadSeasonContext } from "@/lib/season-context";
import { resolveStopEvent, setChipPlanEntry } from "@/lib/chip-plan";
import {
  CHIP_LABELS,
  runChipEngine,
  type ChipDefinitionRow,
  type ChipHalfSchedule,
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
  /** id -> deadline, for the Break Pivot preset's calendar gap. */
  const [deadlineByEvent, setDeadlineByEvent] = useState<Map<number, string>>(new Map());
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
  const [applied, setApplied] = useState<string | null>(null);

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

        const [playersRes, chipsRes, fixturesRes, gwRes] = await Promise.all([
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
          supabase
            .from("gameweeks")
            .select("id, deadline_time")
            .eq("season", gw.season)
            .order("id"),
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

        setDeadlineByEvent(
          new Map((gwRes.data ?? []).map((r) => [r.id as number, r.deadline_time as string])),
        );

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

  /**
   * `runChipEngine` walks every chip's whole window, a real bounded search
   * over up to a season's gameweeks — it used to sit in a bare useMemo and
   * freeze the tab on every recompute, with no busy indicator at all (unlike
   * `/transfers`, this page had none to begin with). Gated the same way as
   * `optimizeTransfers` above: button-triggered, one setTimeout(0) so a busy
   * state can paint, auto-run once on first load, and a signature so
   * switching drafts surfaces "re-run" instead of quietly recomputing (or,
   * worse, showing the previous draft's schedule under the new draft's name).
   */
  const [result, setResult] = useState<ReturnType<typeof runChipEngine> | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultSignature, setResultSignature] = useState<string | null>(null);

  const resultSignatureInputs = useMemo(
    () =>
      JSON.stringify({
        draftId: team?.draftId ?? null,
        playerIds: team ? team.players.map((p) => p.playerId).join(",") : null,
        windowStart,
        windowEnd,
      }),
    [team, windowStart, windowEnd],
  );
  const resultStale =
    result !== null && resultSignature !== null && resultSignature !== resultSignatureInputs;
  const resultReady =
    !!team && pool.length > 0 && windowStart !== null && team.players.length === rules.squadSize;

  const runResult = useCallback(() => {
    if (!team || pool.length === 0 || windowStart === null) return;
    if (team.players.length !== rules.squadSize) return;
    setResultLoading(true);
    setTimeout(() => {
      const next = runChipEngine({
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
      setResult(next);
      setResultSignature(resultSignatureInputs);
      setResultLoading(false);
    }, 0);
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
    resultSignatureInputs,
  ]);

  useEffect(() => {
    if (!resultReady || result !== null || resultLoading) return;
    const t = setTimeout(runResult, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultReady]);

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

  /**
   * Writes straight to the draft's `chipPlan` — /chips is otherwise
   * read-only, so this is the one place on the page that calls `saveDraft`.
   * Follows the same fork-not-mutate exception `/transfers`' chip editor
   * already established: a chip plan is a property of the squad you hold,
   * not a transfer result, so it writes in place.
   */
  const pinChip = (chip: ChipKind, event: number) => {
    if (!team) return;
    saveDraft({ ...team, chipPlan: setChipPlanEntry(team.chipPlan, chip, event, "shortlist") });
    setDrafts(listDrafts());
    setApplied(`Pinned ${CHIP_LABELS[chip]} to GW${event} on "${team.name}".`);
  };

  const pinSchedule = (half: ChipHalfSchedule) => {
    if (!team) return;
    const entries: { chip: ChipKind; event: number }[] = [];
    if (half.oneOff) for (const e of half.oneOff.entries) entries.push({ chip: e.chip, event: e.event });
    if (half.wildcard) entries.push({ chip: "wildcard", event: half.wildcard.event });
    if (entries.length === 0) return;
    let plan = team.chipPlan;
    for (const e of entries) plan = setChipPlanEntry(plan, e.chip, e.event, "shortlist");
    saveDraft({ ...team, chipPlan: plan });
    setDrafts(listDrafts());
    setApplied(`Pinned the ${half.label} schedule (${entries.length} chip${entries.length === 1 ? "" : "s"}) to "${team.name}".`);
  };

  /**
   * Calendar-derived starting points for a chip sequence — not the video's
   * GW4/GW8 dates (a different season's calendar), and not a recommendation:
   * a suggested set of pins the owner can move afterward, same as any other
   * pin on this page. Each candidate is checked against its chip's real
   * `chip_definitions` window before being offered; one whose gameweeks
   * don't fit is simply omitted rather than shown broken.
   *
   * Only these three chips carry a bonus/rebuild worth sequencing —
   * `runChipEngine`'s existing schedule cards above already answer "when is
   * each chip individually best"; this answers a different question ("what
   * if I front-load them") that nothing else on this page asks.
   */
  const presets = useMemo(() => {
    if (windowStart === null || chipDefinitions.length === 0) return [];
    // chip_definitions carries one row PER CHIP PER HALF (two "bboost" rows,
    // two "wildcard" rows, ...) — collapsing that into one Map keyed by name
    // silently keeps whichever half's row the array order puts last, which
    // is wrong for a chip whose event falls in the other half. Caught
    // immediately: presets computed to 0 on live data because "bboost" and
    // "3xc" resolved to their GW20-38 window while GW1 was being checked.
    const fits = (chip: ChipKind, event: number) =>
      chipDefinitions.some(
        (d) => d.name === chip && event >= d.startEvent && event <= resolveStopEvent(d, windowEnd),
      );
    const halfDefOf = (chip: ChipKind, atEvent: number) =>
      chipDefinitions.find(
        (d) => d.name === chip && atEvent >= d.startEvent && atEvent <= resolveStopEvent(d, windowEnd),
      );

    const out: { label: string; entries: { chip: ChipKind; event: number }[]; note: string }[] = [];

    // Front-loaded: BB this gameweek, FH the next, WC the one after — the
    // source's headline sequence. Only offered when it is actually still the
    // opening of the season (a "front-loaded" sequence starting mid-season
    // contradicts its own premise), even though the windows alone might fit.
    const frontLoaded: { chip: ChipKind; event: number }[] = [
      { chip: "bboost", event: windowStart },
      { chip: "freehit", event: windowStart + 1 },
      { chip: "wildcard", event: windowStart + 2 },
    ];
    if (windowStart <= 2 && frontLoaded.every((e) => fits(e.chip, e.event))) {
      out.push({
        label: "Front-loaded",
        entries: frontLoaded,
        note:
          `Bench Boost GW${windowStart}, Free Hit GW${windowStart + 1}, Wildcard GW${windowStart + 2} — ` +
          "spends all three first-half one-off/rebuild chips inside the opening month. Weigh this against " +
          "the Effective Starting XI Budget above: a minimum-cost bench (the cheapest legal one) makes the " +
          "Bench Boost gain small, since there is barely anything to boost.",
      });
    }

    // Early-information anchor: a Wildcard after a few real gameweeks, once
    // starts/minutes/form for the season begin to diverge from the
    // prior-seasons prior every projection is currently built from.
    const EARLY_INFO_GAP = 3;
    const earlyAnchorEvent = windowStart + EARLY_INFO_GAP;
    if (fits("wildcard", earlyAnchorEvent)) {
      out.push({
        label: "Early-information anchor",
        entries: [{ chip: "wildcard", event: earlyAnchorEvent }],
        note: `Wildcard GW${earlyAnchorEvent} — ${EARLY_INFO_GAP} gameweeks of real starts/minutes/form before committing, instead of GW${windowStart}'s pure prior-season rates.`,
      });
    }

    // Break pivot: a Wildcard timed to the largest real gap between
    // deadlines in the current half — computed from gameweeks.deadline_time,
    // not the source's GW8 (a different season's international-break dates).
    // Wildcard's own window never covers GW1 (it opens GW2, per this
    // season's real chip_definitions), so it can't answer "what half is
    // windowStart in" when windowStart is GW1 — halfDefOf("wildcard", 1)
    // finds nothing and the gap search silently ran over zero gameweeks.
    // Bench Boost's window does cover GW1, and all four chips share the same
    // two half boundaries, so it locates the half correctly regardless of
    // which gameweek windowStart is.
    const currentHalf = halfDefOf("bboost", windowStart);
    const halfEnd = currentHalf ? resolveStopEvent(currentHalf, windowEnd) : windowStart;
    let biggestGapEvent: number | null = null;
    let biggestGapDays = 0;
    for (let e = windowStart; e < halfEnd; e++) {
      const a = deadlineByEvent.get(e);
      const b = deadlineByEvent.get(e + 1);
      if (!a || !b) continue;
      const days = (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
      if (days > biggestGapDays) {
        biggestGapDays = days;
        biggestGapEvent = e + 1;
      }
    }
    if (biggestGapEvent !== null && biggestGapDays > 8 && fits("wildcard", biggestGapEvent)) {
      out.push({
        label: "Break pivot",
        entries: [{ chip: "wildcard", event: biggestGapEvent }],
        note: `Wildcard GW${biggestGapEvent} — timed to this season's longest gap between deadlines (${Math.round(biggestGapDays)} days), computed from the real calendar.`,
      });
    }

    return out;
  }, [windowStart, windowEnd, chipDefinitions, deadlineByEvent]);

  const pinPreset = (preset: { label: string; entries: { chip: ChipKind; event: number }[] }) => {
    if (!team) return;
    let plan = team.chipPlan;
    for (const e of preset.entries) plan = setChipPlanEntry(plan, e.chip, e.event, "shortlist");
    saveDraft({ ...team, chipPlan: plan });
    setDrafts(listDrafts());
    setApplied(`Pinned the ${preset.label} sequence (${preset.entries.length} chip${preset.entries.length === 1 ? "" : "s"}) to "${team.name}". Open Transfer Path on /transfers for the sequence-aware total.`);
  };

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
              onChange={(e) => {
                setDraftId(e.target.value);
                setApplied(null);
              }}
              className="rounded-md border border-input bg-surface-3 px-2 py-1.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      {applied && team && (
        <p className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          {applied}{" "}
          <Link
            href={`/transfers/?draft=${team.draftId}`}
            className="font-medium underline-offset-2 hover:underline"
          >
            See it on Transfers →
          </Link>
        </p>
      )}

      {error && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="mt-6 flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading player data…
        </p>
      )}

      {!loading && drafts.length === 0 && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-card p-6 text-center dark:border-purple-900/40">
          <p className="text-sm text-zinc-500">
            No saved squads yet. Build one in the{" "}
            <Link
              href="/builder"
              className="font-medium text-purple-700 underline-offset-2 hover:underline dark:text-primary"
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

      {!loading && team && team.players.length === rules.squadSize && (resultLoading || resultStale) && (
        <div
          role="status"
          className="mt-5 flex items-center justify-between gap-2 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-foreground"
        >
          <span className="flex items-center gap-1.5">
            {resultLoading && <Spinner />}
            {resultLoading ? "Recalculating chip values…" : "Squad changed since these values were computed."}
          </span>
          {!resultLoading && (
            <button
              type="button"
              onClick={runResult}
              className="shrink-0 rounded-md border border-warning-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-warning-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Re-run
            </button>
          )}
        </div>
      )}

      {result && team && presets.length > 0 && (
        <section className="mt-5 rounded-xl border border-purple-300 bg-card p-4 dark:border-primary/40">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Chip sequences</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Starting points for a planned sequence, not a recommendation — pin one, then move any
            gameweek. The schedules above value each chip independently against today&apos;s squad; a
            sequence values each chip against what the one before it left behind. See it on{" "}
            <Link
              href={`/transfers/?draft=${team.draftId}`}
              className="font-medium text-purple-700 underline-offset-2 hover:underline dark:text-primary"
            >
              Transfer Path
            </Link>{" "}
            after pinning.
          </p>
          <div className="mt-3 space-y-2">
            {presets.map((preset) => (
              <div
                key={preset.label}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-purple-900/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{preset.label}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{preset.note}</p>
                </div>
                <button
                  type="button"
                  onClick={() => pinPreset(preset)}
                  className="min-h-9 shrink-0 rounded-md border border-purple-700 px-2.5 py-1 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-primary dark:text-primary dark:hover:bg-primary/10"
                >
                  Pin
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {result && team && (
        <>
          {/* fixture-flatness disclosure, spelled out rather than only in the
              tooltip — collapsed by default so the note doesn't push every
              schedule below the fold on a phone. */}
          <div className="mt-4 overflow-hidden rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40">
            <button
              type="button"
              onClick={() => setNoteOpen((v) => !v)}
              aria-expanded={noteOpen}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs leading-relaxed text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:text-amber-300"
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
              className="mt-5 rounded-xl border border-purple-300 bg-card p-4 dark:border-primary/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Chip schedule · {half.label}
                </h2>
                {(half.oneOff || half.wildcard) && (
                  <button
                    type="button"
                    onClick={() => pinSchedule(half)}
                    disabled={!!half.oneOff && half.oneOff.margin < 1}
                    title={
                      half.oneOff && half.oneOff.margin < 1
                        ? "This schedule is not a strong recommendation — the next-best combination is nearly as good."
                        : `Pin every chip in this schedule to "${team.name}"'s plan.`
                    }
                    className="min-h-9 rounded-md border border-purple-700 px-2.5 py-1 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 dark:border-primary dark:text-primary dark:hover:bg-primary/10"
                  >
                    Pin whole schedule
                  </button>
                )}
              </div>

              {half.oneOff && (
                <>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {half.oneOff.entries
                      .slice()
                      .sort((a, b) => a.event - b.event)
                      .map((e) => (
                        <div
                          key={e.chip}
                          className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-purple-900/40"
                        >
                          <span className="font-medium text-zinc-800 dark:text-zinc-200">
                            {CHIP_LABELS[e.chip]}
                          </span>
                          <span className="text-zinc-500">GW{e.event}</span>
                          <span className="tabular-nums text-purple-800 dark:text-primary">
                            {signed(e.gain)}
                          </span>
                          <button
                            type="button"
                            onClick={() => pinChip(e.chip, e.event)}
                            title={`Pin ${CHIP_LABELS[e.chip]} to GW${e.event}`}
                            className="ml-1 rounded text-zinc-400 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-primary"
                          >
                            📌
                          </button>
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
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-purple-900/40">
                  <div className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-purple-900/40">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">Wildcard</span>
                    <span className="text-zinc-500">GW{half.wildcard.event}</span>
                    <span className="tabular-nums text-purple-800 dark:text-primary">
                      {signed(half.wildcard.gain)}
                    </span>
                    <button
                      type="button"
                      onClick={() => pinChip("wildcard", half.wildcard!.event)}
                      title={`Pin Wildcard to GW${half.wildcard.event}`}
                      className="ml-1 rounded text-zinc-400 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-primary"
                    >
                      📌
                    </button>
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
                  className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-purple-900/40"
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
                              <span className="mr-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                                Best
                              </span>
                            )}
                            GW{v.event}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="tabular-nums font-semibold text-purple-800 dark:text-primary">
                              {signed(v.gain)}
                            </span>
                            <button
                              type="button"
                              onClick={() => pinChip(chip, v.event)}
                              title={`Pin ${CHIP_LABELS[chip]} to GW${v.event}`}
                              className="rounded text-zinc-400 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-primary"
                            >
                              📌
                            </button>
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
          <section className="mt-5 overflow-x-auto rounded-xl border border-zinc-200 bg-card p-4 dark:border-purple-900/40">
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
