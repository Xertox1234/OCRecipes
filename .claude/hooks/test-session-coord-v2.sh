#!/usr/bin/env bash
# Session coordination v2 (spec 2026-09-27 §5–§6): per-actor records, Bash coverage,
# sibling visibility, collision block. Throwaway DB like test-session-coord.sh; SKIPS
# (prints "skip:", exit 0) when Postgres is unreachable — CI's Lint job has none.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/session-coord.sh"
SHIM="$HOOK_DIR/session-coord-hook.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/session-coordination.sql"
FAIL=0
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected [$3], got [$2]"; FAIL=1; fi; }
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got [$2]"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing [$3] in [$2]"; FAIL=1; fi; }
command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }
command -v jq   >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

ME="v2me-$$"; OTHER="v2other-$$"
TEST_DB="pg_lab_session_coord_v2_$$"; TEST_URL="postgresql://localhost/$TEST_DB"
TMPB=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/sc-v2-XXXXXX")" && pwd -P)
SNAPF="/tmp/claude-session-coord-${ME}.json"
BLOCKS="/tmp/claude-session-coord-${ME}.blocked"
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE)" >/dev/null 2>&1
  rm -rf "$TMPB" "$BLOCKS" "$SNAPF" 2>/dev/null
  rmdir "/tmp/claude-session-coord-${ME}.refresh-lock" 2>/dev/null
}
trap cleanup EXIT
age_file() { perl -e '$t = time - $ARGV[1]; utime $t, $t, $ARGV[0]' "$1" "$2"; }
q() { psql -X -qtA -F'|' -d "$TEST_URL" -c "$1"; }

