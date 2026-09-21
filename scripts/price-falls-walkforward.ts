// DSI-54 step 3, falls half — does a fitted classifier beat the naive
// top-N-by-net-transfers baseline at calling tonight's price falls?
//
// Steps 1 and 2 shipped in Sprint 29: the ~2h watchlist sampling, and
// `priceProgress()`, which reports direction and progress toward a
// documented, user-set threshold. Step 3 was gated from the start: fit
// nothing until it can be scored walk-forward against that baseline, and if
// it does not win, ship the heuristic and say so.
//
// **Falls only, deliberately.** The season has ~226 recorded falls against
// ~55 rises. 55 positives leaves ~25-30 in a held-out test fold, which
// cannot separate "this does not work" from "there is not enough data to
// tell" — an unresolvable result, not an honest negative. Rises stay held
// until ~GW10-12. See docs/sprints/gw5-check-in.md §3.
//
// Scoring is precision/recall at a fixed budget K, because that is the shape
// of the decision: "which N players should I look at tonight", not "assign
// every player a probability". Both model and baseline pick K players; they
// are compared on how many of tonight's actual fallers they caught.
//
// Walk-forward: for night t, train only on nights < t. No night's own
// outcome informs its own prediction, and nothing is fitted on the full
// sample and then scored on part of it.
//
// Usage: npx tsx scripts/price-falls-walkforward.ts

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SEASON = "2026-27";

/** Price changes land in the 23:00 UTC hour — measured, not assumed. */
const CUTOFF_HOUR_UTC = 23;

/**
 * Selection budgets. The decision is "who do I check tonight", so the model
 * is scored at a size rather than on a probability. Several sizes, because a
 * lift that appears at exactly one K is a coincidence, not a result.
 */
const BUDGETS = process.argv[2] ? [Number(process.argv[2])] : [10, 20, 40, 80];

/** Nights held back for training before the first scored night. */
const MIN_TRAIN_NIGHTS = 8;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface OwnRow {
  player_code: number;
  observed_at: string;
  selected_by_percent: number | null;
  transfers_in_event: number | null;
  transfers_out_event: number | null;
}
interface PriceRow {
  player_code: number;
  price: number;
  cost_change_event: number | null;
  observed_at: string;
}

