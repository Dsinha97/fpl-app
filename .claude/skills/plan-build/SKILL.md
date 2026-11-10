---
name: plan-build
description: Plan a build or change before doing it - run the wiki, history and code retrievers in parallel, then the planner agent, and execute the returned plan. Use for any website, UI, design, feature, model, engine, migration, refactor or docs change; when asked to "plan this", "/plan-build", "how should we build X", "scope this change", or to review or assess a change request before work starts. Skip for one-line tweaks (a colour, a typo, a copy fix).
---

# Plan a build

Subagents cannot start subagents, so this session does the orchestration. The agents live in
`.claude/agents/`: `wiki-retriever`, `history-retriever`, `code-retriever`, `planner`. All are read-only.

## 1. Restate the task

One sentence of goal, plus any deadline (a GW deadline, a sprint date). If the goal is unclear, ask
one short question first. Do not start the agents on a guess.

## 2. Run the three retrievers in parallel

Send all three `Agent` calls in **one message**. Give each the task and a focused question:

- `wiki-retriever`: what the wiki says about the topic, its decisions and gotchas.
- `history-retriever`: the sprint, roadmap and Linear record. Ask for the issue's gate and status,
  and any owner comments that change the requirement.
- `code-retriever`: where the code lives, the callers, and whether an implementation already exists.

Do not paste the full retriever outputs into your own reply. Keep them for step 3.

## 3. Run the planner

Call `planner` with: the task, the three retriever results (verbatim), and the list of skills
available in this session (project, user, plugin and system skills, from the skill listing in your
context). The planner cannot see that listing. If a retriever returned nothing, say so in the
input; do not fill the gap.

## 4. Show the plan, then execute

Show the plan. If it has "Missing inputs" or "Questions for the user", answer those first.
Execute the steps in order, invoking the skills the plan names. Stop at every **Stop point** and
ask the user before continuing. Those are migrations, edge-function deploys, RLS changes,
commits, pushes and PRs.

## Notes

- The planner plans only. It does not invoke skills or edit files.
- If a retriever result conflicts with the planner's plan, trust the retriever's file link and
  re-check the file.
- Keep the user's reply short, per `CLAUDE.md`: the plan, then progress.
