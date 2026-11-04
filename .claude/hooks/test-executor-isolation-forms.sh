#!/usr/bin/env bash
# The todo-executor's shell snippets must use forms Claude Code's worktree isolation accepts.
#
# The executor runs in an isolated worktree. Claude Code refuses a command there when it can't prove
# from the text that it stays inside: any `$` value in a command that names git (except a quoted
# heredoc, `"$(cat <<'EOF'`), `bash -c`, and sourcing a file. Measured in isolated agents on
# 2026-10-31; 452 refusals in the 20 days before (harness diagnosis item 2). Snippets that broke
# these rules were copied into commands and refused, so this check keeps the snippets clean.
#
# Scope: lines inside ```bash, ```sh and unlabeled fences of .claude/agents/todo-executor.md. A line
# is checked on its own; a command split over lines with git on one and `$` on another is missed.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAIL=0
pass() { echo "ok: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

# Prints "<line no>: <line>" for each fenced shell line isolation would refuse. Reads a file.
offenders() {
  awk '
    /^[[:space:]]*```/ {
      if (inb) { inb = 0 } else { inb = 1; lang = $0; sub(/^[[:space:]]*```/, "", lang) }
      next
    }
    inb && (lang == "bash" || lang == "sh" || lang == "") {
      line = $0
      gsub(/"\$\(cat <<'\''EOF'\''/, "", line)             # a quoted heredoc value is provable
      bad = 0
      if (line ~ /(^|[^[:alnum:]_.-])git([[:space:]]|$)/ && line ~ /\$[[:alnum:]_({?]/) bad = 1
      if (line ~ /(^|[;&|[:space:]])bash[[:space:]]+-c([[:space:]]|$)/) bad = 1
      if (line ~ /(^|[;&|][[:space:]]*|^[[:space:]]*)\.[[:space:]]+[^[:space:]]/) bad = 1
      if (bad) print NR ": " $0
    }
  ' "$1"
}

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
# Each bad line is a form an isolated agent was refused for (probe of 2026-10-31).
cat > "$FIX/bad.md" <<'EOF'
```bash
git ls-remote --heads origin main; echo ls=$?
X=$(git rev-parse HEAD); echo $X
bash scripts/declare-worktree.sh "$(git rev-parse --show-toplevel)"
/usr/bin/git rev-parse HEAD; X=1; echo $X
git reset --mixed "$BASE"
bash -c 'git rev-parse HEAD'
. .claude/hooks/lib/review-stamp-path.sh && review_stamp_dir abc
```
```
DIR=$( cd "$WORKTREE" && . .claude/hooks/lib/review-stamp-path.sh && review_stamp_dir "$HEAD_SHA" )
```
EOF
cat > "$FIX/good.md" <<'EOF'
```bash
git rev-parse HEAD && git rev-parse --abbrev-ref HEAD
git rev-parse HEAD | cut -c1-7
git -C /abs/worktree rev-parse HEAD
git commit -m "$(cat <<'EOF'
SENS=$(grep -m1 '^X=' scripts/todo-automerge-guard.sh | cut -d= -f2-)
bash scripts/review-record-status.sh 42
git reset --mixed <BASE>
```
```yaml
note: "git $x is fine outside shell fences"
```
Prose: run `git diff "$BASE"...HEAD` is outside a fence.
EOF
BAD_N=$(grep -cvE '^```' "$FIX/bad.md")
BAD_HIT=$(offenders "$FIX/bad.md" | wc -l | tr -d ' ')
[ "$BAD_HIT" = "$BAD_N" ] && pass "control: all $BAD_N refused forms flagged" \
  || { fail "control: flagged $BAD_HIT of $BAD_N refused forms"; offenders "$FIX/bad.md"; }
GOOD_HIT=$(offenders "$FIX/good.md")
[ -z "$GOOD_HIT" ] && pass "control: accepted forms and non-shell text not flagged" \
  || fail "control: accepted forms flagged — $GOOD_HIT"

# The executor before this change must be caught (skipped in a shallow clone without the commit).
if git -C "$ROOT" show "00bd9bb3:.claude/agents/todo-executor.md" > "$FIX/pre.md" 2>/dev/null; then
  PRE=$(offenders "$FIX/pre.md" | wc -l | tr -d ' ')
  [ "$PRE" -gt 0 ] && pass "pre-change executor: $PRE refused-form lines flagged" \
    || fail "pre-change executor not flagged"
else
  echo "skip: pre-change executor (commit 00bd9bb3 not in this clone)"
fi

EXEC="$ROOT/.claude/agents/todo-executor.md"
if [ ! -f "$EXEC" ]; then
  fail "$EXEC not found — wrong root?"
else
  FENCED=$(awk '/^[[:space:]]*```/{n++} END{print n+0}' "$EXEC")
  [ "$FENCED" -ge 20 ] || fail "only $FENCED fence lines in $EXEC — parse broken?"
  HIT=$(offenders "$EXEC")
  [ -z "$HIT" ] && pass "todo-executor.md: $((FENCED / 2)) fenced blocks, no refused forms" \
    || fail "todo-executor.md has snippets worktree isolation refuses — see its Step 0 'Command forms that worktree isolation accepts':
$HIT"
fi

[ "$FAIL" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
