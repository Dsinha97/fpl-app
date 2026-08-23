// Sprint 12 — Chip Strategy Engine.
//
// Answers the question nothing in the app answers today: which gameweek should
// each chip be played in? `ChipValue = xP(with chip) - xP(without)`, evaluated
// per gameweek over whatever window `generate-predictions` currently reaches.
//
// ---------------------------------------------------------------------------
// Two facts, measured against the live database rather than assumed, shape
// what this can honestly report:
//
//   1. Every gameweek in the current fixture list has all 20 clubs playing
//      exactly once — no blanks, no doubles anywhere yet. They are created
//      later by cup postponements. Bench Boost and Triple Captain draw most of
//      their real value from a double; Free Hit's canonical use is a blank.
//      So today's values are driven by fixture difficulty alone and read
//      comparatively flat — a real answer from an incomplete fixture list, not
//      a bug. `countBlanksAndDoubles` measures this from `fixtures` at
//      call time, never a hardcoded assumption, so the finding updates itself
//      the moment a real double appears.
//   2. Predictions only reach the first chip window (GW1-19 today). The
//      second half (GW20-38) is reported *blocked*, with its reason, rather
//      than silently omitted — the same treatment `transfer-optimizer.ts`
//      gives its wildcard row: "a blocked option that vanishes reads as a
//      bug; its reason is information."
//
// A third caveat has no measurement, only a warning: a chip valued for GW14 is
// scored against today's squad held frozen for fourteen gameweeks, which will
// not happen. This is the same frozen-projection caveat
// `TRANSFER_OPTIMIZER_NOTE` already carries, sharpened by distance.
// ---------------------------------------------------------------------------
//
// The engine adds exactly one new primitive — a per-gameweek-event view — and
// otherwise reuses the existing squad machinery unchanged:
//
//   * Bench Boost / Triple Captain read `optimiseLineup` (lib/lineup.ts) at a
//     candidate list built for one event, so the bench-order and captain-score
//     maths stay defined in exactly one place.
//   * Free Hit / Wildcard read `optimizeSquad` (lib/optimizer.ts) against a
//     pool whose `xp` carries that event's (or window's) total in the slot the
//     optimiser already reads — no second knapsack implementation, so the
//     fill-order fix that lives there is never at risk of drifting out of step.
//   * Both compare squads with `projectAtEvent` (lib/transfer-optimizer.ts) or
//     the windowed sibling below, so "what a squad is worth" has one answer
//     everywhere it is asked, per CLAUDE.md's "one quantity, one
//     implementation" rule.

import { optimizeSquad, suggestArmband, type OptimizerPlayer } from "./optimizer";
import {
  CHIP_KINDS,
  CHIP_LABELS,
  benchBoostAt,
  blockedValuation,
  candidatesAt,
  resolveStopEvent,
  tripleCaptainAt,
  type ChipDefinitionRow,
  type ChipValuation,
  type EventPrediction,
  type PredAt,
} from "./chip-plan";
import {
  projectAtEvent,
  type ChipKind,
  type PlayerMeta,
  type SquadPick,
  type SquadRules,
  type TeamState,
  type XpByEvent,
} from "./team-state";
import type { ScoredPlayer } from "./scoring";

// `ChipKind`, `CHIP_LABELS`, `EventPrediction`, `PredAt`, `ChipValuation`,
// `candidatesAt`, `benchBoostAt`, `tripleCaptainAt` moved to lib/chip-plan.ts
// (see that file's header for why) — re-exported so every existing import
// path (`app/builder`, `app/scenarios`, `app/deadline`, `app/chips`) keeps
// compiling unchanged.
export { CHIP_LABELS, benchBoostAt, candidatesAt, resolveStopEvent, tripleCaptainAt };
export type { ChipDefinitionRow, ChipKind, ChipValuation, EventPrediction, PredAt };

export interface ChipWindow {
  chip: ChipKind;
  label: string;
  startEvent: number;
  stopEvent: number;
  /** Set when no gameweek in this window has a projection at all. */
  blocked: string | null;
}

