// Does an ownership-scaled price threshold earn its keep — and if so, is it
// the SHAPE doing the work or just a corrected LEVEL?
//
// Sprint 38 shipped `thresholdsFor` in lib/price-watch.ts: falls scale with
// ownership, rises are flat at a measured level. This is the gate on that.
//
// Walk-forward: for night t, everything is fitted on price changes from
// nights BEFORE t only, then scored on night t. Nothing is fitted on a night
// it is later scored on.
//
// THREE arms, because the first run of this gate could not separate two
// different claims. It compared scaled against the pre-Sprint-38 constants
// (200k rise / 150k fall) and returned MIXED — but those levels were simply
// wrong (rises actually fire at ~378k), so "scaled" was being handed a
// badly-levelled opponent and any win was ambiguous between shape and level.
//
//   legacy — the pre-Sprint-38 constants
//   flat   — the best single constant per direction, refit walk-forward on
//            the same training events the scaled arm sees, minus ownership
//   scaled — the ownership line
//
// `flat` vs `scaled` is the ablation that matters: same data, same walk
// forward, differing only in whether ownership is consulted. If scaled cannot
// beat a properly-levelled flat threshold, the shape earns nothing and only
// the level correction ever did — a reason to simplify what shipped, not to
// defend it.
//
// Two scorings, because a threshold does two jobs:
//
//   1. RANKING — who should I look at tonight? Each arm becomes a score
//      (|net| / threshold); compare recall at fixed budgets K with a paired
//      per-night sign test, Bonferroni-corrected across the budgets exactly
//      as price-falls-walkforward.ts does.
//   2. CLASSIFICATION — the yes/no the UI renders. Precision/recall/F1 at the
//      decision boundary (progress >= 1), which is where the arms differ.
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

/**
 * The pre-Sprint-38 flat defaults, kept as a third arm.
 *
 * The first run of this gate compared scaled against these and came back
 * MIXED — but that comparison could not separate two different claims: that
 * ownership *scaling* helps, and that the old *levels* were simply wrong.
 * They were wrong (rises fired at ~378k against a 200k default), so scaled
 * was being handed a badly-levelled opponent.
 *
 * So there are now three arms, and the middle one is the honest baseline:
 *
 *   legacy — these constants, the behaviour before Sprint 38
 *   flat   — the best single constant per direction, refit walk-forward on
 *            the same training events the scaled arm sees, minus ownership
 *   scaled — the ownership line
 *
 * `flat` vs `scaled` is the ablation that matters: same data, same walk
 * forward, differing only in whether ownership is used. If scaled cannot beat
 * a properly-levelled flat threshold, then the shape earns nothing and only
 * the level correction ever did — which would be a reason to simplify what
 * shipped, not to defend it.
 */
const LEGACY_RISE = 200_000;
const LEGACY_FALL = 150_000;

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

