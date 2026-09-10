// Sprint 36 (DSI-66) — historical decision analytics.
//
// Descriptive analytics over decisions already made, scored against results
// already in the database. No new model and no new gate: nothing here predicts
// anything, so nothing here inherits the xP model's calibration debt. That is
// the whole reason this half of Sprint 17 is buildable while the other half
// waits on the GW10 `positionCalibration` refit.
//
// Four questions, each reported in named terms rather than netted:
//
//   captain     how often the armband was the best of the XI, and what the
//               misses cost in points that would actually have been scored
//   transfers   what each transfer returned against the player sold, over a
//               horizon the *user* sets (see below)
//   chips       what a played chip actually earned, where that is answerable
//   rank        the season arc, in one direction convention
//
// COST SHAPE. Everything below runs off one season-wide load — `loadManagerPicks`
// once, `loadScenarioActuals` once, `loadGwHistory` once, plus two small reads —
// not `loadGameweekState` per event, which would be ~3 round trips × 38.
//
// ONE IMPLEMENTATION. The per-event captain comparison used to live in
// lib/gameweek-review.ts. It lives here now and /review calls
// `captainChoiceAt` through this module, so the single-event panel and the
// season table cannot drift apart (CLAUDE.md: "one quantity, one implementation").

import { supabase } from "./supabase/client";
import {
  loadManagerPicks,
  startersOf,
  benchOf,
  type ManagerPick,
} from "./manager-picks";
import { loadScenarioActuals, type ActualsSource } from "./scenario-actuals";
import { loadTransfers, type TransferRow } from "./manager-transfers";
import { horizonLength, type Horizon, type ChipKind } from "./team-state";
import { CHIP_KINDS } from "./chip-plan";

export const DECISION_ANALYTICS_NOTE =
  "A record of decisions already made, scored against results already in the database — not a " +
  "prediction and not a rating. The captain benchmark is hindsight: it is the best scorer among " +
  "the eleven you actually started, which nobody could have known in advance. It deliberately " +
  "excludes your bench — captaining a benched player earns nothing unless FPL substitutes them on, " +
  "so a bench-inclusive benchmark would quietly blame the armband for a starting decision. " +
  "Transfer returns are measured over a horizon you choose, because FPL records no intended one; " +
  "change it and the same transfers are judged over a different window. Points in and points out " +
  "are separate terms and the hit is FPL's own recorded cost, never netted into one figure. Chip " +
  "returns are given only where the counterfactual is real — Free Hit and Wildcard are not scored " +
  "at all, because the squad that would otherwise have played was never recorded anywhere. Ranks " +
  "are overall rank, where lower is better.";

// ------------------------------------------------------------------ captain

export interface CaptainChoice {
  event: number;
  /** Element captained as picked, and their raw (undoubled) points. */
  pickedElement: number;
  pickedRaw: number;
  /** After the vice-captain handover rule, if it fired. */
  effectiveElement: number;
  effectiveRaw: number;
  handedOver: boolean;
  /** Best raw points among the eleven who started — the hindsight benchmark. */
  bestElement: number;
  bestRaw: number;
  /** The armband multiplier in force: 2 normally, 3 under a Triple Captain. */
  multiplier: number;
  /** bestRaw - effectiveRaw, always >= 0 by construction. Raw, undoubled. */
  gapRaw: number;
  /**
   * What the gap actually cost the gameweek total.
   *
   * Swapping the armband from E to B moves the total by (B - E) × (m - 1), not
   * by (B - E) and not by (B - E) × m: one copy of every starter's points is
   * already in the XI total, and the armband only adds the extras. Under a
   * Triple Captain the same raw gap costs twice as much, which is exactly the
   * kind of thing a raw-difference figure hides.
   */
  gapEffective: number;
  /** True when the effective captain *was* the best starter — nothing was lost. */
  wasBest: boolean;
}

/**
 * The vice-captain handover, resolved for a **finished** gameweek.
 *
 * lib/gameweek-state.ts's `resolveCaptaincy` needs per-fixture status because
 * it also runs mid-gameweek, where "0 minutes so far" and "0 minutes, final"
 * are different facts. Over a finished gameweek every fixture is final, so
 * minutes alone decide it and no fixture read is needed. Same rule, cheaper
 * inputs — not a second rule.
 */
