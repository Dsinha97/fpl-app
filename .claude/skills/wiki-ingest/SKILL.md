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
   right section. Add cross-links both directions where relevant.

3. **Append one line per logical change to `docs/wiki/log.md`** (most recent first), dated
   `YYYY-MM-DD`.

4. **Clear `docs/wiki/.pending-ingest`** (truncate, don't delete the file) once every entry has been
   processed.

5. **Run a quick TIDY pass** — not a full audit, just: does anything you just touched now contradict
   another page or `docs/roadmap.md`'s status table? Any claim you just added that's already visibly
   stale? List findings, don't auto-fix beyond what step 2 already changed.

6. **Report**: what was updated/created, and a short "needs your attention" note if the tidy pass in
   step 5 found anything.

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
