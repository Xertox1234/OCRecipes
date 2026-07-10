#!/usr/bin/env bash
# Unit test for scripts/pg-lab/transcripts.sh (and, incidentally,
# scripts/pg-lab/schema/transcripts.sql, applied through it). Run by CI (Lint · Types ·
# Patterns job) via scripts/run-hook-tests.sh's `.claude/hooks/test-*.sh` glob.
#
# That job has NO postgres service (only the Tests/Coverage jobs do — see
# .github/workflows/ci.yml), so this test must SKIP cleanly, never fail, when Postgres is
# unreachable. Locally (or in any CI job with a live Postgres) it does a real --import +
# search round-trip against a throwaway database and a synthetic fixture .jsonl, via the
# PG_LAB_TRANSCRIPTS_DIR test seam (mirrors PG_LAB_SOLUTIONS_DIR in
# test-pg-lab-codify-neardup.sh).
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/transcripts.sh"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_nonzero()  { if [ "$2" -ne 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected non-zero exit, got 0"; FAIL=1; fi; }
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }

# Hard safety rail: LAB_DATABASE_URL resolving to a real app database must be refused loudly,
# before any DB connection is attempted — no live Postgres needed for this assertion.
REFUSAL_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$SCRIPT" --import 2>&1 1>/dev/null); REFUSAL_RC=$?
assert_nonzero "transcripts.sh refuses LAB_DATABASE_URL=nutricam" "$REFUSAL_RC"
assert_contains "refusal names nutricam" "$REFUSAL_ERR" "nutricam"

# Smuggling regressions (docs/solutions/logic-errors/
# bash-suffix-split-db-name-denylist-query-string-smuggling-2026-07-06.md and
# denylist-bypassed-by-connection-string-query-string-2026-07-06.md). Deliberately NO mode
# argument: pre-fix these URLs sailed past the guard, and a modeless invocation exits at
# the usage check without ever touching a database — so the discriminating assertion is
# the distinctive refusal message, not the (vacuously nonzero) exit code.
QS_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$SCRIPT" 2>&1 1>/dev/null); QS_RC=$?
assert_nonzero "refuses nutricam+query-string" "$QS_RC"
assert_contains "query-string refusal is the denylist rail, not a downstream error" "$QS_ERR" "a real app database, not a PG Lab database"
SLQ_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslrootcert=/tmp/ca.pem" bash "$SCRIPT" 2>&1 1>/dev/null); SLQ_RC=$?
assert_nonzero "refuses nutricam+slash-bearing query value" "$SLQ_RC"
assert_contains "slash-query refusal is the denylist rail, not a downstream error" "$SLQ_ERR" "a real app database, not a PG Lab database"
FRAG_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam#anchor" bash "$SCRIPT" 2>&1 1>/dev/null); FRAG_RC=$?
assert_nonzero "refuses nutricam+fragment" "$FRAG_RC"
assert_contains "fragment refusal is the denylist rail, not a downstream error" "$FRAG_ERR" "a real app database, not a PG Lab database"
PCT_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutr%69cam" bash "$SCRIPT" 2>&1 1>/dev/null); PCT_RC=$?
assert_nonzero "refuses percent-encoded nutricam" "$PCT_RC"
assert_contains "percent-encoding refusal is the identifier allowlist" "$PCT_ERR" "not a safe Postgres identifier"

# The rest needs a live local Postgres to create a throwaway test DB. Skip (not fail) when
# there is none — mirrors test-pg-lab-codify-neardup.sh.
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

TEST_DB="pg_lab_transcripts_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
FIX=""
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1
  [ -z "$FIX" ] || rm -rf "$FIX"
}
trap cleanup EXIT

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"$TEST_DB\"" >/dev/null 2>&1
assert_exit0 "creates the throwaway DB" "$?"

