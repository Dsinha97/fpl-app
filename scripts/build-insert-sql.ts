// Generate the INSERT statement for `external_player_seasons` from the
// extraction CSV + match report. Prints SQL to stdout for manual pasting
// into apply_migration/execute_sql. Not part of the app build.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

const extractedPath = join(__dirname, "..", "docs", "Promoted Team Data", "extracted", "footystats_championship_2025_26.csv");
const lines = readFileSync(extractedPath, "utf8").split("\n").filter(Boolean);
const headers = lines[0].split(",");
const rows = lines.slice(1).map((l) => {
  const vals = parseCsvLine(l);
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => (obj[h] = vals[i] ?? ""));
  return obj;
});

const report = JSON.parse(
  readFileSync(join(__dirname, "..", "docs", "Promoted Team Data", "extracted", "match_report.json"), "utf8"),
);
const byName = new Map<string, { player_code: number; confidence: string }>();
for (const m of report.matched) byName.set(m.player_name, { player_code: m.player_code, confidence: m.confidence });

const MANUAL_NAMES = new Set([
  "Kai Andrews", "Kaine Kessler", "Matty Crooks", "Oliver McBurnie",
  "Oluwasemilogo Adesewo Ibidapo Ajayi", "Dara OShea",
]);

function sqlStr(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "null";
  return `'${v.replace(/'/g, "''")}'`;
}
function sqlNum(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "null";
  return v;
}

const values: string[] = [];
for (const r of rows) {
  const match = byName.get(r.player_name);
  const isUnmatched = !match;
  const matchedBy = isUnmatched ? "unmatched" : MANUAL_NAMES.has(r.player_name) ? "manual" : "auto";
  const confidence = isUnmatched ? "null" : `'${match!.confidence}'`;
  const playerCode = isUnmatched ? "null" : String(match!.player_code);

  values.push(
    `(${sqlStr("footystats")}, ${sqlStr(r.origin_league)}, ${sqlStr(r.season)}, ${playerCode}, ` +
    `${sqlStr(r.player_name)}, ${sqlStr(r.origin_club)}, ${sqlStr(r.position)}, ` +
    `'${matchedBy}', ${confidence}, ` +
    `${sqlNum(r.matches_played)}, ${sqlNum(r.matches_started)}, ${sqlNum(r.minutes)}, ${sqlNum(r.minutes_per_appearance)}, ` +
    `${sqlNum(r.xg90)}, ${sqlNum(r.npxg90)}, ${sqlNum(r.xa90)}, ${sqlNum(r.goals90)}, ${sqlNum(r.assists90)}, ` +
    `${sqlNum(r.tackles90)}, ${sqlNum(r.interceptions90)}, ${sqlNum(r.clearances90)}, ${sqlNum(r.shots_blocked90)}, ${sqlNum(r.crosses90)}, ` +
    `${sqlNum(r.cards90)}, ${sqlNum(r.saves90)}, ${sqlNum(r.save_pct)}, ${sqlNum(r.goals_conceded90)}, ${sqlNum(r.clean_sheet_pct)}, ` +
    `${sqlStr(r.captured_at)}, ${sqlStr(r.source_file)})`,
  );
}

const sql =
  `insert into public.external_player_seasons (\n` +
  `  provider, league, season, player_code, player_name_source, origin_club, position,\n` +
  `  matched_by, match_confidence, matches_played, matches_started, minutes, minutes_per_appearance,\n` +
  `  xg90, npxg90, xa90, goals90, assists90, tackles90, interceptions90, clearances90, shots_blocked90, crosses90,\n` +
  `  cards90, saves90, save_pct, goals_conceded90, clean_sheet_pct, captured_at, source_file\n` +
  `) values\n` +
  values.join(",\n") +
  `;\n`;

const outPath = join(__dirname, "..", "docs", "Promoted Team Data", "extracted", "insert.sql");
writeFileSync(outPath, sql);
console.log(`Wrote ${rows.length} row inserts to ${outPath}`);
