// One-shot extractor for the FootyStats player PDFs in
// `docs/Promoted Team Data/<Team>/`. Run manually, output committed as CSV —
// see docs/sprints/championship-priors.md. Raw values only, no translation:
// translation (league lambda) is a model concern, fitted separately.
//
// Usage: npx tsx scripts/extract-footystats.ts
//
// Not part of the app build. Depends on `pdf-parse`, installed with --no-save
// for this one run — see the note at the bottom of this file.

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PDFParse } from "pdf-parse";

const ROOT = join(__dirname, "..", "docs", "Promoted Team Data");
const TEAMS: Record<string, string> = {
  Coventry: "Coventry City",
  "Hull City": "Hull City",
  Ipswich: "Ipswich Town",
};
const CAPTURED_AT = "2026-08-05"; // date printed on every PDF's browser-chrome timestamp line
const LEAGUE = "EFL Championship";
const SEASON = "2025/26";

interface Row {
  player_name: string;
  origin_club: string;
  origin_league: string;
  season: string;
  position: string | null;
  matches_played: number | null;
  matches_started: number | null;
  minutes: number | null;
  minutes_per_appearance: number | null;
  xg90: number | null;
  npxg90: number | null;
  xa90: number | null;
  goals90: number | null;
  assists90: number | null;
  tackles90: number | null;
  interceptions90: number | null;
  clearances90: number | null;
  shots_blocked90: number | null;
  crosses90: number | null;
  cards90: number | null;
  saves90: number | null;
  save_pct: number | null;
  goals_conceded90: number | null;
  clean_sheet_pct: number | null;
  captured_at: string;
  source_file: string;
}

/**
 * Find `<Label> \t <total> \t <value> \t <percentile>` and return the value
 * column. `label` is a plain string (or a `^`-anchored plain string to pin
 * it to a line start, e.g. distinguishing "Assists" from "Expected Assists")
 * — this function does its own regex escaping, so callers must NOT
 * pre-escape.
 */
function metric(text: string, label: string): number | null {
  const anchored = label.startsWith("^");
  const plain = anchored ? label.slice(1) : label;
  const escaped = plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${anchored ? "^" : ""}${escaped}\\s+[^\\t\\n]+\\t([\\d.]+)%?\\s+(?:\\d+|N/A)`,
    "m",
  );
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

function int(text: string, label: string): number | null {
  const anchored = label.startsWith("^");
  const plain = anchored ? label.slice(1) : label;
  const escaped = plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${anchored ? "^" : ""}${escaped}\\s+(\\d+)`, "m");
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

async function extractOne(filePath: string, team: string): Promise<Row | null> {
  const buf = readFileSync(filePath);
  const parser = new PDFParse({ data: buf });
  const { text } = await parser.getText();

  const nameMatch = text.match(/^([^\n]+) Stats$/m);
  const playerName = nameMatch ? nameMatch[1].trim() : null;
  if (!playerName) {
    console.warn(`  ! could not find player name in ${filePath}`);
    return null;
  }

  const positionMatch = text.match(/Position\s*:\s*([^\n]+?)\s+Nationality/);
  const position = positionMatch ? positionMatch[1].trim() : null;

  // Canonical minutes/matches come from the "General" block under
  // "Championship Stats for <Name>" — the same basis every per-90 figure
  // below it is computed from.
  const generalSection = text.split(/Championship Stats for/)[1] ?? text;
  const matchesPlayed = int(generalSection, "Matches Played");
  const matchesStarted = int(generalSection, "Matches Started");
  const minutesMatch = generalSection.match(/Minutes\s+(\d+)\s+(\d+)\s+min'\s+per appearance/);
  const minutes = minutesMatch ? Number(minutesMatch[1]) : null;
  const minutesPerApp = minutesMatch ? Number(minutesMatch[2]) : null;

  const row: Row = {
    player_name: playerName,
    origin_club: team,
    origin_league: LEAGUE,
    season: SEASON,
    position,
    matches_played: matchesPlayed,
    matches_started: matchesStarted,
    minutes,
    minutes_per_appearance: minutesPerApp,
    xg90: metric(text, "Expected Goals (xG)"),
    npxg90: metric(text, "Non-Penalty xG (npxG)"),
    xa90: metric(text, "Expected Assists (xA)"),
    goals90: metric(text, "Goals Scored"),
    assists90: metric(text, "^Assists"),
    tackles90: metric(text, "^Tackles"),
    interceptions90: metric(text, "Interceptions"),
    clearances90: metric(text, "Clearances"),
    shots_blocked90: metric(text, "Shots Blocked"),
    crosses90: metric(text, "^Crosses"),
    cards90: metric(text, "Total Cards"),
    saves90: metric(text, "^Saves"),
    save_pct: metric(text, "Save Percentage"),
    goals_conceded90: metric(text, "Goals Conceded"),
    clean_sheet_pct: metric(text, "^Clean Sheets"),
    captured_at: CAPTURED_AT,
    source_file: filePath.split(/[/\\]/).pop() ?? filePath,
  };

  return row;
}

function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Defensive: a malformed field regex could otherwise smuggle an embedded
  // newline into a value, breaking every line-based CSV consumer downstream.
  const s = String(v).replace(/[\r\n]+/g, " ").trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const rows: Row[] = [];

  for (const [folder, teamName] of Object.entries(TEAMS)) {
    const dir = join(ROOT, folder);
    const files = readdirSync(dir).filter(
      (f) =>
        f.endsWith(".pdf") &&
        !f.startsWith(teamName) && // team-level PDF, e.g. "Coventry City Stats, Form & xG..."
        !f.includes("Stats, Form & xG"),
    );
    console.log(`${folder}: ${files.length} player PDFs`);
    for (const f of files) {
      const row = await extractOne(join(dir, f), teamName);
      if (row) rows.push(row);
    }
  }

  const headers = Object.keys(rows[0]) as (keyof Row)[];
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => toCsvValue(r[h])).join(",")),
  ];
  const outPath = join(ROOT, "extracted", "footystats_championship_2025_26.csv");
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`\nWrote ${rows.length} rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Note: `pdf-parse` was installed with `npm install --no-save pdf-parse` for
// this one run and is not a project dependency — the script's output (the
// committed CSV) is what the rest of the pipeline depends on, not a live PDF
// parse path. Re-run `npm install --no-save pdf-parse` if this script needs
// to run again (e.g. a re-capture next season).
