---
name: wiki-ingest
description: Update docs/wiki/ from source material that changed since the last ingest — reads docs/wiki/.pending-ingest (or falls back to git log since docs/wiki/log.md's last entry), updates or creates the right topic pages, cross-links them, runs a quick tidy pass, and reports what needs attention. Use when asked to "ingest", "update the wiki", "/ingest", or after committing changes under docs/sources/, docs/sprints/, docs/roadmap.md, or CLAUDE.md.
---

# Wiki ingest

Runs the INGEST + a quick TIDY pass defined in [docs/wiki/AGENTS.md](../../../docs/wiki/AGENTS.md) —
read that file first, it's the actual operating contract; this skill is the trigger and the
mechanics for firing it.

## Steps

1. **Find what changed.**
   - If `docs/wiki/.pending-ingest` exists and is non-empty, read it — one path per line, written by
     `scripts/hooks/post-commit`.
   - Otherwise, fall back to `git log --since="<date of docs/wiki/log.md's last entry>" --name-only
     -- docs/sources docs/sprints docs/roadmap.md docs/architecture.md docs/phase-4-model.md
     CLAUDE.md AGENTS.md`.
   - If neither yields anything, say so and stop — nothing to ingest.

2. **For each changed file**, read it, then follow `docs/wiki/AGENTS.md`'s INGEST job: find the
   existing wiki page(s) the topic belongs to and update them (never create a near-duplicate page);
   only create a new page for a genuinely new topic, and add it to `docs/wiki/index.md` under the
   right section **and** to the matching map in `docs/wiki/moc/`. A new page's first line after its
   `# Title` is `Up: [Wiki home](index.md) · [<Map title>](moc/<map>.md)` (exactly one map). Add
   cross-links both directions where relevant.

3. **Append one line per logical change to `docs/wiki/log.md`** (most recent first), dated
   `YYYY-MM-DD`.

4. **Clear `docs/wiki/.pending-ingest`** (truncate, don't delete the file) once every entry has been
   processed.

5. **Run a quick TIDY pass** — not a full audit, just: does anything you just touched now contradict
   another page or `docs/roadmap.md`'s status table? Any claim you just added that's already visibly
   stale? List findings, don't auto-fix beyond what step 2 already changed.

6. **Report**: what was updated/created, and a short "needs your attention" note if the tidy pass in
   step 5 found anything. Then run the graph check (below) and report anything it lists.

## Graph check

Opened in Obsidian (vault at the repo root, `.obsidian/` is gitignored), a healthy graph has
`docs/wiki/index.md` as the biggest node, the four maps in `docs/wiki/moc/` as the second ring, and
no loose dots. Run this after every ingest, as part of TIDY, or whenever the graph looks messy:

```bash
node .claude/skills/wiki-ingest/graph-check.mjs --top 15
```

It is read-only and prints four lists:
- **Orphans:** `.md` files under `docs/` that nothing in `docs/` or the root `.md` files links to.
- **Wiki pages missing an "Up:" line.**
- **Wiki pages listed in no map.**
- **Most-linked pages:** distinct pages linking in. `index.md` should top it. A dated record (a
  sprint or a GW check-in) ranking near the top is acting as a hub; make sure the topic pages carry
  the current answer rather than pointing at it.

Fixing what it finds (never move, rename or delete a file to fix the graph):
- **Orphan:** link it from the wiki or docs page that already discusses it. `docs/site-explainer.md`
  is the owner's own one-off and stays unlinked unless they say otherwise.
- **Missing "Up:" line:** first text after the `# Title`: `Up: [Wiki home](index.md) · [<Map
  title>](moc/<map>.md)`. Maps link home only. Maps: engines-and-model, features-and-surfaces,
  platform, cross-cutting.
- **In no map:** add a row to the map its `Up:` line names. Note the change in `log.md`.

Obsidian display (`.obsidian/graph.json`, local only, backup `graph.json.bak-2026-10-18`): filter
`path:docs -path:"docs/linear-archive"`; colour groups in order gold (index and maps), purple
(`docs/sources`), grey (`docs/sprints`), blue (`docs/wiki`). Close the graph view before editing
the file, since Obsidian rewrites it while open.

## Ground rules (inherited from docs/wiki/AGENTS.md and the project's CLAUDE.md)

- Never move, rename, or delete a file without a plan and explicit go-ahead — this includes files
  under `docs/sources/` and `docs/sprints/`, whose **bodies** this skill only ever reads.
- **Follow a stale claim out of `docs/wiki/`.** Writing wiki pages is this job's purpose, not its
  boundary. The same wrong sentence usually also lives in `docs/roadmap.md`, in a shipped
  `*_MODEL_NOTE`/`*_NOTE` string under `lib/` or `components/`, and in a source spec's banner — fix
  it in all of them rather than reporting a punch list, which is the TIDY job's deliverable, not
  INGEST's. Two exceptions: a **source spec** gets a dated reconciliation note added to its banner
  and its body left untouched, and a **sprint file** in `docs/sprints/` is a historical record that
  is not rewritten at all. Run the project's gate (`npx tsc --noEmit`, `npm run lint`,
  `npm run build`) when the fix touches code. See `docs/wiki/AGENTS.md`'s **Folder conventions**.
- Never delete wiki content; if a page's claim looks wrong, correct it in place with a note, don't
  silently drop history.
- Plain markdown only.
- Don't state something as fact without it being traceable to a source file — every claim in a wiki
  page should be attributable to a specific `docs/` file if asked.
