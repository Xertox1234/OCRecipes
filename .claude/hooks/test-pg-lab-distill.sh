#!/usr/bin/env bash
# Unit test for scripts/pg-lab/distill.sh, distill-gate.py, and schema/memory-candidates.sql.
# Run by CI (Lint · Types · Patterns job) via scripts/run-hook-tests.sh's .claude/hooks/test-*.sh
# glob. That job has NO postgres service, so DB-dependent sections SKIP cleanly when Postgres
# is unreachable (mirrors test-pg-lab-transcripts.sh). The external send is stubbed via the
# DISTILL_SEND_CMD seam — no network, ever.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/distill.sh"
GATE="$PROJECT_ROOT/scripts/pg-lab/distill-gate.py"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/memory-candidates.sql"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_nonzero()  { if [ "$2" -ne 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected non-zero exit, got 0"; FAIL=1; fi; }
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_not_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "FAIL: $1 — found forbidden: $3"; FAIL=1; else echo "ok: $1"; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v python3 >/dev/null 2>&1 || { echo "skip: python3 not installed"; exit 0; }

# ---------- Gate (no DB required) ----------
GFIX="$(mktemp -d)"
gate_cleanup() { rm -rf "$GFIX"; }
# note: combined with DB cleanup below once FIX exists; for now standalone
json_field() { python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))' "$2" <<<"$1"; }

# Clean session passes, artifact written 0600, sha matches
printf '[#u-1] user: Let us discuss the search architecture.\n\n[#a-1] assistant: pg_trgm word_similarity is the right primitive here.\n' > "$GFIX/clean.txt"
OUT=$(python3 "$GATE" "$GFIX/clean.txt" "$GFIX/clean.out"); RC=$?
assert_exit0 "gate: clean session exits 0" "$RC"
assert_eq "gate: clean session verdict sent" "$(json_field "$OUT" verdict)" "sent"
PERMS=$(stat -f '%Lp' "$GFIX/clean.out" 2>/dev/null || stat -c '%a' "$GFIX/clean.out")
assert_eq "gate: artifact is 0600" "$PERMS" "600"
WANT_SHA=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$GFIX/clean.out")
assert_eq "gate: reported sha256 matches artifact" "$(json_field "$OUT" sha256)" "$WANT_SHA"
[ ! -e "$GFIX/clean.out.tmp" ]; assert_exit0 "gate: no temp file left beside artifact" "$?"

# Defense-in-depth redaction happens in the artifact
printf '[#u-1] user: my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 sorry\n' > "$GFIX/secret.txt"
OUT=$(python3 "$GATE" "$GFIX/secret.txt" "$GFIX/secret.out")
assert_eq "gate: secret-only session still sent" "$(json_field "$OUT" verdict)" "sent"
assert_contains "gate: artifact redacted" "$(cat "$GFIX/secret.out")" "[REDACTED]"
assert_not_contains "gate: raw key absent from artifact" "$(cat "$GFIX/secret.out")" "sk-ant-api03"

# Layer 1 — JSON-form nutrition record (camelCase, value-bearing) gates
printf '[#u-1] user: debugging, here is the record: {"caloriesPerServing": 320.5, "proteinPerServing": 12}\n' > "$GFIX/json.txt"
OUT=$(python3 "$GATE" "$GFIX/json.txt" "$GFIX/json.out")
assert_eq "gate: JSON nutrition record gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: JSON class nutrition_fields" "$(json_field "$OUT" class)" "nutrition_fields"

