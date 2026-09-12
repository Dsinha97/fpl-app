// Chip strategy — the plan, and the per-event chip primitives that a chip
// plan needs cheaply available to the transfer simulator.
//
// This module is deliberately a leaf: it depends only on `./lineup` and
// `./team-state`, never on `./chips` or `./optimizer`. `lib/chips.ts` imports
// `./transfer-optimizer`, which imports `./transfers` — so `./transfers`
// importing `./chips` back would be a real ESM cycle. Everything the
// simulator needs (bench-boost / triple-captain valuation, one squad at a
// time) is cheap and lives here; everything expensive (Free Hit / Wildcard
// rebuilds via `optimizeSquad`) stays in `lib/chips.ts`, which re-exports
// this module's symbols so no existing import path breaks.

import { optimiseLineup, type LineupCandidate } from "./lineup";
import {
  projectAtEvent,
  type ChipKind,
  type ChipPlan,
  type ChipPlanEntry,
  type PlayerMeta,
  type SquadPick,
  type TeamState,
  type XpByEvent,
  EMPTY_CHIP_PLAN,
} from "./team-state";

// Re-exported: every consumer of this module's chip primitives (the plan
// editor, the pages composing it) already imports `ChipKind` alongside them,
// and re-exporting here means they don't also need a second import from
// `./team-state` just for the type.
export type { ChipKind };

export interface EventPrediction {
  expectedMinutes: number | null;
  startProbability: number | null;
  /** 0-1, per event — player_predictions carries this per gameweek, not just "now". */
  availability: number;
  fdr: number | null;
  xp: number | null;
}

export type PredAt = (playerId: number, event: number) => EventPrediction | undefined;

export const CHIP_LABELS: Record<ChipKind, string> = {
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
  freehit: "Free Hit",
  wildcard: "Wildcard",
};

export const CHIP_KINDS: ChipKind[] = ["bboost", "3xc", "freehit", "wildcard"];

/**
 * A chip slug rendered for a human. `TeamState.activeChip` and
 * `manager_gameweek_history.active_chip` are untyped strings FPL owns, so this
 * falls back to the raw value for anything it doesn't recognise rather than
 * throwing or printing "undefined" — but nothing user-facing should ever print
 * a bare `3xc` again, which is what both call sites were doing.
 */
export function chipLabel(chip: string | null | undefined): string | null {
  if (!chip) return null;
  return CHIP_KINDS.includes(chip as ChipKind) ? CHIP_LABELS[chip as ChipKind] : chip;
}

export interface ChipValuation {
  chip: ChipKind;
  event: number;
  gain: number;
  /** Named components so the page never shows a bare net figure. */
  terms: Record<string, number>;
  explanation: string[];
  /** Why this gameweek could not be valued, when it could not. */
  blocked: string | null;
}

export interface ChipDefinitionRow {
  name: string;
  startEvent: number;
  /** Null in the database for an open-ended window — see `resolveStopEvent`. */
  stopEvent: number | null;
}

// -------------------------------------------------------------- primitives

/** One gameweek's `LineupCandidate[]` for a squad — the one new view lib/chips.ts added in Sprint 12. */
export function candidatesAt(
  picks: SquadPick[],
  event: number,
  predAt: PredAt,
  lookup: (playerId: number) => PlayerMeta | undefined,
  isPenaltyTaker: (playerId: number) => boolean,
): LineupCandidate[] {
  const out: LineupCandidate[] = [];
  for (const pick of picks) {
    const meta = lookup(pick.playerId);
    if (!meta) continue;
    const pred = predAt(pick.playerId, event);
    out.push({
      playerId: pick.playerId,
      elementType: meta.elementType,
      webName: meta.webName,
      xp: pred?.xp ?? null,
      expectedMinutes: pred?.expectedMinutes ?? null,
      startProbability: pred?.startProbability ?? null,
      availability: pred?.availability ?? 0,
      fdr: pred?.fdr ?? null,
      opponent: null,
      isPenaltyTaker: isPenaltyTaker(pick.playerId),
    });
  }
  return out;
}

export function blockedValuation(chip: ChipKind, event: number, reason: string): ChipValuation {
  return { chip, event, gain: 0, terms: {}, explanation: [reason], blocked: reason };
}