async function pageAll<T>(table: string, columns: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("season", SEASON)
      .order(order)
      .order("player_code")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as T[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/** The nightly cutoff instant for a given calendar day (UTC). */
const cutoffOf = (day: string) => new Date(`${day}T${String(CUTOFF_HOUR_UTC).padStart(2, "0")}:00:00Z`);

interface Sample {
  night: string;
  code: number;
  /** Net transfers since the player's last price change, as of the cutoff. */
  netSinceChange: number;
  /** Net transfers over the 24h before the cutoff. */
  net24h: number;
  ownership: number;
  /** Cumulative price change so far this season, in tenths. */
  costChange: number;
  /** Days since this player last changed price. */
  daysSinceChange: number;
  /** 1 if the price fell at this night's cutoff. */
  fell: number;
}

function buildSamples(own: OwnRow[], prices: PriceRow[]): Sample[] {
  const ownByPlayer = new Map<number, OwnRow[]>();
  for (const r of own) {
    const list = ownByPlayer.get(r.player_code) ?? [];
    list.push(r);
    ownByPlayer.set(r.player_code, list);
  }
  for (const list of ownByPlayer.values()) {
    list.sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  }

  const priceByPlayer = new Map<number, PriceRow[]>();
  for (const r of prices) {
    const list = priceByPlayer.get(r.player_code) ?? [];
    list.push(r);
    priceByPlayer.set(r.player_code, list);
  }
  for (const list of priceByPlayer.values()) {
    list.sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  }

  // The nights we can score: every calendar day on which any price moved.
  const nights = [...new Set(prices.map((p) => p.observed_at.slice(0, 10)))].sort();

  const samples: Sample[] = [];
  for (const night of nights) {
    const cutoff = cutoffOf(night);
    const cutoffMs = cutoff.getTime();

    for (const [code, obs] of ownByPlayer) {
      // Everything strictly BEFORE the cutoff. Using a sample taken after it
      // would leak the outcome into its own features.
      const before = obs.filter((o) => new Date(o.observed_at).getTime() < cutoffMs);
      if (before.length < 2) continue;

      const changes = priceByPlayer.get(code) ?? [];
      const priorChanges = changes.filter((c) => new Date(c.observed_at).getTime() < cutoffMs);
      const lastChange = priorChanges[priorChanges.length - 1];
      if (!lastChange) continue; // never repriced — no anchor, same as the shipped tool

      const lastChangeMs = new Date(lastChange.observed_at).getTime();
      const sinceAnchor = before.filter((o) => new Date(o.observed_at).getTime() >= lastChangeMs);
      if (sinceAnchor.length < 2) continue;

      // `transfers_in_event`/`transfers_out_event` are per-GAMEWEEK counters
      // that reset to zero at every deadline, so these cannot be a simple
      // first-to-last difference — that spans resets and inverts the sign for
      // any player whose anchor predates a deadline (89% of them). The
      // in-counter only increases within a gameweek, so a decrease is a reset.
      // Mirrors `netTransfersSinceLastPriceChange` in lib/price-watch.ts.
      const netOf = (o: OwnRow) => (o.transfers_in_event ?? 0) - (o.transfers_out_event ?? 0);
      const sumResetAware = (rows: OwnRow[]): number => {
        let total = 0;
        for (let k = 1; k < rows.length; k++) {
          const reset = (rows[k].transfers_in_event ?? 0) < (rows[k - 1].transfers_in_event ?? 0);
          total += reset ? netOf(rows[k]) : netOf(rows[k]) - netOf(rows[k - 1]);
        }
        return total;
      };

      const netSinceChange = sumResetAware(sinceAnchor);

      const dayAgo = cutoffMs - 24 * 3600_000;
      const win = before.filter((o) => new Date(o.observed_at).getTime() >= dayAgo);
      const net24h = win.length >= 2 ? sumResetAware(win) : 0;

      const latest = before[before.length - 1];

      // The label: did the price go DOWN at this night's cutoff?
      //
      // Not `cost_change_event < 0` — that is FPL's cumulative change for the
      // gameweek, so a player already down on the week reads as falling every
      // night regardless of what happened. `player_price_history` is
      // change-on-write, so direction is this row's price against the
      // previous recorded one.
      const idxTonight = changes.findIndex((c) => c.observed_at.slice(0, 10) === night);
      let fell = 0;
      if (idxTonight >= 0) {
        const tonight = changes[idxTonight];
        const previous = changes[idxTonight - 1];
        if (previous && tonight.price < previous.price) fell = 1;
      }

      samples.push({
        night,
        code,
        netSinceChange,
        net24h,
        ownership: Number(latest.selected_by_percent ?? 0),
        costChange: lastChange.cost_change_event ?? 0,
        daysSinceChange: (cutoffMs - lastChangeMs) / 86_400_000,
        fell,
      });
    }
  }
  return samples;
}

// ---------------------------------------------------------------- the model
//
// Logistic regression by batch gradient descent. Deliberately the simplest
// thing that could beat the baseline: if a linear model on these features
// cannot, a more flexible one is fitting noise on ~226 positives, not finding
// signal. Features are standardised on the TRAINING fold's own statistics —
// standardising on the full sample would leak the test fold's distribution.

const FEATURES = ["netSinceChange", "net24h", "ownership", "costChange", "daysSinceChange"] as const;

const featureVector = (s: Sample): number[] => FEATURES.map((f) => s[f] as number);

interface Model {
  weights: number[];
  bias: number;
  mean: number[];
  sd: number[];
}

function fit(train: Sample[], epochs = 400, lr = 0.1): Model {
  const X = train.map(featureVector);
  const y = train.map((s) => s.fell);
  const n = X.length;
  const d = FEATURES.length;

  const mean = Array.from({ length: d }, (_, j) => X.reduce((a, r) => a + r[j], 0) / n);
  const sd = Array.from({ length: d }, (_, j) => {
    const v = X.reduce((a, r) => a + (r[j] - mean[j]) ** 2, 0) / Math.max(1, n - 1);
    return Math.sqrt(v) || 1;
  });
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));

  const weights = new Array<number>(d).fill(0);
  let bias = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const z = Z[i].reduce((a, v, j) => a + v * weights[j], bias);
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) weights[j] -= (lr * gw[j]) / n;
    bias -= (lr * gb) / n;
  }
  return { weights, bias, mean, sd };
}