export interface EventFixtureCounts {
  /** Row count in `fixtures` for the event — inflated by doubles. */
  fixtureSlots: number;
  /** Distinct clubs with a fixture in the event — deflated by blanks. */
  distinctClubs: number;
}

export interface ChipsEngineInput {
  team: TeamState;
  /** Every selectable player, for Free Hit / Wildcard rebuilds. */
  pool: ScoredPlayer[];
  lookup: (playerId: number) => PlayerMeta | undefined;
  predAt: PredAt;
  availabilityOf: (playerId: number) => number;
  isPenaltyTaker: (playerId: number) => boolean;
  rules: SquadRules;
  chipDefinitions: ChipDefinitionRow[];
  fixturesPerEvent: Map<number, EventFixtureCounts>;
  /** First event with a projection — normally the next gameweek. */
  windowStart: number;
  /** Last event with a projection, from `player_xp_horizons.last_event`. */
  windowEnd: number;
}

export interface ChipScheduleEntry {
  chip: ChipKind;
  event: number;
  gain: number;
}

export interface ChipSchedule {
  entries: ChipScheduleEntry[];
  total: number;
  /** Gap to the next-best assignment — small means the schedule is not a real recommendation. */
  margin: number;
}

/**
 * One chip half — FPL gives every chip once per half (GW1-19, GW20-38 today),
 * so the two halves are independent decisions, not one season-long schedule.
 * `oneOff` is Bench Boost + Triple Captain + Free Hit: none of them change
 * the squad permanently, so their gains are genuinely additive and combine
 * into one total. `wildcard` is reported separately and never summed with
 * `oneOff` — it is a *cumulative* gain over the rest of the half (a
 * permanent rebuild), not a single gameweek's worth, so adding it to three
 * one-week numbers would mix incompatible units into a meaningless total.
 */
export interface ChipHalfSchedule {
  /** e.g. "GW1-19". */
  label: string;
  startEvent: number;
  stopEvent: number;
  oneOff: ChipSchedule | null;
  /** Best gameweek for Wildcard in this half, or null if none is playable. */
  wildcard: ChipValuation | null;
}

export interface ChipEngineResult {
  windows: ChipWindow[];
  /** Every evaluable gameweek per chip, including ones a caller may choose not to show. */
  valuationsByChip: Record<ChipKind, ChipValuation[]>;
  /** One entry per chip half (normally two: GW1-19 and GW20-38). */
  schedules: ChipHalfSchedule[];
  note: string;
  /** One-sentence version of `note`, for a collapsed-card summary line —
   *  see `chipModelNoteSummary`. Not a truncation of `note`; a separate
   *  sentence, so a UI showing both isn't showing the same text twice. */
  noteSummary: string;
}

// ------------------------------------------------------------- disclosure

/**
 * Blanks and doubles measured from `fixtures`, never assumed — re-running
 * after a real double appears changes this note with no code change.
 */
export function countBlanksAndDoubles(
  fixturesPerEvent: Map<number, EventFixtureCounts>,
  windowStart: number,
  windowEnd: number,
): { blankEvents: number; doubleEvents: number } {
  let blankEvents = 0;
  let doubleEvents = 0;
  for (let e = windowStart; e <= windowEnd; e++) {
    const c = fixturesPerEvent.get(e);
    if (!c) continue;
    if (c.distinctClubs < 20) blankEvents++;
    if (c.fixtureSlots > c.distinctClubs) doubleEvents++;
  }
  return { blankEvents, doubleEvents };
}

/**
 * A single-sentence summary of `chipModelNote`, for a collapsed card's
 * summary line. `CollapsibleCard` renders its `summary` prop and its
 * children both, always (grid accordion, not mount/unmount) — passing the
 * full multi-sentence note as both meant the same paragraph appeared twice
 * once expanded. This is the same measured blank/double count, phrased as
 * one line rather than truncated.
 */