// -------------------------------------------------------------- Bench Boost

/**
 * Net of what auto-subs would already deliver: `optimiseLineup` already
 * prices the bench's expected contribution *without* the chip
 * (`benchExpectedContribution`), so charging for it again inside the chip
 * value would overstate every Bench Boost by however much the bench already
 * earns on a normal week.
 */
export function benchBoostAt(
  picks: SquadPick[],
  event: number,
  predAt: PredAt,
  lookup: (playerId: number) => PlayerMeta | undefined,
  isPenaltyTaker: (playerId: number) => boolean,
): ChipValuation {
  const candidates = candidatesAt(picks, event, predAt, lookup, isPenaltyTaker);
  const result = optimiseLineup(candidates);
  if (!result) return blockedValuation("bboost", event, "No legal lineup could be formed for this gameweek.");

  const gain = result.benchXp - result.benchExpectedContribution;
  return {
    chip: "bboost",
    event,
    gain,
    terms: { benchXp: result.benchXp, benchExpectedContribution: result.benchExpectedContribution },
    explanation: [
      `Bench totals ${result.benchXp.toFixed(1)} xP; auto-subs would already deliver ` +
        `${result.benchExpectedContribution.toFixed(1)} of it without the chip.`,
    ],
    blocked: null,
  };
}

// ---------------------------------------------------------- Triple Captain

/**
 * Reports two figures rather than one: the extra copy your *current* armband
 * would earn, and what the model's own best captain for this gameweek would
 * earn. The best Triple Captain target is often not today's captain, and
 * collapsing the two into one number would hide a choice the user still has.
 */
export function tripleCaptainAt(
  team: TeamState,
  event: number,
  predAt: PredAt,
  availabilityOf: (playerId: number) => number,
  lookup: (playerId: number) => PlayerMeta | undefined,
  isPenaltyTaker: (playerId: number) => boolean,
): ChipValuation {
  const candidates = candidatesAt(team.players, event, predAt, lookup, isPenaltyTaker);
  const result = optimiseLineup(candidates);
  if (!result) return blockedValuation("3xc", event, "No legal lineup could be formed for this gameweek.");

  const bonus = (captain: number | null, vice: number | null): number => {
    if (captain === null) return 0;
    const pCap = availabilityOf(captain);
    const capXp = predAt(captain, event)?.xp ?? 0;
    const viceXp = vice !== null ? (predAt(vice, event)?.xp ?? 0) : 0;
    return capXp * pCap + viceXp * (1 - pCap);
  };

  const withCurrent = bonus(team.captain, team.viceCaptain);
  const bestCaptain = result.captain?.playerId ?? null;
  const withBest = bonus(bestCaptain, result.vice?.playerId ?? null);

  const gain = team.captain !== null ? withCurrent : withBest;
  const differs = team.captain !== null && bestCaptain !== null && bestCaptain !== team.captain;

  return {
    chip: "3xc",
    event,
    gain,
    terms: { withCurrentArmband: withCurrent, withBestArmband: withBest },
    explanation: differs
      ? [
          `Your current captain is worth +${withCurrent.toFixed(1)}; the model's own pick for this ` +
            `gameweek, ${result.captain?.webName ?? "another player"}, would be worth +${withBest.toFixed(1)}.`,
        ]
      : [`One extra copy of the captain's gameweek score: +${gain.toFixed(1)}.`],
    blocked: null,
  };
}

/**
 * Bench Boost / Triple Captain bonus at one event, for one squad. Delegates
 * to `benchBoostAt`/`tripleCaptainAt` so this quantity has exactly one
 * implementation; returns null for `freehit`/`wildcard`, which are event
 * *masks* rather than additive bonuses (see `chipContextFor`).
 */
export function chipBonusAt(
  team: TeamState,
  event: number,
  chip: ChipKind,
  predAt: PredAt,
  availabilityOf: (playerId: number) => number,
  lookup: (playerId: number) => PlayerMeta | undefined,
  isPenaltyTaker: (playerId: number) => boolean,
): ChipValuation | null {
  if (chip === "bboost") return benchBoostAt(team.players, event, predAt, lookup, isPenaltyTaker);
  if (chip === "3xc") return tripleCaptainAt(team, event, predAt, availabilityOf, lookup, isPenaltyTaker);
  return null;
}

