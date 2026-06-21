#!/usr/bin/env bash
# Tests for `scripts/preflight.sh --staged` branching (the pre-commit gate).
# Hermetic: runs in a temp git repo with PREFLIGHT_DRY_RUN=1 so the script ECHOES
# the commands it would run instead of executing real eslint/tsc/vitest. Asserts the
# DECISION (what runs for a given staged set), not the tools themselves.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/preflight.sh"
PASS=0; FAIL=0

# run_staged "path:content" ... → output of the gate (dry-run) with those files staged.
run_staged() {
  local repo out spec name content
  repo=$(mktemp -d)
  git -C "$repo" init -q
  git -C "$repo" config user.email t@t; git -C "$repo" config user.name t
  echo seed > "$repo/seed.txt"; git -C "$repo" add seed.txt; git -C "$repo" commit -qm seed
  for spec in "$@"; do
    name="${spec%%:*}"; content="${spec#*:}"
    mkdir -p "$repo/$(dirname "$name")"
    printf '%s\n' "$content" > "$repo/$name"
    git -C "$repo" add "$name"
  done
  out=$( cd "$repo" && PREFLIGHT_DRY_RUN=1 bash "$SCRIPT" --staged 2>&1 )
  rm -rf "$repo"
  printf '%s' "$out"
}

assert_runs() {   # name needle out
  # `--` ends grep options so a needle starting with `--` (e.g. --exclude) is a pattern.
  if printf '%s' "$3" | grep -qF -- "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected to run: $2)"; printf '  got: %s\n' "$3"; FAIL=$((FAIL+1)); fi
}
assert_skips() {  # name needle out
  if printf '%s' "$3" | grep -qF -- "$2"; then echo "FAIL: $1 (should NOT run: $2)"; printf '  got: %s\n' "$3"; FAIL=$((FAIL+1));
  else echo "PASS: $1"; PASS=$((PASS+1)); fi
}

# 1. Staged .ts → eslint + incremental tsc + vitest(unit) all run on it.
OUT=$(run_staged "server/foo.ts:export const x = 1")
assert_runs  "ts: eslint runs on the file"    "eslint server/foo.ts" "$OUT"
assert_runs  "ts: incremental tsc runs"       "check:types:incremental" "$OUT"
assert_runs  "ts: vitest related runs"        "vitest related --run server/foo.ts" "$OUT"
assert_runs  "ts: integration tests excluded" "--exclude server/storage/__tests__/**" "$OUT"

# 2. Docs-only → nothing runs.
OUT=$(run_staged "docs/note.md:hello")
assert_skips "md: no eslint"  "eslint"       "$OUT"
assert_skips "md: no tsc"     "check:types"  "$OUT"
assert_skips "md: no vitest"  "vitest"       "$OUT"

# 3. JSON-only → tsc runs (resolveJsonModule), no eslint/vitest (no .ts staged).
OUT=$(run_staged "client/data.json:{}")
assert_runs  "json: incremental tsc runs" "check:types:incremental" "$OUT"
assert_skips "json: no eslint"            "eslint" "$OUT"
assert_skips "json: no vitest"            "vitest" "$OUT"

echo ""; echo "Results: $PASS passed, $FAIL failed"; [ $FAIL -eq 0 ]
