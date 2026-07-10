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
# Herestrings, NOT `printf | grep -q`: under pipefail, grep -q's early exit on match
# EPIPEs the printf mid-write and the pipeline reports failure for a FOUND needle.
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_not_contains() { if grep -qF -- "$3" <<<"$2"; then echo "FAIL: $1 — found forbidden: $3"; FAIL=1; else echo "ok: $1"; fi; }
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
# python3, not stat: BSD stat wants -f '%Lp' while GNU stat's -f means --file-system
# (prints an fs-info block AND lets the || fallback fire, corrupting the capture on CI).
PERMS=$(python3 -c 'import os,sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])' "$GFIX/clean.out")
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

# Layer 2 — one >=2000-char pasted-data run in a LONG session (ratio < 30%) gates: the
# absolute trigger exists because a pure ratio dilutes (spec).
python3 - "$GFIX/abs.txt" <<'PY'
import sys
prose = "".join(f"[#u-{i}] user: ordinary discussion line {i} about architecture.\n\n" for i in range(200))
blob = "\n".join('{"item_%d": %d, "note": "bulk"}' % (i, i) for i in range(80))  # ~2.4k chars, JSON-ish lines
open(sys.argv[1], "w").write(prose + blob + "\n" + prose)
PY
OUT=$(python3 "$GATE" "$GFIX/abs.txt" "$GFIX/abs.out")
assert_eq "gate: absolute-size pasted run gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: absolute class" "$(json_field "$OUT" class)" "volume_guard_absolute"

# Layer 2 — many mid-size runs pushing ratio > 30% gates
python3 - "$GFIX/ratio.txt" <<'PY'
import sys
prose = "".join(f"[#u-{i}] user: short line {i}.\n" for i in range(20))          # ~400 chars
blob = "\n".join('| row%03d | %d |' % (i, i) for i in range(60))                  # ~1k chars table run
open(sys.argv[1], "w").write(prose + blob + "\n")
PY
OUT=$(python3 "$GATE" "$GFIX/ratio.txt" "$GFIX/ratio.out")
assert_eq "gate: ratio breach gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: ratio class" "$(json_field "$OUT" class)" "volume_guard_ratio"

# Layer 2 — a long single-line PROSE message must not read as a pasted-data run: the
# assembly prefix `[#uuid] user:` starts with '[', which the JSONISH start-anchor matched,
# so any >=2000-char one-line message falsely tripped volume_guard_absolute (found live
# 2026-07-09 via the csv-field-limit fixture).
python3 - "$GFIX/longprose.txt" <<'PY'
import sys
open(sys.argv[1], "w").write("[#u-1] user: " + "we discussed the navigation architecture at length " * 50 + "\n\n[#a-1] assistant: agreed, that tradeoff holds.\n")
PY
OUT=$(python3 "$GATE" "$GFIX/longprose.txt" "$GFIX/longprose.out")
assert_eq "gate: long single-line prose message passes" "$(json_field "$OUT" verdict)" "sent"

# Layer 2 — small pasted snippet (<500-char run) in normal dialogue passes
python3 - "$GFIX/small.txt" <<'PY'
import sys
prose = "".join(f"[#u-{i}] user: ordinary line {i} of discussion.\n\n" for i in range(40))
open(sys.argv[1], "w").write(prose + '| a | 1 |\n| b | 2 |\n' + prose)
PY
OUT=$(python3 "$GATE" "$GFIX/small.txt" "$GFIX/small.out")
assert_eq "gate: small paste passes" "$(json_field "$OUT" verdict)" "sent"

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

# --- distill.sh fixtures: transcript rows + a stub send (mimics ask-kimi's contract:
# response JSON on stdout, "[kimi: N in (0 cached) / M out | finish: stop]" on stderr).
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$PROJECT_ROOT/scripts/pg-lab/schema/transcripts.sql" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" >/dev/null <<'SQL'
INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content) VALUES
 ('c-1','clean-session','fx','2026-07-01T10:00:00Z','user','We decided pg_trgm beats embeddings here.'),
 ('c-2','clean-session','fx','2026-07-01T10:00:05Z','assistant','Agreed — keyword search wins the neutral benchmarks.'),
 ('h-1','healthy-session','fx','2026-07-01T11:00:00Z','user','debug row: {"caloriesPerServing": 320.5, "proteinPerServing": 12}'),
 ('o-1','out-of-window','fx','2026-06-01T09:00:00Z','user','Old session outside the window.');