// --------------------------------------------------------------- context

export interface ChipContextEntry {
  event: number;
  chip: ChipKind;
}

/**
 * A chip plan, resolved into the two things the transfer simulator can act
 * on within one horizon window. Callers resolve the window (the simulator
 * never touches `horizonLength`) and pass only the plan's *usable* entries
 * (`ChipPlanValidation.usable`) — an invalid entry must never silently shape
 * a number the UI presents as modelled.
 *
 *   - `excluded`: gameweeks a Free Hit or Wildcard makes worthless to
 *     transfer for. Free Hit masks its own gameweek only — moves made *in*
 *     that gameweek still persist afterwards. Wildcard masks every gameweek
 *     from its own event through the end of the window, because a rebuild
 *     overwrites everything before it; this is what makes "near-worthless"
 *     fall out of the arithmetic rather than an invented coefficient.
 *   - `bonus`: gameweeks carrying an additive Bench Boost / Triple Captain value.
 */
export interface ChipContext {
  excluded: (ChipContextEntry & { reason: string })[];
  bonus: ChipContextEntry[];
}

/**
 * Resolves usable plan entries within `[fromEvent, toEvent]` into a
 * `ChipContext`, or null when nothing in the plan touches this window (the
 * common case, and the one that must cost nothing extra to compute).
 */
export function chipContextFor(
  usableEntries: ChipPlanEntry[],
  fromEvent: number,
  toEvent: number,
): ChipContext | null {
  const relevant = usableEntries.filter((e) => e.event >= fromEvent && e.event <= toEvent);
  if (relevant.length === 0) return null;

  const excluded: ChipContext["excluded"] = [];
  const bonus: ChipContext["bonus"] = [];

  const wildcard = relevant
    .filter((e) => e.chip === "wildcard")
    .sort((a, b) => a.event - b.event)[0];

  if (wildcard) {
    for (let e = wildcard.event; e <= toEvent; e++) {
      excluded.push({
        event: e,
        chip: "wildcard",
        reason: `A Wildcard is planned for GW${wildcard.event} — this squad is overwritten by then, so a transfer made before it earns nothing.`,
      });
    }
  }

  for (const entry of relevant) {
    if (entry.chip === "freehit" && !(wildcard && entry.event >= wildcard.event)) {
      excluded.push({
        event: entry.event,
        chip: "freehit",
        reason: `A Free Hit is planned for GW${entry.event} — you field a different squad that gameweek only, so a transfer earns nothing there.`,
      });
    }
    if ((entry.chip === "bboost" || entry.chip === "3xc") && !(wildcard && entry.event >= wildcard.event)) {
      bonus.push({ event: entry.event, chip: entry.chip });
    }
  }

  return excluded.length > 0 || bonus.length > 0 ? { excluded, bonus } : null;
}

export interface ChipAdjustment {
  /** xP removed because a Free Hit / Wildcard overwrites those gameweeks. */
  excluded: number;
  /** xP added by a planned Bench Boost / Triple Captain. */
  bonus: number;
  /** One line per contributing gameweek, so the number is never bare. */
  terms: { event: number; chip: ChipKind; delta: number; reason: string }[];
}

/**
 * The chip-plan adjustment for one squad. `excluded` reuses `projectAtEvent`
 * — the same function `rollBranch` (transfer-optimizer.ts) already uses for
 * its forfeited-gameweek arithmetic — so "one gameweek's worth of a squad"
 * has exactly one implementation. `bonus` reuses `chipBonusAt`, which is
 * itself a thin delegate to `benchBoostAt`/`tripleCaptainAt`.
 */