# Legacy (pre-v2) tables first, so applying the schema exercises the migration path.
LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" >/dev/null 2>&1 <<'SQL'
CREATE TABLE harness.session_registry (session_id TEXT PRIMARY KEY, pid INTEGER, repo_root TEXT NOT NULL,
  branch TEXT, head_sha TEXT, session_kind TEXT NOT NULL DEFAULT 'unknown',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes');
CREATE TABLE harness.files_in_flight (session_id TEXT NOT NULL REFERENCES harness.session_registry(session_id) ON DELETE CASCADE,
  abs_path TEXT NOT NULL, rel_path TEXT NOT NULL, first_touch TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_touch TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (session_id, abs_path));
INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('legacy', '/tmp/l');
INSERT INTO harness.files_in_flight (session_id, abs_path, rel_path) VALUES ('legacy', '/tmp/l/a.ts', 'a.ts');
SQL
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_eq "schema: migrates a legacy DB cleanly" "$?" "0"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_eq "schema: idempotent" "$?" "0"
assert_eq "schema: legacy row kept with agent_id ''" "$(q "SELECT agent_id FROM harness.files_in_flight WHERE session_id='legacy'")" ""
assert_eq "schema: PK is (session_id, agent_id, abs_path)" \
  "$(q "SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum WHERE c.conrelid = 'harness.files_in_flight'::regclass AND c.contype = 'p'")" \
  "session_id,agent_id,abs_path"
q "DELETE FROM harness.session_registry" >/dev/null
export LAB_DATABASE_URL="$TEST_URL"

mkgit() { mkdir -p "$TMPB/$1"; git -C "$TMPB/$1" init -q; printf '%s' "$TMPB/$1"; }
R1=$(mkgit r1); R2=$(mkgit r2)
rec() { bash "$SCRIPT" record --stdin-json; }

# --- record (Task 7) ---------------------------------------------------------------------
jq -n --arg s "$ME" --arg f "$R1/src/a.ts" '{session_id:$s, agent_id:"agentA1", tool_name:"Write", tool_input:{file_path:$f}}' | rec
assert_eq "record: subagent row keyed by agent_id" "$(q "SELECT agent_id, rel_path FROM harness.files_in_flight WHERE abs_path='$R1/src/a.ts'")" "agentA1|src/a.ts"
jq -n --arg s "$ME" --arg f "$R1/src/a.ts" '{session_id:$s, tool_name:"Edit", tool_input:{file_path:$f}}' | rec
assert_eq "record: main agent row is agent_id ''" "$(q "SELECT count(*) FROM harness.files_in_flight WHERE abs_path='$R1/src/a.ts'")" "2"
jq -n --arg s "$ME" --arg c "rm src/b.ts && echo hi > c.txt" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | rec
assert_eq "record: Bash targets recorded" "$(q "SELECT string_agg(rel_path, ',' ORDER BY rel_path) FROM harness.files_in_flight WHERE abs_path IN ('$R1/src/b.ts','$R1/c.txt')")" "c.txt,src/b.ts"
jq -n --arg s "$ME" --arg c "cd src && rm d.ts" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | rec
assert_eq "record: Bash after cd records nothing relative" "$(q "SELECT count(*) FROM harness.files_in_flight WHERE abs_path LIKE '%d.ts'")" "0"

# PIN: `resolve_write_targets` emits /dev/null as a target for `> /dev/null`. record_one must
# drop it naturally (git_root_of("/dev") fails) — never insert a /dev row.
jq -n --arg s "$ME" --arg c "echo hi > /dev/null && rm src/e.ts" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | rec
assert_eq "record: Bash writes past /dev/null still records the real target" "$(q "SELECT rel_path FROM harness.files_in_flight WHERE abs_path='$R1/src/e.ts'")" "src/e.ts"
assert_eq "record: nothing under /dev is ever recorded" "$(q "SELECT count(*) FROM harness.files_in_flight WHERE abs_path LIKE '/dev/%'")" "0"

assert_eq "record: TTL is 15 minutes" "$(q "SELECT extract(epoch FROM expires_at - last_seen_at)::int FROM harness.session_registry WHERE session_id='$ME'")" "900"

# --- snapshot (Task 8) ---------------------------------------------------------------------
q "INSERT INTO harness.session_registry (session_id, repo_root, session_kind, branch) VALUES ('$OTHER', '$R2', 'todo-executor', 'todo/foo') ON CONFLICT DO NOTHING" >/dev/null
q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path) VALUES ('$OTHER', '', '$R2/src/z.ts', 'src/z.ts')" >/dev/null
rm -f "$SNAPF"; bash "$SCRIPT" refresh-snapshot --session "$ME"
assert_eq "snapshot: includes own session" "$(jq -r --arg me "$ME" '[.sessions[] | select(.session_id == $me)] | length' "$SNAPF")" "1"
assert_eq "snapshot: file carries agent_id" "$(jq -r --arg me "$ME" '.sessions[] | select(.session_id == $me) | .files[] | select(.rel_path == "src/a.ts" and .agent_id == "agentA1") | .agent_id' "$SNAPF")" "agentA1"
assert_eq "snapshot: last_touch is epoch seconds" "$(jq -r '[.sessions[].files[].last_touch | type] | unique | join(",")' "$SNAPF")" "number"