SQL
STUB="$FIX/stub-send.sh"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
echo '[{"target_store":"solution","subtype":"knowledge:conventions","title":"Fixture: prefer pg_trgm keyword search over embeddings","content":"Fixture content sentence.","evidence_msg_uuids":["c-1"]}]'
echo '[kimi: 1200 in (0 cached) / 90 out | finish: stop]' >&2
EOF
chmod +x "$STUB"

# Refusal rail (query-string smuggling covered): nutricam refused before any connection
REF=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=disable" bash "$SCRIPT" --window 2026-07-01 2026-07-14 2>&1 1>/dev/null); RC=$?
assert_nonzero "distill.sh refuses nutricam (with query string)" "$RC"
assert_contains "refusal names nutricam" "$REF" "nutricam"

# A '/'-bearing query value (?sslrootcert=/path) must not hijack the ##*/ split — strip
# order regression fixture (query/fragment BEFORE suffix split; found in code review)
REF2=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslrootcert=/tmp/ca.pem" bash "$SCRIPT" --window 2026-07-01 2026-07-14 2>&1 1>/dev/null); RC=$?
assert_nonzero "distill.sh refuses nutricam (slash-bearing query value)" "$RC"
assert_contains "slash-query refusal names nutricam" "$REF2" "nutricam"

WOUT=$(LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-01 2026-07-14 2>&1); RC=$?
assert_exit0 "--window runs" "$RC"
SEEN=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT sessions_seen||'/'||sessions_sent||'/'||sessions_gated FROM harness.distill_runs ORDER BY id DESC LIMIT 1")
assert_eq "--window run stats seen/sent/gated" "$SEEN" "2/1/1"
CLEAN_OUTCOME=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT outcome FROM harness.distilled_sessions WHERE session_id='clean-session'")
assert_eq "clean session outcome sent" "$CLEAN_OUTCOME" "sent"
GATED_OUTCOME=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT outcome FROM harness.distilled_sessions WHERE session_id='healthy-session'")
assert_eq "healthy session outcome gated" "$GATED_OUTCOME" "gated"
OOW=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.distilled_sessions WHERE session_id='out-of-window'")
assert_eq "out-of-window session untouched" "$OOW" "0"

# Idempotency: second run over the same window selects zero sessions
W2=$(LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-01 2026-07-14 2>&1)
SEEN2=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT sessions_seen FROM harness.distill_runs ORDER BY id DESC LIMIT 1")
assert_eq "second --window is a no-op (bookmark)" "$SEEN2" "0"

# Candidates from the Task 5 window run should now exist (stub returned one valid candidate)
# — reset ledgers and re-run so this task's assertions see a fresh run.
psql -X -q -d "$TEST_URL" -c "TRUNCATE harness.memory_candidates, harness.distilled_sessions, harness.distill_runs RESTART IDENTITY CASCADE" >/dev/null
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-01 2026-07-14 >/dev/null 2>&1
NCAND=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='pending'")
assert_eq "valid candidate inserted pending" "$NCAND" "1"
CANDROW=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT target_store||'|'||subtype||'|'||array_to_string(source_msgs,',') FROM harness.memory_candidates LIMIT 1")
assert_eq "candidate fields round-trip" "$CANDROW" "solution|knowledge:conventions|c-1"
TOKS=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT tokens_in||'/'||tokens_out FROM harness.distill_runs ORDER BY id DESC LIMIT 1")
assert_eq "token counts recorded from send stderr" "$TOKS" "1200/90"

