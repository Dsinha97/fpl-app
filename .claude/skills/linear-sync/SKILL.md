---
name: linear-sync
description: Reconcile the FPL-App Linear project against docs/linear.md and docs/roadmap.md, report drift in both directions, and propose the next sprint from the Linear backlog's own order. Use when asked "what's next", "/linear-sync", "plan the next sprint", "did anything change in Linear", or "reconcile Linear against the docs".
---

# Linear sync

Linear owns **what is planned and what its status is**; `docs/` owns **what happened and why**.
This skill checks the two still agree, and plans from Linear when asked.

## 1. Read Linear

```
list_issues  project: "FPL-App", limit: 250, includeArchived: true,
             fields: ["id","title","status","statusType","priority","projectMilestone","labels","updatedAt","archivedAt"]
```

`includeArchived` matters: closed issues are archived to stay under the free plan's 250-issue cap
(`scripts/linear-archive.ts`), and without it every Shipped row reads as "doc item with no issue".
An archived issue is closed, not drift.

Optionally `get_project` with `includeMilestones: true` when milestone dates matter.

## 2. Compare against the repo

- `docs/linear.md` — the Shipped, Canceled and Open tables. Every issue should appear in exactly one.
- `docs/roadmap.md` — the sprint index, "Next up" and "Blocked, with reasons".

## 3. Report drift, in both directions

Say both of these explicitly, and separately — a one-sided report is how the two halves silently
diverge:

- **Linear → docs.** Issues added, re-prioritised, re-milestoned or closed in the dashboard that
  the docs don't reflect. This is the direction that matters most: the dashboard is where the
  owner plans, so a change here is an instruction, not an inconsistency.
- **Docs → Linear.** Open items in `roadmap.md` with no issue, or issues pointing at a doc path
  that no longer exists.

Report "no drift" plainly when there is none. Do not pad it.

## 4. When asked to plan

**If the ask is "start a sprint", that is `/start-sprint`, not this skill.** This one reconciles and
proposes; that one reads the Todo column, reads each candidate's comments and gate, and on approval
writes the sprint into existence. Don't do its job here.

Propose the next sprint from the **Linear backlog's own priority and milestone order**, not from
`roadmap.md`'s narrative order. For each candidate, name the gate its doc states and say plainly
when that gate is not yet met — a data-blocked item stays blocked; do not plan around it or
narrow it. The milestones' target dates in Linear (`get_project` with `includeMilestones: true`)
are the schedule.

## 5. Never write silently

Status changes, new issues and closures are outward-facing writes. List what you propose to
change and get approval first. Then apply both halves — the Linear write **and** the
`docs/linear.md` row — or the next run reports the half you skipped as drift.
