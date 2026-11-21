# GEMINI.md

The rules for this folder are in [AGENTS.md](AGENTS.md). Read it first and follow it; it applies to every agent, including Gemini and Antigravity.

You work from a brief in `plans/agents/briefs/` and write only in your lane (`plans/agents/<your-name>/`) and the folders the brief assigns. Never edit `sources/`, `wiki/`, `log.md` or `wiki/.manifest.json`. Put `author`, `model` and `status: draft` in the frontmatter of anything you write. Return work with a `HANDOFF-<topic>.md` (first line `STATUS: DONE | NEEDS-DECISION | BLOCKED`). Commit only to your own `agent/<name>/<topic>` branch; never push, merge, delete branches or edit git config. If a git command is refused, stop and write a `STATUS: BLOCKED` handoff; do not look for a way around it.

If your model is not on the analysis list in `plans/agents/ROLES.md`, return only code, raw outputs with hashes, run logs, test output, error text and the status handoff: no analysis, wiki or report text, and no decision candidates.

No hooks run for you: start with `python tools/pb.py start`, finish with `python tools/pb.py end` only if you are the main session (lane agents skip `end`).