export function chipModelNoteSummary(
  blankEvents: number,
  doubleEvents: number,
  windowEnd: number,
): string {
  return blankEvents === 0 && doubleEvents === 0
    ? `Every gameweek through GW${windowEnd} currently plays once — values read comparatively flat.`
    : `${blankEvents} blank${blankEvents === 1 ? "" : "s"} and ${doubleEvents} double${doubleEvents === 1 ? "" : "s"} through GW${windowEnd} — see below for how that's handled.`;
}

export function chipModelNote(blankEvents: number, doubleEvents: number, windowEnd: number): string {
  const fixtureLine =
    blankEvents === 0 && doubleEvents === 0
      ? `Every gameweek through GW${windowEnd} currently has all 20 clubs playing exactly once — no ` +
        "blanks or doubles yet (those are created later by cup postponements), so these values are " +
        "driven by fixture difficulty alone and read comparatively flat."
      : `${blankEvents} blank gameweek${blankEvents === 1 ? "" : "s"} and ${doubleEvents} double ` +
        `gameweek${doubleEvents === 1 ? "" : "s"} exist through GW${windowEnd} in the current fixture list.`;
  return (
    `${fixtureLine} Only the prediction window through GW${windowEnd} is evaluated — a chip window ` +
    "beyond it shows as blocked rather than guessed. Every value assumes today's squad held unchanged " +
    "until the chip is played, which will not happen — treat gameweeks further away as more " +
    "speculative. Bench Boost is shown net of what auto-subs would already deliver without the chip. " +
    "Free Hit and Wildcard carry your current armband into the rebuilt squad when it is still there, " +
    "and disclose it when the captain has to move on, so the gain is never overstated. FPL gives each " +
    "chip once per half, so the two halves are shown as separate schedules rather than one combined " +
    "total. Within a half, Bench Boost, Triple Captain and Free Hit are single-gameweek gains and sum " +
    "together; Wildcard is a permanent rebuild valued cumulatively over the rest of the half, so it is " +
    "reported on its own rather than added to the other three. Every chip is still valued against " +
    "today's squad regardless of what the schedule plays first — a Triple Captain shown after a " +
    "scheduled Wildcard does not yet reflect the rebuilt squad."
  );
}

// -------------------------------------------------------------- primitives
//
// `candidatesAt`, `blockedValuation`, `benchBoostAt`, `tripleCaptainAt` now
// live in lib/chip-plan.ts and are re-exported above.

/**
 * Sum of a player's xP over a gameweek range, or `null` if the model has no
 * projection anywhere in it.
 *
 * The distinction matters to `optimizeSquad`: it treats a `null` projection as
 * "no data" (excluded from the cheapest-real-pick reserve floor) and a `0` as
 * a genuine, if unappealing, projection (included). Defaulting an absent
 * prediction to `0` here would make a player with no data at all look like a
 * real zero-xP pick and skew which players the reserve floor considers —
 * exactly the reserve-floor failure mode CLAUDE.md already records for the
 * squad optimiser. A gap inside an otherwise-projected range still sums to a
 * real (if partial) number; only total absence returns `null`.
 */
function windowTotal(playerId: number, predAt: PredAt, from: number, to: number): number | null {
  let total = 0;
  let anyData = false;
  for (let e = from; e <= to; e++) {
    const xp = predAt(playerId, e)?.xp;
    if (xp !== undefined && xp !== null) {
      total += xp;
      anyData = true;
    }
  }
  return anyData ? total : null;
}

/**
 * Squad value over a gameweek *range*, mirroring `computeProjection`'s
 * captain-doubling formula (`lib/team-state.ts`) and `projectAtEvent`'s
 * single-event version (`lib/transfer-optimizer.ts`) exactly — only the
 * source of each player's xP changes, from a precomputed horizon total to a
 * fresh sum over an arbitrary sub-window, which is what a Wildcard needs and
 * no existing horizon (1/3/5/8/season) can express.
 */
