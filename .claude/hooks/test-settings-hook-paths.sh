#!/usr/bin/env bash
# Tests that every hook registration in .claude/settings.json locates its script by
# ABSOLUTE path via $CLAUDE_PROJECT_DIR, not a cwd-relative one.
#
# Why this test exists: hook handlers "run in the current directory" (Claude Code hooks
# docs). A relative `bash .claude/hooks/<name>.sh` therefore only resolves while cwd is
# the repo root. The Bash tool's cwd PERSISTS across calls, so a single `cd` into any
# subdirectory made every hook fail with `No such file or directory`. Those failures are
# non-blocking, so git-safety.sh and guard-worktree-isolation.sh simply DID NOT RUN —
# a `cd` silently disarmed the whole guardrail chain built across PRs #663-#678.
#
# Worse than the noise: the relative form selected the gate script BY CWD, so whatever
# `.claude/hooks/<name>.sh` happened to sit under the agent's current directory would be
# trusted to emit the allow/deny verdict. $CLAUDE_PROJECT_DIR removes cwd from script
# selection entirely.
#
# The static checks below stop a new hook from reintroducing a relative registration.
# The behavioral checks are two-sided on purpose: a green result on the absolute form
# proves nothing unless the relative form is also shown to FAIL from the same directory,
# which is what demonstrates the test reproduces the original bug at all.
#
# Kept free of bash-4 builtins (mapfile/declare -A) like its sibling hook tests — macOS
# ships bash 3.2, so a bash-4-only test would pass in CI and break every local run.
#
# Run by CI (Lint · Types · Patterns job).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SETTINGS="$ROOT/.claude/settings.json"
GUARD="git-safety.sh"          # the gate whose firing is asserted below
PASS=0; FAIL=0
ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; [ $# -gt 1 ] && echo "  $2"; FAIL=$((FAIL+1)); }

# The documented per-command bypass would turn the behavioral assertions below into a
# false RED, and the tempting "fix" for that is to weaken them. Drop it up front, the way
# scripts/run-hook-tests.sh strips inherited GIT_* state.
unset SKIP_WORKTREE_CONTRACT

command -v jq >/dev/null || { echo "SKIP: jq unavailable"; exit 0; }
[ -f "$SETTINGS" ] || { echo "FAIL: $SETTINGS not found"; exit 1; }

# Every `{"type":"command"}` string registered anywhere in the settings tree, one per
# line in a temp file (rather than an array) to stay bash-3.2 clean under `set -u`.
# jq DECODES the JSON strings, so these carry real quotes, not the file's escaped ones.
CMD_FILE=$(mktemp "${TMPDIR:-/tmp}/ocrecipes-hookpaths.XXXXXX")
SESSION="test-hookpaths-$$"
REG_DIR="/tmp/claude-worktree-contracts-$SESSION"
trap 'rm -f "$CMD_FILE"; rm -rf "$REG_DIR"' EXIT

jq -r '[.. | objects | select(.type? == "command") | .command?]
       | map(select(. != null)) | .[]' "$SETTINGS" > "$CMD_FILE"
TOTAL=$(grep -c . "$CMD_FILE" || true)
[ "$TOTAL" -gt 0 ] || { echo "FAIL: no command entries parsed from $SETTINGS"; exit 1; }

# ---------- static: every registration names its script absolutely ----------
# Judged generically on the script token, NOT by pre-filtering for `.claude/hooks/`: a
# future `bash scripts/check-foo.sh` has the identical silent-disarm defect and must fail
# this test too.
BADPATH=""
while IFS= read -r c; do
  [ -n "$c" ] || continue
  case "$c" in                                  # strip an optional interpreter word
    bash\ *|sh\ *|node\ *|python3\ *) arg=${c#* } ;;
    *) arg=$c ;;
  esac
  case "$arg" in
    '"$CLAUDE_PROJECT_DIR'*|'"${CLAUDE_PROJECT_DIR}'*|/*|'"/'*) ;;   # absolute — fine
    *) BADPATH="$BADPATH$c"$'\n' ;;
  esac
done < "$CMD_FILE"
if [ -z "$BADPATH" ]; then
  ok "all $TOTAL command entries name their script by absolute path"
else
  bad "$(printf '%s' "$BADPATH" | grep -c .) registration(s) resolve their script from cwd" \
      "first: $(printf '%s' "$BADPATH" | head -1)"
fi

# The variable must be double-quoted: an unquoted path breaks on a project dir with spaces.
UNQUOTED=$(grep -F 'CLAUDE_PROJECT_DIR' "$CMD_FILE" \
           | grep -vE '"\$\{?CLAUDE_PROJECT_DIR' || true)
if [ -z "$UNQUOTED" ]; then
  ok "every \$CLAUDE_PROJECT_DIR reference is double-quoted"
else
  bad "$(printf '%s\n' "$UNQUOTED" | grep -c .) unquoted \$CLAUDE_PROJECT_DIR reference(s)" \
      "first: $(printf '%s\n' "$UNQUOTED" | head -1)"
fi

# Each referenced hook script must actually exist on disk (catches a typo'd rename).
MISSING=""
while IFS= read -r script; do
  [ -n "$script" ] || continue
  [ -f "$ROOT/$script" ] || MISSING="$MISSING$script"$'\n'
done < <(grep -oE '\.claude/hooks/[A-Za-z0-9._-]+\.sh' "$CMD_FILE" | sort -u)
if [ -z "$MISSING" ]; then
  ok "every registered hook script exists on disk"
else
  bad "registered hook script(s) missing from disk" "first: $(printf '%s' "$MISSING" | head -1)"
fi

# ---------- behavioral: the guard must FIRE from a subdirectory ----------
# A real subdirectory INSIDE the checkout — the shape of the observed incident, where an
# agent cd'd into node_modules/. It must not be /tmp: git-safety.sh allowlists scratch
# dirs, so a /tmp cwd would exercise a different branch than the one that broke.
# `scripts/` is used because it is tracked and always present; node_modules/ is not.
SUBDIR="$ROOT/scripts"
[ -d "$SUBDIR" ] || SUBDIR="$ROOT/.claude/hooks"

# Contract fixture: a declared worktree plus a mutating git command whose cwd lies outside
# it is exactly the shape git-safety.sh denies. Registry paths are fake, and the directory
# is PID-keyed so it cannot collide with a real UUID-keyed session registry.
# Residual: this lives in the same /tmp/claude-worktree-contracts-* namespace git-safety.sh
# globs, so a SIGKILL'd run (trap never fires) leaks a directory that a later session would
# see. Same tradeoff test-git-safety.sh already makes — the fixture must sit in the real
# namespace to be read at all.
WT='/Users/x/projects/OCRecipes/.claude/worktrees/agent-aaa'
MAIN='/Users/x/projects/OCRecipes'
mkdir -p "$REG_DIR"
printf '%s' "$WT" > "$REG_DIR/aaaa000000000001"

PAYLOAD=$(jq -cn --arg s "$SESSION" --arg c "$MAIN" \
  '{tool_name:"Bash",session_id:$s,cwd:$c,tool_input:{command:"git commit -m x"}}')

# Negative control — the OLD relative form. Must NOT produce a deny, because bash cannot
# even find the script from here. If this ever starts denying, the test has stopped
# reproducing the bug and the positive case below is meaningless.
OUT_REL=$( printf '%s' "$PAYLOAD" | (
    cd "$SUBDIR" || exit 1
    bash ".claude/hooks/$GUARD"
  ) 2>&1 )
if printf '%s' "$OUT_REL" | grep -q '"permissionDecision": "deny"'; then
  bad "negative control: relative form unexpectedly fired from $SUBDIR"
else
  ok "negative control: relative form cannot resolve from a subdirectory (the bug)"
fi

# Positive — run the ACTUAL registered string from settings.json, so this asserts against
# the real registration rather than a hand-copied duplicate that could drift from it.
GUARD_HITS=$(grep -cF "$GUARD" "$CMD_FILE")
GS_CMD=$(grep -F "$GUARD" "$CMD_FILE" | head -1)
if [ "$GUARD_HITS" -ne 1 ]; then
  bad "expected exactly 1 $GUARD registration, found $GUARD_HITS" \
      "a second registration would go untested by the assertion below"
else
  # eval reproduces the shell-form expansion the harness performs on the command string.
  # cd + export happen INSIDE the subshell so the hook sees exactly the subdirectory cwd
  # and the project-root variable the harness would hand it.
  OUT_ABS=$( printf '%s' "$PAYLOAD" | (
      cd "$SUBDIR" || exit 1
      export CLAUDE_PROJECT_DIR="$ROOT"
      eval "$GS_CMD"
    ) 2>&1 )
  # Assert the REASON too, not just that something denied: this pins the contract-violation
  # branch, so the test cannot silently start passing via an unrelated deny path.
  if printf '%s' "$OUT_ABS" | grep -q '"permissionDecision": "deny"' \
     && printf '%s' "$OUT_ABS" | grep -qF 'outside every registered worktree'; then
    ok "registered form DENIES a contract violation from a subdirectory (guard actually fires)"
  else
    bad "registered form did not deny-for-contract-violation from $SUBDIR" \
        "got: $(printf '%s' "$OUT_ABS" | head -2)"
  fi
fi

echo "---"
echo "test-settings-hook-paths: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