# --- consult cells (Task 8: warn tiers) ----------------------------------------------------
NOW=$(date +%s)
snap() { # $1 = JSON array of session objects -> fresh snapshot file
  printf '{"sessions":%s}\n' "$1" > "$SNAPF"
}
ses() { # $1 sid, $2 files JSON array
  printf '{"session_id":"%s","session_kind":"interactive","branch":"b","repo_root":"%s","last_seen_at":"t","files":%s}' "$1" "$R1" "$2"
}
fil() { # $1 abs, $2 rel, $3 agent, $4 seconds ago
  printf '{"abs_path":"%s","rel_path":"%s","agent_id":"%s","last_touch":%s}' "$1" "$2" "$3" "$((NOW - $4))"
}
consult() { # $1 current agent ('' = main), $2 abs path
  jq -n --arg s "$ME" --arg a "$1" --arg f "$2" \
    '{session_id:$s, tool_name:"Edit", tool_input:{file_path:$f}} + (if $a == "" then {} else {agent_id:$a} end)' \
    | bash "$SCRIPT" consult --stdin-json 2>/dev/null
}
ctx()  { jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$1" 2>/dev/null; }
dec()    { jq -r '.hookSpecificOutput.permissionDecision // "none"' <<<"$1" 2>/dev/null; }
reason() { jq -r '.hookSpecificOutput.permissionDecisionReason // ""' <<<"$1" 2>/dev/null; }

snap "[$(ses "$OTHER" "[$(fil "$R1/src/x.ts" src/x.ts '' 60)]")]"
assert_contains "cell other/same abs: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "same checkout"
snap "[$(ses "$OTHER" "[$(fil "$R2/src/x.ts" src/x.ts '' 60)]")]"
assert_contains "cell other/same rel other root: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "another worktree"
snap "[$(ses "$ME" "[$(fil "$R1/src/x.ts" src/x.ts agentA1 60)]")]"
assert_contains "cell own/different agent/same abs: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "Agent agentA1 in this same session"
snap "[$(ses "$ME" "[$(fil "$R1/src/x.ts" src/x.ts agentA1 60)]")]"
assert_empty "cell own/same agent/same abs: silent" "$(consult agentA1 "$R1/src/x.ts")"
snap "[$(ses "$ME" "[$(fil "$R1/src/x.ts" src/x.ts '' 60)]")]"
assert_contains "cell own/main-agent row vs subagent: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "main agent of this same session"
snap "[$(ses "$ME" "[$(fil "$R2/src/x.ts" src/x.ts agentA1 60)]")]"
assert_contains "cell own/different agent/other worktree fresh: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "another worktree"
snap "[$(ses "$ME" "[$(fil "$R2/src/x.ts" src/x.ts agentA1 960)]")]"
assert_empty "cell own/different agent/other worktree 16 min old: silent" "$(consult agentB "$R1/src/x.ts")"

# Bash consult (Review Focus 2: ./ spelling matches the recorded path)
snap "[$(ses "$OTHER" "[$(fil "$R1/src/x.ts" src/x.ts '' 60)]")]"
bcon() { jq -n --arg s "$ME" --arg c "$1" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | bash "$SCRIPT" consult --stdin-json 2>/dev/null; }
assert_contains "Bash consult: rm ./src/x.ts matches" "$(ctx "$(bcon 'rm ./src/x.ts')")" "same checkout"
assert_empty "Bash consult: after cd → silent" "$(bcon 'cd src && rm x.ts')"
assert_empty "Bash consult: non-writing → silent" "$(bcon 'ls src')"

# Stale snapshot + a holder that appeared since → refreshed synchronously (spec §6.2 step 0)
q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path) VALUES ('$OTHER', '', '$R1/src/late.ts', 'src/late.ts')" >/dev/null
snap "[]"; age_file "$SNAPF" 600
OUT=$(consult '' "$R1/src/late.ts")
assert_contains "stale snapshot: new holder seen on the first consult" "$(reason "$OUT")" "Session ${OTHER:0:8}"
assert_eq "stale snapshot: refreshed holder is confirmed live → block" "$(dec "$OUT")" "deny"
rm -rf "$BLOCKS"

# --- collision block (replaces the ask: the ask prompt never showed its reason) ---------------
hold()   { # $1 sid, $2 agent, $3 abs, $4 rel, $5 seconds ago — DB row
  q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path, last_touch) VALUES ('$1', '$2', '$3', '$4', now() - make_interval(secs => $5)) ON CONFLICT (session_id, agent_id, abs_path) DO UPDATE SET last_touch = EXCLUDED.last_touch" >/dev/null
}
q "INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('$ME', '$R1') ON CONFLICT (session_id) DO UPDATE SET expires_at = now() + interval '15 minutes'" >/dev/null
q "UPDATE harness.session_registry SET expires_at = now() + interval '15 minutes'" >/dev/null
rm -rf "$BLOCKS"

