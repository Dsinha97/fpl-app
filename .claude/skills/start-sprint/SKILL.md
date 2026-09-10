---
name: start-sprint
description: Read the FPL-App Linear project's Todo column, shape the next sprint from it, and on approval write that sprint into existence — a parent issue, statuses, a sprint doc and the roadmap row. Use when asked to "start a sprint", "/start-sprint", "check Linear for todos", "plan sprint work from Linear", or "create the next sprint".
---

# Start a sprint

`/linear-sync` **reconciles** — it compares Linear against the docs and reports drift in both
directions. This skill **starts work**: it reads the Todo column, shapes a sprint from it, and on
approval writes the sprint into existence. Keep the two apart; neither should grow into the other.

## 1. Read the Todo column, specifically

```
list_issues  project: "FPL-App", state: "Todo", limit: 250,
             fields: ["title","status","priority","projectMilestone","labels","updatedAt"]
```

**Todo is not Backlog.** An issue the owner moved Backlog → Todo is a promotion, and that move is
the signal this skill acts on. Do not widen to Backlog to fill a sprint. If Todo is empty, say so
and offer the Backlog's own priority order as a separate question — don't silently substitute it.

## 2. Read every candidate's comments, not just its description

```
list_comments  issueId: "<DSI-nn>"
```

on each candidate. Comments are where the owner adds requirements after the issue was written, and
they can change what an item *is* — DSI-65's comment turned a one-way notifier into a two-way bot
with its own command surface. Where a comment and the description disagree, **the comment wins**.
Quote it in the plan so the change is visible rather than absorbed.

## 3. Read each candidate's gate before including it

Issues link their doc rather than copying the gate — the gate has one home and it isn't Linear.
Open the linked doc. If the gate is not met, say so plainly and leave the issue out. A data-blocked
item stays blocked; do not plan around a gate, and never narrow one to let an item through.

## 4. Number the sprint from the repo

Highest sprint number in `docs/roadmap.md`'s sprint index, plus one. Never a number remembered from
a previous session — that is what went stale last time.

## 5. Shape it, and state the total honestly

Group the work into phases that can each be stopped at, ordered so any prefix is shippable. If the
Todo column is more than one sprint's work, say which phases are the sprint and which are next —
don't quietly drop the remainder. Name the decisions that materially change the work (a delivery
channel, a horizon, a threshold) rather than picking one silently.

## 6. Ask before writing

Present scope, phase order and the open decisions with `AskUserQuestion`. Everything below this
line is an outward-facing write.

## 7. On approval, write both halves

- Linear: create `Sprint NN — …` in the right milestone; move each constituent issue to
  **In Progress** and relate it to the parent.
- Repo: create `docs/sprints/sprint-NN.md`, add the row to `docs/roadmap.md`'s sprint index, and
  refresh its "Next up" so it no longer points at work now in flight.
- On ship: close the issues and move their rows from Open to Shipped in `docs/linear.md`.

Skipping either half is exactly what the next `/linear-sync` reports as drift.

## 8. Never write silently

List what you propose to change and get approval first — the same rule `/linear-sync` ends on.
