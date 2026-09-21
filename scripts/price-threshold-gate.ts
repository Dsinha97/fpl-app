// Does an ownership-scaled price threshold beat the shipped flat one?
//
// `lib/price-watch.ts` reports progress toward a threshold in absolute net
// transfers — `DEFAULT_RISE_THRESHOLD = 200_000`, `DEFAULT_FALL_THRESHOLD =
// 150_000`, flat for every player. Sprint 38 measured what FPL's real trigger
// looked like at each actual price change and found it scales roughly
// linearly with ownership (~22k net transfers per 1% owned), so the flat
// figure is ~5.6x too low at 39% ownership and far too high at 1%.
//
// That measurement is not a licence to ship a fitted curve. CLAUDE.md:
// "never tune an invented coefficient until the answer looks reasonable" and
// "an acceptance threshold you invented is not evidence". So this gates it
// the same way DSI-54's classifier was gated, and against the same kind of
// baseline — the thing already shipped.
//
// Walk-forward: for night t, fit the ownership->threshold line on price
// changes from nights BEFORE t only, then score night t. Nothing is fitted on
// a night it is later scored on.
//
// Two scorings, because a threshold does two jobs:
//
//   1. RANKING — who should I look at tonight? Both flat and scaled turn into
//      a score (|net| / threshold); compare recall at fixed budgets K, the
//      same shape as the classifier gate, with a paired per-night sign test.
//   2. CLASSIFICATION — "expected tonight" is a yes/no the UI renders. Score
//      precision/recall/F1 at the decision boundary (progress >= 1), which is
//      where flat and scaled genuinely differ.
//
// A win needs BOTH: better ordering is worthless if the verdict it drives is
// still wrong, and a better verdict on a worse ordering is luck.
//
// Usage: npx tsx scripts/price-threshold-gate.ts

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SEASON = "2026-27";

/** Price changes land in the 23:00 UTC hour — measured, not assumed. */
const CUTOFF_HOUR_UTC = 23;
const BUDGETS = [10, 20, 40, 80];
const MIN_TRAIN_EVENTS = 25;

/** The shipped flat defaults this is trying to beat. */
const FLAT_RISE = 200_000;
const FLAT_FALL = 150_000;

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
  observed_at: string;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("season", SEASON)
      .order("observed_at")
      .order("player_code")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as T[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

const netOf = (o: OwnRow) => (o.transfers_in_event ?? 0) - (o.transfers_out_event ?? 0);

/**
 * Reset-aware sum of net transfers across a run of samples.
 *
 * `transfers_in_event`/`transfers_out_event` are per-GAMEWEEK counters FPL
 * zeroes at every deadline, so a first-to-last difference spans resets and
 * inverts the sign for any player whose window crosses one. The in-counter
 * only increases within a gameweek, so a decrease IS a reset. Mirrors
 * `netTransfersSinceLastPriceChange` in lib/price-watch.ts.
 */
function sumResetAware(rows: OwnRow[]): number {
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    const reset = (rows[i].transfers_in_event ?? 0) < (rows[i - 1].transfers_in_event ?? 0);
    total += reset ? netOf(rows[i]) : netOf(rows[i]) - netOf(rows[i - 1]);
  }
  return total;
}

const cutoffMsOf = (day: string) =>
  new Date(`${day}T${String(CUTOFF_HOUR_UTC).padStart(2, "0")}:00:00Z`).getTime();

/** One observed price change: what the net and ownership were when it fired. */
interface ChangeEvent {
  night: string;
  dir: "rise" | "fall";
  ownership: number;
  absNet: number;
}

/** One player-night the model has to judge. */
interface Candidate {
  night: string;
  code: number;
  ownership: number;
  net: number;
  /** Did this player's price actually move that night, and which way. */
  moved: "rise" | "fall" | null;
}

