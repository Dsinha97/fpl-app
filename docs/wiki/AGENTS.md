# Operating instructions for docs/wiki/

This file governs how any agent (Claude or otherwise) should maintain `docs/wiki/` — the topic-
organised knowledge base sitting alongside `docs/`'s chronological sprint history. It does not
override root `AGENTS.md`/`CLAUDE.md`; it's scoped to this folder only.

## What this wiki is, and isn't

`docs/wiki/` is synthesis — one page per real topic, written in your own words, cross-linked, each
claim attributed to the sprint file or source spec it came from. It is **not** the source of truth:
`docs/roadmap.md` is the authoritative sprint plan, `docs/sources/` holds the owner's original specs
unedited, and `docs/sprints/` is the chronological build record. When the wiki and `roadmap.md`
disagree, `roadmap.md` wins — treat that as a signal the wiki page is stale and fix it.

## The three jobs

### INGEST

When new material lands in `docs/sources/` (a new source spec) or an existing `docs/` file changes
(a sprint file updated, `roadmap.md`'s status table changed, a new sprint file added):

1. Read what changed.
2. Find the existing wiki page(s) it belongs to. **Never create a near-duplicate page** — if a topic
   already has a page, update that page. Only create a new page for a genuinely new topic with no
   existing home.
3. Update the page: synthesis in your own words, one-line summary intact at the top, claims
   attributed back to their source with a relative link.
4. Add/update links both ways — if page A now references page B's topic, B should link back to A
   where relevant.
5. If a new page was created, add it to `index.md` under the right section.
6. Append one line to `log.md`: `YYYY-MM-DD — what changed`.

Never delete or overwrite raw source material in `docs/sources/` or `docs/sprints/` as part of an
ingest — this wiki only adds and updates pages under `docs/wiki/`.

### ANSWER

When asked a question, **answer from the wiki first** and name which page(s) the answer came from
(e.g. "— see `cold-start-priors.md`"). If the wiki doesn't cover it, say so plainly rather than
improvising from general knowledge or guessing at the codebase. It's fine to then go read the
underlying sprint files or code directly — just say that's what you're doing, since it means the
wiki has a gap worth filling on the next ingest.

### TIDY (lint)

When asked to "tidy the wiki," produce a **punch list only** — never auto-fix:

- Pages that contradict each other, or contradict `roadmap.md`'s current status table.
- Claims that look out of date (a "blocked" item `roadmap.md` now shows as built, a version number
  that's been superseded, a date-sensitive fact like `GW1 deadline 2026-08-21` that's passed).
- Orphan pages — nothing in `index.md` or another wiki page links to them.
- Topics that come up repeatedly (in sprint files, in conversation) with no dedicated page yet.

Present the list and stop. Fixes happen in a follow-up ingest pass, with the owner's sign-off if the
fix is non-trivial.

## Ground rules inherited from the project

- **Never move, rename, or delete a file without a plan and explicit "yes" first.** This applies to
  every file in `docs/`, not just the wiki.
- **Never delete anything.** If something looks like stale junk, don't touch it — flag it in the
  TIDY punch list instead and let the owner decide.
- **Plain markdown only.**
- **Never say "verified"/"the app does X" without checking** — if a wiki claim can be confirmed
  against live code or the database in a rolled-back transaction, do that before stating it as fact,
  the same discipline `CLAUDE.md`'s "verify, don't assume" rule requires everywhere else in this repo.

## Automation

A `post-commit` git hook appends changed paths under `docs/sources/`, `docs/`, and root `CLAUDE.md`/
`AGENTS.md` to `docs/wiki/.pending-ingest` (gitignored, not itself tracked). Run the ingest job
against that file, then clear it. If the hook or marker file is missing, `git log` since `log.md`'s
last entry is the fallback source of "what changed."
