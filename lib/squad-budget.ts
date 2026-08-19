// Sprint 18 — Effective Starting XI budget.
//
// Only the starting 11 score points; a squad's money is split between an XI
// that earns and a bench that (mostly) doesn't. Nothing in the app has ever
// computed that split — `squadScore`'s `benchStrength` is expected *points*
// only (lib/squad-score.ts), and `LineupResult` carries no price field at
// all — even though every ingredient already exists: `SquadPick.purchasePrice`,
// `TeamState.startingXI`/`benchOrder`, and the lineup engine's XI/bench split.
//
// `benchFloor` is *derived* from the live price list and the bench's actual
// position counts, not a fixed threshold — a third-party source suggested a
// flat £17.5m cap, which is someone else's number for a different season's
// prices with nothing in this repo to check it against. Same move Hidden
// Gems made with the video's literal percentile thresholds (see
// docs/wiki/hidden-gems.md): keep the shape of the idea, derive the number.

import type { PlayerMeta, SquadRules, TeamState } from "./team-state";
import type { LineupResult } from "./lineup";

/** The one implementation of "money spent on a set of picks" — see
 *  docs/wiki/methodology.md's "one quantity, one implementation" rule. This
 *  reduce was previously duplicated across lib/drafts.ts, lib/fpl-squad.ts,
 *  lib/optimizer.ts, lib/scoring.ts, lib/squad-score.ts (twice),
 *  lib/transfer-path.ts (twice), lib/transfers.ts, app/builder/page.tsx, and
 *  app/scenarios/page.tsx. Generic over the pick shape rather than typed to
 *  `SquadPick[]` so callers with a structurally-identical local type (e.g.
 *  the optimiser's working picks array) don't need an extra import/cast.
 */
export function totalSpend(picks: readonly { purchasePrice: number }[]): number {
  return picks.reduce((sum, p) => sum + p.purchasePrice, 0);
}

export interface SquadBudget {
  /** Σ purchasePrice across all 15 picks. */
  spent: number;
  /** state.budget - spent. */
  bank: number;
  /** Null when the XI/bench split is unknown (see splitKnown). */
  xiSpend: number | null;
  benchSpend: number | null;
  /** Cheapest legal bench for the XI's actual formation, from today's prices. */
  benchFloor: number | null;
  /** benchSpend - benchFloor: money parked on players who don't score. */
  benchSurplus: number | null;
  /**
   * False when neither `state.startingXI`/`benchOrder` nor a supplied
   * `LineupResult` fallback is available *and internally consistent* — a
   * split whose starters+bench don't exactly reconstitute `state.players`
   * (stale after a transfer, in real data seen) is treated as unknown, same
   * as an unset one. Matches `squadScore`'s existing honesty about
   * `benchStrength` (`benchContribution ?? 0`, with `SQUAD_SCORE_NOTE`
   * disclosing the same thing) — report unknown rather than a guess.
   */
  splitKnown: boolean;
}

/**
 * A split is only trustworthy when starters+bench are exactly the squad's own
 * player ids — no more, no fewer. Caught on real data: `startingXI`/
 * `benchOrder` can go stale relative to `players` after a transfer (one real
 * draft's `benchOrder` referenced a playerId no longer in `players` at all),
 * and silently pricing the missing id at 0 would understate `benchSpend`
 * without ever surfacing that anything was wrong — exactly the kind of
 * quietly-shrunken number CLAUDE.md's "drop, renormalise, disclose" rule
 * exists to prevent.
 */
function isValidSplit(state: TeamState, starters: number[], bench: number[]): boolean {
  const combined = [...starters, ...bench];
  if (combined.length !== state.players.length) return false;
  const squadIds = new Set(state.players.map((p) => p.playerId));
  return combined.every((id) => squadIds.has(id)) && new Set(combined).size === combined.length;
}

function resolveSplit(
  state: TeamState,
  lineup?: LineupResult | null,
): { starters: number[]; bench: number[] } | null {
  if (state.startingXI.length > 0 && state.benchOrder.length > 0) {
    if (isValidSplit(state, state.startingXI, state.benchOrder)) {
      return { starters: state.startingXI, bench: state.benchOrder };
    }
  }
  if (lineup && isValidSplit(state, lineup.starters, lineup.bench)) {
    return { starters: lineup.starters, bench: lineup.bench };
  }
  return null;
}

/**
 * `squadBudget(state, rules, lookup, allPlayers, lineup?)`.
 *
 * `allPlayers` prices the hypothetical cheapest-legal-bench floor — it is not
 * a legality check against the owner's actual squad (a floor is allowed to
 * reuse a price point regardless of who else holds it), so no dedup against
 * `state.players` is needed.
 */
export function squadBudget(
  state: TeamState,
  rules: SquadRules,
  lookup: (playerId: number) => PlayerMeta | undefined,
  allPlayers: readonly PlayerMeta[],
  lineup?: LineupResult | null,
): SquadBudget {
  const spent = totalSpend(state.players);
  const bank = state.budget - spent;

  const split = resolveSplit(state, lineup);
  if (!split) {
    return { spent, bank, xiSpend: null, benchSpend: null, benchFloor: null, benchSurplus: null, splitKnown: false };
  }

  const priceById = new Map(state.players.map((p) => [p.playerId, p.purchasePrice]));
  const sumPrices = (ids: number[]) =>
    ids.reduce((sum, id) => sum + (priceById.get(id) ?? 0), 0);

  const xiSpend = sumPrices(split.starters);
  const benchSpend = sumPrices(split.bench);

  // Bench position counts fall out of the squad's fixed quota minus what the
  // XI actually used — squadSize/positionQuota come from game_settings via
  // SquadRules, never hardcoded 2/5/5/3.
  const xiCounts = new Map<number, number>();
  for (const id of split.starters) {
    const elementType = lookup(id)?.elementType;
    if (elementType !== undefined) xiCounts.set(elementType, (xiCounts.get(elementType) ?? 0) + 1);
  }

  const pricesByPosition = new Map<number, number[]>();
  for (const p of allPlayers) {
    const list = pricesByPosition.get(p.elementType);
    if (list) list.push(p.nowCost);
    else pricesByPosition.set(p.elementType, [p.nowCost]);
  }
  for (const list of pricesByPosition.values()) list.sort((a, b) => a - b);

  let benchFloor = 0;
  for (const [elementType, required] of Object.entries(rules.positionQuota)) {
    const count = required - (xiCounts.get(Number(elementType)) ?? 0);
    if (count <= 0) continue;
    const cheapest = pricesByPosition.get(Number(elementType)) ?? [];
    benchFloor += cheapest.slice(0, count).reduce((sum, price) => sum + price, 0);
  }

  return {
    spent,
    bank,
    xiSpend,
    benchSpend,
    benchFloor,
    benchSurplus: benchSpend - benchFloor,
    splitKnown: true,
  };
}