hold "$OTHER" '' "$R1/src/k.ts" src/k.ts 60
snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
LOG_BEFORE=$(q "SELECT count(*) FROM harness.coordination_log WHERE event='block-collision' AND session_id='$ME'")
OUT=$(consult '' "$R1/src/k.ts")
assert_eq "block: confirmed live other-session hold" "$(dec "$OUT")" "deny"
assert_contains "block: reason names the holder" "$(reason "$OUT")" "Session ${OTHER:0:8}"
assert_contains "block: reason names the file" "$(reason "$OUT")" "src/k.ts"
assert_contains "block: reason tells the model to ask the user" "$(reason "$OUT")" "Ask the user"
sleep 1   # log_event is backgrounded
LOG_AFTER=$(q "SELECT count(*) FROM harness.coordination_log WHERE event='block-collision' AND session_id='$ME'")
assert_eq "block: exactly one telemetry row for this block" "$((LOG_AFTER - LOG_BEFORE))" "1"
rm -rf "$BLOCKS"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/ghost.ts" src/ghost.ts '' 60)]")]"
assert_eq "block: snapshot hit not confirmed live → warn" "$(dec "$(consult '' "$R1/src/ghost.ts")")" "none"

hold "$OTHER" '' "$R1/src/b14.ts" src/b14.ts 840
snap "[$(ses "$OTHER" "[$(fil "$R1/src/b14.ts" src/b14.ts '' 840)]")]"
assert_eq "block: boundary 14 min → block" "$(dec "$(consult '' "$R1/src/b14.ts")")" "deny"
hold "$OTHER" '' "$R1/src/b16.ts" src/b16.ts 960
snap "[$(ses "$OTHER" "[$(fil "$R1/src/b16.ts" src/b16.ts '' 960)]")]"
assert_eq "block: boundary 16 min → warn" "$(dec "$(consult '' "$R1/src/b16.ts")")" "none"

hold "$ME" agentA1 "$R1/src/sib.ts" src/sib.ts 60
snap "[$(ses "$ME" "[$(fil "$R1/src/sib.ts" src/sib.ts agentA1 60)]")]"
OUT=$(consult agentB "$R1/src/sib.ts")
assert_eq "block: sibling agent confirmed → warn only (siblings never block)" "$(dec "$OUT")" "none"
assert_contains "block: sibling still gets the warn text" "$(ctx "$OUT")" "in this same session"
rm -rf "$BLOCKS"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
assert_eq "block: SKIP_COLLISION_BLOCK=1 → warn" "$(dec "$(SKIP_COLLISION_BLOCK=1 consult '' "$R1/src/k.ts")")" "none"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
assert_eq "block: pg down + fresh snapshot → block" "$(dec "$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" consult '' "$R1/src/k.ts")")" "deny"
rm -rf "$BLOCKS"
snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"; age_file "$SNAPF" 70
assert_eq "block: pg down + 70 s snapshot → warn" "$(dec "$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" consult '' "$R1/src/k.ts")")" "none"
rm -rf "$BLOCKS"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
assert_empty "consult: agent_id with a space is rejected" "$(consult 'agent B' "$R1/src/k.ts")"