function effectiveCaptainOf(
  starters: ManagerPick[],
  minutes: Map<number, number>,
): { element: number; handedOver: boolean } | null {
  const captain = starters.find((p) => p.isCaptain);
  if (!captain) return null;
  const vice = starters.find((p) => p.isViceCaptain);
  const blanked = (minutes.get(captain.element) ?? 0) === 0;
  if (blanked && vice) return { element: vice.element, handedOver: true };
  return { element: captain.element, handedOver: false };
}

/**
 * One gameweek's captain comparison. Exported because /review's single-event
 * panel scores the same quantity and must not compute it a second time.
 */
export function captainChoiceAt(
  event: number,
  picks: ManagerPick[],
  points: Map<number, number>,
  minutes: Map<number, number>,
  /**
   * A handover already resolved by lib/gameweek-state.ts's `resolveCaptaincy`.
   * Pass it whenever one is to hand: mid-gameweek it is the stricter answer,
   * because "0 minutes so far" is not yet "0 minutes, final", and the
   * minutes-only fallback below cannot tell those apart. Over a finished
   * gameweek the two agree by construction.
   */
  resolved?: { element: number; handedOver: boolean },
): CaptainChoice | null {
  const starters = startersOf(picks);
  const picked = starters.find((p) => p.isCaptain);
  const effective = resolved ?? effectiveCaptainOf(starters, minutes);
  if (!picked || !effective || starters.length === 0) return null;

  let best: { element: number; raw: number } | null = null;
  for (const p of starters) {
    const raw = points.get(p.element) ?? 0;
    if (best === null || raw > best.raw) best = { element: p.element, raw };
  }
  if (!best) return null;

  const effectiveRaw = points.get(effective.element) ?? 0;
  // The armband's own multiplier, from the pick FPL recorded — 3 under a
  // Triple Captain. Read, never assumed to be 2.
  const multiplier = Math.max(2, picked.multiplier);
  const gapRaw = Math.max(0, best.raw - effectiveRaw);

  return {
    event,
    pickedElement: picked.element,
    pickedRaw: points.get(picked.element) ?? 0,
    effectiveElement: effective.element,
    effectiveRaw,
    handedOver: effective.handedOver,
    bestElement: best.element,
    bestRaw: best.raw,
    multiplier,
    gapRaw,
    gapEffective: gapRaw * (multiplier - 1),
    wasBest: gapRaw === 0,
  };
}

export interface CaptainSummary {
  /** Gameweeks with a resolvable armband — the denominator. */
  scored: number;
  /** Gameweeks where the effective captain was the best starter. */
  hits: number;
  /** Σ gapEffective — points the armband left on the table, in real terms. */
  pointsLost: number;
  /** Gameweeks where the vice-captain took over. */
  handovers: number;
  perEvent: CaptainChoice[];
}

// ----------------------------------------------------------------- transfers

export interface TransferOutcome {
  row: TransferRow;
  /** Gameweeks actually scored, of `horizonGws` — a recent transfer is still open. */
  scoredGws: number;
  horizonGws: number;
  /** Points the incoming player scored over the scored window. */
  inPoints: number;
  /** Points the outgoing player scored over the same window. */
  outPoints: number;
  /** True while `scoredGws < horizonGws` — the verdict is not final. */
  inProgress: boolean;
}

export interface TransferEventGroup {
  event: number;
  transfers: TransferOutcome[];
  /** FPL's own recorded cost for this gameweek's transfers — not recomputed
   *  from a count, which would need the free-transfer balance this app does not
   *  store historically. 0 when nothing was paid. */
  hit: number;
  inPoints: number;
  outPoints: number;
  inProgress: boolean;
}

export interface TransferSummary {
  groups: TransferEventGroup[];
  /** Season totals, kept as three terms. Never summed into one here. */
  inPoints: number;
  outPoints: number;
  hits: number;
  /** True when any group is still inside its horizon. */
  inProgress: boolean;
  horizon: Horizon;
}

// --------------------------------------------------------------------- chips

export interface ChipOutcome {
  event: number;
  chip: string;
  /**
   * Points the chip actually earned, or null when it cannot be answered from
   * recorded data. Null is a real answer here, not a missing one — see `why`.
   */
  earned: number | null;
  /** Present exactly when `earned` is null: why this chip is not scoreable. */
  why: string | null;
}

// ---------------------------------------------------------------------- rank

export interface RankPoint {
  event: number;
  /** FPL's overall rank after this gameweek. **Lower is better.** */
  overallRank: number | null;
  points: number | null;
  totalPoints: number | null;
  chip: string | null;
}

// ------------------------------------------------------------------- reading