function projectOverWindow(
  picks: SquadPick[],
  predAt: PredAt,
  availabilityOf: (playerId: number) => number,
  captain: number | null,
  vice: number | null,
  from: number,
  to: number,
): number {
  let total = 0;
  for (const pick of picks) total += windowTotal(pick.playerId, predAt, from, to) ?? 0;

  if (captain !== null) {
    const pCap = availabilityOf(captain);
    const capTotal = windowTotal(captain, predAt, from, to) ?? 0;
    const viceTotal = vice !== null ? (windowTotal(vice, predAt, from, to) ?? 0) : 0;
    total += capTotal * pCap + viceTotal * (1 - pCap);
  }

  return total;
}

/** `ScoredPlayer` -> `OptimizerPlayer` valued at a single event, mirroring `transfer-optimizer.ts`'s conversion. */
function toOptimizerPlayerAt(p: ScoredPlayer, predAt: PredAt, event: number): OptimizerPlayer {
  return {
    id: p.id,
    elementType: p.elementType,
    teamId: p.teamId,
    price: p.price,
    xp: { 1: predAt(p.id, event)?.xp ?? null, 3: null, 5: null, 8: null, 19: null, season: null },
    ownership: p.ownership,
    status: p.availability >= 1 ? "a" : p.availability > 0 ? "d" : "u",
    chanceNextRound: Math.round(p.availability * 100),
  };
}

/** Same conversion, valued as a window total in the `season` slot `optimizeSquad` already reads generically. */
function toOptimizerPlayerWindow(p: ScoredPlayer, predAt: PredAt, from: number, to: number): OptimizerPlayer {
  return {
    id: p.id,
    elementType: p.elementType,
    teamId: p.teamId,
    price: p.price,
    xp: { 1: null, 3: null, 5: null, 8: null, 19: null, season: windowTotal(p.id, predAt, from, to) },
    ownership: p.ownership,
    status: p.availability >= 1 ? "a" : p.availability > 0 ? "d" : "u",
    chanceNextRound: Math.round(p.availability * 100),
  };
}

// --------------------------------------------------------------- Free Hit

export interface RebuildContext {
  team: TeamState;
  pool: ScoredPlayer[];
  rules: SquadRules;
  predAt: PredAt;
  availabilityOf: (playerId: number) => number;
}

/**
 * A chip's rebuilt squad, not just its value — `ChipValuation.gain` alone is
 * not enough for a caller (the transfer optimiser's Free Hit branch, the
 * forward transfer path) that needs to actually field the rebuilt picks.
 * `picks` is empty when `valuation.blocked` is set.
 */
export interface ChipRebuild {
  valuation: ChipValuation;
  picks: SquadPick[];
  captain: number | null;
  vice: number | null;
  /** True when the current armband could not be carried over — the same disclosure `wildcardRebuildAt` already makes in its valuation's explanation. */
  armbandMoved: boolean;
}

function blockedRebuild(chip: ChipKind, event: number, reason: string): ChipRebuild {
  return { valuation: blockedValuation(chip, event, reason), picks: [], captain: null, vice: null, armbandMoved: false };
}

/** Best legal one-week squad, valued against the current squad for the same gameweek; reverts after. */
export function freeHitRebuildAt(ctx: RebuildContext, event: number): ChipRebuild {
  const { team, pool, rules, predAt, availabilityOf } = ctx;
  const rebuildPool = pool.map((p) => toOptimizerPlayerAt(p, predAt, event));
  const rebuild = optimizeSquad({ pool: rebuildPool, rules, locked: [], horizon: 1, strategy: "max_points", risk: "medium" });

  if (rebuild.error || rebuild.picks.length !== rules.squadSize) {
    return blockedRebuild("freehit", event, rebuild.error ?? "Could not build a legal one-week squad.");
  }

  const byId = new Map(rebuildPool.map((p) => [p.id, p]));
  const armband = suggestArmband(rebuild.picks, byId, 1);

  const seriesAtEvent: XpByEvent = new Map();
  const eventSeriesOf = (id: number): XpByEvent => {
    seriesAtEvent.clear();
    seriesAtEvent.set(event, predAt(id, event)?.xp ?? 0);
    return seriesAtEvent;
  };

  const after = projectAtEvent(rebuild.picks, eventSeriesOf, availabilityOf, armband.captain, armband.vice, event);
  const before = projectAtEvent(team.players, eventSeriesOf, availabilityOf, team.captain, team.viceCaptain, event);

  return {
    valuation: {
      chip: "freehit",
      event,
      gain: after - before,
      terms: { rebuiltXp: after, currentSquadXp: before },
      explanation: [
        `Best legal one-week squad for GW${event} scores ${after.toFixed(1)} against your current ` +
          `squad's ${before.toFixed(1)}. The squad reverts after the gameweek.`,
      ],
      blocked: null,
    },
    picks: rebuild.picks,
    captain: armband.captain,
    vice: armband.vice,
    armbandMoved: false,
  };
}

