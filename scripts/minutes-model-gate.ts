// DSI-185 — does a small, calibrated start/minutes estimator beat what ships?
//
// Scores four estimators of "will this player start / how many minutes" on every
// scored 2026-27 and 2023-24..2025-26 row with >=3 prior gameweeks that season,
// restricted to the walk-forward harness's cohort (>=1200 weighted prior minutes,
// so it conditions on established players and says nothing about cold-start):
//   prior-only      deriveRates' startShare/minutesPerGame (no current-season data)
//   last-5          the player's own last five gameweeks (the standing baseline)
//   shrunk blend    last-5 shrunk toward the prior with weight k (k picked on the other seasons)
//   logistic        6 features, ridge-regularised, one fit per held-out season on the OTHER
//                   three (leave-one-season-out, like the bias-correction sweep)
// plus, for 2026-27 only, the shipped player_prediction_archive as the incumbent.
//
// Primary metrics are proper scoring rules (Brier, RMSE) and a calibration table.
// bias-by-cohort (appeared / no-show) is printed because the issue's gate names it,
// but it is mechanically unfavourable to any calibrated mean predictor: minutes are
// bimodal, so E[actual - pred | appeared] > 0 and E[actual - pred | no-show] < 0 even
// for a perfect expectation. Read it as that, not as a calibration failure.
//
// Not modelled: injury/availability flags (not stored historically). The archive
// incumbent has them; the estimators here do not.
//
// Usage: set -a; . ./.env.local; set +a; npx tsx scripts/minutes-model-gate.ts
import { deriveRates, type SeasonRow } from "../supabase/functions/_shared/xp-model.ts";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