export function chipAdjustmentFor(
  team: TeamState,
  context: ChipContext,
  seriesOf: (playerId: number) => XpByEvent | undefined,
  availabilityOf: (playerId: number) => number,
  predAt: PredAt,
  lookup: (playerId: number) => PlayerMeta | undefined,
  isPenaltyTaker: (playerId: number) => boolean,
): ChipAdjustment {
  const terms: ChipAdjustment["terms"] = [];
  let excluded = 0;

  // Grouped by chip, not one row per masked gameweek: a Wildcard's mask can
  // span a dozen-plus events, and a dozen near-identical "GW9 wildcard, GW10
  // wildcard, …" rows is noise, not named components. One summed term per
  // masking chip keeps the number decomposed without the clutter.
  const excludedByChip = new Map<ChipKind, { events: number[]; total: number; reason: string }>();
  for (const ex of context.excluded) {
    const value = projectAtEvent(
      team.players,
      seriesOf,
      availabilityOf,
      team.captain,
      team.viceCaptain,
      ex.event,
    );
    excluded += value;
    const group = excludedByChip.get(ex.chip);
    if (group) {
      group.events.push(ex.event);
      group.total += value;
    } else {
      excludedByChip.set(ex.chip, { events: [ex.event], total: value, reason: ex.reason });
    }
  }
  for (const [chip, group] of excludedByChip) {
    const from = Math.min(...group.events);
    const to = Math.max(...group.events);
    terms.push({
      event: from,
      chip,
      delta: -group.total,
      reason: to > from ? `${group.reason} (GW${from}-${to} in this window.)` : group.reason,
    });
  }

  let bonus = 0;
  for (const b of context.bonus) {
    const v = chipBonusAt(team, b.event, b.chip, predAt, availabilityOf, lookup, isPenaltyTaker);
    if (!v || v.blocked) continue;
    bonus += v.gain;
    terms.push({
      event: b.event,
      chip: b.chip,
      delta: v.gain,
      reason: v.explanation[0] ?? `${CHIP_LABELS[b.chip]} bonus at GW${b.event}.`,
    });
  }

  return { excluded, bonus, terms };
}

// ------------------------------------------------------------------- plan

/** The one normaliser for "does this draft have a plan yet" — every reader should go through this. */
export function chipPlanOf(state: TeamState): ChipPlan {
  return state.chipPlan ?? EMPTY_CHIP_PLAN;
}

/**
 * The chip in force at `event`. FPL's own report of the current gameweek
 * always wins over the plan — a plan is an intention, `activeChip` is what
 * the game says is already happening. An `activeChip` value that is not one
 * of the four typed kinds returns null rather than guessed, matching
 * `lib/fpl-squad.ts`'s fail-closed treatment of the same field.
 *
 * The chip's gameweek is `activeChipEvent` when the draft carries one, and
 * `gameweek` otherwise — the fallback is what every draft saved before that
 * field existed was already doing, so their behaviour is unchanged. The
 * distinction matters once a deadline passes: `gameweek` is stamped with
 * whichever gameweek was next at import time, so a stale draft would otherwise
 * report last gameweek's chip as live in this one.
 */
export function chipAt(state: TeamState, event: number): ChipKind | null {
  const fact = fplActiveChipAt(state, event);
  if (fact) return fact;
  const entry = chipPlanOf(state).entries.find((e) => e.event === event);
  return entry?.chip ?? null;
}

/**
 * The fact half of `chipAt`, on its own: the chip **FPL itself** reports as
 * already played at `event`, never one the owner merely planned. Split out
 * because a status badge must not label an intention as something that has
 * happened — and because splitting it is the only way to have one
 * implementation of the rule rather than two (CLAUDE.md).
 */
export function fplActiveChipAt(state: TeamState, event: number): ChipKind | null {
  const activeEvent = state.activeChipEvent ?? state.gameweek;
  if (activeEvent === event && state.activeChip && CHIP_KINDS.includes(state.activeChip as ChipKind)) {
    return state.activeChip as ChipKind;
  }
  return null;
}

/**
 * The chip entries actually in force from `event` onward: the plan's usable
 * entries, plus a synthetic `source: "fpl"` entry for a chip FPL reports as
 * already active at `event`.
 *
 * This is the one place the fact and the intention are merged, so no page
 * writes a second version of the rule (CLAUDE.md: one quantity, one
 * implementation). A chip already in play is not a *choice* the optimiser can
 * still make, but it is very much a term in this gameweek's points — leaving
 * it out means the projection quietly scores a Triple Captain squad as if the
 * captain were only doubled.
 *
 * `usableEntries` must be `validateChipPlan`'s `usable` output, which has
 * already rejected any plan entry conflicting with the active chip — so this
 * cannot double up a gameweek.
 */
