#!/usr/bin/env bash
# Every backgrounded job in a hook must redirect stdout on the backgrounded unit itself.
#
# Claude Code reads a hook's stdout to EOF. A backgrounded job that still holds that stdout keeps
# the stream open after the hook's JSON, and Claude Code refuses an injecting hook whose stream
# went quiet before end-of-stream: 25 blocked edits (harness diagnosis item 3, #1650). A redirect
# INSIDE a backgrounded `{ …; } &` group covers only the inner command, so the group's subshell
# still holds stdout. The written rule in the 07-10 solution doc
# (docs/solutions/logic-errors/backgrounded-child-holds-command-substitution-pipe-2026-07-10.md)
# passed that line once already; this check is the mechanical version.
#
# The rule, per line that backgrounds something (a lone `&`, not `&&`, `&>`, `>&`):
#   - `{ …; } … &` or `( … ) … &`: the text between the closing brace and `&` must redirect stdout;
#   - otherwise (a command or pipeline): the last pipeline element must redirect stdout.
# Stdout counts as redirected by `>file`, `>>file`, `1>file`, `&>file` — not `2>`, and not `>&2`
# (that hands it to stderr, which is read too).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAIL=0
pass() { echo "ok: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

STDOUT_REDIR='(^|[[:space:]])(1?>>?|&>>?)[[:space:]]*[^&[:space:]]'
ONLY_REDIRS='^([[:space:]]*([0-9]?[<>]>?|&>>?)[[:space:]]*[^[:space:]]+)*[[:space:]]*$'

# Prints "<line no>: <line>" for each backgrounding line whose job keeps stdout. Reads a file.
offenders() {
  local n=0 line s tail
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line#"${line%%[![:space:]]*}"}"        # leading whitespace
    case "$line" in \#*) continue ;; esac
    [[ "$line" =~ ^(.*[^[:space:]])[[:space:]]+\# ]] && line="${BASH_REMATCH[1]}"   # trailing comment
    # A background `&`: not part of &&, &>, >&, <&, |&; followed by end, `;`, `#` or space+word.
    # Greedy `.*` captures everything before the LAST such `&` (a string cut at the first " &"
    # would stop inside `&>file`).
    [[ "$line" =~ ^(.*[^&<>|])?\&([[:space:]]*$|[[:space:]]*[;#]|[[:space:]]+[a-z]) ]] || continue
    s="${BASH_REMATCH[1]}"
    tail="${s##*|}"
    if [[ "$s" =~ [\}\)]([^\}\)]*)$ ]]; then
      local after="${BASH_REMATCH[1]}"   # saved: the next =~ overwrites BASH_REMATCH
      [[ "$after" =~ $ONLY_REDIRS ]] && tail="$after"
    fi
    [[ "$tail" =~ $STDOUT_REDIR ]] || printf '%s: %s\n' "$n" "$line"
  done < "$1"
}

# --- Controls: the shapes measured in #1650 (EOF timed with `sleep 3` in the background). ---
FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
cat > "$FIX/bad.sh" <<'EOF'
{ printf x | sleep 3 >/dev/null 2>&1; } &
{ printf '%s' "$LOG_TSV" | bash "$LOG_SCRIPT" >/dev/null 2>&1; } &
( sleep 3 >/dev/null 2>&1 ) &
sleep 3 &
sleep 3 2>/dev/null &
sleep 3 >&2 &
printf x | sleep 3 &
{ sleep 3 >/dev/null; } & disown
    { sleep 3 >/dev/null; } &   # indented, trailing comment
EOF
cat > "$FIX/good.sh" <<'EOF'
printf x | sleep 3 >/dev/null 2>&1 &
sleep 3 >/dev/null 2>&1 &
{ printf x | sleep 3; } >/dev/null 2>&1 </dev/null &
( sleep 3 ) >/dev/null 2>&1 &
sleep 3 &>/dev/null &
sleep 3 >>"$LOG" 2>&1 &
{ sleep 3; } >/dev/null 2>&1 & disown
[ -n "$x" ] && echo y >&2
a && b
echo "c == \"&\" || d"
# { sleep 3; } &   (a comment)
      emit_effective()     # the verb: emit & stop
EOF
BAD_N=$(wc -l < "$FIX/bad.sh" | tr -d ' ')
BAD_HIT=$(offenders "$FIX/bad.sh" | wc -l | tr -d ' ')
[ "$BAD_HIT" = "$BAD_N" ] && pass "control: all $BAD_N held-stdout shapes flagged" \
  || { fail "control: flagged $BAD_HIT of $BAD_N held-stdout shapes"; offenders "$FIX/bad.sh"; }
GOOD_HIT=$(offenders "$FIX/good.sh")
[ -z "$GOOD_HIT" ] && pass "control: no detached or non-background shape flagged" \
  || fail "control: safe shapes flagged — $GOOD_HIT"

# The two hooks as they were before #1650 must be caught (skipped in a shallow clone without it).
for f in .claude/hooks/inject-patterns.sh .claude/hooks/session-recent-issues.sh; do
  if git -C "$ROOT" show "4139660e:$f" > "$FIX/pre.sh" 2>/dev/null; then
    [ -n "$(offenders "$FIX/pre.sh")" ] && pass "pre-#1650 $f flagged" \
      || fail "pre-#1650 $f not flagged"
  else
    echo "skip: pre-#1650 $f (commit 4139660e not in this clone)"
  fi
done

# --- The real hooks. ---
SCANNED=0 LINES=0
for f in "$ROOT"/.claude/hooks/*.sh "$ROOT"/.claude/hooks/lib/*.sh; do
  [ -f "$f" ] || continue   # an unmatched glob stays literal
  case "${f##*/}" in test-*|repro-*) continue ;; esac
  SCANNED=$((SCANNED + 1))
  BG=$(grep -cE '(^|[^&<>|])&([[:space:]]*$|[[:space:]]*[;#]|[[:space:]]+[a-z])' "$f")
  LINES=$((LINES + BG))
  HIT=$(offenders "$f")
  [ -z "$HIT" ] || fail "${f#"$ROOT"/} backgrounds a job that keeps the hook's stdout open — put the redirect on the backgrounded unit (\`{ …; } >/dev/null 2>&1 </dev/null &\`):
$HIT"
done
# 31 hooks on 2026-10-31; a scan that finds a handful means the glob or ROOT is wrong.
[ "$SCANNED" -ge 20 ] && pass "scanned $SCANNED hook files, $LINES candidate background lines" \
  || fail "scanned only $SCANNED hook files under $ROOT/.claude/hooks — wrong root?"

[ "$FAIL" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