# Layer 1 — psql-table paste (snake_case headers + numeric row): THE channel the three
# container shapes exist for (spec critical finding)
cat > "$GFIX/psql.txt" <<'TBL'
[#u-1] user: query output while debugging:
 serving_size | calories | protein
--------------+----------+---------
 100g         |   235.50 |   11.20
TBL
OUT=$(python3 "$GATE" "$GFIX/psql.txt" "$GFIX/psql.out")
assert_eq "gate: psql table paste gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: psql table class nutrition_fields" "$(json_field "$OUT" class)" "nutrition_fields"

# Layer 1 — key=value record line gates
printf '[#u-1] user: row was calories=421 protein=18 for that user\n' > "$GFIX/kv.txt"
OUT=$(python3 "$GATE" "$GFIX/kv.txt" "$GFIX/kv.out")
assert_eq "gate: key=value record gated" "$(json_field "$OUT" verdict)" "gated"

# Layer 1 — code DISCUSSION does not gate (field name without a value-bearing container)
printf '[#u-1] user: should calories stay decimal("calories", { precision: 10 }) in schema.ts?\n' > "$GFIX/code.txt"
OUT=$(python3 "$GATE" "$GFIX/code.txt" "$GFIX/code.out")
assert_eq "gate: schema code discussion passes" "$(json_field "$OUT" verdict)" "sent"

# Layer 1 — non-allowlisted email gates; allowlisted set + RFC 2606 pass
printf '[#u-1] user: the affected account is jane.roe1984@gmail.com\n' > "$GFIX/email.txt"
OUT=$(python3 "$GATE" "$GFIX/email.txt" "$GFIX/email.out")
assert_eq "gate: foreign email gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: email class" "$(json_field "$OUT" class)" "email"
printf '[#u-1] user: mail william.tower@gmail.com, bot noreply@anthropic.com, fixture demo@example.com\n' > "$GFIX/email-ok.txt"
OUT=$(python3 "$GATE" "$GFIX/email-ok.txt" "$GFIX/email-ok.out")
assert_eq "gate: allowlisted emails pass" "$(json_field "$OUT" verdict)" "sent"

# Layer 1 — DOB keyword-adjacent date gates; free-floating ISO date passes
printf '[#u-1] user: her dob: 1984-03-11 was in the row\n' > "$GFIX/dob.txt"
OUT=$(python3 "$GATE" "$GFIX/dob.txt" "$GFIX/dob.out")
assert_eq "gate: dob-adjacent date gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: dob class" "$(json_field "$OUT" class)" "dob"
printf '[#u-1] user: see docs/research/2026-07-04-postgres-memory-for-claude-code.md from 2026-07-04\n' > "$GFIX/date-ok.txt"
OUT=$(python3 "$GATE" "$GFIX/date-ok.txt" "$GFIX/date-ok.out")
assert_eq "gate: free-floating dates pass" "$(json_field "$OUT" verdict)" "sent"

# Layer 1 — prose weight-with-units gates
printf '[#u-1] user: the profile showed 72.5 kg at signup\n' > "$GFIX/wt.txt"
OUT=$(python3 "$GATE" "$GFIX/wt.txt" "$GFIX/wt.out")
assert_eq "gate: weight-with-units gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: weight class" "$(json_field "$OUT" class)" "weight_height_units"

# Fail-closed: unreadable input → non-zero exit, gated verdict, no artifact
OUT=$(python3 "$GATE" "$GFIX/does-not-exist.txt" "$GFIX/nope.out" 2>/dev/null); RC=$?
assert_nonzero "gate: missing input fails closed (non-zero)" "$RC"
assert_eq "gate: missing input verdict gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: missing input class gate_error" "$(json_field "$OUT" class)" "gate_error"
[ ! -f "$GFIX/nope.out" ]; assert_exit0 "gate: no artifact on gate_error" "$?"

# Post-review hardening: users-table weight/height columns gate in value-bearing shapes
printf '[#u-1] user: profile row was {"weight": 72.5, "height": 178.0}\n' > "$GFIX/wh.txt"
OUT=$(python3 "$GATE" "$GFIX/wh.txt" "$GFIX/wh.out")
assert_eq "gate: weight/height record gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: weight/height class nutrition_fields" "$(json_field "$OUT" class)" "nutrition_fields"

# Post-review hardening: natural-prose DOB phrasing gates (spec: within 12 chars, any chars)
printf '[#u-1] user: her date of birth is 1984-03-11 per the record\n' > "$GFIX/dob2.txt"
OUT=$(python3 "$GATE" "$GFIX/dob2.txt" "$GFIX/dob2.out")
assert_eq "gate: prose dob gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: prose dob class" "$(json_field "$OUT" class)" "dob"
rm -rf "$GFIX"

# ---------- DB-dependent sections ----------
command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; [ "$FAIL" -eq 0 ] && exit 0 || exit 1; }
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; [ "$FAIL" -eq 0 ] && exit 0 || exit 1; }

TEST_DB="pg_lab_distill_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
FIX=""
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1
  [ -z "$FIX" ] || rm -rf "$FIX"
}
trap cleanup EXIT
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"$TEST_DB\"" >/dev/null 2>&1
assert_exit0 "creates the throwaway DB" "$?"
FIX="$(mktemp -d)"

# Schema applies idempotently (twice = still exit 0)
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "schema applies" "$?"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "schema re-applies (idempotent)" "$?"
TABLES=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname='harness'")
assert_contains "memory_candidates exists" "$TABLES" "memory_candidates"
assert_contains "distill_runs exists" "$TABLES" "distill_runs"
assert_contains "distilled_sessions exists" "$TABLES" "distilled_sessions"

[ "$FAIL" -eq 0 ] && { echo "all assertions passed"; exit 0; } || exit 1