function build(own: OwnRow[], prices: PriceRow[]) {
  const ownByPlayer = new Map<number, OwnRow[]>();
  for (const r of own) {
    const l = ownByPlayer.get(r.player_code) ?? [];
    l.push(r);
    ownByPlayer.set(r.player_code, l);
  }
  const priceByPlayer = new Map<number, PriceRow[]>();
  for (const r of prices) {
    const l = priceByPlayer.get(r.player_code) ?? [];
    l.push(r);
    priceByPlayer.set(r.player_code, l);
  }

  const nights = [...new Set(prices.map((p) => p.observed_at.slice(0, 10)))].sort();

  // --- observed changes, with the net and ownership that triggered them ----
  const events: ChangeEvent[] = [];
  for (const [code, changes] of priceByPlayer) {
    const obs = ownByPlayer.get(code) ?? [];
    for (let i = 1; i < changes.length; i++) {
      const prev = changes[i - 1];
      const cur = changes[i];
      if (cur.price === prev.price) continue;
      const window = obs.filter(
        (o) => o.observed_at >= prev.observed_at && o.observed_at < cur.observed_at,
      );
      if (window.length < 2) continue;
      const net = sumResetAware(window);
      const ownership = Number(window[window.length - 1].selected_by_percent ?? 0);
      events.push({
        night: cur.observed_at.slice(0, 10),
        dir: cur.price > prev.price ? "rise" : "fall",
        ownership,
        absNet: Math.abs(net),
      });
    }
  }

  // --- candidates per night ------------------------------------------------
  const candidates: Candidate[] = [];
  for (const night of nights) {
    const cutoff = cutoffMsOf(night);
    for (const [code, obs] of ownByPlayer) {
      const before = obs.filter((o) => new Date(o.observed_at).getTime() < cutoff);
      if (before.length < 2) continue;

      const changes = priceByPlayer.get(code) ?? [];
      const prior = changes.filter((c) => new Date(c.observed_at).getTime() < cutoff);
      const anchor = prior[prior.length - 1];
      if (!anchor) continue;

      const sinceAnchor = before.filter((o) => o.observed_at >= anchor.observed_at);
      if (sinceAnchor.length < 2) continue;

      const tonightIdx = changes.findIndex((c) => c.observed_at.slice(0, 10) === night);
      let moved: "rise" | "fall" | null = null;
      if (tonightIdx > 0) {
        const t = changes[tonightIdx];
        const p = changes[tonightIdx - 1];
        if (t.price !== p.price) moved = t.price > p.price ? "rise" : "fall";
      }

      candidates.push({
        night,
        code,
        ownership: Number(before[before.length - 1].selected_by_percent ?? 0),
        net: sumResetAware(sinceAnchor),
        moved,
      });
    }
  }

  return { events, candidates, nights };
}

// ------------------------------------------------------- the fitted threshold
//
// Ordinary least squares of |net at change| on ownership, one line per
// direction. Deliberately linear: the measurement looked linear, and a curve
// fitted to ~40 rise events would be fitting noise.
//
// Two disclosed weaknesses, neither fixable with this data:
//
//   - It is fitted on events that DID fire, so it estimates "the net when we
//     next looked after the trigger", which at ~2h sampling overshoots the
//     true trigger slightly. Every estimate here is therefore an upper bound,
//     biased the same way for both directions.
//   - Players who never changed price contribute nothing, so the fit says
//     nothing about how high a threshold has to be to never fire.

interface Line {
  intercept: number;
  slope: number;
  n: number;
}

function fitLine(points: { x: number; y: number }[], floor: number): Line | null {
  if (points.length < MIN_TRAIN_EVENTS) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, n };
}

/** Threshold for a player, floored so a negative intercept can't make everything fire. */
const thresholdFrom = (line: Line, ownership: number, floor: number): number =>
  Math.max(floor, line.intercept + line.slope * ownership);

interface Tally {
  tp: number;
  fp: number;
  fn: number;
}
const prec = (t: Tally) => (t.tp + t.fp === 0 ? 0 : t.tp / (t.tp + t.fp));
const rec = (t: Tally) => (t.tp + t.fn === 0 ? 0 : t.tp / (t.tp + t.fn));
const f1 = (t: Tally) => {
  const p = prec(t);
  const r = rec(t);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
};

function signTestP(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let cum = 0;
  let coef = 1;
  for (let i = 0; i <= k; i++) {
    cum += coef;
    coef = (coef * (n - i)) / (i + 1);
  }
  return Math.min(1, 2 * cum * Math.pow(0.5, n));
}