const score = (m: Model, s: Sample): number => {
  const x = featureVector(s);
  const z = x.reduce((a, v, j) => a + ((v - m.mean[j]) / m.sd[j]) * m.weights[j], m.bias);
  return 1 / (1 + Math.exp(-z));
};

// ------------------------------------------------------------- the baseline
//
// The naive rule the shipped heuristic already implements: the K players who
// have bled the most net transfers since their last price change.
const baselineRank = (s: Sample): number => s.netSinceChange;

function topK<T>(items: T[], k: number, by: (t: T) => number): T[] {
  return [...items].sort((a, b) => by(a) - by(b)).slice(0, k);
}

interface Tally {
  caught: number;
  selected: number;
  positives: number;
}
const rate = (a: number, b: number) => (b === 0 ? 0 : a / b);

/**
 * Two-sided sign test on the nights where the two differed.
 *
 * The right statistic here: the comparison is paired (same night, same
 * candidates, same positives), and "won more nights than it lost" is the
 * claim. Counting total falls caught instead would let one freak night carry
 * the result. Exact binomial, no approximation — the counts are small.
 */
function signTestP(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let cum = 0;
  let coef = 1; // C(n,0)
  for (let i = 0; i <= k; i++) {
    cum += coef;
    coef = (coef * (n - i)) / (i + 1);
  }
  return Math.min(1, 2 * cum * Math.pow(0.5, n));
}