# Fixture: one synthetic session .jsonl covering every record/block shape transcripts.sh
# must handle -- framework-XML user text (skip), real user text as a plain string (ingest),
# real user text as list content (ingest -- user list content is NOT always tool_result;
# verified against real transcripts during review), a thinking block (skip), a text block
# (ingest as assistant), a tool_use block (ingest tool NAME only, never `input`), a
# tool_result on a user record (list content -- never ingested), an unrelated record type
# (queue-operation, skip tolerantly), and one malformed JSON line (skip, count, never crash).
FIX="$(mktemp -d)"
PROJECT_DIR="$FIX/fixture-project"
mkdir -p "$PROJECT_DIR"
cat > "$PROJECT_DIR/test-session-1.jsonl" <<'JSONL'
{"type":"mode","mode":"default","sessionId":"test-session-1"}
{"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>"},"sessionId":"test-session-1","cwd":"/fixture/project","timestamp":"2026-01-01T10:00:00.000Z","uuid":"u-1"}
{"type":"user","message":{"role":"user","content":"We decided to use pg_trgm instead of embeddings for transcript search."},"sessionId":"test-session-1","cwd":"/fixture/project","timestamp":"2026-01-01T10:00:01.000Z","uuid":"u-2"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"internal reasoning, never ingested","signature":"x"}]},"sessionId":"test-session-1","cwd":"/fixture/project","timestamp":"2026-01-01T10:00:02.000Z","uuid":"a-1"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Right, keyword search beats vector search on jargon-heavy corpora at this scale."}]},"sessionId":"test-session-1","cwd":"/fixture/project","timestamp":"2026-01-01T10:00:03.000Z","uuid":"a-2"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"echo hi"}}]},"sessionId":"test-session-1","cwd":"/fixture/project","timestamp":"2026-01-01T10:00:04.000Z","uuid":"a-3"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"hi"}]},"sessionId":"test-session-1","cwd":"/fixture/project","timestamp":"2026-01-01T10:00:05.000Z","uuid":"u-3"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Does a real question wrapped in list content still get ingested?"}]},"sessionId":"test-session-1","cwd":"/fixture/project","timestamp":"2026-01-01T10:00:06.000Z","uuid":"u-4"}
{"type":"user","message":{"role":"user","content":"Here's my key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890ABCDEF and a GitHub PAT ghp_abcdefghijklmnopqrstuvwxyz1234 pasted by mistake."},"sessionId":"test-session-1","cwd":"/fixture/project","timestamp":"2026-01-01T10:00:07.000Z","uuid":"u-5"}
{"type":"queue-operation","operation":"add","sessionId":"test-session-1"}
this is not valid json at all {{{
JSONL

IMPORT_OUT=$(LAB_DATABASE_URL="$TEST_URL" PG_LAB_TRANSCRIPTS_DIR="$FIX" bash "$SCRIPT" --import 2>&1); IMPORT_RC=$?
assert_exit0 "--import against fixture corpus" "$IMPORT_RC"
assert_contains "--import reports the session" "$IMPORT_OUT" "test-session-1: imported lines"

ROWCOUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_messages")
assert_eq "--import ingests exactly 5 rows (2x user text, assistant text, tool name, secret-redaction fixture)" "$ROWCOUNT" "5"

# Redaction regression (docs/solutions/ — REDACT_PATTERNS missed several real secret
# shapes, verified empirically): pasted secrets must never reach the archive raw.
SECRET_ROW=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT content FROM harness.transcript_messages WHERE msg_uuid LIKE 'u-5%'")
assert_contains "Anthropic-shaped key is redacted" "$SECRET_ROW" "[REDACTED]"
if printf '%s' "$SECRET_ROW" | grep -qF "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890ABCDEF"; then
  echo "FAIL: raw Anthropic-shaped key leaked into stored content"; FAIL=1
else
  echo "ok: raw Anthropic-shaped key never stored"
fi
if printf '%s' "$SECRET_ROW" | grep -qF "ghp_abcdefghijklmnopqrstuvwxyz1234"; then
  echo "FAIL: raw GitHub PAT leaked into stored content"; FAIL=1
else
  echo "ok: raw GitHub PAT never stored"
fi

LIST_TEXT_ROW=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT content FROM harness.transcript_messages WHERE msg_uuid LIKE 'u-4%'")
assert_eq "user list-content text block is ingested (not treated as tool_result)" "$LIST_TEXT_ROW" "Does a real question wrapped in list content still get ingested?"

TOOL_ROW=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT content FROM harness.transcript_messages WHERE role = 'tool'")
assert_eq "tool_use row stores only the tool NAME, not its input" "$TOOL_ROW" "Bash"

FRAMEWORK_ROWS=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_messages WHERE msg_uuid IN ('u-1', 'u-3')")
assert_eq "framework-XML user text and tool_result payloads are never ingested" "$FRAMEWORK_ROWS" "0"

# Incremental re-import with no new lines must be a no-op (todo AC).
REIMPORT_OUT=$(LAB_DATABASE_URL="$TEST_URL" PG_LAB_TRANSCRIPTS_DIR="$FIX" bash "$SCRIPT" --import 2>&1); REIMPORT_RC=$?
assert_exit0 "second --import (no new lines) exits 0" "$REIMPORT_RC"
assert_contains "second --import reports no new lines" "$REIMPORT_OUT" "no new lines"
ROWCOUNT_AFTER=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_messages")
assert_eq "incremental re-import adds zero rows" "$ROWCOUNT_AFTER" "5"

# FTS search: a hit should surface the matching row plus its ±1-message context; a miss
# must print no results and never error.
HIT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" "pg_trgm embeddings" 2>&1); HIT_RC=$?
assert_exit0 "FTS search (hit) exits 0" "$HIT_RC"
assert_contains "FTS hit finds the matching message" "$HIT" "pg_trgm instead of embeddings"
assert_contains "FTS hit includes next-message context" "$HIT" "keyword search beats vector search"

MISS=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" "a totally unrelated question about ocean tides" 2>&1); MISS_RC=$?
assert_exit0 "FTS search (miss) exits 0" "$MISS_RC"
assert_contains "FTS miss reports no matches" "$MISS" "no matches"

# --fuzzy: a misremembered paraphrase of the same message should still hit via word_similarity.
FUZZY_HIT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" "pg trigram embeding" --fuzzy 2>&1); FUZZY_RC=$?
assert_exit0 "fuzzy search (hit) exits 0" "$FUZZY_RC"
assert_contains "fuzzy hit finds the paraphrased message" "$FUZZY_HIT" "pg_trgm instead of embeddings"

# Value probe: all four search invocations above must be logged.
LOGCOUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_search_log")
if [ "$LOGCOUNT" -ge 3 ]; then
  echo "ok: value-probe log recorded search invocations ($LOGCOUNT rows)"
else
  echo "FAIL: expected >=3 transcript_search_log rows, got $LOGCOUNT"; FAIL=1
fi

# --rebuild: truncates + reimports transcript_messages/transcript_sessions, but the
# search-log ledger (an independent append-only table) must survive.
REBUILD_OUT=$(LAB_DATABASE_URL="$TEST_URL" PG_LAB_TRANSCRIPTS_DIR="$FIX" bash "$SCRIPT" --rebuild 2>&1); REBUILD_RC=$?
assert_exit0 "--rebuild against fixture corpus" "$REBUILD_RC"
ROWCOUNT_REBUILD=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_messages")
assert_eq "--rebuild reimports exactly the same 5 rows" "$ROWCOUNT_REBUILD" "5"
LOGCOUNT_AFTER_REBUILD=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_search_log")
assert_eq "--rebuild preserves the search-log ledger" "$LOGCOUNT_AFTER_REBUILD" "$LOGCOUNT"

# --rebuild against an empty/misconfigured source dir must REFUSE, never silently truncate
# a previously-imported archive with nothing to replace it (count-and-fail-on-zero, mirroring
# codify-neardup.sh's same guard).
EMPTY_FIX="$(mktemp -d)"
EMPTY_REBUILD_ERR=$(LAB_DATABASE_URL="$TEST_URL" PG_LAB_TRANSCRIPTS_DIR="$EMPTY_FIX" bash "$SCRIPT" --rebuild 2>&1 1>/dev/null); EMPTY_REBUILD_RC=$?
assert_nonzero "--rebuild against an empty source dir refuses" "$EMPTY_REBUILD_RC"
assert_contains "--rebuild refusal names the empty-dir reason" "$EMPTY_REBUILD_ERR" "refusing"
rm -rf "$EMPTY_FIX"
ROWCOUNT_AFTER_REFUSED_REBUILD=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_messages")
assert_eq "table untouched after a refused empty-dir rebuild" "$ROWCOUNT_AFTER_REFUSED_REBUILD" "5"

# A mid-file parser crash (an unexpected shape, e.g. a bare-string `message` field instead
# of an object) must be isolated to that one session: no partial rows committed, no bookmark
# advanced past the crash point (so a retry reprocesses the whole file), and the batch as a
# whole still reports success with a visible warning rather than silently swallowing it.
CRASH_PROJECT_DIR="$FIX/crash-project"
mkdir -p "$CRASH_PROJECT_DIR"
cat > "$CRASH_PROJECT_DIR/crash-session.jsonl" <<'JSONL'
{"type":"user","message":{"role":"user","content":"first message, should never be committed if the crash isn't isolated"},"sessionId":"crash-session","cwd":"/crash/project","timestamp":"2026-01-01T10:00:00.000Z","uuid":"c-1"}
{"type":"user","message":"a bare string, not an object -- triggers an uncaught AttributeError","sessionId":"crash-session","cwd":"/crash/project","timestamp":"2026-01-01T10:00:01.000Z","uuid":"c-2"}
{"type":"user","message":{"role":"user","content":"third message, should also never be reached"},"sessionId":"crash-session","cwd":"/crash/project","timestamp":"2026-01-01T10:00:02.000Z","uuid":"c-3"}
JSONL
CRASH_IMPORT_OUT=$(LAB_DATABASE_URL="$TEST_URL" PG_LAB_TRANSCRIPTS_DIR="$FIX" bash "$SCRIPT" --import 2>&1); CRASH_IMPORT_RC=$?
assert_exit0 "batch --import still exits 0 despite one crashed session" "$CRASH_IMPORT_RC"
assert_contains "crashed session surfaces a WARNING, not silent success" "$CRASH_IMPORT_OUT" "WARNING: import failed for"
CRASH_ROWCOUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_messages WHERE session_id = 'crash-session'")
assert_eq "crashed session commits zero partial rows" "$CRASH_ROWCOUNT" "0"
CRASH_BOOKMARK=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_sessions WHERE session_id = 'crash-session'")
assert_eq "crashed session's bookmark is never created/advanced" "$CRASH_BOOKMARK" "0"
# The other, healthy session in the same batch must be unaffected by the crash.
HEALTHY_ROWCOUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.transcript_messages WHERE session_id = 'test-session-1'")
assert_eq "the other session in the same batch is unaffected by the crash" "$HEALTHY_ROWCOUNT" "5"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