function freeHitAt(ctx: RebuildContext, event: number): ChipValuation {
  return freeHitRebuildAt(ctx, event).valuation;
}

// --------------------------------------------------------------- Wildcard

/**
 * Permanent rebuild, valued over the remaining window rather than one
 * gameweek. Carries the current armband into the rebuilt squad when it is
 * still there — otherwise `suggestArmband` picks a new one and the gain is
 * disclosed as understated, the same treatment `transfer-optimizer.ts`'s
 * wildcard branch gives the same situation.
 */
export function wildcardRebuildAt(ctx: RebuildContext, event: number, windowEnd: number): ChipRebuild {
  const { team, pool, rules, predAt, availabilityOf } = ctx;
  const rebuildPool = pool.map((p) => toOptimizerPlayerWindow(p, predAt, event, windowEnd));
  const rebuild = optimizeSquad({
    pool: rebuildPool,
    rules,
    locked: [],
    horizon: "season",
    strategy: "max_points",
    risk: "medium",
  });

  if (rebuild.error || rebuild.picks.length !== rules.squadSize) {
    return blockedRebuild("wildcard", event, rebuild.error ?? "Could not build a legal squad from scratch.");
  }

  const byId = new Map(rebuildPool.map((p) => [p.id, p]));
  const stillIn = team.captain !== null && rebuild.picks.some((p) => p.playerId === team.captain);
  const armband = stillIn
    ? { captain: team.captain, vice: team.viceCaptain }
    : suggestArmband(rebuild.picks, byId, "season");

  const after = projectOverWindow(rebuild.picks, predAt, availabilityOf, armband.captain, armband.vice, event, windowEnd);
  const before = projectOverWindow(team.players, predAt, availabilityOf, team.captain, team.viceCaptain, event, windowEnd);

  const explanation = [
    `Rebuilt squad projects ${after.toFixed(1)} xP through GW${windowEnd} against your current ` +
      `squad's ${before.toFixed(1)}.`,
  ];
  if (!stillIn) {
    explanation.push("The armband is not re-optimised here, so this gain is understated.");
  }

  return {
    valuation: {
      chip: "wildcard",
      event,
      gain: after - before,
      terms: { rebuiltXp: after, currentSquadXp: before },
      explanation,
      blocked: null,
    },
    picks: rebuild.picks,
    captain: armband.captain,
    vice: armband.vice,
    armbandMoved: !stillIn,
  };
}

function wildcardAt(ctx: RebuildContext, event: number, windowEnd: number): ChipValuation {
  return wildcardRebuildAt(ctx, event, windowEnd).valuation;
}

// -------------------------------------------------------------- schedule

/**
 * Best way to place one available chip per gameweek across the given chip
 * kinds, by exhaustive search — at most a few dozen candidate gameweeks per
 * chip, so a full search (tens of thousands of combinations) runs in
 * milliseconds and needs no pruning heuristic to get right.
 *
 * `kinds` restricts which chips compete for a slot — callers pass the
 * single-gameweek chips (Bench Boost, Triple Captain, Free Hit) here, since
 * summing in Wildcard's cumulative multi-gameweek gain would mix
 * incompatible units into the total. `preUsedEvents` blocks gameweeks
 * already spoken for by a chip decided outside this search (Wildcard's own
 * pick), since FPL never allows two chips active in the same gameweek.
 *
 * Returns the margin to the next-best assignment alongside the total, so a
 * schedule built from a flat set of values is visibly flat rather than
 * presented as a confident recommendation.
 */
