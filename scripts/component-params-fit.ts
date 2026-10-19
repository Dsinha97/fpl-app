// Sprint 43 — the three fitted constants behind v1.7.0's component fixes.
//
// Prints, for pasting into MODEL_PARAMS (supabase/functions/_shared/xp-model.ts):
//   cameoMinutes   mean minutes of a substitute appearance (starts = 0, minutes > 0),
//                  2023-24..2025-26. 2022-23 is left out: its archived `starts` is
//                  unreliable (its "cameos" average 55 minutes).
//   dcDispersion   negative-binomial size r for the defensive-contribution count, by
//                  FPL rule: DEF (10 CBIT) and MID+FWD pooled (12 CBIRT — same rule,
//                  and the forward sample alone is thin). Method of moments on
//                  within-player mean/variance over 85+ minute appearances, players
//                  with >= 8 such games, so differences *between* players (which the
//                  rate already carries) do not inflate the dispersion.
//   assistsPerXa   `fitAssistsPerXa` over every completed season with xA published.
//
// Positions: gameweek rows use the season's own archived `raw.position`, falling back
// to today's roster; season-history rows have no position column, so they use today's
// roster (a player who changed position between seasons is mis-bucketed — disclosed).
//
// Read-only, publishable key. Usage:
//   set -a; . ./.env.local; set +a; npx tsx scripts/component-params-fit.ts

import { fitAssistsPerXa, XA_TRACKED_FROM } from "../supabase/functions/_shared/xp-model.ts";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
if (!URL_ || !KEY) throw new Error("load .env.local first");

/** Pages past the 1000-row cap. `order` must be a unique key (see backtest-walkforward.ts). */
async function fetchAll<T>(table: string, select: string, extra: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${URL_}/rest/v1/${table}?select=${encodeURIComponent(select)}${extra}&order=${encodeURIComponent(order)}&limit=1000&offset=${from}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
    );
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const ARCHIVE_POSITION: Record<string, number> = { GK: 1, GKP: 1, DEF: 2, MID: 3, FWD: 4 };
const CAMEO_SEASONS = ["2023-24", "2024-25", "2025-26"];
const COMPLETED_SEASONS_BEFORE = "2026/27";

async function main() {
  const players = await fetchAll<{ code: number; element_type: number }>("players", "code,element_type", "", "id");
  const rosterPosition = new Map(players.map((p) => [p.code, p.element_type]));

  // ---- cameoMinutes ------------------------------------------------------
  const cameos = await fetchAll<{ season: string; minutes: number }>(
    "player_gameweek_stats",
    "season,minutes,player_code,fixture",
    `&starts=eq.0&minutes=gt.0&season=in.(${CAMEO_SEASONS.join(",")})`,
    "season,player_code,fixture",
  );
  const cameoMean = cameos.reduce((s, r) => s + r.minutes, 0) / cameos.length;
  const perSeason = CAMEO_SEASONS.map((season) => {
    const rows = cameos.filter((r) => r.season === season);
    return `${season} ${(rows.reduce((s, r) => s + r.minutes, 0) / rows.length).toFixed(2)} (n=${rows.length})`;
  });
  console.log(`cameoMinutes: ${cameoMean.toFixed(1)}  (n=${cameos.length}; ${perSeason.join(", ")})`);

  // ---- dcDispersion ------------------------------------------------------
  const full = await fetchAll<{ season: string; player_code: number; fixture: number; dc: number; position: string | null }>(
    "player_gameweek_stats",
    "season,player_code,fixture,dc:defensive_contribution,position:raw->>position",
    "&minutes=gte.85&defensive_contribution=not.is.null&season=lt.2026-27",
    "season,player_code,fixture",
  );
  const groupOf = (pos: number | undefined) => (pos === 2 ? "DEF" : pos === 3 || pos === 4 ? "MID+FWD" : null);
  const byPlayer = new Map<string, { group: string; xs: number[] }>();
  for (const r of full) {
    const pos = (r.position ? ARCHIVE_POSITION[r.position] : undefined) ?? rosterPosition.get(r.player_code);
    const group = groupOf(pos);
    if (!group) continue;
    const key = `${r.season}:${r.player_code}`;
    const entry = byPlayer.get(key) ?? { group, xs: [] };
    entry.xs.push(r.dc);
    byPlayer.set(key, entry);
  }
  const seasonsSeen = [...new Set(full.map((r) => r.season))].sort();
  for (const group of ["DEF", "MID+FWD"]) {
    let num = 0;
    let den = 0;
    let players = 0;
    let rows = 0;
    let sumMean = 0;
    for (const { group: g, xs } of byPlayer.values()) {
      if (g !== group || xs.length < 8) continue;
      const n = xs.length;
      const mu = xs.reduce((a, b) => a + b, 0) / n;
      const v = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1);
      num += n * mu * mu;
      den += n * (v - mu);
      players++;
      rows += n;
      sumMean += mu * n;
    }
    const r = den > 0 ? num / den : Infinity;
    console.log(
      `dcDispersion ${group}: r=${Number.isFinite(r) ? r.toFixed(0) : "Infinity (no over-dispersion)"}  ` +
        `(players=${players}, rows=${rows}, mean=${(sumMean / rows).toFixed(2)}, seasons=${seasonsSeen.join(",")})`,
    );
  }

  // ---- assistsPerXa ------------------------------------------------------
  const history = await fetchAll<{ player_code: number; season_name: string; assists: number | null; expected_assists: number | null }>(
    "player_season_history",
    "player_code,season_name,assists,expected_assists",
    `&season_name=lt.${COMPLETED_SEASONS_BEFORE}`,
    "player_code,season_name",
  );
  const fitRows = history.flatMap((h) => {
    const positionId = rosterPosition.get(h.player_code);
    return positionId === undefined ? [] : [{ ...h, positionId }];
  });
  const pooled = fitAssistsPerXa(fitRows);
  console.log(`assistsPerXa (pooled, seasons >= ${XA_TRACKED_FROM}): ${JSON.stringify(Object.fromEntries(Object.entries(pooled).map(([k, v]) => [k, Number(v.toFixed(2))])))}`);
  for (const season of [...new Set(fitRows.map((r) => r.season_name))].filter((s) => s >= XA_TRACKED_FROM).sort()) {
    const one = fitAssistsPerXa(fitRows.filter((r) => r.season_name === season));
    console.log(`  ${season}: DEF ${one.DEF.toFixed(2)} MID ${one.MID.toFixed(2)} FWD ${one.FWD.toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