export interface GwHistoryLite {
  event: number;
  points: number | null;
  totalPoints: number | null;
  overallRank: number | null;
  eventTransfersCost: number | null;
  activeChip: string | null;
}

/** The whole season's gameweek history for one entry, ascending by event. */
async function loadSeasonHistory(
  season: string,
  entryId: number,
): Promise<Map<number, GwHistoryLite>> {
  const { data, error } = await supabase
    .from("manager_gameweek_history")
    .select("event, points, total_points, overall_rank, event_transfers_cost, active_chip")
    .eq("season", season)
    .eq("entry_id", entryId)
    .order("event");
  if (error) throw new Error(error.message);

  const byEvent = new Map<number, GwHistoryLite>();
  for (const r of data ?? []) {
    byEvent.set(r.event as number, {
      event: r.event as number,
      points: r.points as number | null,
      totalPoints: r.total_points as number | null,
      overallRank: r.overall_rank as number | null,
      eventTransfersCost: r.event_transfers_cost as number | null,
      activeChip: r.active_chip as string | null,
    });
  }
  return byEvent;
}

/**
 * Chips this manager has played, by gameweek.
 *
 * `manager_chips` has been written by supabase/functions/_shared/manager-sync.ts
 * since Sprint 14 and read by nothing until now. It is preferred over
 * `manager_gameweek_history.active_chip` here because it is the table whose
 * whole purpose is this fact; the history column is used only as a fallback for
 * a gameweek `manager_chips` somehow missed.
 */
async function loadPlayedChips(
  season: string,
  entryId: number,
): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from("manager_chips")
    .select("event, name")
    .eq("season", season)
    .eq("entry_id", entryId)
    .order("event");
  if (error) throw new Error(error.message);

  const byEvent = new Map<number, string>();
  for (const r of data ?? []) byEvent.set(r.event as number, r.name as string);
  return byEvent;
}

// ----------------------------------------------------------------- assembling

export interface DecisionAnalytics {
  season: string;
  entryId: number;
  /** Finished gameweeks this manager actually entered a squad for, ascending. */
  events: number[];
  /** True when any figure drew on a still-moving gameweek's live snapshot. */
  provisional: boolean;
  captain: CaptainSummary;
  transfers: TransferSummary;
  chips: ChipOutcome[];
  rank: RankPoint[];
}

/**
 * Everything the season panel renders, in one pass.
 *
 * `horizon` is a user input, deliberately: `manager_transfers` records when a
 * transfer was made and nothing about how long it was meant to pay off over.
 * Rather than invent a coefficient and tune it until the answers looked
 * reasonable, the window is exposed and labelled (CLAUDE.md: "when a term
 * cannot be dropped, make it an input").
 */
