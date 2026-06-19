#!/usr/bin/env bash
# Unit test for session-recent-issues.sh. Run by CI (Lint · Types · Patterns job).
# Core focus: the FAIL-SILENT contract (the SessionStart digest must never block or error a
# session — it exits 0 with no output on a missing var / missing tool / DB outage). The
# DB-shape assertions run only when a live read-only DB is actually reachable.
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/session-recent-issues.sh"
FAIL=0
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $2"; FAIL=1; fi; }
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }

# 1. Unset DB URL → fail-silent: no output, exit 0.
OUT=$(env -u SOLUTIONS_DB_READONLY_URL bash "$HOOK"); RC=$?
assert_empty  "unset URL → no output" "$OUT"
assert_exit0  "unset URL → exit 0" "$RC"

# 2. Empty DB URL → fail-silent.
OUT=$(SOLUTIONS_DB_READONLY_URL="" bash "$HOOK"); RC=$?
assert_empty  "empty URL → no output" "$OUT"
assert_exit0  "empty URL → exit 0" "$RC"

# 3. Unreachable DB (psql present) → connection fails → fail-silent. Fast-fail via a refused port.
if command -v psql >/dev/null 2>&1; then
  OUT=$(SOLUTIONS_DB_READONLY_URL="postgresql://localhost:59999/nonexistent" PGCONNECT_TIMEOUT=2 bash "$HOOK" 2>/dev/null); RC=$?
  assert_empty "unreachable DB → no output" "$OUT"
  assert_exit0 "unreachable DB → exit 0" "$RC"
else
  echo "skip: psql not installed (case 3)"
fi

# 4. Live DB (only if one is actually reachable here): output is valid SessionStart JSON.
if [ -n "${SOLUTIONS_DB_READONLY_URL:-}" ] && command -v psql >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  OUT=$(bash "$HOOK")
  if [ -n "$OUT" ]; then
    # Assert the shape via jq on the parsed value (robust to jq's pretty-print spacing):
    # a SessionStart event carrying a non-empty additionalContext string.
    if printf '%s' "$OUT" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart" and (.hookSpecificOutput.additionalContext | type == "string" and length > 0)' >/dev/null 2>&1; then
      echo "ok: live digest → valid SessionStart additionalContext JSON"
    else
      echo "FAIL: live digest shape wrong — got: $OUT"; FAIL=1
    fi
  else
    echo "skip: live DB reachable but no solutions in the last 14 days"
  fi
else
  echo "skip: no live read-only DB here (case 4)"
fi

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
