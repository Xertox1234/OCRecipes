#!/usr/bin/env bash
# Tests scripts/preflight.sh --fast conditional pass-stamp:
#   - changed TS + Postgres reachable   → tests run    → STAMP written.
#   - changed TS + Postgres unreachable → tests skipped → NO stamp (guard stays blocking).
#   - no changed TS (docs only)         → no tests needed → STAMP written.
#   - changed hook/husky file + hook self-tests PASS → STAMP written.
#   - changed hook/husky file + hook self-tests FAIL → NO stamp (guard stays blocking).
#   - DELETED hook/husky file + hook self-tests FAIL → NO stamp (the probe must catch
#     deletions too, not just add/modify — a deletion needs --diff-filter=ACDMR, not ACMR).
#   - TYPECHANGED hook file (swapped for a symlink at the same path) + hook self-tests
#     FAIL → NO stamp (the probe's ACDMRT filter must catch T, not just ACDMR).
#   - changed scripts/*.sh file (NOT under .claude/hooks/) + hook self-tests FAIL → NO
#     stamp (the probe must also cover scripts/*.sh — e.g. run-hook-tests.sh itself, or
#     scripts/lib/preflight-stamp-path.sh — not just .claude/hooks/ and .husky/).
# DRY_RUN so eslint/tsc/vitest are echoed not executed; pg_isready is STUBBED to control
# reachability; PREFLIGHT_STAMP_FILE is a throwaway per run. The hook-change cases run for
# REAL (no DRY_RUN) instead: DRY_RUN would just echo `run bash scripts/run-hook-tests.sh`
# without executing it, defeating the pass/fail assertion — so those cases stub `npm` (via
# PATH) and the repo-relative `scripts/run-hook-tests.sh` (a literal path, not PATH-resolved)
# instead of relying on DRY_RUN.
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

npm_stub() { # no-op npm (exit 0) so build:copilot-instructions:check / check:types succeed
  cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$BIN/npm"
}

make_repo() { # $1 = "ts" (changed .ts) | "none" (docs only) | "hook" (changed .claude/hooks/*.sh)
                #    | "hookdel" (commit B DELETES a hook file added in an earlier commit)
                #    | "hooktype" (commit B swaps a hook file for a symlink at the same path)
  local d; d=$(mktemp -d)
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
  case "$1" in
    ts)   echo "export const x = 1" > "$d/foo.ts"; git -C "$d" add foo.ts ;;
    hook) mkdir -p "$d/.claude/hooks"; echo "echo hi" > "$d/.claude/hooks/foo.sh"; git -C "$d" add .claude/hooks/foo.sh ;;
    hookdel)
      mkdir -p "$d/.claude/hooks"; echo "echo hi" > "$d/.claude/hooks/foo.sh"
      git -C "$d" add .claude/hooks/foo.sh
      git -C "$d" -c user.email=t@t -c user.name=t commit -q -m "add hook"
      git -C "$d" rm -q .claude/hooks/foo.sh
      ;;
    hooktype)
      mkdir -p "$d/.claude/hooks"; echo "echo hi" > "$d/.claude/hooks/foo.sh"
      git -C "$d" add .claude/hooks/foo.sh
      git -C "$d" -c user.email=t@t -c user.name=t commit -q -m "add hook"
      rm "$d/.claude/hooks/foo.sh"
      ln -s /dev/null "$d/.claude/hooks/foo.sh"
      git -C "$d" add .claude/hooks/foo.sh
      ;;
    scriptssh)
      mkdir -p "$d/scripts"; echo "echo hi" > "$d/scripts/some-other-tool.sh"
      git -C "$d" add scripts/some-other-tool.sh
      ;;
    *)    echo "hello" > "$d/note.md"; git -C "$d" add note.md ;;
  esac
  git -C "$d" -c user.email=t@t -c user.name=t commit -q -m B
  printf '%s' "$d"
}