async function main() {
  console.log(`Ownership-scaled vs flat price threshold — season ${SEASON}\n`);

  const [own, prices] = await Promise.all([
    pageAll<OwnRow>(
      "player_ownership_history",
      "player_code, observed_at, selected_by_percent, transfers_in_event, transfers_out_event",
    ),
    pageAll<PriceRow>("player_price_history", "player_code, price, observed_at"),
  ]);

  const { events, candidates, nights } = build(own, prices);
  console.log(
    `nights ${nights.length}, change events ${events.length} ` +
      `(${events.filter((e) => e.dir === "rise").length} rise / ${events.filter((e) => e.dir === "fall").length} fall), ` +
      `player-nights ${candidates.length}`,
  );

  const flatTally: Record<string, Tally> = { rise: { tp: 0, fp: 0, fn: 0 }, fall: { tp: 0, fp: 0, fn: 0 } };
  const scaledTally: Record<string, Tally> = { rise: { tp: 0, fp: 0, fn: 0 }, fall: { tp: 0, fp: 0, fn: 0 } };
  const rank = new Map<number, { flat: number; scaled: number; pos: number; wins: number; losses: number }>();
  for (const k of BUDGETS) rank.set(k, { flat: 0, scaled: 0, pos: 0, wins: 0, losses: 0 });

  let scoredNights = 0;
  let riseNights = 0;
  let fallNights = 0;
  const fittedLines: { night: string; rise: Line | null; fall: Line | null }[] = [];

  for (const night of nights) {
    const train = events.filter((e) => e.night < night);
    const riseTrain = train.filter((e) => e.dir === "rise").map((e) => ({ x: e.ownership, y: e.absNet }));
    const fallTrain = train.filter((e) => e.dir === "fall").map((e) => ({ x: e.ownership, y: e.absNet }));

    // Fitted and scored INDEPENDENTLY per direction. Requiring both would
    // hold falls (341 events) hostage to rises (60), costing two thirds of
    // the scorable nights for the half of the question with the data to
    // answer it. This widens the test rather than narrowing it: each
    // direction is still scored only on nights its own fit could be made
    // from strictly earlier events.
    const riseLine = fitLine(riseTrain, 0);
    const fallLine = fitLine(fallTrain, 0);
    if (!riseLine && !fallLine) continue;

    // Floor at the 10th percentile of training magnitudes, so a negative
    // intercept cannot make every player fire.
    const pct10 = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length * 0.1)] ?? 1;
    };
    const riseFloor = pct10(riseTrain.map((p) => p.y));
    const fallFloor = pct10(fallTrain.map((p) => p.y));

    const test = candidates.filter((c) => c.night === night);
    if (test.length === 0) continue;
    scoredNights++;
    fittedLines.push({ night, rise: riseLine, fall: fallLine });
    if (riseLine) riseNights++;
    if (fallLine) fallNights++;

    for (const c of test) {
      const dir = c.net > 0 ? "rise" : "fall";
      const line = dir === "rise" ? riseLine : fallLine;
      if (!line) continue; // this direction has no fit yet on this night
      const abs = Math.abs(c.net);

      const flatT = dir === "rise" ? FLAT_RISE : FLAT_FALL;
      const scaledT = thresholdFrom(line, c.ownership, dir === "rise" ? riseFloor : fallFloor);

      const actual = c.moved === dir;
      const flatSays = abs >= flatT;
      const scaledSays = abs >= scaledT;

      const bump = (t: Tally, says: boolean) => {
        if (says && actual) t.tp++;
        else if (says && !actual) t.fp++;
        else if (!says && actual) t.fn++;
      };
      bump(flatTally[dir], flatSays);
      bump(scaledTally[dir], scaledSays);
    }

    // Ranking: order by progress ratio under each threshold.
    const positives = test.filter((c) => c.moved !== null).length;
    for (const k of BUDGETS) {
      const r = rank.get(k)!;
      const score = (c: Candidate, scaled: boolean) => {
        const dir = c.net > 0 ? "rise" : "fall";
        const line = dir === "rise" ? riseLine : fallLine;
        const t = scaled && line
          ? thresholdFrom(line, c.ownership, dir === "rise" ? riseFloor : fallFloor)
          : dir === "rise"
            ? FLAT_RISE
            : FLAT_FALL;
        return Math.abs(c.net) / t;
      };
      const take = (scaled: boolean) =>
        [...test].sort((a, b) => score(b, scaled) - score(a, scaled)).slice(0, k)
          .filter((c) => c.moved !== null).length;
      const f = take(false);
      const sc = take(true);
      r.flat += f;
      r.scaled += sc;
      r.pos += positives;
      if (sc > f) r.wins++;
      else if (sc < f) r.losses++;
    }
  }

  const last = fittedLines[fittedLines.length - 1];
  console.log(`scored nights: ${scoredNights} (rise fit on ${riseNights}, fall fit on ${fallNights})`);
  if (last) {
    const show = (l: Line | null) =>
      l ? `${Math.round(l.intercept).toLocaleString()} + ${Math.round(l.slope).toLocaleString()}/pct (n=${l.n})` : "(no fit)";
    console.log(`final fit — rise: ${show(last.rise)}  |  fall: ${show(last.fall)}`);
  }

  // Bonferroni across the budgets, matching what price-falls-walkforward.ts
  // already does. Testing four budgets gives the smallest p four chances to
  // look small, and holding this gate to a looser standard than the classifier
  // gate would be grading on a curve.
  const alpha = 0.05 / BUDGETS.length;
  console.log("\n=== 1. RANKING (recall at a budget) ===");
  console.log(`  K    flat   scaled   nights won/lost   sign-test p   (Bonferroni alpha ${alpha.toFixed(4)})`);
  const rankWins: boolean[] = [];
  for (const k of BUDGETS) {
    const r = rank.get(k)!;
    const p = signTestP(r.wins, r.losses);
    const better = r.scaled > r.flat && p < alpha;
    rankWins.push(better);
    const mark = better
      ? "  SCALED WINS"
      : r.scaled > r.flat && p < 0.05
        ? "  (uncorrected only — does not survive)"
        : "";
    console.log(
      `${String(k).padStart(3)}  ${((r.flat / r.pos) * 100).toFixed(1).padStart(6)}%  ` +
        `${((r.scaled / r.pos) * 100).toFixed(1).padStart(6)}%   ${String(r.wins + "/" + r.losses).padStart(13)}   ` +
        `${p.toFixed(4)}${mark}`,
    );
  }

  console.log("\n=== 2. CLASSIFICATION at the decision boundary (progress >= 1) ===");
  console.log("dir   threshold   precision   recall      F1     tp/fp/fn");
  for (const dir of ["rise", "fall"] as const) {
    for (const [label, t] of [
      ["flat", flatTally[dir]],
      ["scaled", scaledTally[dir]],
    ] as const) {
      console.log(
        `${dir.padEnd(5)} ${label.padEnd(9)} ${(prec(t) * 100).toFixed(1).padStart(9)}%  ` +
          `${(rec(t) * 100).toFixed(1).padStart(7)}%  ${(f1(t) * 100).toFixed(1).padStart(6)}%   ` +
          `${t.tp}/${t.fp}/${t.fn}`,
      );
    }
  }

  console.log("\n=== VERDICT ===");
  const riseBetter = f1(scaledTally.rise) > f1(flatTally.rise);
  const fallBetter = f1(scaledTally.fall) > f1(flatTally.fall);
  const rankBetter = rankWins.some(Boolean);

  console.log(`  ranking improves significantly at some budget (Bonferroni): ${rankBetter ? "yes" : "no"}`);
  console.log(`  rise F1 improves: ${riseBetter ? "yes" : "no"}   fall F1 improves: ${fallBetter ? "yes" : "no"}`);
  console.log("");
  if (rankBetter && riseBetter && fallBetter) {
    console.log("PASS — scaled beats flat on both ordering and verdict, in both directions.");
    console.log("Ship it as the default, keeping it user-adjustable, and say it was fitted.");
  } else if (!riseBetter && !fallBetter && !rankBetter) {
    console.log("FAIL — scaled beats flat on nothing. Keep the flat default and say so.");
  } else {
    console.log("MIXED — scaled wins on some measures and not others. A threshold that orders");
    console.log("better but decides worse (or vice versa) is not ready to be a default. Report");
    console.log("exactly which, and do NOT ship on the half that looks good.");
  }

  // Worth saying whatever the verdict is. Both thresholds are wrong far more
  // often than they are right, so whichever one ships, the UI must not word a
  // crossing as a prediction about tonight.
  const lo = Math.min(prec(scaledTally.rise), prec(scaledTally.fall));
  const hi = Math.max(prec(scaledTally.rise), prec(scaledTally.fall));
  console.log("");
  console.log(
    `Precision of the BEST threshold here is ${(lo * 100).toFixed(1)}%-${(hi * 100).toFixed(1)}%. ` +
      "Crossing a threshold is",
  );
  console.log("therefore not evidence that a change is coming tonight, and the UI must not say");
  console.log("it is. That is a wording fix, and it needs no fitted coefficient.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
