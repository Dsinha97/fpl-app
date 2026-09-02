---
name: engine-verify
description: Scaffold, run, and clean up a throwaway npx tsx harness to verify an xP/scoring/optimizer engine change against real data before trusting the UI. Use when asked to "verify the model change", "test the engine", "sanity check the xP numbers", or after editing lib/scoring.ts, lib/squad-score.ts, lib/transfer-optimizer.ts, or similar.
---

# Engine Verify

CLAUDE.md gotcha: two optimizer bugs shipped past code review and were only caught by
running the real module against live data in a harness, not by reading the diff. Do this
for every scoring/optimizer/xP change before trusting the UI to reveal a problem.

## Procedure

1. Copy `harness-template.ts` to the session scratchpad (NOT inside the repo — never
   commit this file) and fill in the import of the specific function under test.
2. Fill in real inputs — pull actual player/squad/gameweek data (via the Supabase MCP if
   needed). Don't invent fixture data; that's exactly what let the prior bugs slip through.
3. Run it with `npx tsx <scratch-path>` and print the actual output values, not just
   "ran without error."
4. Compare before/after numbers against what you expect from the code change.
5. Delete the scratch file when done.
