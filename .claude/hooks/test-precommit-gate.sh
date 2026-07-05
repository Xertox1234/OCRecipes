#!/usr/bin/env bash
# Guards the "commits stay cheap" invariant (2026-07-04 gate consolidation): .husky/pre-commit
# must run lint-staged ONLY — never the semantic preflight gate, which moved to pre-push.
# Static assertions on the hook text — fully hermetic, no execution.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/../.." && pwd)/.husky/pre-commit"
PASS=0; FAIL=0
check() { if eval "$2"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1"; FAIL=$((FAIL+1)); fi; }

check "pre-commit runs lint-staged"                "grep -q 'lint-staged' '$HOOK'"
check "pre-commit does NOT run the --staged gate"  "! grep -q -- 'preflight.sh --staged' '$HOOK'"
# "invoke" = a NON-comment line runs it. A doc comment pointing to where the gate moved
# (pre-push) is desirable, so strip comment lines before checking for an invocation.
check "pre-commit does NOT invoke any preflight"   "! grep -vE '^[[:space:]]*#' '$HOOK' | grep -q 'preflight.sh'"

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