async function fetchAll<T>(table: string, select: string, extra: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${table}?select=${encodeURIComponent(select)}${extra}&order=${encodeURIComponent(order)}&limit=1000&offset=${from}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${table} ${r.status} ${await r.text()}`);
    const rows = (await r.json()) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

type Row = {
  season: string; code: number; fixture: number; pos: number; start: number; app: number; min: number;
  p0: number; m0: number; n: number; l5s: number; l5a: number; l5m: number; l1s: number; l3s: number; l3m: number; gk: number;
};

const POS: Record<string, number> = { GK: 1, GKP: 1, DEF: 2, MID: 3, FWD: 4 };

async function main() {
  const hist = await fetchAll<SeasonRow & { player_code: number }>("player_season_history",
    "player_code,season_name,minutes,starts,expected_goals,expected_assists,expected_goals_conceded,clean_sheets,bonus,saves,defensive_contribution,yellow_cards", "", "player_code,season_name");
  const plist = await fetchAll<{ code: number; element_type: number }>("players", "code,element_type", "", "id");
  const todayPos = new Map(plist.map((p) => [p.code, p.element_type]));
  const byCode = new Map<number, (SeasonRow & { player_code: number })[]>();
  for (const h of hist) { const l = byCode.get(h.player_code); if (l) l.push(h); else byCode.set(h.player_code, [h]); }

  const seasons = [["2023-24", "2023/24"], ["2024-25", "2024/25"], ["2025-26", "2025/26"], ["2026-27", "2026/27"]];
  const all: Row[] = [];
  for (const [s, slash] of seasons) {
    const truth = await fetchAll<{ player_code: number; event: number; fixture: number; minutes: number | null; starts: number | null; position: string | null }>(
      "player_gameweek_stats", "player_code,event,fixture,minutes,starts,position:raw->>position", `&season=eq.${s}`, "player_code,fixture");
    const per = new Map<number, typeof truth>();
    for (const t of truth) { if (t.event == null) continue; const l = per.get(t.player_code); if (l) l.push(t); else per.set(t.player_code, [t]); }
    let cohort = 0;
    for (const [code, rows] of per) {
      const prior = (byCode.get(code) ?? []).filter((r) => r.season_name < slash);
      if (!prior.length) continue;
      const rates = deriveRates(prior, new Set());
      if (!rates || rates.weightedMinutes < 1200) continue;
      cohort++;
      const sorted = [...rows].sort((a, b) => a.event - b.event || a.fixture - b.fixture);
      const posId = POS[sorted.find((r) => r.position)?.position ?? ""] ?? todayPos.get(code) ?? 0;
      for (let i = 0; i < sorted.length; i++) {
        const past = sorted.slice(Math.max(0, i - 5), i);
        if (past.length < 3) continue;
        const st = (r: typeof truth[number]) => (r.starts ?? 0) > 0 ? 1 : 0;
        const l3 = past.slice(-3);
        all.push({
          season: s, code, fixture: sorted[i].fixture, pos: posId, start: st(sorted[i]), app: (sorted[i].minutes ?? 0) > 0 ? 1 : 0, min: sorted[i].minutes ?? 0,
          p0: rates.startShare, m0: rates.minutesPerGame, n: past.length,
          l5s: mean(past.map(st)), l5a: mean(past.map((r) => ((r.minutes ?? 0) > 0 ? 1 : 0))), l5m: mean(past.map((r) => r.minutes ?? 0)),
          l1s: st(past[past.length - 1]), l3s: mean(l3.map(st)), l3m: mean(l3.map((r) => r.minutes ?? 0)), gk: posId === 1 ? 1 : 0,
        });
      }
    }
    console.error(`${s}: cohort ${cohort}`);
  }

  // ---- fitting helpers ----
  const feats = (r: Row) => [1, r.p0, r.l5s, r.l1s, r.l3s, r.gk];
  const solve = (A: number[][], b: number[]) => {
    const n = b.length; const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((row, i) => row[n] / row[i]);
  };
  const fitLogit = (rows: Row[], y: (r: Row) => number) => {
    const d = feats(rows[0]).length; let w = new Array(d).fill(0);
    for (let it = 0; it < 25; it++) {
      const H = Array.from({ length: d }, () => new Array(d).fill(0)); const g = new Array(d).fill(0);
      for (const r of rows) { const x = feats(r); const p = 1 / (1 + Math.exp(-x.reduce((s, v, i) => s + v * w[i], 0)));
        for (let i = 0; i < d; i++) { g[i] += (y(r) - p) * x[i]; for (let j = 0; j < d; j++) H[i][j] += p * (1 - p) * x[i] * x[j]; } }
      for (let i = 1; i < d; i++) { H[i][i] += 1; g[i] -= w[i]; }
      const step = solve(H, g); w = w.map((v, i) => v + step[i]);
    }
    return w;
  };
  const fitOls = (rows: Row[], y: (r: Row) => number) => {
    const d = feats(rows[0]).length;
    const A = Array.from({ length: d }, () => new Array(d).fill(0)); const b = new Array(d).fill(0);
    for (const r of rows) { const x = feats(r); for (let i = 0; i < d; i++) { b[i] += x[i] * y(r); for (let j = 0; j < d; j++) A[i][j] += x[i] * x[j]; } }
    for (let i = 1; i < d; i++) A[i][i] += 1;
    return solve(A, b);
  };
  const dot = (w: number[], r: Row) => feats(r).reduce((s, v, i) => s + v * w[i], 0);
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const KS = [1, 2, 3, 5, 8];
  const blendS = (r: Row, k: number) => (Math.min(r.n, 5) * r.l5s + k * r.p0) / (Math.min(r.n, 5) + k);
  const blendM = (r: Row, k: number) => (Math.min(r.n, 5) * r.l5m + k * r.m0) / (Math.min(r.n, 5) + k);
  const brier = (rows: Row[], f: (r: Row) => number, y: (r: Row) => number) => mean(rows.map((r) => (f(r) - y(r)) ** 2));


  type Pred = { s: (r: Row) => number; a: (r: Row) => number; m: (r: Row) => number };
  const arch = await fetchAll<{ player_code: number; fixture: number; start_probability: number; expected_minutes: number }>(
    "player_prediction_archive", "player_code,fixture,start_probability,expected_minutes", "&season=eq.2026-27", "player_code,fixture,event");
  const prod = new Map<string, { sp: number; em: number }>();
  for (const a of arch) prod.set(`${a.player_code}:${a.fixture}`, { sp: Number(a.start_probability), em: Number(a.expected_minutes) });

  const out: string[] = [];
  const poolRows: Record<string, { r: Row; s: number; a: number; m: number }[]> = {};
  const add = (name: string, r: Row, p: Pred) => (poolRows[name] ??= []).push({ r, s: p.s(r), a: p.a(r), m: p.m(r) });
  const report = (title: string, name: string, rs: { r: Row; s: number; a: number; m: number }[]) => {
    const ap = rs.filter((x) => x.r.app === 1), ns = rs.filter((x) => x.r.app === 0), gk = rs.filter((x) => x.r.gk === 1);
    const m = (xs: typeof rs, f: (x: typeof rs[number]) => number) => (xs.length ? mean(xs.map(f)) : NaN);
    out.push(`${title}${name.padEnd(34)} n=${rs.length} startBrier=${m(rs, (x) => (x.s - x.r.start) ** 2).toFixed(4)} appBrier=${m(rs, (x) => (x.a - x.r.app) ** 2).toFixed(4)} ` +
      `minRMSE=${Math.sqrt(m(rs, (x) => (x.m - x.r.min) ** 2)).toFixed(2)} minMAE=${m(rs, (x) => Math.abs(x.m - x.r.min)).toFixed(2)} ` +
      `bias[app]=${m(ap, (x) => x.r.min - x.m).toFixed(1)} bias[no-show]=${m(ns, (x) => x.r.min - x.m).toFixed(1)} GK:startBrier=${m(gk, (x) => (x.s - x.r.start) ** 2).toFixed(4)} minRMSE=${gk.length ? Math.sqrt(m(gk, (x) => (x.m - x.r.min) ** 2)).toFixed(1) : "n/a"}`);
  };
  const calib: { p: number; y: number }[] = [];
  // Amended gate (DSI-185) — collected per held-out season, judged at the end.
  const gate: { season: string; n: number; logB: number; l5B: number; gkLogB: number; gkL5B: number; logRmse: number; l5Rmse: number; citl: number; citlSe: number }[] = [];
  let shippedCmp: { logB: number; prodB: number; n: number } | null = null;

  for (const [sn] of seasons) {
    const test = all.filter((r) => r.season === sn); const train = all.filter((r) => r.season !== sn);
    const kS = KS.map((k) => ({ k, l: brier(train, (r) => blendS(r, k), (r) => r.start) })).sort((a, b) => a.l - b.l)[0].k;
    const kM = KS.map((k) => ({ k, l: mean(train.map((r) => (blendM(r, k) - r.min) ** 2)) })).sort((a, b) => a.l - b.l)[0].k;
    const wS = fitLogit(train, (r) => r.start), wA = fitLogit(train, (r) => r.app), wM = fitOls(train, (r) => r.min);
    // two-part minutes: P(start)*E[min|start] + (1-P(start))*E[min|not start], constants fitted on train per position
    const cond = (pos: number) => {
      const t = train.filter((r) => (pos === 1 ? r.gk === 1 : r.gk === 0));
      const st = t.filter((r) => r.start === 1), bn = t.filter((r) => r.start === 0);
      return { ms: mean(st.map((r) => r.min)), mb: mean(bn.map((r) => r.min)) };
    };
    const cGK = cond(1), cOut = cond(0);
    const lrS = (r: Row) => sig(dot(wS, r));
    const twoPart = (r: Row) => { const c = r.gk ? cGK : cOut; const p = lrS(r); return p * c.ms + (1 - p) * c.mb; };
    const preds: Record<string, Pred> = {
      "prior-only (harness model)": { s: (r) => r.p0, a: (r) => clamp(r.m0 / 60, 0, 1), m: (r) => r.m0 },
      "last-5 baseline": { s: (r) => r.l5s, a: (r) => r.l5a, m: (r) => r.l5m },
      "shrunk blend (k LOSO)": { s: (r) => blendS(r, kS), a: (r) => clamp(blendM(r, kM) / 60, 0, 1), m: (r) => blendM(r, kM) },
      "logistic start + OLS minutes": { s: lrS, a: (r) => sig(dot(wA, r)), m: (r) => clamp(dot(wM, r), 0, 90) },
      "logistic start + two-part minutes": { s: lrS, a: (r) => sig(dot(wA, r)), m: twoPart },
    };
    for (const [name, p] of Object.entries(preds)) {
      for (const r of test) add(name, r, p);
      report(`[${sn}] `, name, test.map((r) => ({ r, s: p.s(r), a: p.a(r), m: p.m(r) })));
    }
    for (const r of test) calib.push({ p: lrS(r), y: r.start });
    {
      const gkRows = test.filter((r) => r.gk === 1);
      const pm = test.map((r) => lrS(r)); const ym = test.map((r) => r.start);
      const ybar = mean(ym); const se = Math.sqrt((ybar * (1 - ybar)) / test.length);
      gate.push({
        season: sn, n: test.length,
        logB: brier(test, lrS, (r) => r.start), l5B: brier(test, (r) => r.l5s, (r) => r.start),
        gkLogB: gkRows.length ? brier(gkRows, lrS, (r) => r.start) : NaN, gkL5B: gkRows.length ? brier(gkRows, (r) => r.l5s, (r) => r.start) : NaN,
        logRmse: Math.sqrt(mean(test.map((r) => (twoPart(r) - r.min) ** 2))), l5Rmse: Math.sqrt(mean(test.map((r) => (r.l5m - r.min) ** 2))),
        citl: mean(pm) - ybar, citlSe: se,
      });
    }
    if (sn === "2026-27") {
      const matched = test.filter((r) => prod.has(`${r.code}:${r.fixture}`));
      out.push(`\n--- 2026-27 matched to the shipped archive (production incl. injury flags + current-season blend): n=${matched.length}`);
      const pp: Record<string, Pred> = {
        "PRODUCTION (shipped archive)": { s: (r) => prod.get(`${r.code}:${r.fixture}`)!.sp, a: (r) => clamp(prod.get(`${r.code}:${r.fixture}`)!.em / 60, 0, 1), m: (r) => prod.get(`${r.code}:${r.fixture}`)!.em },
        ...preds,
      };
      shippedCmp = { n: matched.length, logB: brier(matched, lrS, (r) => r.start), prodB: brier(matched, (r) => prod.get(`${r.code}:${r.fixture}`)!.sp, (r) => r.start) };
      for (const [name, p] of Object.entries(pp)) report("[matched] ", name, matched.map((r) => ({ r, s: p.s(r), a: p.a(r), m: p.m(r) })));
    }
    out.push("");
  }
  console.log(out.join("\n"));
  console.log("=== POOLED 4 seasons (each season's models fitted on the other three)");
  out.length = 0;
  for (const [name, rs] of Object.entries(poolRows)) report("", name, rs);
  console.log(out.join("\n"));
  console.log("\n=== calibration of logistic P(start), pooled held-out");
  const sorted = [...calib].sort((a, b) => a.p - b.p); const nb = 10;
  for (let b = 0; b < nb; b++) { const sl = sorted.slice(Math.floor(b * sorted.length / nb), Math.floor((b + 1) * sorted.length / nb)); console.log(`decile ${b + 1}: predicted ${mean(sl.map((x) => x.p)).toFixed(3)}  actual ${mean(sl.map((x) => x.y)).toFixed(3)}  n=${sl.length}`); }

  // ---- amended gate verdict ----
  const ok = (b: boolean) => (b ? "PASS" : "FAIL");
  const g1 = gate.every((g) => g.logB < g.l5B);
  const g2 = gate.every((g) => Number.isNaN(g.gkLogB) || g.gkLogB < g.gkL5B);
  const g3 = gate.every((g) => g.logRmse < g.l5Rmse);
  const g4 = gate.every((g) => Math.abs(g.citl) <= 2 * g.citlSe);
  const sc = shippedCmp as { logB: number; prodB: number; n: number } | null;
  const g5 = sc !== null && sc.logB < sc.prodB;
  console.log("\n=== AMENDED GATE (DSI-185): proper scoring rules, per season, nothing narrowed ===");
  for (const g of gate) console.log(`${g.season}: startBrier ${g.logB.toFixed(4)} vs last-5 ${g.l5B.toFixed(4)} | GKP ${Number.isNaN(g.gkLogB) ? "n/a" : g.gkLogB.toFixed(4)} vs ${Number.isNaN(g.gkL5B) ? "n/a" : g.gkL5B.toFixed(4)} | minutes RMSE (two-part) ${g.logRmse.toFixed(2)} vs ${g.l5Rmse.toFixed(2)} | calibration-in-the-large ${g.citl >= 0 ? "+" : ""}${g.citl.toFixed(4)} (2 SE = ${(2 * g.citlSe).toFixed(4)})`);
  console.log(`G1 start Brier beats last-5 in every season ........ ${ok(g1)}`);
  console.log(`G2 GKP start Brier beats last-5 in every season .... ${ok(g2)}`);
  console.log(`G3 minutes RMSE beats last-5 in every season ....... ${ok(g3)}`);
  console.log(`G4 calibration-in-the-large within 2 SE, every season ${ok(g4)}`);
  console.log(`G5 beats the shipped archive on 2026-27 start Brier  ${ok(g5)}${sc ? ` (${sc.logB.toFixed(4)} vs ${sc.prodB.toFixed(4)}, n=${sc.n})` : ""}`);
  console.log(`VERDICT: ${g1 && g2 && g3 && g4 && g5 ? "ALL PASS - ships" : "NOT ALL PASS - does not ship"}`);

  // ---- the fit that ships: all four seasons pooled, the exact constants to paste ----
  const wAll = fitLogit(all, (r) => r.start);
  const condAll = (gk: boolean) => {
    const t = all.filter((r) => (r.gk === 1) === gk);
    return { whenStarts: mean(t.filter((r) => r.start === 1).map((r) => r.min)), whenNot: mean(t.filter((r) => r.start === 0).map((r) => r.min)) };
  };
  console.log("\n=== SHIPPING FIT (pooled, n=" + all.length + ") ===");
  console.log(JSON.stringify({ features: ["intercept", "priorStartShare", "last5StartRate", "lastStart", "last3StartRate", "goalkeeper"], coef: wAll.map((x) => Number(x.toFixed(4))), minutesGivenStart: { outfield: Number(condAll(false).whenStarts.toFixed(2)), goalkeeper: Number(condAll(true).whenStarts.toFixed(2)) }, minutesGivenNotStart: { outfield: Number(condAll(false).whenNot.toFixed(2)), goalkeeper: Number(condAll(true).whenNot.toFixed(2)) } }));
}
main();
