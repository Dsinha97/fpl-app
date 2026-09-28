/**
 * Export every Linear issue to a local record, then archive the closed ones.
 *
 * Linear's free plan caps a workspace at 250 non-archived issues. Archived
 * issues don't count, stay searchable, keep their URLs and can be restored —
 * so closed work is archived, never deleted. The Linear MCP has no archive
 * tool, hence the GraphQL API.
 *
 *   npx tsx scripts/linear-archive.ts                   # export only (read-only)
 *   npx tsx scripts/linear-archive.ts archive --dry-run # export + list what would be archived
 *   npx tsx scripts/linear-archive.ts archive --apply   # export + archive Done/Canceled
 *
 * Every run re-exports first, so the record is always taken before anything is
 * archived. FPL-App project issues go to docs/linear-archive/ (committed — the
 * public repo already mirrors them in docs/linear.md); everything else goes to
 * linear-export/ (gitignored). Needs LINEAR_API_KEY in .env.local, a personal
 * key from Linear → Settings → Security & access. Nothing is hardcoded here.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "docs", "linear-archive");
const PRIVATE_DIR = path.join(ROOT, "linear-export");
const PUBLIC_PROJECT = "FPL-App";
const CLOSED_TYPES = new Set(["completed", "canceled"]);

function env(): Record<string, string> {
  const file = path.join(ROOT, ".env.local");
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const API_KEY = process.env.LINEAR_API_KEY ?? env().LINEAR_API_KEY;
if (!API_KEY) throw new Error("LINEAR_API_KEY not set - add it to .env.local");

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: API_KEY! },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || body.errors?.length) {
    throw new Error(`Linear ${res.status}: ${body.errors?.map((e) => e.message).join("; ") ?? res.statusText}`);
  }
  return body.data!;
}

type Comment = { body: string; createdAt: string; user: { name: string } | null };
type Issue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priorityLabel: string;
  createdAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  archivedAt: string | null;
  state: { name: string; type: string };
  team: { key: string; name: string };
  project: { name: string } | null;
  projectMilestone: { name: string } | null;
  parent: { identifier: string } | null;
  labels: { nodes: { name: string }[] };
  relations: { nodes: { type: string; relatedIssue: { identifier: string } }[] };
  comments: { nodes: Comment[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

const ISSUE_FIELDS = `
  id identifier title description url priorityLabel
  createdAt completedAt canceledAt archivedAt
  state { name type } team { key name } project { name } projectMilestone { name }
  parent { identifier } labels { nodes { name } }
  relations { nodes { type relatedIssue { identifier } } }
  comments(first: 50) { nodes { body createdAt user { name } } pageInfo { hasNextPage endCursor } }
`;

async function fetchAllIssues(): Promise<Issue[]> {
  const out: Issue[] = [];
  let after: string | null = null;
  for (;;) {
    const data: { issues: { nodes: Issue[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await gql(
      `query($after: String) {
        issues(first: 25, after: $after, includeArchived: true, orderBy: createdAt) {
          nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor }
        }
      }`,
      { after },
    );
    out.push(...data.issues.nodes);
    if (!data.issues.pageInfo.hasNextPage) break;
    after = data.issues.pageInfo.endCursor;
  }
  // Long comment threads: page the rest per issue.
  for (const issue of out) {
    let page = issue.comments.pageInfo;
    while (page.hasNextPage) {
      const data: { issue: { comments: Issue["comments"] } } = await gql(
        `query($id: String!, $after: String) {
          issue(id: $id) { comments(first: 50, after: $after) { nodes { body createdAt user { name } } pageInfo { hasNextPage endCursor } } }
        }`,
        { id: issue.id, after: page.endCursor },
      );
      issue.comments.nodes.push(...data.issue.comments.nodes);
      page = data.issue.comments.pageInfo;
    }
  }
  return out.sort((a, b) => a.team.key.localeCompare(b.team.key) || num(a) - num(b));
}

const num = (i: Issue) => Number(i.identifier.split("-")[1]);
const day = (s: string | null) => (s ? s.slice(0, 10) : "—");
// Backslashes first, or an input ending in `\` would escape the `\|` added after it.
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function renderMarkdown(title: string, issues: Issue[], exportedAt: string): string {
  const groups: [string, Issue[]][] = [
    ["Open", issues.filter((i) => !CLOSED_TYPES.has(i.state.type))],
    ["Done", issues.filter((i) => i.state.type === "completed")],
    ["Canceled", issues.filter((i) => i.state.type === "canceled")],
  ];
  const lines = [
    `# ${title}`,
    "",
    `Exported from Linear ${exportedAt} by \`scripts/linear-archive.ts\` — ${issues.length} issues. ` +
      "Closed issues are archived in Linear, not deleted: their links still resolve and they can be restored. " +
      "`docs/linear.md` remains the issue ↔ doc mapping; this is the full-text record.",
    "",
  ];
  for (const [name, list] of groups) {
    if (!list.length) continue;
    lines.push(`## ${name} (${list.length})`, "", "| Issue | Title | State | Milestone | Closed |", "|---|---|---|---|---|");
    for (const i of list) {
      lines.push(
        `| [${i.identifier}](${i.url}) | ${cell(i.title)} | ${i.state.name} | ${i.projectMilestone?.name ?? "—"} | ${day(i.completedAt ?? i.canceledAt)} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Full text", "");
  for (const i of issues) {
    const meta = [
      `**State:** ${i.state.name}`,
      `**Created:** ${day(i.createdAt)}`,
      i.completedAt && `**Completed:** ${day(i.completedAt)}`,
      i.canceledAt && `**Canceled:** ${day(i.canceledAt)}`,
      i.projectMilestone && `**Milestone:** ${i.projectMilestone.name}`,
      `**Priority:** ${i.priorityLabel}`,
      i.labels.nodes.length && `**Labels:** ${i.labels.nodes.map((l) => l.name).join(", ")}`,
      i.parent && `**Parent:** ${i.parent.identifier}`,
      i.relations.nodes.length &&
        `**Relations:** ${i.relations.nodes.map((r) => `${r.type} ${r.relatedIssue.identifier}`).join(", ")}`,
    ].filter(Boolean);
    lines.push(
      `<details><summary><b>${i.identifier}</b> — ${i.title.replace(/</g, "&lt;")}</summary>`,
      "",
      meta.join(" · "),
      "",
      i.description?.trim() || "_No description._",
      "",
    );
    for (const c of i.comments.nodes) {
      lines.push(`> **${c.user?.name ?? "Unknown"}**, ${day(c.createdAt)}`, ">", ...c.body.trim().split(/\r?\n/).map((l) => `> ${l}`), "");
    }
    lines.push("</details>", "");
  }
  return lines.join("\n");
}

function writeRecord(issues: Issue[], exportedAt: string) {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  mkdirSync(PRIVATE_DIR, { recursive: true });
  const pub = issues.filter((i) => i.project?.name === PUBLIC_PROJECT);
  writeFileSync(path.join(PUBLIC_DIR, "fpl-app.json"), JSON.stringify({ exportedAt, issues: pub }, null, 2) + "\n");
  writeFileSync(path.join(PUBLIC_DIR, "fpl-app.md"), renderMarkdown(`Linear archive — ${PUBLIC_PROJECT}`, pub, exportedAt));
  const rest = issues.filter((i) => i.project?.name !== PUBLIC_PROJECT);
  const byTeam = new Map<string, Issue[]>();
  for (const i of rest) byTeam.set(i.team.key, [...(byTeam.get(i.team.key) ?? []), i]);
  for (const [key, list] of byTeam) {
    writeFileSync(path.join(PRIVATE_DIR, `${key}.json`), JSON.stringify({ exportedAt, issues: list }, null, 2) + "\n");
    writeFileSync(path.join(PRIVATE_DIR, `${key}.md`), renderMarkdown(`Linear archive — team ${key} (outside ${PUBLIC_PROJECT})`, list, exportedAt));
  }
  return { pub: pub.length, byTeam: [...byTeam].map(([k, l]) => `${k} ${l.length}`) };
}

function summarise(issues: Issue[]) {
  const teams = new Map<string, { total: number; archived: number; open: number; done: number; canceled: number }>();
  for (const i of issues) {
    const t = teams.get(i.team.key) ?? { total: 0, archived: 0, open: 0, done: 0, canceled: 0 };
    t.total++;
    if (i.archivedAt) t.archived++;
    else if (i.state.type === "completed") t.done++;
    else if (i.state.type === "canceled") t.canceled++;
    else t.open++;
    teams.set(i.team.key, t);
  }
  console.table(Object.fromEntries(teams));
  const active = issues.filter((i) => !i.archivedAt).length;
  const openCount = issues.filter((i) => !i.archivedAt && !CLOSED_TYPES.has(i.state.type)).length;
  console.log(`Non-archived (counts toward the 250 cap): ${active}. After archiving closed: ${openCount}.`);
}

async function main() {
  const [cmd, flag] = process.argv.slice(2);
  const exportedAt = new Date().toISOString();
  const issues = await fetchAllIssues();
  const written = writeRecord(issues, exportedAt);
  console.log(`Exported ${issues.length} issues: ${PUBLIC_PROJECT} ${written.pub} → docs/linear-archive/; others → linear-export/ (${written.byTeam.join(", ") || "none"}).`);
  summarise(issues);
  if (cmd !== "archive") return;

  const candidates = issues.filter((i) => !i.archivedAt && CLOSED_TYPES.has(i.state.type));
  // Belt and braces: never archive an open issue, whatever the filter above says.
  const open = candidates.filter((i) => !CLOSED_TYPES.has(i.state.type));
  if (open.length) throw new Error(`Refusing: open issues in candidate list: ${open.map((i) => i.identifier).join(", ")}`);

  console.log(`\n${candidates.length} closed issues to archive:`);
  for (const i of candidates) console.log(`  ${i.identifier.padEnd(9)} ${i.state.name.padEnd(10)} ${i.title}`);
  if (flag !== "--apply") {
    console.log("\nDry run — nothing archived. Re-run with --apply.");
    return;
  }

  const stamp = exportedAt.slice(0, 10);
  const logs = {
    pub: path.join(PUBLIC_DIR, `archive-log-${stamp}.md`),
    priv: path.join(PRIVATE_DIR, `archive-log-${stamp}.md`),
  };
  for (const f of Object.values(logs)) {
    if (!existsSync(f)) writeFileSync(f, `# Linear archive log — ${stamp}\n\n| Issue | State | Title | Result |\n|---|---|---|---|\n`);
  }
  let ok = 0;
  for (const i of candidates) {
    let result: string;
    try {
      const data = await gql<{ issueArchive: { success: boolean } }>(
        `mutation($id: String!) { issueArchive(id: $id) { success } }`,
        { id: i.id },
      );
      result = data.issueArchive.success ? "archived" : "FAILED";
      if (data.issueArchive.success) ok++;
    } catch (e) {
      result = `ERROR: ${(e as Error).message}`;
    }
    const log = i.project?.name === PUBLIC_PROJECT ? logs.pub : logs.priv;
    appendFileSync(log, `| [${i.identifier}](${i.url}) | ${i.state.name} | ${cell(i.title)} | ${cell(result)} |\n`);
    console.log(`  ${i.identifier.padEnd(9)} ${result}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`\nArchived ${ok}/${candidates.length}. Re-running is safe: archived issues are skipped.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