export function chipEntriesInForce(
  state: TeamState,
  usableEntries: ChipPlanEntry[],
  event: number,
): ChipPlanEntry[] {
  const chip = chipAt(state, event);
  if (!chip || usableEntries.some((e) => e.event === event)) return usableEntries;
  return sortEntries([
    ...usableEntries,
    { chip, event, source: "fpl", pinnedAt: new Date().toISOString() },
  ]);
}

const sortEntries = (entries: ChipPlanEntry[]): ChipPlanEntry[] =>
  [...entries].sort((a, b) => a.event - b.event);

/** Pins `chip` to `event`, replacing any existing entry for that event (FPL allows only one chip per gameweek). */
export function setChipPlanEntry(
  plan: ChipPlan | undefined,
  chip: ChipKind,
  event: number,
  source: ChipPlanEntry["source"] = "manual",
): ChipPlan {
  const rest = chipPlanOf({ chipPlan: plan } as TeamState).entries.filter((e) => e.event !== event);
  return {
    version: 1,
    entries: sortEntries([...rest, { chip, event, source, pinnedAt: new Date().toISOString() }]),
  };
}

/** Removes whatever chip is pinned to `event`, if any. */
export function clearChipPlanEntry(plan: ChipPlan | undefined, event: number): ChipPlan {
  const entries = chipPlanOf({ chipPlan: plan } as TeamState).entries.filter((e) => e.event !== event);
  return { version: 1, entries: sortEntries(entries) };
}

/** `stop_event` is nullable in the database for an open-ended window — resolve it to the season's last gameweek. */
export function resolveStopEvent(def: ChipDefinitionRow, lastEvent: number): number {
  return def.stopEvent ?? lastEvent;
}

export type ChipPlanProblemKind =
  | "outside-window"
  | "no-window"
  | "past-gameweek"
  | "two-chips-one-gameweek"
  | "duplicate-in-half"
  | "already-played"
  | "conflicts-with-active-chip";

/** One chip FPL's own history already reports as played this season — the
 *  shape `manager_chips` (`event, name`) is read into. */
export interface PlayedChip {
  chip: ChipKind;
  event: number;
}

export interface ChipPlanProblem {
  kind: ChipPlanProblemKind;
  chip: ChipKind;
  event: number;
  /** Prose, shown directly next to the offending row. */
  message: string;
}

export interface ChipPlanValidation {
  problems: ChipPlanProblem[];
  /** Entries with no problem — what the engine is allowed to act on. */
  usable: ChipPlanEntry[];
  valid: boolean;
}

/**
 * Validates a chip plan against the real `chip_definitions` windows, never a
 * hardcoded GW19 boundary. Every rule is sourced from the database:
 *
 *   - the chip is one of the four FPL kinds;
 *   - the gameweek has not already passed;
 *   - the chip has a window at all this season, and this gameweek falls in one;
 *   - at most one entry per gameweek, across all chips (FPL rule);
 *   - at most one entry per (chip, half) — a half is *which `chip_definitions`
 *     row* the gameweek falls into, not an assumed boundary;
 *   - an entry at `nextEvent` does not contradict a chip FPL already reports live;
 *   - at most one entry per (chip, half) where FPL's own history
 *     (`manager_chips`) already reports that chip played this half — a plan
 *     can't offer to plan a chip that no longer exists to play.
 */
