#!/usr/bin/env bash
# Static guard: in a hook self-test, a `grep`/`egrep`/`fgrep` whose needle is a DOUBLE-QUOTED
# variable, on one line, must pass `--` before it.
#
# That is narrower than the rule it defends, deliberately — see RESIDUALS at the bottom of this
# header. Shell parsing by regex has a real ceiling, and widening further would endanger the
# property the whole gate rests on: `grep -qF -- "$needle"` must keep being ACCEPTED. A gate
# that flags compliant files gets deleted by the next person it inconveniences.
#
# Why this is a gate and not a style nit: `grep -qF "$needle"` parses a needle beginning with
# `-` as an OPTION. grep prints `grep: unrecognized option ...` and exits 2 — and `if grep -q
# ...` reads any non-zero as "not found", the same branch a genuine no-match takes. A
# `assert_not_contains` built on that reports PASS **without ever searching**, permanently.
# The exposure is asymmetric: a positive assertion degrades to FAIL (someone investigates), a
# negative one degrades to a silent, permanent green.
#
# Full write-up: docs/solutions/logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md
#
# Scope is deliberately `.claude/hooks/test-*.sh` — the assert-helper population. Production
# scripts (e.g. scripts/todo-automerge-guard.sh) pass hardcoded alternation constants that can
# never begin with `-`; widening there would be churn, not safety.
#
# RESIDUALS — shapes this does NOT catch, all failing OPEN. Zero instances exist in the scanned
# population today (verified); they are recorded so nobody mistakes this gate for total coverage:
#   1. an UNQUOTED needle          — `grep -qF $needle`      (the regex requires a literal `"`)
#   2. a long option with a quoted or glob argument — `grep --include='*.md' -qF "$needle"`
#      (the flag-word class excludes `'` and `*`, so the whole line stops matching)
#   3. a needle on a CONTINUATION line — the scan is per-line
# Adding a case here means adding its fixture to the FIXTURES heredoc below, never widening the
# regex alone: an unproven widening is the decoration this gate exists to prevent.
#
# It also over-flags `grep -e "$needle"`, which is already safe (`-e` consumes its argument as
# the pattern regardless of a leading dash). Over-flagging is the harmless direction — the fix
# is a redundant `--`, not a bypass.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$(basename "${BASH_SOURCE[0]}")"
PASS=0; FAIL=0
ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; [ $# -gt 1 ] && printf '  %s\n' "$2"; FAIL=$((FAIL+1)); }

# THE matcher. Used for the tree scan AND both controls, so the controls exercise identical
# logic — a re-typed copy would only prove the copy works (per
# docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md).
#
# `grep`/`egrep`/`fgrep`, then any number of flag words, then a double-quoted expansion.
# The `--` form is excluded for free: both flag alternatives require a character after the
# dashes, so neither can consume a bare `--`, and the needle then no longer sits immediately
# after the flags. `egrep`/`fgrep` are covered because they are the reflexive substitution a
# contributor reaches for when "fixing" a flagged `grep -E`/`grep -F` — silently reproducing
# the bug one level down is exactly the failure this gate exists to stop.
#
# `(^|[^[:alnum:]_])` is a hand-rolled word boundary rather than `\b` because `\b` is a GNU
# extension POSIX ERE does not define — the same portability reason recorded in
# docs/solutions/design-patterns/facade-only-enforced-by-source-grep-guard-test-2026-06-26.md.
# (It is NOT that BSD grep mis-parses it: BSD grep 2.6.0-FreeBSD implements `\b` correctly —
# verified. The `pgrep -P "$PID"` false positive this hit on its first run came from having no
# LEADING boundary at all, which `\bgrep\b` would also have fixed.)
NEEDLE_RE='(^|[^[:alnum:]_])(e|f)?grep( +-[A-Za-z]+| +--[A-Za-z0-9=_.-]+)* +"\$'
offenders_in() { grep -nE -- "$NEEDLE_RE" "$@" 2>/dev/null || true; }

# --- Control 1 (positive): the matcher MUST flag every broken shape it claims to cover. ------
# Fixtures live in temp files, never inline: this file is itself inside the scanned glob, and
# an inline fixture would self-match and make the tree scan below permanently red.
# One fixture per covered shape — a widened regex with no widened control is the same
# decoration this gate exists to prevent.
CTRL=$(mktemp -d); trap 'rm -rf "${CTRL:-}"' EXIT
i=0
while IFS= read -r fixture; do
  [ -n "$fixture" ] || continue
  i=$((i+1))
  printf '%s\n' "$fixture" > "$CTRL/broken$i.sh"
  if [ -n "$(offenders_in "$CTRL/broken$i.sh")" ]; then
    ok "matcher flags: $fixture"
  else
    bad "matcher did NOT flag: $fixture — the tree scan below proves less than it claims" \
        "regex: $NEEDLE_RE"
  fi
done <<'FIXTURES'
  if grep -qF "$needle" <<<"$out"; then
  if egrep -q "$needle" <<<"$out"; then
  if fgrep -q "$needle" <<<"$out"; then
  if grep --color -qF "$needle" <<<"$out"; then
HITS=$(grep -nE "$RE" "$f")
FIXTURES

# The boundary must still reject a command that merely ENDS in `grep` — the false positive
# this gate hit on its own first run (`pgrep -P "$WRAPPER_PID"` in test-db-serial-lock.sh).
printf '%s\n' '  PSQL_PID=$(pgrep -P "$WRAPPER_PID" 2>/dev/null)' > "$CTRL/pgrep.sh"
if [ -z "$(offenders_in "$CTRL/pgrep.sh")" ]; then
  ok "matcher rejects pgrep (word-boundary control)"
else
  bad "matcher flagged pgrep — the leading word boundary is broken"
fi

# --- Control 2 (negative): the matcher must NOT flag the fixed form. -------------------------
# Without this, a matcher that flags everything would also pass Control 1.
printf '%s\n' '  if grep -qF -- "$needle" <<<"$out"; then' > "$CTRL/fixed.sh"
if [ -z "$(offenders_in "$CTRL/fixed.sh")" ]; then
  ok "matcher accepts the guarded form (negative control)"
else
  bad "matcher flagged the CORRECT form — it would fail every compliant file"
fi

# --- Non-vacuity: the scan must have files to search. ----------------------------------------
# A glob that matches nothing produces the same empty offender list as a clean tree.
FILES=()
for f in "$HERE"/test-*.sh; do
  [ -f "$f" ] || continue
  # Skip self: this file's source necessarily SPELLS the offending shape (the regex, the
  # fixture strings), so scanning it would be permanently red. Control 1 proves the MATCHER
  # works — it does not prove this file's own real code complies. That residual is a genuine
  # blind spot: an unguarded `grep ... "$var"` introduced into this file's live logic would
  # be caught by nothing. Keep `offenders_in` (line ~43) the only grep here, and keep it `--`.
  [ "$(basename "$f")" = "$SELF" ] && continue
  FILES+=("$f")
done
# `-gt 5`, not `-gt 0`: a known-minimum floor is stronger than bare fail-on-zero (per
# docs/solutions/logic-errors/glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md).
# 5 is a floor with wide margin against the ~31 files present today, not a required count —
# it exists to catch a broken glob, so lower it only if the suite genuinely shrinks.
if [ "${#FILES[@]}" -gt 5 ]; then
  ok "scan population is non-empty (${#FILES[@]} hook self-tests)"
else
  bad "scan found only ${#FILES[@]} files — glob is broken, a clean result would be meaningless"
fi

# --- The gate. -------------------------------------------------------------------------------
if [ "${#FILES[@]}" -gt 0 ]; then
  HITS=$(offenders_in "${FILES[@]}")
  if [ -z "$HITS" ]; then
    ok "no unguarded variable needle in any hook self-test"
  else
    bad "unguarded variable needle(s) — add \`--\` before the needle:" \
        "$(printf '%s' "$HITS" | sed "s|$HERE/||")"
  fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
