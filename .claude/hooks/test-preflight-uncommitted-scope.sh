#!/usr/bin/env bash
# Tests scripts/preflight.sh --fast --uncommitted: scope the changed-file set off the
# working tree vs HEAD, not committed BASE..HEAD (push-gate semantics) — needed for
# mid-pipeline verification (todo-executor.md Step 5a) where the implementation is not
# yet committed; comparing against origin/main there would see zero changes and
# silently no-op. Also confirms --uncommitted never writes a pass-stamp (the current
# HEAD hasn't received the implementation yet — a stamp for it would certify the wrong
# commit; the real one lands later, at todo-executor.md Step 8).
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/preflight.sh"
PASS=0; FAIL=0
BIN=$(mktemp -d); trap 'rm -rf "$BIN"' EXIT

pg_stub() { # $1 = exit code pg_isready returns (0 = reachable)
  cat > "$BIN/pg_isready" <<EOF
#!/usr/bin/env bash
exit $1
EOF
  chmod +x "$BIN/pg_isready"
}

make_repo_with_uncommitted_ts() {
  local d; d=$(mktemp -d)
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
  echo "export const x = 1" > "$d/foo.ts"
  git -C "$d" add foo.ts   # staged, but NEVER committed — the point of this test
  printf '%s' "$d"
}

make_repo_with_untracked_ts() {
  local d; d=$(mktemp -d)
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
  echo "export const y = 2" > "$d/bar.ts"   # NEVER git add'ed — fully untracked
  printf '%s' "$d"
}

run_dry() { # $1 repo, remaining args = preflight flags. Captures dry-run stdout+stderr.
  local repo; repo="$1"; shift
  ( cd "$repo" && PATH="$BIN:$PATH" PREFLIGHT_DRY_RUN=1 PREFLIGHT_STAMP_FILE="$repo/.stamp" bash "$SCRIPT" "$@" 2>&1 )
}

assert_contains()     { if printf '%s' "$2" | grep -q "$3"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (missing: $3)"; FAIL=$((FAIL+1)); fi; }
assert_not_contains()  { if printf '%s' "$2" | grep -q "$3"; then echo "FAIL: $1 (unexpectedly present: $3)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }
assert_no_stamp_file() { if [ -f "$2" ]; then echo "FAIL: $1 (stamp WAS written)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }

pg_stub 0

R=$(make_repo_with_uncommitted_ts)
OUT=$(run_dry "$R" --fast --uncommitted)
assert_contains     "uncommitted ts file IS scoped in with --uncommitted" "$OUT" "foo.ts"
assert_no_stamp_file "--uncommitted mode never writes a pass-stamp" "$R/.stamp"
rm -rf "$R"

R=$(make_repo_with_uncommitted_ts)
OUT=$(run_dry "$R" --fast)
assert_not_contains "uncommitted ts file is NOT scoped without --uncommitted (push-gate semantics unchanged)" "$OUT" "foo.ts"
rm -rf "$R"

R=$(make_repo_with_untracked_ts)
OUT=$(run_dry "$R" --fast --uncommitted)
assert_contains "wholly untracked ts file IS scoped in with --uncommitted" "$OUT" "bar.ts"
rm -rf "$R"

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
