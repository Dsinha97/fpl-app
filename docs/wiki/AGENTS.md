---
title: "Operating instructions for docs/wiki/"
type: guide
tags: []
updated: 2026-10-28
---
# Operating instructions for docs/wiki/

Second-brain conventions: v2

For any wiki job (ingest, answer, tidy, audit), load the `anthropic-skills:second-brain` skill. This
file's rules win wherever they differ from it: the layout below (`docs/wiki/` for pages, `docs/sources/`
and `docs/sprints/` for the source layer, `moc/` for maps) is deliberate.

This file governs how any agent (Claude or otherwise) should maintain `docs/wiki/` — the topic-
organised knowledge base sitting alongside `docs/`'s chronological sprint history. It does not
override root `AGENTS.md`/`CLAUDE.md`; it's scoped to this folder only.

## What this wiki is, and isn't

`docs/wiki/` is synthesis — one page per real topic, written in your own words, cross-linked, each
claim attributed to the sprint file or source spec it came from. It is **not** the source of truth:
`docs/roadmap.md` is the authoritative sprint plan, `docs/sources/` holds the owner's original specs
unedited, and `docs/sprints/` is the chronological build record. When the wiki and `roadmap.md`
disagree, `roadmap.md` wins — treat that as a signal the wiki page is stale and fix it.

## Folder conventions

<!-- RETRO fills this in over time. Each line is a rule learned from a correction the owner gave
Claude while working in docs/wiki/ specifically — not a general repo rule, those belong in root
CLAUDE.md/AGENTS.md. Empty until the first RETRO pass has something to add. -->

- **A stale claim gets fixed everywhere it lives, not just in the wiki.** The same wrong sentence is
  usually in `roadmap.md`, a shipped `*_MODEL_NOTE`, and a source spec's banner too. Fix the wiki
  page, then follow the claim out: correct `roadmap.md` and the code strings, and add a dated
  reconciliation note to the source banner (never its body). Report a punch list only when TIDY was
  what was asked for.

## Deliberate differences from the second-brain defaults

- **Inline attribution comes first.** Claims are attributed inline with a relative link to the sprint
  file or spec they came from. The `## Sources` section at the foot of each page is generated from
  those links, so it lists them rather than replacing them; keep adding the inline link first.
- **Frontmatter** follows the skill's schema with this vault's own `type` set: `concept` (engines),
  `feature`, `platform`, `reference`, `moc`, `guide`. `related` mirrors the page's outbound wiki
  links and `sources` lists in-`docs/` files, both relative to `docs/wiki/` and `docs/` respectively.
  `.manifest.json` hashes `docs/sources/` only; `docs/sprints/` is tracked by git and `log.md`.
- **Dated claims.** Dates mark when something happened (`Sprint 33, 2026-09-05`, `fixed 2026-08-27`)
  and are already consistent. Add `as of <date>` only to a *snapshot* figure that drifts (a live count,
  a bias reading), as `data-pipeline.md` does; do not stamp every dated line.
- **Evidence level.** When a source is generated (e.g. `ml-model-audit.md`) or second-hand, say so on
  the page that rests on it.
- **Log entries stay short**: date, what changed, which pages. Narrative goes in the commit message.

## The jobs

### INGEST

When new material lands in `docs/sources/` (a new source spec) or an existing `docs/` file changes
(a sprint file updated, `roadmap.md`'s status table changed, a new sprint file added):

1. Read what changed.
2. Find the existing wiki page(s) it belongs to. **Never create a near-duplicate page** — search titles and acronyms first; if a topic
   already has a page, update that page. Only create a new page for a genuinely new topic with no
   existing home.
3. Update the page: synthesis in your own words, one-line summary intact at the top, claims
   attributed back to their source with a relative link.
4. Add/update links both ways — if page A now references page B's topic, B should link back to A
   where relevant.
5. If a new page was created, add it to `index.md` under the right section.
6. Append one line to `log.md`: `YYYY-MM-DD — what changed`.

Never delete or overwrite raw source material in `docs/sources/` or `docs/sprints/` as part of an
ingest — their bodies are read-only to this job. Writing pages under `docs/wiki/` is the job's
*purpose*, not its boundary: when an ingest finds the same stale claim living in `roadmap.md`, in a
shipped `*_MODEL_NOTE` string, or in a source spec's banner, fix it there too rather than handing
back a list — see **Folder conventions** above. A source spec is the one exception that stays
note-only: add a dated reconciliation note to its banner, leave the body untouched.

### ANSWER

When asked a question, **answer from the wiki first** and name which page(s) the answer came from
(e.g. "— see `cold-start-priors.md`"), and end every answer that used wiki pages with these two lines:

```
Pages used: <wiki pages opened, as links>
Linked but not opened: <pages those pages link to that were not opened, or none>
```

Do not judge which skipped pages matter; the owner decides. If the wiki doesn't cover it, say so plainly rather than
improvising from general knowledge or guessing at the codebase. It's fine to then go read the
underlying sprint files or code directly — just say that's what you're doing, since it means the
wiki has a gap worth filling on the next ingest.

### TIDY (lint)

When asked to "tidy the wiki," produce a **punch list only** — never auto-fix. Start with the
skill's mechanical check (`check_vault.py <docs> lint`: dead links, orphans, duplicate titles; ignore
its frontmatter and `## Sources` findings, see above), then read for the rest:

- Pages that contradict each other, or contradict `roadmap.md`'s current status table.
- Claims that look out of date (a "blocked" item `roadmap.md` now shows as built, a version number
  that's been superseded, a date-sensitive fact like `GW1 deadline 2026-08-21` that's passed).
- Orphan pages — nothing in `index.md` or another wiki page links to them.
- Topics that come up repeatedly (in sprint files, in conversation) with no dedicated page yet.

Present the list and stop. Fixes happen in a follow-up ingest pass, with the owner's sign-off if the
fix is non-trivial.

Run RETRO (below) at the end of the same TIDY pass, unless only the punch list was asked for. Skip
it on the first TIDY if there's no history yet to look back on.

### RETRO

This file is written once and otherwise never changes, so a correction the owner keeps repeating —
wrong section for a topic, a tagging habit that keeps getting missed, how a certain kind of page
should be named — gets re-learned from scratch every session instead of sticking.

- Look back over this conversation (and recent past sessions, if transcript access is available) for
  moments where the owner corrected how something in `docs/wiki/` specifically was organised,
  tagged, or named — not general project preferences, those belong in root `CLAUDE.md`/`AGENTS.md`
  or Claude's own memory, not here.
- Distill each real, **recurring** correction into one short rule. A single one-off fix isn't a
  convention; the same correction happening twice is.
- Compare against **Folder conventions** above: add what's new and non-conflicting, let the newest
  correction replace a conflicting older line, and drop anything that no longer applies.
- **Show the exact lines being added, changed, or removed before writing them** — this is the one
  part of TIDY that edits this file itself, so it gets a diff and waits for a "yes"; everything else
  in TIDY only reports.
- On approval, update **Folder conventions** and append a line to `log.md` noting the change.

Keep **Folder conventions** short — a handful of sharp rules beats a long vague list. If it passes
~15 lines, fold related ones together instead of letting it sprawl.

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