export async function loadDecisionAnalytics(
  season: string,
  entryId: number,
  horizon: Horizon,
): Promise<DecisionAnalytics | null> {
  const [picksByEvent, historyByEvent, chipsByEvent, transferRows] = await Promise.all([
    loadManagerPicks(season, entryId),
    loadSeasonHistory(season, entryId),
    loadPlayedChips(season, entryId),
    loadTransfers(season, entryId),
  ]);

  if (picksByEvent.size === 0) return null;

  // Every player the analytics can possibly need a score for: everyone ever
  // picked, plus both ends of every transfer (a player sold in GW3 may not
  // appear in any later squad, and their points are half the comparison).
  const ids = new Set<number>();
  for (const picks of picksByEvent.values()) for (const p of picks) ids.add(p.element);
  for (const t of transferRows) {
    ids.add(t.elementIn);
    ids.add(t.elementOut);
  }

  const actuals: ActualsSource = await loadScenarioActuals(season, [...ids]);
  const finished = new Set(actuals.events);
  const events = [...picksByEvent.keys()].filter((e) => finished.has(e)).sort((a, b) => a - b);

  const pointsAt = (event: number) => actuals.pointsByEvent.get(event) ?? new Map<number, number>();
  const minutesAt = (event: number) =>
    actuals.minutesByEvent.get(event) ?? new Map<number, number>();

  // ---------------------------------------------------------------- captain
  const perEvent: CaptainChoice[] = [];
  for (const event of events) {
    const picks = picksByEvent.get(event);
    if (!picks || picks.length === 0) continue;
    const choice = captainChoiceAt(event, picks, pointsAt(event), minutesAt(event));
    if (choice) perEvent.push(choice);
  }
  const captain: CaptainSummary = {
    scored: perEvent.length,
    hits: perEvent.filter((c) => c.wasBest).length,
    pointsLost: perEvent.reduce((sum, c) => sum + c.gapEffective, 0),
    handovers: perEvent.filter((c) => c.handedOver).length,
    perEvent,
  };

  // -------------------------------------------------------------- transfers
  const window = horizonLength(horizon);
  const groups: TransferEventGroup[] = [];
  const byEvent = new Map<number, TransferRow[]>();
  for (const t of transferRows) {
    const list = byEvent.get(t.event);
    if (list) list.push(t);
    else byEvent.set(t.event, [t]);
  }

  for (const [event, rows] of [...byEvent.entries()].sort((a, b) => b[0] - a[0])) {
    // The window the transfer was made *for* starts at its own gameweek.
    const wanted: number[] = [];
    for (let e = event; e < event + window; e += 1) wanted.push(e);
    const scored = wanted.filter((e) => finished.has(e));

    const outcomes: TransferOutcome[] = rows.map((row) => {
      let inPoints = 0;
      let outPoints = 0;
      for (const e of scored) {
        const pts = pointsAt(e);
        inPoints += pts.get(row.elementIn) ?? 0;
        outPoints += pts.get(row.elementOut) ?? 0;
      }
      return {
        row,
        scoredGws: scored.length,
        horizonGws: wanted.length,
        inPoints,
        outPoints,
        inProgress: scored.length < wanted.length,
      };
    });

    groups.push({
      event,
      transfers: outcomes,
      hit: historyByEvent.get(event)?.eventTransfersCost ?? 0,
      inPoints: outcomes.reduce((s, o) => s + o.inPoints, 0),
      outPoints: outcomes.reduce((s, o) => s + o.outPoints, 0),
      inProgress: scored.length < wanted.length,
    });
  }

  const transfers: TransferSummary = {
    groups,
    inPoints: groups.reduce((s, g) => s + g.inPoints, 0),
    outPoints: groups.reduce((s, g) => s + g.outPoints, 0),
    hits: groups.reduce((s, g) => s + g.hit, 0),
    inProgress: groups.some((g) => g.inProgress),
    horizon,
  };

  // ------------------------------------------------------------------ chips
  const chipEvents = new Set<number>([...chipsByEvent.keys()]);
  for (const [event, h] of historyByEvent) if (h.activeChip) chipEvents.add(event);

  const chips: ChipOutcome[] = [...chipEvents]
    .sort((a, b) => a - b)
    .map((event) => {
      const chip = chipsByEvent.get(event) ?? historyByEvent.get(event)?.activeChip ?? "";
      const picks = picksByEvent.get(event);
      const kind = CHIP_KINDS.includes(chip as ChipKind) ? (chip as ChipKind) : null;

      if (!picks || !finished.has(event)) {
        return {
          event,
          chip,
          earned: null,
          why: "This gameweek has not been scored yet.",
        };
      }

      const pts = pointsAt(event);

      if (kind === "bboost") {
        // Exact: the bench scored, and would not have without the chip.
        const earned = benchOf(picks).reduce((sum, p) => sum + (pts.get(p.element) ?? 0), 0);
        return { event, chip, earned, why: null };
      }

      if (kind === "3xc") {
        // Exact: the third helping on top of the doubling a normal captain
        // would already have had.
        const choice = captainChoiceAt(event, picks, pts, minutesAt(event));
        return {
          event,
          chip,
          earned: choice ? choice.effectiveRaw : null,
          why: choice ? null : "No armband recorded for this gameweek.",
        };
      }

      // Free Hit and Wildcard rebuild the squad, and the squad that would
      // otherwise have played is recorded nowhere — not in manager_picks,
      // which stores what was actually fielded. Reconstructing it from the
      // previous gameweek's XI and calling the difference a return would be an
      // invented counterfactual, so this says so instead (CLAUDE.md: empty
      // result sets say so rather than ranking worse options).
      return {
        event,
        chip,
        earned: null,
        why: "Not scoreable — the squad this replaced was never recorded, so there is no honest comparison.",
      };
    });

  // ------------------------------------------------------------------- rank
  const rank: RankPoint[] = [...historyByEvent.values()]
    .sort((a, b) => a.event - b.event)
    .map((h) => ({
      event: h.event,
      overallRank: h.overallRank,
      points: h.points,
      totalPoints: h.totalPoints,
      chip: chipsByEvent.get(h.event) ?? h.activeChip,
    }));

  return {
    season,
    entryId,
    events,
    provisional: actuals.provisional,
    captain,
    transfers,
    chips,
    rank,
  };
}
