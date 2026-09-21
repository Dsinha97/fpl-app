// Which window does FPL's price algorithm actually count over?
//
// `lib/price-watch.ts` assumes "net transfers since this player's last price
// change" — community lore, never tested here. B.Fernandes made it worth
// testing: he has never changed price this season, so that window is the
// whole season and five deadline resets, and it reads -1,103,718 (-736%
// against a flat threshold) while his price has not moved at all.
//
// Two candidate windows, one competing hypothesis each:
//
//   A. SINCE LAST CHANGE  — FPL keeps a counter per player that only resets
//      when the price moves. A never-moved player accumulates all season.
//   B. SINCE LAST DEADLINE — FPL's counter resets every gameweek along with
//      `transfers_in_event`, so only the current gameweek's flow matters.
//
// The test: for every observed price change, compute the net under each
// window. If a window is the one FPL uses, the magnitude at the moment of
// firing should be a tight function of ownership — that is what a threshold
// IS. So compare how well each window's |net| is explained by ownership
// (R^2), and how tight the spread of |net|/threshold is around 1.
//
// A window that explains the firings better is the window FPL counts over.
// This is measurement, not fitting a shippable coefficient: the output is
// "which of two hypotheses matches reality", and it decides what quantity
// lib/price-watch.ts should compute before any threshold is tuned at all.
//
// Usage: npx tsx scripts/price-window-probe.ts

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SEASON = "2026-27";

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

/** Reset-aware sum; a drop in the in-counter is a deadline reset. */
function sumResetAware(rows: OwnRow[]): number {
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    const reset = (rows[i].transfers_in_event ?? 0) < (rows[i - 1].transfers_in_event ?? 0);
    total += reset ? netOf(rows[i]) : netOf(rows[i]) - netOf(rows[i - 1]);
  }
  return total;
}

/** R^2 of |net| ~ ownership, and the spread of the ratio around the fitted line. */
function explain(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 10) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const sxy = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  const ssTot = points.reduce((a, p) => a + (p.y - my) ** 2, 0);
  const ssRes = points.reduce((a, p) => a + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;

  // Coefficient of variation of |net| — how tight the firing magnitudes are
  // in absolute terms, independent of any fit.
  const sd = Math.sqrt(points.reduce((a, p) => a + (p.y - my) ** 2, 0) / (n - 1));
  return { n, slope, intercept, r2, mean: my, cv: sd / Math.abs(my) };
}

async function main() {
  const [own, prices, gws] = await Promise.all([
    pageAll<OwnRow>(
      "player_ownership_history",
      "player_code, observed_at, selected_by_percent, transfers_in_event, transfers_out_event",
    ),
    pageAll<PriceRow>("player_price_history", "player_code, price, observed_at"),
    supabase
      .from("gameweeks")
      .select("id, deadline_time")
      .eq("season", SEASON)
      .order("deadline_time")
      .then((r) => (r.data ?? []) as { id: number; deadline_time: string }[]),
  ]);

  const deadlines = gws.map((g) => g.deadline_time).filter(Boolean).sort();

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

  const lastDeadlineBefore = (iso: string): string | null => {
    let best: string | null = null;
    for (const d of deadlines) if (d < iso) best = d;
    return best;
  };

  const sinceChange: Record<string, { x: number; y: number }[]> = { rise: [], fall: [] };
  const sinceDeadline: Record<string, { x: number; y: number }[]> = { rise: [], fall: [] };

  for (const [code, changes] of priceByPlayer) {
    const obs = ownByPlayer.get(code) ?? [];
    for (let i = 1; i < changes.length; i++) {
      const prev = changes[i - 1];
      const cur = changes[i];
      if (cur.price === prev.price) continue;
      const dir = cur.price > prev.price ? "rise" : "fall";

      const winChange = obs.filter((o) => o.observed_at >= prev.observed_at && o.observed_at < cur.observed_at);
      const dl = lastDeadlineBefore(cur.observed_at);
      const winDeadline = dl
        ? obs.filter((o) => o.observed_at >= dl && o.observed_at < cur.observed_at)
        : winChange;

      if (winChange.length < 2 || winDeadline.length < 2) continue;
      const ownership = Number(winChange[winChange.length - 1].selected_by_percent ?? 0);

      sinceChange[dir].push({ x: ownership, y: Math.abs(sumResetAware(winChange)) });
      sinceDeadline[dir].push({ x: ownership, y: Math.abs(sumResetAware(winDeadline)) });
    }
  }

  console.log("Which window does FPL count over?\n");
  console.log("Magnitude at the moment a price actually fired, under each hypothesis.");
  console.log("A window FPL really uses should make firings a TIGHT function of ownership.\n");

  console.log("dir    window            n     mean |net|   slope/pct      R^2      CV");
  for (const dir of ["fall", "rise"] as const) {
    for (const [label, data] of [
      ["since last change", sinceChange[dir]],
      ["since last deadline", sinceDeadline[dir]],
    ] as const) {
      const e = explain(data);
      if (!e) {
        console.log(`${dir.padEnd(6)} ${label.padEnd(19)} (too few)`);
        continue;
      }
      console.log(
        `${dir.padEnd(6)} ${label.padEnd(19)} ${String(e.n).padStart(4)}  ` +
          `${Math.round(e.mean).toLocaleString().padStart(11)}  ` +
          `${Math.round(e.slope).toLocaleString().padStart(10)}  ` +
          `${e.r2.toFixed(3).padStart(7)}  ${e.cv.toFixed(2).padStart(6)}`,
      );
    }
  }

  console.log("\nR^2 = how much of the firing magnitude ownership explains (higher is better).");
  console.log("CV  = spread of the magnitudes relative to their mean (LOWER is better —");
  console.log("      a real threshold fires at a consistent number, not a scattered one).");

  // The case that prompted this.
  const bf = ownByPlayer.get(141746) ?? [];
  const bfChanges = priceByPlayer.get(141746) ?? [];
  const anchor = bfChanges[bfChanges.length - 1];
  const dl = deadlines.filter((d) => d < new Date().toISOString()).pop()!;
  const sinceAnchorNet = sumResetAware(bf.filter((o) => o.observed_at >= anchor.observed_at));
  const sinceDeadlineNet = sumResetAware(bf.filter((o) => o.observed_at >= dl));
  console.log(`\nB.Fernandes (38.9% owned, never repriced — anchor is the season-start snapshot):`);
  console.log(`  since that snapshot (${anchor.observed_at.slice(0, 10)}): ${sinceAnchorNet.toLocaleString()}`);
  console.log(`  since the last deadline (${dl.slice(0, 10)}):    ${sinceDeadlineNet.toLocaleString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