# --- block once, then the retry goes through with a warning -----------------------------------
rm -rf "$BLOCKS"
hold "$OTHER" '' "$R1/src/once.ts" src/once.ts 60
snap "[$(ses "$OTHER" "[$(fil "$R1/src/once.ts" src/once.ts '' 60)]")]"
assert_eq "once: first edit is blocked" "$(dec "$(consult agentB "$R1/src/once.ts")")" "deny"
M="$BLOCKS/$(printf '%s\037%s' "$R1/src/once.ts" agentB | shasum | cut -c1-40)"
assert_eq "once: marker records that the model was told" "$(cut -d' ' -f1 "$M" 2>/dev/null)" "told"
OUT=$(consult agentB "$R1/src/once.ts")
assert_eq "once: retry by the same agent → allowed" "$(dec "$OUT")" "none"
assert_contains "once: retry still carries the warning" "$(ctx "$OUT")" "same checkout"
assert_eq "once: another agent is blocked separately" "$(dec "$(consult agentC "$R1/src/once.ts")")" "deny"
printf 'told %s:%s %s\n' "$OTHER" "" "$(( $(date +%s) - 960 ))" > "$M"
assert_eq "once: block older than 15 min → block again" "$(dec "$(consult agentB "$R1/src/once.ts")")" "deny"
printf 'told %s:%s %s\n' "someone-else" "" "$(date +%s)" > "$M"
assert_eq "once: block for a different holder → block" "$(dec "$(consult agentB "$R1/src/once.ts")")" "deny"
printf 'pending %s:%s %s\n' "$OTHER" "" "$(date +%s)" > "$M"
assert_eq "once: a leftover pre-block marker is not a pass" "$(dec "$(consult agentB "$R1/src/once.ts")")" "deny"
# SESSION_COORD_CLAUDE_PID seams do_deregister's claude_pid() walk so it never touches the
# REAL live session's bridge file (/tmp/claude-session-coord-pid-<realpid>.sid).
SC_STUB_PID=$((50000000 + $$))
jq -n --arg s "$ME" '{session_id:$s}' | SESSION_COORD_CLAUDE_PID="$SC_STUB_PID" bash "$SHIM" deregister
[ ! -d "$BLOCKS" ] && echo "ok: deregister removes the blocks dir" || { echo "FAIL: blocks dir survived deregister"; FAIL=1; }

# --- Bash writes are blocked once too -----------------------------------------------------------
bjson() { jq -n --arg s "$ME" --arg a "$1" --arg c "$2" --arg cwd "$R1" \
  '{session_id:$s, agent_id:$a, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}'; }
hold "$OTHER" '' "$R1/src/bblk.ts" src/bblk.ts 60
snap "[$(ses "$OTHER" "[$(fil "$R1/src/bblk.ts" src/bblk.ts '' 60)]")]"
assert_eq "bash: rm of a held file is blocked" "$(dec "$(bjson agentB 'rm ./src/bblk.ts' | bash "$SCRIPT" consult --stdin-json 2>/dev/null)")" "deny"
assert_eq "bash: the retry is allowed" "$(dec "$(bjson agentB 'rm ./src/bblk.ts' | bash "$SCRIPT" consult --stdin-json 2>/dev/null)")" "none"
rm -rf "$BLOCKS"

# --- every holder is judged, not just the first one listed ----------------------------------------
# Snapshot order is not a promise; a holder that doesn't count must not hide one that does.
OTHER2="v2other2-$$"; STALE="v2stale-$$"; GHOST="v2ghost-$$"
q "INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('$ME', '$R1'), ('$OTHER2', '$R1'), ('$STALE', '$R1') ON CONFLICT (session_id) DO UPDATE SET expires_at = now() + interval '15 minutes'" >/dev/null
hold "$OTHER" '' "$R1/src/ord.ts" src/ord.ts 60
hold "$STALE" '' "$R1/src/ord.ts" src/ord.ts 1200
LIVE_S=$(ses "$OTHER" "[$(fil "$R1/src/ord.ts" src/ord.ts '' 60)]")
STALE_S=$(ses "$STALE" "[$(fil "$R1/src/ord.ts" src/ord.ts '' 1200)]")
snap "[$LIVE_S,$STALE_S]"
assert_eq "order: live first, stale second → block (control)" "$(dec "$(consult '' "$R1/src/ord.ts")")" "deny"; rm -rf "$BLOCKS"
snap "[$STALE_S,$LIVE_S]"
assert_eq "order: stale first, live second → block" "$(dec "$(consult '' "$R1/src/ord.ts")")" "deny"; rm -rf "$BLOCKS"
hold "$ME" agentA1 "$R1/src/ord.ts" src/ord.ts 30
SIB_S=$(ses "$ME" "[$(fil "$R1/src/ord.ts" src/ord.ts agentA1 30)]")
snap "[$LIVE_S,$SIB_S]"
assert_eq "order: live first, sibling second → block (control)" "$(dec "$(consult agentB "$R1/src/ord.ts")")" "deny"; rm -rf "$BLOCKS"
snap "[$SIB_S,$LIVE_S]"
assert_eq "order: sibling first, live second → block" "$(dec "$(consult agentB "$R1/src/ord.ts")")" "deny"; rm -rf "$BLOCKS"
# A fresher holder that the DB can't confirm (snapshot-only ghost) must not hide the live one.
GHOST_S=$(ses "$GHOST" "[$(fil "$R1/src/ord.ts" src/ord.ts '' 10)]")
snap "[$GHOST_S,$LIVE_S]"
OUT=$(consult '' "$R1/src/ord.ts")
assert_eq "order: unconfirmed fresher holder first → still blocks" "$(dec "$OUT")" "deny"
assert_contains "order: block names the confirmed holder" "$(reason "$OUT")" "Session ${OTHER:0:8}"
rm -rf "$BLOCKS"