# Malformed response => parse_failed outcome, run completes; invented subtype => candidate
# rejected but session still 'sent'
BADSTUB="$FIX/bad-send.sh"; cat > "$BADSTUB" <<'EOF'
#!/usr/bin/env bash
echo 'Sorry, here is prose, not JSON.'
echo '[kimi: 500 in (0 cached) / 20 out | finish: stop]' >&2
EOF
chmod +x "$BADSTUB"
SUBSTUB="$FIX/subtype-send.sh"; cat > "$SUBSTUB" <<'EOF'
#!/usr/bin/env bash
echo '[{"target_store":"solution","subtype":"bug:invented-category","title":"x","content":"y","evidence_msg_uuids":[]},{"target_store":"memory","subtype":"feedback","title":"Valid one","content":"Valid content.","evidence_msg_uuids":["m-1"]}]'
echo '[kimi: 700 in (0 cached) / 40 out | finish: stop]' >&2
EOF
chmod +x "$SUBSTUB"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" >/dev/null <<'SQL'
INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content) VALUES
 ('m-1','malformed-session','fx','2026-07-02T10:00:00Z','user','Another clean discussion, no records.'),
 ('s-1','subtype-session','fx','2026-07-03T10:00:00Z','user','Clean discussion for subtype validation.');
SQL
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$BADSTUB" bash "$SCRIPT" --window 2026-07-02 2026-07-02 >/dev/null 2>&1
MF=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT outcome FROM harness.distilled_sessions WHERE session_id='malformed-session'")
assert_eq "malformed response -> parse_failed" "$MF" "parse_failed"
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$SUBSTUB" bash "$SCRIPT" --window 2026-07-03 2026-07-03 >/dev/null 2>&1
SS=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT outcome FROM harness.distilled_sessions WHERE session_id='subtype-session'")
assert_eq "invented subtype: session still sent" "$SS" "sent"
NVALID=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE session_id='subtype-session'")
assert_eq "invented subtype rejected, valid sibling inserted" "$NVALID" "1"

# Cost cap: seed a run at the cap -> refusal before any send
psql -X -q -d "$TEST_URL" -c "INSERT INTO harness.distill_runs (window_start,window_end,tokens_in) VALUES ('2026-01-01','2026-01-01', 20000000000)" >/dev/null
CAPOUT=$(LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-04 2026-07-04 2>&1); RC=$?
assert_nonzero "cost cap refusal" "$RC"
assert_contains "cap message names the cap" "$CAPOUT" "cap"
psql -X -q -d "$TEST_URL" -c "DELETE FROM harness.distill_runs WHERE tokens_in = 20000000000" >/dev/null

# A single message larger than Python's csv default 128 KiB field limit must not crash
# assemble_session (csv.field_size_limit fix) — real transcripts contain >131072-char
# messages; pre-fix this aborted the whole run mid-window (2026-07-09, live run, 73/88).
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -c "INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content) SELECT 'big-1','bigfield-session','fx','2026-07-07T10:00:00Z','user', repeat('ordinary architecture discussion ', 5000)" >/dev/null
BIGOUT=$(LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-07 2026-07-07 2>&1); RC=$?
assert_exit0 "oversized-field session does not crash --window" "$RC"
BF=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT outcome FROM harness.distilled_sessions WHERE session_id='bigfield-session'")
assert_eq "oversized-field session sent" "$BF" "sent"

# Near-dup: seed the solutions projection with a very similar title; re-run a fresh session
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$PROJECT_ROOT/scripts/pg-lab/schema/codify-neardup.sql" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" >/dev/null <<'SQL'
INSERT INTO harness.solution_titles (path, title) VALUES
 ('docs/solutions/conventions/prefer-pg-trgm-keyword-search-2026-07-01.md',
  'Fixture: prefer pg_trgm keyword search over embeddings');
INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content) VALUES
 ('n-1','neardup-session','fx','2026-07-05T10:00:00Z','user','Clean discussion for near-dup flagging.');
SQL
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-05 2026-07-05 >/dev/null 2>&1
ND=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT near_dup_path FROM harness.memory_candidates WHERE session_id='neardup-session'")
assert_contains "solution near-dup flagged" "$ND" "prefer-pg-trgm-keyword-search"

# Memory-store near-dup via ad-hoc file comparison
MEMDIR="$FIX/memory"; mkdir -p "$MEMDIR"
cat > "$MEMDIR/some_memory.md" <<'MD'
---
name: some_memory
description: "Valid one — a highly similar memory description"
metadata:
  type: feedback