async function main() {
  console.log(`Falls classifier vs naive baseline — season ${SEASON}, budgets ${BUDGETS.join(", ")}\n`);

  const [own, prices] = await Promise.all([
    pageAll<OwnRow>(
      "player_ownership_history",
      "player_code, observed_at, selected_by_percent, transfers_in_event, transfers_out_event",
      "observed_at",
    ),
    pageAll<PriceRow>("player_price_history", "player_code, price, cost_change_event, observed_at", "observed_at"),
  ]);
  console.log(`ownership samples: ${own.length}, price changes: ${prices.length}`);

  const samples = buildSamples(own, prices);
  const nights = [...new Set(samples.map((s) => s.night))].sort();
  const falls = samples.filter((s) => s.fell).length;
  console.log(`nights: ${nights.length}, player-nights: ${samples.length}, falls: ${falls}\n`);

  if (nights.length <= MIN_TRAIN_NIGHTS) {
    console.log(`Not enough nights to walk forward (need > ${MIN_TRAIN_NIGHTS}). Unresolvable, not negative.`);
    return;
  }

  // The model is refit per night, but the fit does not depend on K — so fit
  // once per night and score every budget off the same ranking.
  const results = new Map<number, { model: Tally; base: Tally; wins: number; losses: number }>();
  for (const k of BUDGETS) {
    results.set(k, {
      model: { caught: 0, selected: 0, positives: 0 },
      base: { caught: 0, selected: 0, positives: 0 },
      wins: 0,
      losses: 0,
    });
  }

  const candidatesPerNight: number[] = [];
  for (let i = MIN_TRAIN_NIGHTS; i < nights.length; i++) {
    const night = nights[i];
    const train = samples.filter((s) => s.night < night);
    const test = samples.filter((s) => s.night === night);
    if (test.length === 0) continue;
    candidatesPerNight.push(test.length);

    const positives = test.filter((s) => s.fell).length;
    const m = fit(train);

    for (const k of BUDGETS) {
      const r = results.get(k)!;
      const mPick = topK(test, k, (s) => -score(m, s));
      const bPick = topK(test, k, baselineRank);
      const mCaught = mPick.filter((s) => s.fell).length;
      const bCaught = bPick.filter((s) => s.fell).length;

      r.model.caught += mCaught;
      r.model.selected += mPick.length;
      r.model.positives += positives;
      r.base.caught += bCaught;
      r.base.selected += bPick.length;
      r.base.positives += positives;
      if (mCaught > bCaught) r.wins++;
      else if (mCaught < bCaught) r.losses++;
    }
  }

  const avgCandidates =
    candidatesPerNight.reduce((a, b) => a + b, 0) / Math.max(1, candidatesPerNight.length);
  console.log(`scored nights: ${candidatesPerNight.length}, mean candidates/night: ${avgCandidates.toFixed(0)}
`);

  console.log("  K   model rec   base rec   random rec   nights won/lost");
  let anyDecisive = false;
  for (const k of BUDGETS) {
    const r = results.get(k)!;
    // What picking K at random would catch, as the floor both must clear.
    const randomRecall = Math.min(1, k / avgCandidates);
    const mRec = rate(r.model.caught, r.model.positives);
    const bRec = rate(r.base.caught, r.base.positives);
    console.log(
      `${String(k).padStart(3)}   ${(mRec * 100).toFixed(1).padStart(8)}%  ${(bRec * 100).toFixed(1).padStart(8)}%  ` +
        `${(randomRecall * 100).toFixed(1).padStart(9)}%   ${r.wins}/${r.losses}`,
    );
    if (r.wins + r.losses > 0 && (r.wins === 0 || r.losses === 0)) anyDecisive = true;
  }
  void anyDecisive;

  console.log("");
  const lifts = BUDGETS.map((k) => {
    const r = results.get(k)!;
    return { k, lift: r.model.caught - r.base.caught, wins: r.wins, losses: r.losses };
  });
  const positive = lifts.filter((l) => l.lift > 0).length;
  const negative = lifts.filter((l) => l.lift < 0).length;

  console.log("VERDICT");
  const decisive: number[] = [];
  for (const l of lifts) {
    const p = signTestP(l.wins, l.losses);
    const verdict = p >= 0.05 ? "not significant" : l.lift > 0 ? "MODEL WINS" : "BASELINE WINS";
    if (p < 0.05 && l.lift > 0) decisive.push(l.k);
    console.log(
      `  K=${String(l.k).padStart(3)}: ${l.lift >= 0 ? "+" : ""}${String(l.lift).padStart(3)} falls  ` +
        `won ${l.wins} / lost ${l.losses} nights  sign-test p=${p.toFixed(4)}  ${verdict}`,
    );
  }

  // Four budgets were tested, so the smallest p-value gets four chances to
  // look small. Reporting the best one without saying so is the exact trap
  // this gate exists to avoid.
  console.log("");
  console.log(
    `Testing ${BUDGETS.length} budgets means ${BUDGETS.length} chances at a small p. Bonferroni-corrected, ` +
      `a win needs p < ${(0.05 / BUDGETS.length).toFixed(4)}.`,
  );
  const survives = lifts.filter((l) => l.lift > 0 && signTestP(l.wins, l.losses) < 0.05 / BUDGETS.length);
  console.log(
    survives.length > 0
      ? `Surviving that: K=${survives.map((l) => l.k).join(", ")}.`
      : "Nothing survives that correction.",
  );

  console.log("");
  if (decisive.length === 0) {
    console.log("No budget shows a significant win. Ship the heuristic and say so — and do NOT");
    console.log("narrow the gate to make this pass (CLAUDE.md: an acceptance threshold you");
    console.log("invented is not evidence).");
  } else if (decisive.length === BUDGETS.length) {
    console.log("Model wins significantly at every budget.");
  } else {
    console.log(`Model wins significantly at K=${decisive.join(", ")} and not at the rest.`);
    console.log("That is a coherent result rather than a coincidence only if the pattern has a");
    console.log("reason — a ranking model should help most where the budget is tight and the");
    console.log("order matters, and wash out once the budget covers most plausible candidates.");
    console.log("Check the recall table above: if the two converge as K grows, that is the");
    console.log("shape. If the wins are scattered across K with no pattern, it is noise.");
  }
  void positive;
  void negative;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
