---
name: ship-check
description: Run the full pre-commit/pre-push gate — typecheck, lint, build — and report pass/fail per stage. Use before committing or pushing, or when asked to "run the gate", "check before I push", or "ship check".
---

# Ship Check

Runs the three-command gate CLAUDE.md requires before every commit:

```bash
npx tsc --noEmit && npm run lint && npm run build
```

## How it works

Run `scripts/check.sh` — it runs each command separately (not chained with `&&`) so a
failure in an earlier stage doesn't hide whether later stages would also fail, and prints a
PASS/FAIL line per stage plus the tail of any failing stage's output.

## Usage

1. Run `bash .claude/skills/ship-check/scripts/check.sh` from the repo root.
2. Report the PASS/FAIL line for each stage back to the user.
3. If any stage FAILs, fix it and re-run the whole script — don't commit/push until all
   three pass. Don't hand-run the individual commands instead; running them separately is
   exactly what this replaces.