# Two live holders: name the most recent editor, then the other, then let the edit through.
hold "$OTHER2" '' "$R1/src/two.ts" src/two.ts 300
hold "$OTHER" '' "$R1/src/two.ts" src/two.ts 60
snap "[$(ses "$OTHER2" "[$(fil "$R1/src/two.ts" src/two.ts '' 300)]"),$(ses "$OTHER" "[$(fil "$R1/src/two.ts" src/two.ts '' 60)]")]"
OUT=$(consult '' "$R1/src/two.ts")
assert_contains "two holders: first block names the most recent editor" "$(reason "$OUT")" "Session ${OTHER:0:8}"
OUT=$(consult '' "$R1/src/two.ts")
assert_eq "two holders: retry blocks on the other live holder" "$(dec "$OUT")" "deny"
assert_contains "two holders: second block names the other holder" "$(reason "$OUT")" "Session ${OTHER2:0:8}"
assert_eq "two holders: third try goes through (no ping-pong)" "$(dec "$(consult '' "$R1/src/two.ts")")" "none"
rm -rf "$BLOCKS"

# Bash with several targets: the first file's holder doesn't count, the second's does.
hold "$STALE" '' "$R1/src/m1.ts" src/m1.ts 1200
hold "$OTHER" '' "$R1/src/m2.ts" src/m2.ts 60
snap "[$(ses "$STALE" "[$(fil "$R1/src/m1.ts" src/m1.ts '' 1200)]"),$(ses "$OTHER" "[$(fil "$R1/src/m2.ts" src/m2.ts '' 60)]")]"
OUT=$(bjson '' 'rm ./src/m1.ts ./src/m2.ts' | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_eq "bash multi-file: a later file's live holder blocks" "$(dec "$OUT")" "deny"
assert_contains "bash multi-file: block names that file" "$(reason "$OUT")" "src/m2.ts"
rm -rf "$BLOCKS"

# The live-check cap (3 per edit): three fresher unconfirmed holders use it up before the live one.
hold "$OTHER" '' "$R1/src/cap.ts" src/cap.ts 60
snap "[$(ses "g1-$$" "[$(fil "$R1/src/cap.ts" src/cap.ts '' 10)]"),$(ses "g2-$$" "[$(fil "$R1/src/cap.ts" src/cap.ts '' 20)]"),$(ses "g3-$$" "[$(fil "$R1/src/cap.ts" src/cap.ts '' 30)]"),$(ses "$OTHER" "[$(fil "$R1/src/cap.ts" src/cap.ts '' 60)]")]"
CAP_BEFORE=$(q "SELECT count(*) FROM harness.coordination_log WHERE event='block-downgraded' AND session_id='$ME' AND detail->>'reason'='confirm-cap'")
assert_eq "cap: a 4th holder past 3 live checks → warn only" "$(dec "$(consult '' "$R1/src/cap.ts")")" "none"
sleep 1   # log_event is backgrounded
assert_eq "cap: downgrade logged as confirm-cap" "$(( $(q "SELECT count(*) FROM harness.coordination_log WHERE event='block-downgraded' AND session_id='$ME' AND detail->>'reason'='confirm-cap'") - CAP_BEFORE ))" "1"
rm -rf "$BLOCKS"

rm -f "$SNAPF"; bash "$SCRIPT" refresh-snapshot --session "$ME"
assert_eq "snapshot: sessions ordered most recently seen first" \
  "$(jq -r '[.sessions[].last_seen_at] | . == (sort | reverse)' "$SNAPF")" "true"

. "$HOOK_DIR/lib/mutants.sh"
mutant "is_self ignores agent_id (all own rows = self)" "scripts/pg-lab/session-coord.sh" \
  's/^( *def is_self\(\$s; \$x\): \(\$s\.session_id == \$me\)) and .*;$/\1;/'
mutant "is_self never true (own same-agent rows collide)" "scripts/pg-lab/session-coord.sh" \
  's/^( *def is_self\(\$s; \$x\):).*;$/\1 false;/'
mutant "own-session 15-min gate dropped" "scripts/pg-lab/session-coord.sh" \
  's/^( *def own_gate\(\$s; \$x\):).*;$/\1 true;/'
mutant "refresh excludes own session again" "scripts/pg-lab/session-coord.sh" \
  "s/^  WHERE r\\.expires_at > now\\(\\)\$/  WHERE r.session_id <> :'sid' AND r.expires_at > now()/"
mutant "stale snapshot refreshed in background only" "scripts/pg-lab/session-coord.sh" \
  's/then refresh_bounded "\$sid";/then refresh_bounded "$sid" \&/'
mutant "sibling collision also blocks (own=0 gate dropped)" "scripts/pg-lab/session-coord.sh" \
  's/ && \[ "\$own" = "0" \]; then/; then/'
mutant "block becomes allow" "scripts/pg-lab/session-coord.sh" \
  's/permissionDecision:"deny"/permissionDecision:"allow"/'
mutant "live confirm skipped (snapshot trusted)" "scripts/pg-lab/session-coord.sh" \
  's/case "\$\(live_confirm "\$osid" "\$oagent" "\$file"\)" in/case "yes" in/'
mutant "touch window 15 min → 150 min" "scripts/pg-lab/session-coord.sh" \
  's/^WINDOW_SECS=900 /WINDOW_SECS=9000 /'
mutant "told markers ignored (every retry blocked)" "scripts/pg-lab/session-coord.sh" \
  's/elif block_told /elif false \&\& block_told /'
mutant "block never recorded (retry blocked again)" "scripts/pg-lab/session-coord.sh" \
  's/^( *)block_mark_told "\$sid"/\1: block_mark_told "$sid"/'
mutant "any marker state counts as told" "scripts/pg-lab/session-coord.sh" \
  's/\[ "\$st" = told \] && //'
mutant "first match decides (one candidate judged)" "scripts/pg-lab/session-coord.sh" \
  's/^MAX_CANDIDATES=5 /MAX_CANDIDATES=1 /'
mutant "live-check cap dropped" "scripts/pg-lab/session-coord.sh" \
  's/elif \[ "\$CONFIRMS" -ge "\$MAX_CONFIRMS" \]; then/elif false; then/'
mutant "candidates not sorted (most recent editor lost)" "scripts/pg-lab/session-coord.sh" \
  's/sort -s -t[^|]*-k2,2n/cat/'
mutant "told marker keeps only the last holder (ping-pong)" "scripts/pg-lab/session-coord.sh" \
  's/^( *printf .told %s %s.*) >> /\1 > /'
run_mutants "$PROJECT_ROOT" ".claude/hooks/test-session-coord-v2.sh" || FAIL=1

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
