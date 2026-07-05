#!/usr/bin/env bash
# Tests scripts/preflight.sh --fast conditional pass-stamp:
#   - changed TS + Postgres reachable   → tests run    → STAMP written.
#   - changed TS + Postgres unreachable → tests skipped → NO stamp (guard stays blocking).
#   - no changed TS (docs only)         → no tests needed → STAMP written.
# DRY_RUN so eslint/tsc/vitest are echoed not executed; pg_isready is STUBBED to control
# reachability; PREFLIGHT_STAMP_FILE is a throwaway per run.
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

make_repo() { # $1 = "ts" (changed .ts in commit B) | "none" (docs-only commit B)
  local d; d=$(mktemp -d)
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
  if [ "$1" = "ts" ]; then echo "export const x = 1" > "$d/foo.ts"; git -C "$d" add foo.ts
  else echo "hello" > "$d/note.md"; git -C "$d" add note.md; fi
  git -C "$d" -c user.email=t@t -c user.name=t commit -q -m B
  printf '%s' "$d"
}

run_fast() { # $1 repo → runs --fast (DRY_RUN) with the pg stub + throwaway stamp; echoes stamp path
  local repo stamp; repo="$1"; stamp="$repo/.stamp"
  ( cd "$repo" && PATH="$BIN:$PATH" PREFLIGHT_DRY_RUN=1 PREFLIGHT_STAMP_FILE="$stamp" bash "$SCRIPT" --fast >/dev/null 2>&1 )
  printf '%s' "$stamp"
}

assert_stamp()    { if [ -f "$2" ]; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (no stamp written)"; FAIL=$((FAIL+1)); fi; }
assert_no_stamp() { if [ -f "$2" ]; then echo "FAIL: $1 (stamp WAS written)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }

pg_stub 0; R=$(make_repo ts);   S=$(run_fast "$R"); assert_stamp    "ts + pg up → stamp"            "$S"; rm -rf "$R"
pg_stub 3; R=$(make_repo ts);   S=$(run_fast "$R"); assert_no_stamp "ts + pg down → NO stamp"        "$S"; rm -rf "$R"
pg_stub 3; R=$(make_repo none); S=$(run_fast "$R"); assert_stamp    "docs-only → stamp (pg irrelevant)" "$S"; rm -rf "$R"

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
