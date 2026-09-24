#!/usr/bin/env bash
set -uo pipefail

run_stage() {
  local name="$1"; shift
  echo "=== $name ==="
  if output=$("$@" 2>&1); then
    echo "PASS: $name"
    # eslint's real verdict is its "✖ N problems (X errors, Y warnings)" line.
    # The line after it counts only *fixable* problems, and once reported
    # "0 errors" over a run that had one (DSI-77), so surface this one.
    echo "$output" | grep -E "✖ [0-9]+ problems?" || true
  else
    echo "FAIL: $name"
    echo "$output" | tail -n 40
  fi
  echo
}

run_stage "typecheck (tsc --noEmit)" npx tsc --noEmit
run_stage "lint" npm run lint
run_stage "build" npm run build

echo "=== summary ==="
echo "See PASS/FAIL lines above. All three must PASS before commit/push."
