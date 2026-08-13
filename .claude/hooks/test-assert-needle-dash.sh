#!/usr/bin/env bash
# Static guard: in a hook self-test, every `grep` whose needle is a VARIABLE must pass `--`
# before it.
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
# `grep`, then any number of single-dash flag words, then a double-quoted expansion. The `--`
# form is excluded for free: `-[A-Za-z]+` requires a letter after the dash, so the flag-word
# repetition cannot consume `--`, and the needle no longer sits immediately after the flags.
#
# The `(^|[^[:alnum:]_])` prefix is a hand-rolled word boundary, NOT `\b`: `\b` is a GNU
# extension that BSD grep -E (macOS default) silently treats as a literal `b`, which would
# make this matcher quietly match nothing. Without the boundary it also matched `pgrep -P
# "$PID"` in test-db-serial-lock.sh — a real false positive this caught on its first run.
NEEDLE_RE='(^|[^[:alnum:]_])grep( +-[A-Za-z]+)* +"\$'
offenders_in() { grep -nE -- "$NEEDLE_RE" "$@" 2>/dev/null || true; }

# --- Control 1 (positive): the matcher MUST flag the broken form. ---------------------------
# Lives in a temp file, never inline: this file is itself inside the scanned glob, and an
# inline fixture would self-match and make the tree scan below permanently red.
CTRL=$(mktemp -d); trap 'rm -rf "${CTRL:-}"' EXIT
printf '%s\n' '  if grep -qF "$needle" <<<"$out"; then' > "$CTRL/broken.sh"
if [ -n "$(offenders_in "$CTRL/broken.sh")" ]; then
  ok "matcher flags an unguarded variable needle (positive control)"
else
  bad "matcher did NOT flag the broken form — the tree scan below proves nothing" \
      "regex: $NEEDLE_RE"
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
  # Skip self: the controls above write example call sites, and this file's own source
  # necessarily discusses the offending shape. Coverage for that blind spot IS Control 1.
  [ "$(basename "$f")" = "$SELF" ] && continue
  FILES+=("$f")
done
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