run_fast() { # $1 repo → runs --fast (DRY_RUN) with the pg stub + throwaway stamp; echoes stamp path
  local repo stamp; repo="$1"; stamp="$repo/.stamp"
  ( cd "$repo" && PATH="$BIN:$PATH" PREFLIGHT_DRY_RUN=1 PREFLIGHT_STAMP_FILE="$stamp" bash "$SCRIPT" --fast >/dev/null 2>&1 )
  printf '%s' "$stamp"
}

hook_test_stub() { # $1 = repo dir, $2 = exit code scripts/run-hook-tests.sh returns
  mkdir -p "$1/scripts"
  cat > "$1/scripts/run-hook-tests.sh" <<EOF
#!/usr/bin/env bash
exit $2
EOF
  chmod +x "$1/scripts/run-hook-tests.sh"
}

run_fast_real() { # $1 repo → runs --fast for REAL (npm stubbed, no DRY_RUN); echoes stamp path
  local repo stamp; repo="$1"; stamp="$repo/.stamp"
  ( cd "$repo" && PATH="$BIN:$PATH" PREFLIGHT_STAMP_FILE="$stamp" bash "$SCRIPT" --fast >/dev/null 2>&1 )
  printf '%s' "$stamp"
}

assert_stamp()    { if [ -f "$2" ]; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (no stamp written)"; FAIL=$((FAIL+1)); fi; }
assert_no_stamp() { if [ -f "$2" ]; then echo "FAIL: $1 (stamp WAS written)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }

pg_stub 0; R=$(make_repo ts);   S=$(run_fast "$R"); assert_stamp    "ts + pg up → stamp"            "$S"; rm -rf "$R"
pg_stub 3; R=$(make_repo ts);   S=$(run_fast "$R"); assert_no_stamp "ts + pg down → NO stamp"        "$S"; rm -rf "$R"
pg_stub 3; R=$(make_repo none); S=$(run_fast "$R"); assert_stamp    "docs-only → stamp (pg irrelevant)" "$S"; rm -rf "$R"

npm_stub
R=$(make_repo hook);    hook_test_stub "$R" 0; S=$(run_fast_real "$R"); assert_stamp    "hook changed + hook tests PASS → stamp"       "$S"; rm -rf "$R"
R=$(make_repo hook);    hook_test_stub "$R" 1; S=$(run_fast_real "$R"); assert_no_stamp "hook changed + hook tests FAIL → NO stamp"    "$S"; rm -rf "$R"
R=$(make_repo hookdel); hook_test_stub "$R" 1; S=$(run_fast_real "$R"); assert_no_stamp "hook DELETED + hook tests FAIL → NO stamp" "$S"; rm -rf "$R"
R=$(make_repo hookdel); hook_test_stub "$R" 0; S=$(run_fast_real "$R"); assert_stamp    "hook DELETED + hook tests PASS → stamp"    "$S"; rm -rf "$R"
R=$(make_repo hooktype); hook_test_stub "$R" 1; S=$(run_fast_real "$R"); assert_no_stamp "hook TYPECHANGED (symlink swap) + hook tests FAIL → NO stamp" "$S"; rm -rf "$R"
R=$(make_repo hooktype); hook_test_stub "$R" 0; S=$(run_fast_real "$R"); assert_stamp    "hook TYPECHANGED (symlink swap) + hook tests PASS → stamp"    "$S"; rm -rf "$R"
R=$(make_repo scriptssh); hook_test_stub "$R" 1; S=$(run_fast_real "$R"); assert_no_stamp "scripts/*.sh changed (outside .claude/hooks) + hook tests FAIL → NO stamp" "$S"; rm -rf "$R"
R=$(make_repo scriptssh); hook_test_stub "$R" 0; S=$(run_fast_real "$R"); assert_stamp    "scripts/*.sh changed (outside .claude/hooks) + hook tests PASS → stamp"    "$S"; rm -rf "$R"

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