function fitLine(points: { x: number; y: number }[]): Line | null {
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

  type Arm = "legacy" | "flat" | "scaled";
  const ARMS: Arm[] = ["legacy", "flat", "scaled"];
  const blank = (): Record<string, Tally> => ({
    rise: { tp: 0, fp: 0, fn: 0 },
    fall: { tp: 0, fp: 0, fn: 0 },
  });
  const tallies: Record<Arm, Record<string, Tally>> = {
    legacy: blank(),
    flat: blank(),
    scaled: blank(),
  };
  const rank = new Map<number, Record<Arm, number> & { pos: number; wins: number; losses: number }>();
  for (const k of BUDGETS) rank.set(k, { legacy: 0, flat: 0, scaled: 0, pos: 0, wins: 0, losses: 0 });

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
    const riseLine = fitLine(riseTrain);
    const fallLine = fitLine(fallTrain);
    if (!riseLine && !fallLine) continue;

    // Floor at the 10th percentile of training magnitudes, so a negative
    // intercept cannot make every player fire.
    const pct10 = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length * 0.1)] ?? 1;
    };
    const riseFloor = pct10(riseTrain.map((p) => p.y));
    const fallFloor = pct10(fallTrain.map((p) => p.y));

    // The best single constant available from the same training events — the
    // mean magnitude at which this direction actually fired. Refit each night
    // exactly as the line is, so the only difference between this arm and the
    // scaled one is whether ownership is consulted.
    const meanOf = (xs: { y: number }[]) =>
      xs.length === 0 ? null : xs.reduce((a, p) => a + p.y, 0) / xs.length;
    const riseFlatFit = meanOf(riseTrain);
    const fallFlatFit = meanOf(fallTrain);

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

      const thresholdOf = (arm: Arm): number => {
        if (arm === "legacy") return dir === "rise" ? LEGACY_RISE : LEGACY_FALL;
        if (arm === "flat") {
          return (dir === "rise" ? riseFlatFit : fallFlatFit) ?? (dir === "rise" ? LEGACY_RISE : LEGACY_FALL);
        }
        return thresholdFrom(line, c.ownership, dir === "rise" ? riseFloor : fallFloor);
      };

      const actual = c.moved === dir;
      for (const arm of ARMS) {
        const t = tallies[arm][dir];
        const says = abs >= thresholdOf(arm);
        if (says && actual) t.tp++;
        else if (says && !actual) t.fp++;
        else if (!says && actual) t.fn++;
      }
    }

    // Ranking: order by progress ratio under each threshold.
    const positives = test.filter((c) => c.moved !== null).length;
    for (const k of BUDGETS) {
      const r = rank.get(k)!;
      const score = (c: Candidate, arm: Arm) => {
        const dir = c.net > 0 ? "rise" : "fall";
        const line = dir === "rise" ? riseLine : fallLine;
        let t: number;
        if (arm === "legacy") t = dir === "rise" ? LEGACY_RISE : LEGACY_FALL;
        else if (arm === "flat")
          t = (dir === "rise" ? riseFlatFit : fallFlatFit) ?? (dir === "rise" ? LEGACY_RISE : LEGACY_FALL);
        else
          t = line
            ? thresholdFrom(line, c.ownership, dir === "rise" ? riseFloor : fallFloor)
            : dir === "rise"
              ? LEGACY_RISE
              : LEGACY_FALL;
        return Math.abs(c.net) / t;
      };
      const take = (arm: Arm) =>
        [...test].sort((a, b) => score(b, arm) - score(a, arm)).slice(0, k)
          .filter((c) => c.moved !== null).length;

      const caught: Record<Arm, number> = { legacy: take("legacy"), flat: take("flat"), scaled: take("scaled") };
      for (const arm of ARMS) r[arm] += caught[arm];
      r.pos += positives;
      // The sign test is scaled vs the FAIR baseline, not the legacy one.
      if (caught.scaled > caught.flat) r.wins++;
      else if (caught.scaled < caught.flat) r.losses++;
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
  console.log("scaled is tested against FLAT — the properly-levelled baseline, not legacy.");
  console.log(`  K   legacy     flat   scaled   scaled-v-flat   sign-test p   (Bonferroni alpha ${alpha.toFixed(4)})`);
  const rankWins: boolean[] = [];
  for (const k of BUDGETS) {
    const r = rank.get(k)!;
    const p = signTestP(r.wins, r.losses);
    const better = r.scaled > r.flat && p < alpha;
    rankWins.push(better);
    const mark = better
      ? "  SCALED WINS"
      : r.scaled > r.flat && p < 0.05
        ? "  (uncorrected only)"
        : "";
    console.log(
      `${String(k).padStart(3)}  ${((r.legacy / r.pos) * 100).toFixed(1).padStart(6)}%  ` +
        `${((r.flat / r.pos) * 100).toFixed(1).padStart(6)}%  ` +
        `${((r.scaled / r.pos) * 100).toFixed(1).padStart(6)}%   ${String(r.wins + "/" + r.losses).padStart(13)}   ` +
        `${p.toFixed(4)}${mark}`,
    );
  }

  console.log("\n=== 2. CLASSIFICATION at the decision boundary (progress >= 1) ===");
  console.log("dir   threshold   precision   recall      F1     tp/fp/fn");
  for (const dir of ["rise", "fall"] as const) {
    for (const arm of ARMS) {
      const t = tallies[arm][dir];
      console.log(
        `${dir.padEnd(5)} ${arm.padEnd(9)} ${(prec(t) * 100).toFixed(1).padStart(9)}%  ` +
          `${(rec(t) * 100).toFixed(1).padStart(7)}%  ${(f1(t) * 100).toFixed(1).padStart(6)}%   ` +
          `${t.tp}/${t.fp}/${t.fn}`,
      );
    }
  }

  console.log("\n=== VERDICT ===");
  const riseBetter = f1(tallies.scaled.rise) > f1(tallies.flat.rise);
  const fallBetter = f1(tallies.scaled.fall) > f1(tallies.flat.fall);
  const rankBetter = rankWins.some(Boolean);

  console.log("  (everything below is scaled vs FLAT — the properly-levelled baseline)");
  console.log(`  ranking improves significantly at some budget (Bonferroni): ${rankBetter ? "yes" : "no"}`);
  console.log(`  rise F1 improves: ${riseBetter ? "yes" : "no"}   fall F1 improves: ${fallBetter ? "yes" : "no"}`);
  // The point of the three arms: split the total gain into the part that came
  // from fixing the LEVEL and the part that came from adding the SHAPE. A
  // single scaled-vs-legacy number cannot tell those apart, and they imply
  // different things to ship.
  console.log("\n  where the gain came from (F1):");
  for (const dir of ["rise", "fall"] as const) {
    const l = f1(tallies.legacy[dir]) * 100;
    const fl = f1(tallies.flat[dir]) * 100;
    const sc = f1(tallies.scaled[dir]) * 100;
    console.log(
      `    ${dir.padEnd(5)} legacy ${l.toFixed(1)}%  ->  level +${(fl - l).toFixed(1)}  ->  ` +
        `shape +${(sc - fl).toFixed(1)}  =  ${sc.toFixed(1)}%   ` +
        (sc - fl > fl - l ? "(SHAPE does the work — scale this direction)" : "(LEVEL does the work — flat is enough)"),
    );
  }
  console.log("");
  if (rankBetter && riseBetter && fallBetter) {
    console.log("PASS — scaled beats a properly-levelled flat threshold on both ordering and");
    console.log("verdict, in both directions. The SHAPE earns its keep, not just the level.");
  } else if (!riseBetter && !fallBetter && !rankBetter) {
    console.log("FAIL — scaled beats a properly-levelled flat threshold on nothing. Whatever the");
    console.log("shipped scaling gained, it gained by fixing the LEVEL. Simplify to a flat");
    console.log("threshold at the fitted level and drop the ownership term.");
  } else {
    console.log("MIXED — scaled wins on some measures and not others. A threshold that orders");
    console.log("better but decides worse (or vice versa) is not ready to be a default. Report");
    console.log("exactly which, and do NOT ship on the half that looks good.");
  }

  // Worth saying whatever the verdict is. Both thresholds are wrong far more
  // often than they are right, so whichever one ships, the UI must not word a
  // crossing as a prediction about tonight.
  const lo = Math.min(prec(tallies.scaled.rise), prec(tallies.scaled.fall));
  const hi = Math.max(prec(tallies.scaled.rise), prec(tallies.scaled.fall));
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
