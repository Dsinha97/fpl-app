// Fit a Championship -> Premier League translation factor (lambda) per
// metric, off the 12-player cohort that holds both a 2024/25 PL season
// (450+ minutes) in `player_season_history` and a 2025/26 Championship
// FootyStats PDF. See docs/sprints/championship-priors.md.
//
// Pooled-rate estimator: lambda = (sum of PL total output across the cohort)
// / (sum of Championship total output across the cohort), i.e. minutes-
// weighted, not a mean of per-player ratios — averaging individual ratios
// blows up whenever a player's Championship denominator is near zero (e.g.
// Palmer/Walton/O'Shea/Woolfenden all read ~0 xG in the PL sample; a ratio
// estimator would divide by near-zero for the Championship side too).
//
// Usage: npx tsx scripts/fit-lambda.ts

interface CohortRow {
  name: string;
  code: number;
  championshipMinutes: number;
  championshipXg90: number;
  championshipXa90: number;
  championshipCards90: number;
  plMinutes: number;
  plXg90: number;
  plXa90: number;
  plCards90: number;
}

// Championship side: from the extracted CSV (footystats_championship_2025_26.csv).
// PL side: player_season_history, season_name = '2024/25', queried live via
// execute_sql against project fyxyqxpscmqjyjxsyhms on 2026-08-11.
const COHORT: CohortRow[] = [
  { name: "O'Shea", code: 216616, championshipMinutes: 4140, championshipXg90: 0.09, championshipXa90: 0.16, championshipCards90: 0, plMinutes: 3122, plXg90: 0.0372, plXa90: 0.0193, plCards90: 0.173 },
  { name: "Davis", code: 455084, championshipMinutes: 3167, championshipXg90: 0.08, championshipXa90: 0.2, championshipCards90: 0.14, plMinutes: 2742, plXg90: 0.0322, plXa90: 0.1556, plCards90: 0.1641 },
  { name: "Johnson", code: 222018, championshipMinutes: 843, championshipXg90: 0.11, championshipXa90: 0.19, championshipCards90: 0.11, plMinutes: 1346, plXg90: 0.0709, plXa90: 0.0555, plCards90: 0.2006 },
  { name: "Woolfenden", code: 220583, championshipMinutes: 1072, championshipXg90: 0.03, championshipXa90: 0.13, championshipCards90: 0.17, plMinutes: 1187, plXg90: 0.0023, plXa90: 0.0015, plCards90: 0.1516 },
  { name: "Palmer", code: 112520, championshipMinutes: 834, championshipXg90: 0, championshipXa90: 0.05, championshipCards90: 0, plMinutes: 1170, plXg90: 0, plXa90: 0, plCards90: 0.1538 },
  { name: "Clarke", code: 443261, championshipMinutes: 2380, championshipXg90: 0.52, championshipXa90: 0.15, championshipCards90: 0.15, plMinutes: 1161, plXg90: 0.0907, plXa90: 0.086, plCards90: 0.155 },
  { name: "Burns", code: 149929, championshipMinutes: 797, championshipXg90: 0.22, championshipXa90: 0.16, championshipCards90: 0.34, plMinutes: 922, plXg90: 0.0488, plXa90: 0.1142, plCards90: 0.0976 },
  { name: "McAteer", code: 461587, championshipMinutes: 1271, championshipXg90: 0.29, championshipXa90: 0.13, championshipCards90: 0.21, plMinutes: 846, plXg90: 0.1053, plXa90: 0.067, plCards90: 0.3191 },
  { name: "Taylor", code: 231899, championshipMinutes: 2154, championshipXg90: 0.15, championshipXa90: 0.19, championshipCards90: 0.38, plMinutes: 837, plXg90: 0.0806, plXa90: 0.0828, plCards90: 0.4301 },
  { name: "Philogene", code: 481624, championshipMinutes: 1996, championshipXg90: 0.59, championshipXa90: 0.14, championshipCards90: 0.14, plMinutes: 796, plXg90: 0.2747, plXa90: 0.0384, plCards90: 0.3392 },
  { name: "Hirst", code: 222625, championshipMinutes: 2110, championshipXg90: 0.51, championshipXa90: 0.13, championshipCards90: 0.26, plMinutes: 645, plXg90: 0.2986, plXa90: 0.0335, plCards90: 0.4186 },
  { name: "Walton", code: 108813, championshipMinutes: 3306, championshipXg90: 0, championshipXa90: 0.04, championshipCards90: 0.11, plMinutes: 630, plXg90: 0, plXa90: 0, plCards90: 0 },
];

function pooledLambda(metric: "Xg90" | "Xa90" | "Cards90") {
  let plTotal = 0;
  let champTotal = 0;
  const ratios: { name: string; ratio: number | null }[] = [];
  for (const r of COHORT) {
    const plRate = r[`pl${metric}`];
    const champRate = r[`championship${metric}`];
    const plMin = r.plMinutes;
    const champMin = r.championshipMinutes;
    plTotal += (plRate * plMin) / 90;
    champTotal += (champRate * champMin) / 90;
    ratios.push({ name: r.name, ratio: champRate > 0 ? plRate / champRate : null });
  }
  const lambda = champTotal > 0 ? plTotal / champTotal : null;
  return { lambda, plTotal, champTotal, ratios };
}

console.log("=".repeat(70));
console.log(`LAMBDA FIT — ${COHORT.length}-player cohort (PL 2024/25, 450+min <-> Championship 2025/26 PDF)`);
console.log("=".repeat(70));

for (const metric of ["Xg90", "Xa90", "Cards90"] as const) {
  const { lambda, plTotal, champTotal, ratios } = pooledLambda(metric);
  console.log(`\n${metric}:`);
  console.log(`  pooled lambda = ${lambda?.toFixed(3)}  (PL total ${plTotal.toFixed(2)} / Champ total ${champTotal.toFixed(2)})`);
  const defined = ratios.filter((r) => r.ratio !== null).map((r) => r.ratio!);
  const sorted = [...defined].sort((a, b) => a - b);
  console.log(`  per-player ratio range (${defined.length} defined): ${sorted[0]?.toFixed(2)} - ${sorted[sorted.length - 1]?.toFixed(2)}`);
  console.log(`  per-player: ${ratios.map((r) => `${r.name}=${r.ratio === null ? "n/a" : r.ratio.toFixed(2)}`).join(", ")}`);
}

console.log("\n" + "=".repeat(70));
console.log("dc90 / CBIT: NOT FITTABLE — player_season_history has no");
console.log("clearances_blocks_interceptions/tackles data for 2024/25 (confirmed");
console.log("all-zero for this cohort; the API didn't expose the split until");
console.log("2025/26). external_measured falls back to position_price for dc90.");
console.log("=".repeat(70));