export function validateChipPlan(
  plan: ChipPlan | undefined,
  chipDefinitions: ChipDefinitionRow[],
  nextEvent: number,
  lastEvent: number,
  activeChip: string | null = null,
  playedChips: PlayedChip[] = [],
): ChipPlanValidation {
  const entries = sortEntries(chipPlanOf({ chipPlan: plan } as TeamState).entries);
  const problems: ChipPlanProblem[] = [];
  const usable: ChipPlanEntry[] = [];

  const defsByChip = new Map<ChipKind, ChipDefinitionRow[]>();
  for (const def of chipDefinitions) {
    if (!CHIP_KINDS.includes(def.name as ChipKind)) continue;
    const chip = def.name as ChipKind;
    const list = defsByChip.get(chip) ?? [];
    list.push(def);
    defsByChip.set(chip, list);
  }
  for (const list of defsByChip.values()) list.sort((a, b) => a.startEvent - b.startEvent);

  // Which (chip, half) FPL's own history already reports as played — checked
  // before the plan's own duplicate-in-half rule, since "already played" is a
  // fact and "duplicate in the plan" is only ever an intention conflicting
  // with itself.
  const playedHalves = new Set<string>(); // `${chip}:${defIndex}`
  for (const played of playedChips) {
    const defs = defsByChip.get(played.chip) ?? [];
    const defIndex = defs.findIndex(
      (d) => d.startEvent <= played.event && played.event <= resolveStopEvent(d, lastEvent),
    );
    if (defIndex !== -1) playedHalves.add(`${played.chip}:${defIndex}`);
  }

  const eventsSeen = new Map<number, ChipPlanEntry>();
  const halvesSeen = new Set<string>(); // `${chip}:${defIndex}`

  for (const entry of entries) {
    let ok = true;

    if (!CHIP_KINDS.includes(entry.chip)) {
      // Not a real chip kind — nothing more to check, but nothing crashes on it either.
      problems.push({
        kind: "no-window",
        chip: entry.chip,
        event: entry.event,
        message: `"${entry.chip}" is not a chip this game has.`,
      });
      continue;
    }

    if (entry.event < nextEvent) {
      problems.push({
        kind: "past-gameweek",
        chip: entry.chip,
        event: entry.event,
        message: `GW${entry.event} has already passed.`,
      });
      ok = false;
    }

    const defs = defsByChip.get(entry.chip) ?? [];
    if (defs.length === 0) {
      problems.push({
        kind: "no-window",
        chip: entry.chip,
        event: entry.event,
        message: `${entry.chip} has no window this season.`,
      });
      ok = false;
    } else {
      const defIndex = defs.findIndex(
        (d) => d.startEvent <= entry.event && entry.event <= resolveStopEvent(d, lastEvent),
      );
      if (defIndex === -1) {
        problems.push({
          kind: "outside-window",
          chip: entry.chip,
          event: entry.event,
          message: `GW${entry.event} is outside every window this chip has (${defs
            .map((d) => `GW${d.startEvent}-${resolveStopEvent(d, lastEvent)}`)
            .join(", ")}).`,
        });
        ok = false;
      } else {
        const halfKey = `${entry.chip}:${defIndex}`;
        if (playedHalves.has(halfKey)) {
          problems.push({
            kind: "already-played",
            chip: entry.chip,
            event: entry.event,
            message: `${CHIP_LABELS[entry.chip]} was already played this half — there is nothing left to plan.`,
          });
          ok = false;
        } else if (halvesSeen.has(halfKey)) {
          problems.push({
            kind: "duplicate-in-half",
            chip: entry.chip,
            event: entry.event,
            message: `${CHIP_LABELS[entry.chip]} is already planned once in this half — FPL grants it only once.`,
          });
          ok = false;
        } else {
          halvesSeen.add(halfKey);
        }
      }
    }

    const clash = eventsSeen.get(entry.event);
    if (clash) {
      problems.push({
        kind: "two-chips-one-gameweek",
        chip: entry.chip,
        event: entry.event,
        message: `GW${entry.event} already has ${CHIP_LABELS[clash.chip]} planned — only one chip per gameweek.`,
      });
      ok = false;
    } else {
      eventsSeen.set(entry.event, entry);
    }

    if (
      entry.event === nextEvent &&
      activeChip &&
      CHIP_KINDS.includes(activeChip as ChipKind) &&
      activeChip !== entry.chip
    ) {
      problems.push({
        kind: "conflicts-with-active-chip",
        chip: entry.chip,
        event: entry.event,
        message: `FPL already reports ${CHIP_LABELS[activeChip as ChipKind]} as active for GW${nextEvent}, not ${CHIP_LABELS[entry.chip]}.`,
      });
      ok = false;
    }

    if (ok) usable.push(entry);
  }

  return { problems, usable, valid: problems.length === 0 };
}