---
Body.
MD
MEMSTUB="$FIX/mem-send.sh"; cat > "$MEMSTUB" <<'EOF'
#!/usr/bin/env bash
echo '[{"target_store":"memory","subtype":"feedback","title":"Valid one","content":"Content.","evidence_msg_uuids":[]}]'
echo '[kimi: 300 in (0 cached) / 30 out | finish: stop]' >&2
EOF
chmod +x "$MEMSTUB"
psql -X -q -d "$TEST_URL" -c "INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content) VALUES ('mm-1','memdup-session','fx','2026-07-06T10:00:00Z','user','Clean.')" >/dev/null
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$MEMSTUB" DISTILL_MEMORY_DIR="$MEMDIR" bash "$SCRIPT" --window 2026-07-06 2026-07-06 >/dev/null 2>&1
MND=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT near_dup_path FROM harness.memory_candidates WHERE session_id='memdup-session'")
assert_contains "memory near-dup flagged" "$MND" "some_memory.md"

# Review: 'a' + note accepts; 'd' rejects with dup: prefix; 'q' quits leaving rest pending
psql -X -q -d "$TEST_URL" -c "UPDATE harness.memory_candidates SET status='pending', reviewer_note=NULL, reviewed_at=NULL" >/dev/null
NPEND=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='pending'")
REVOUT=$(printf 'a\ngood one\nd\n\nq\n' | LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" --review 2>&1); RC=$?
assert_exit0 "--review runs" "$RC"
NACC=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='accepted' AND reviewer_note='good one' AND reviewed_at IS NOT NULL")
assert_eq "review accept with note" "$NACC" "1"
NDUP=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='rejected' AND reviewer_note LIKE 'dup:%'")
assert_eq "review duplicate-reject" "$NDUP" "1"
NLEFT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='pending'")
assert_eq "quit leaves remainder pending" "$NLEFT" "$((NPEND - 2))"

# Report: buckets derive from review encoding; spend > 0; codify-only sweep runs (the git
# window in the fixture repo has no docs/solutions commits in 2026-07 => count 0 lines is fine)
RPT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" --report 2026-07-01 2026-07-14 2>&1); RC=$?
assert_exit0 "--report runs" "$RC"
assert_contains "report: automation-only bucket" "$RPT" "automation-only: 1"
assert_contains "report: caught-by-both bucket" "$RPT" "caught-by-both: 1"
assert_contains "report: spend line" "$RPT" "spend:"
assert_contains "report: gate stats" "$RPT" "gated"
assert_contains "report: codify-only" "$RPT" "codify-only"

# Precondition hints on an empty DB
EMPTY_DB="pg_lab_distill_empty_$$"
psql -X -q -d postgres -c "CREATE DATABASE \"$EMPTY_DB\"" >/dev/null 2>&1
HINT=$(LAB_DATABASE_URL="postgresql://localhost/$EMPTY_DB" bash "$SCRIPT" --report 2>&1)
assert_contains "report: transcripts precondition hint" "$HINT" "transcripts.sh --import"
assert_contains "report: solution_titles precondition hint" "$HINT" "codify-neardup.sh --rebuild"
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$EMPTY_DB\"" >/dev/null 2>&1

# Unrecognized input must RE-PROMPT, not silently quit: pre-fix `q|*)` treated a typo or a
# blank Enter as quit, ending a 254-candidate review after a stray keystroke (live,
# 2026-07-10 — reviewer saw ~18 of 254). Stray 'zz' and a blank line precede a valid 'a'.
# Runs LAST: it resets review statuses, which the report assertions above depend on.
psql -X -q -d "$TEST_URL" -c "UPDATE harness.memory_candidates SET status='pending', reviewer_note=NULL, reviewed_at=NULL" >/dev/null
NPEND2=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='pending'")
printf 'zz\n\na\nresilient note\nq\n' | LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" --review >/dev/null 2>&1
NACC2=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='accepted' AND reviewer_note='resilient note'")
assert_eq "stray input re-prompts instead of quitting" "$NACC2" "1"
NLEFT2=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='pending'")
assert_eq "only the explicit q ends the review" "$NLEFT2" "$((NPEND2 - 1))"

[ "$FAIL" -eq 0 ] && { echo "all assertions passed"; exit 0; } || exit 1
