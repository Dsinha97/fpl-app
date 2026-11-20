<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Multi-agent rules (lean roster)

Roles
- Main Claude session: orchestrator. Only writer of `docs/wiki/log.md`, `docs/wiki/index.md`,
  `docs/wiki/.manifest.json` and `CLAUDE.md`. Delegates by brief. Merges.
- `worker` and `reviewer` (Claude subagents): one ticket, then a check against its `eval.md`.
- Antigravity (Gemini model): coding briefs only. Writes code, raw outputs with hashes, run logs,
  test output and the status handoff. No analysis, wiki text, copy, or decision candidates.
The user alone approves moves, renames, deletions, pushes, PRs and merges.

Lanes
- Agents other than Claude never edit: `supabase/**`, `.env*`, `.github/`, `.claude/`, `docs/`,
  `CLAUDE.md`, `AGENTS.md`, or a file named in an active freeze.
- A brief may allow named files under `app/`, `components/` and `lib/`.
- Never open: `.env*`, any key or token, and `plans-private/`. A Gemini-model agent opens only the one brief its prompt names, by path.

Git
- One branch per task: `agent/<name>/<topic>`. Antigravity works in a local clone with no remote. Its handoff and raw outputs go in a lane-only
  branch under `agent-lanes/` in the clone; lane branches are never merged or pushed.
- Agents commit only to their branch and never push, open PRs or merge. Commits carry the
  trailers `Agent:` and `Model:`.
- The repo is public: nothing private, no key name and no personal data in a commit, PR or tracked file.

Review and provenance
- Review before promotion: a reviewer reports pass or fail per check with evidence and never fixes.
  The main session recomputes any number before using it.
- Draft files carry `author`, `model`, `status`, `reviewed_by` in frontmatter.

Where things live
- Briefs, handoffs, tickets and the decision register are in `plans-private/` (gitignored).