export function bestSchedule(
  perChip: Record<ChipKind, ChipValuation[]>,
  kinds: ChipKind[] = CHIP_KINDS,
  preUsedEvents: Set<number> = new Set(),
): ChipSchedule | null {
  const chips = kinds.filter((c) => perChip[c] && perChip[c].length > 0);
  if (chips.length === 0) return null;

  const options: Record<ChipKind, ChipValuation[]> = {} as Record<ChipKind, ChipValuation[]>;
  for (const c of chips) options[c] = [...perChip[c]].sort((a, b) => b.gain - a.gain);

  let bestTotal = -Infinity;
  let bestEntries: ChipScheduleEntry[] = [];
  let secondTotal = -Infinity;

  const used = new Set<number>(preUsedEvents);
  const current: ChipScheduleEntry[] = [];

  function recurse(idx: number, total: number) {
    if (idx === chips.length) {
      if (total > bestTotal) {
        secondTotal = bestTotal;
        bestTotal = total;
        bestEntries = [...current];
      } else if (total > secondTotal) {
        secondTotal = total;
      }
      return;
    }
    const chip = chips[idx];
    for (const v of options[chip]) {
      if (used.has(v.event)) continue;
      used.add(v.event);
      current.push({ chip, event: v.event, gain: v.gain });
      recurse(idx + 1, total + v.gain);
      current.pop();
      used.delete(v.event);
    }
  }
  recurse(0, 0);

  if (bestEntries.length !== chips.length) return null;

  return {
    entries: bestEntries,
    total: bestTotal,
    margin: secondTotal === -Infinity ? bestTotal : bestTotal - secondTotal,
  };
}

// ------------------------------------------------------------------ entry

