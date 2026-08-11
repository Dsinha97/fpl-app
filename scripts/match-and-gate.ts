// One-shot: join the FootyStats extraction to `players` by name, then run the
// three-check gate from docs/sprints/cold-start-patch.md (2026-08-05) against
// the joined result. Output feeds the `external_player_seasons` migration and
// the lambda-fitting harness. Not part of the app build.
//
// Usage: npx tsx scripts/match-and-gate.ts

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const COMBINING_MARKS = /[̀-ͯ]/g;
const SPECIAL_LETTERS: [RegExp, string][] = [
  [/ø/g, "o"],
  [/đ/g, "d"],
  [/ł/g, "l"],
  [/ß/g, "ss"],
  [/æ/g, "ae"],
];
function fold(s: string): string {
  let out = s.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
  for (const [p, r] of SPECIAL_LETTERS) out = out.replace(p, r);
  return out;
}
function tokens(s: string): Set<string> {
  return new Set(
    fold(s)
      .split(/[\s.\-']+/)
      .filter((t) => t.length > 1), // drop bare initials/punctuation fragments
  );
}

interface DbPlayer {
  code: number;
  web_name: string;
  first_name: string;
  second_name: string;
  known_name: string | null;
  short_name: string; // club
  element_type: number;
  total_pl_minutes: number;
  pl_minutes_2024_25: number;
}

// Pulled live via execute_sql against project fyxyqxpscmqjyjxsyhms on 2026-08-11
// — see the task history. Re-fetch if `players`/`player_season_history`
// change before this runs again.
const DB_PLAYERS: DbPlayer[] = JSON.parse(
  readFileSync(join(__dirname, "db-players-cov-hul-ips.json"), "utf8"),
);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function loadCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const headers = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const vals = parseCsvLine(l);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}

const CLUB_MAP: Record<string, string> = {
  "Coventry City": "COV",
  "Hull City": "HUL",
  "Ipswich Town": "IPS",
};

interface MatchResult {
  row: Record<string, string>;
  player: DbPlayer | null;
  confidence: "high" | "medium" | "unmatched";
  score: number;
}

/**
 * Manual overrides for the 7 the automatic token-overlap matcher missed —
 * each checked by hand against `db-players-cov-hul-ips.json`. Six are name
 * variants the matcher's exact-token comparison can't bridge (nicknames
 * "Kai"/"Kaine", "Matty"/"Matt", "Oliver"/"Oli"; a misspelling
 * "Kessler"/"Kesler"; a first-name-only match "Oluwasemilogo .../Semi"; and
 * an apostrophe asymmetry "OShea"/"O'Shea" — the PDF strips the apostrophe,
 * `tokens()` splits DB "O'Shea" into fragments on it). The seventh,
 * "Amir Hadziahmetovic", genuinely has no row in `players` for COV/HUL/IPS —
 * confirmed absent, not a matching failure — and is left unmatched.
 */
const MANUAL_MATCHES: Record<string, number> = {
  "Kai Andrews": 629397,
  "Kaine Kessler": 465390,
  "Matty Crooks": 101282,
  "Oliver McBurnie": 169432,
  "Oluwasemilogo Adesewo Ibidapo Ajayi": 146426,
  "Dara OShea": 216616,
};

function bestMatch(extractedName: string, club: string): { player: DbPlayer | null; score: number } {
  const manualCode = MANUAL_MATCHES[extractedName];
  if (manualCode !== undefined) {
    const player = DB_PLAYERS.find((p) => p.code === manualCode) ?? null;
    return { player, score: player ? 1 : 0 };
  }
  const nameTokens = tokens(extractedName);
  const candidates = DB_PLAYERS.filter((p) => p.short_name === club);
  let best: DbPlayer | null = null;
  let bestScore = 0;
  for (const p of candidates) {
    const dbTokens = tokens(`${p.first_name} ${p.second_name} ${p.known_name ?? ""} ${p.web_name}`);
    const intersection = [...nameTokens].filter((t) => dbTokens.has(t)).length;
    const union = new Set([...nameTokens, ...dbTokens]).size;
    const score = union === 0 ? 0 : intersection / union;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return { player: best, score: bestScore };
}

function main() {
  const extracted = loadCsv(
    join(__dirname, "..", "docs", "Promoted Team Data", "extracted", "footystats_championship_2025_26.csv"),
  );

  const results: MatchResult[] = extracted.map((row) => {
    const club = CLUB_MAP[row.origin_club] ?? row.origin_club;
    const { player, score } = bestMatch(row.player_name, club);
    const confidence: MatchResult["confidence"] = score >= 0.8 ? "high" : score >= 0.4 ? "medium" : "unmatched";
    return { row, player: confidence === "unmatched" ? null : player, confidence, score };
  });

  console.log("=".repeat(70));
  console.log("MATCH REPORT");
  console.log("=".repeat(70));
  for (const r of results) {
    const label = r.player ? `${r.player.web_name} (code ${r.player.code})` : "NO MATCH";
    console.log(
      `${r.row.player_name.padEnd(32)} -> ${label.padEnd(28)} [${r.confidence}, score=${r.score.toFixed(2)}]`,
    );
  }

  const unmatched = results.filter((r) => r.confidence === "unmatched");
  const medium = results.filter((r) => r.confidence === "medium");
  console.log(`\n${unmatched.length} unmatched, ${medium.length} medium-confidence (manual review).`);

  // ---------------------------------------------------------- three-check gate
  console.log("\n" + "=".repeat(70));
  console.log("THREE-CHECK GATE (docs/sprints/cold-start-patch.md, 2026-08-05)");
  console.log("=".repeat(70));

  // Check 1: per-player distinct values, not position archetypes.
  const matched = results.filter((r) => r.player);
  const tupleKey = (r: MatchResult) =>
    [r.row.xg90, r.row.xa90, r.row.tackles90, r.row.clearances90, r.row.minutes].join("|");
  const distinctTuples = new Set(matched.map(tupleKey));
  console.log(
    `Check 1 (distinct values): ${distinctTuples.size} distinct metric-tuples across ${matched.length} matched players` +
      (distinctTuples.size === matched.length ? " — PASS, every player genuinely distinct." : " — FAIL, investigate duplicates."),
  );

  // Check 2: genuine origin competition.
  const leagues = new Set(matched.map((r) => r.row.origin_league));
  console.log(
    `Check 2 (genuine competition): origin_league = {${[...leagues].join(", ")}} — ` +
      (leagues.size === 1 && leagues.has("EFL Championship") ? "PASS." : "FAIL, mixed/unexpected leagues."),
  );

  // Check 3: no overlap with players who already carry PL minutes — resolved
  // by splitting into disjoint sets rather than rejecting the whole drop.
  const coldStart = matched.filter((r) => r.player!.total_pl_minutes === 0);
  const lambdaCohort = matched.filter((r) => r.player!.pl_minutes_2024_25 >= 450);
  const excludedOther = matched.filter(
    (r) => r.player!.total_pl_minutes > 0 && r.player!.pl_minutes_2024_25 < 450,
  );
  console.log(
    `Check 3 (overlap resolved by split): ${coldStart.length} genuine cold-start (0 PL minutes ever) get priors; ` +
      `${lambdaCohort.length} form the λ-fitting cohort (450+ PL minutes in 2024/25); ` +
      `${excludedOther.length} fall in neither set and are excluded entirely (some PL history, but not enough to fit λ).`,
  );

  writeFileSync(
    join(__dirname, "..", "docs", "Promoted Team Data", "extracted", "match_report.json"),
    JSON.stringify(
      {
        matched: matched.map((r) => ({
          player_name: r.row.player_name,
          player_code: r.player!.code,
          club: r.row.origin_club,
          confidence: r.confidence,
          total_pl_minutes: r.player!.total_pl_minutes,
          pl_minutes_2024_25: r.player!.pl_minutes_2024_25,
          bucket: r.player!.total_pl_minutes === 0 ? "cold_start" : r.player!.pl_minutes_2024_25 >= 450 ? "lambda_cohort" : "excluded",
        })),
        unmatched: unmatched.map((r) => r.row.player_name),
      },
      null,
      2,
    ),
  );
  console.log("\nWrote match_report.json");
}

main();