export function runChipEngine(input: ChipsEngineInput): ChipEngineResult {
  const {
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
  } = input;

  const windows: ChipWindow[] = [];
  const valuationsByChip: Record<ChipKind, ChipValuation[]> = {
    bboost: [],
    "3xc": [],
    freehit: [],
    wildcard: [],
  };

  const rebuildCtx: RebuildContext = { team, pool, rules, predAt, availabilityOf };

  // Per chip, the last event a def's blocked-gap fill or valuation loop has
  // already accounted for. Chip windows are contiguous halves (GW1-19,
  // GW20-38 today), so only the very first def for a chip can have a real
  // gap before it (e.g. Wildcard's GW1 before its GW2 open) — without this,
  // the second half's def would re-run the gap fill from `windowStart` and
  // overwrite the first half's already-valued gameweeks with a bogus
  // "opens GW20" reason.
  const coveredThrough: Partial<Record<ChipKind, number>> = {};

  for (const def of chipDefinitions) {
    const chip = def.name as ChipKind;
    if (!CHIP_KINDS.includes(chip)) continue;
    const label = CHIP_LABELS[chip];

    if (def.startEvent > windowEnd) {
      windows.push({
        chip,
        label,
        startEvent: def.startEvent,
        stopEvent: resolveStopEvent(def, windowEnd),
        blocked: `Predictions only reach GW${windowEnd}; this window opens GW${def.startEvent}.`,
      });
      continue;
    }

    windows.push({
      chip,
      label,
      startEvent: def.startEvent,
      stopEvent: resolveStopEvent(def, windowEnd),
      blocked: null,
    });

    // Gameweeks inside the requested window, after whatever this chip's
    // prior def already covered, but before this def's own window opens
    // (e.g. Wildcard/Free Hit's first start_event 2 leaving GW1
    // unplayable): reported blocked with a reason, not silently dropped from
    // the series — same discipline as the "Predictions only reach…" case
    // above, and matching transfer-optimizer.ts's wildcard-row precedent.
    const gapFrom = Math.max(windowStart, (coveredThrough[chip] ?? windowStart - 1) + 1);
    for (let e = gapFrom; e < Math.min(def.startEvent, windowEnd + 1); e++) {
      valuationsByChip[chip].push(blockedValuation(chip, e, `${label} opens GW${def.startEvent}.`));
    }

    const from = Math.max(def.startEvent, windowStart);
    const to = Math.min(resolveStopEvent(def, windowEnd), windowEnd);

    if (chip === "wildcard") {
      for (let e = from; e <= to; e++) {
        valuationsByChip.wildcard.push(wildcardAt(rebuildCtx, e, to));
      }
    } else if (chip === "freehit") {
      for (let e = from; e <= to; e++) {
        valuationsByChip.freehit.push(freeHitAt(rebuildCtx, e));
      }
    } else if (chip === "bboost") {
      for (let e = from; e <= to; e++) {
        valuationsByChip.bboost.push(benchBoostAt(team.players, e, predAt, lookup, isPenaltyTaker));
      }
    } else if (chip === "3xc") {
      for (let e = from; e <= to; e++) {
        valuationsByChip["3xc"].push(tripleCaptainAt(team, e, predAt, availabilityOf, lookup, isPenaltyTaker));
      }
    }

    coveredThrough[chip] = Math.max(coveredThrough[chip] ?? windowStart - 1, to, def.startEvent - 1);
  }

  // ---- per-half schedules ------------------------------------------------
  //
  // FPL grants each chip once per half (GW1-19, GW20-38 today), so the two
  // halves are independent decisions rather than one season-long schedule —
  // this is also what stops the second half's chip use from being silently
  // discarded, which a single flat search across both halves would do.
  const defsByChip = new Map<ChipKind, ChipDefinitionRow[]>();
  for (const def of chipDefinitions) {
    const chip = def.name as ChipKind;
    if (!CHIP_KINDS.includes(chip)) continue;
    const list = defsByChip.get(chip) ?? [];
    list.push(def);
    defsByChip.set(chip, list);
  }
  for (const list of defsByChip.values()) list.sort((a, b) => a.startEvent - b.startEvent);

  const halfCount = Math.max(0, ...[...defsByChip.values()].map((l) => l.length));
  const schedules: ChipHalfSchedule[] = [];

  for (let h = 0; h < halfCount; h++) {
    const perChipHalf: Record<ChipKind, ChipValuation[]> = {
      bboost: [],
      "3xc": [],
      freehit: [],
      wildcard: [],
    };
    let minStart = Infinity;
    let maxStop = -Infinity;
    let anyDef = false;

    for (const chip of CHIP_KINDS) {
      const def = defsByChip.get(chip)?.[h];
      if (!def) continue;
      anyDef = true;
      const stop = resolveStopEvent(def, windowEnd);
      minStart = Math.min(minStart, def.startEvent);
      maxStop = Math.max(maxStop, stop);
      perChipHalf[chip] = valuationsByChip[chip].filter(
        (v) => v.blocked === null && v.event >= def.startEvent && v.event <= stop,
      );
    }
    if (!anyDef) continue;

    // Wildcard is picked independently — argmax over this half's gameweeks —
    // rather than jointly with the one-off search, since its cumulative gain
    // dwarfs three single-gameweek gains by construction and a joint search
    // would not meaningfully change which gameweek wins.
    const wildcardPick =
      perChipHalf.wildcard.length > 0
        ? [...perChipHalf.wildcard].sort((a, b) => b.gain - a.gain)[0]
        : null;
    const preUsed = wildcardPick ? new Set([wildcardPick.event]) : new Set<number>();

    const oneOff = bestSchedule(perChipHalf, ["bboost", "3xc", "freehit"], preUsed);

    schedules.push({
      label: `GW${minStart}-${maxStop}`,
      startEvent: minStart,
      stopEvent: maxStop,
      oneOff,
      wildcard: wildcardPick,
    });
  }

  const { blankEvents, doubleEvents } = countBlanksAndDoubles(fixturesPerEvent, windowStart, windowEnd);

  return {
    windows,
    valuationsByChip,
    schedules,
    note: chipModelNote(blankEvents, doubleEvents, windowEnd),
    noteSummary: chipModelNoteSummary(blankEvents, doubleEvents, windowEnd),
  };
}
