#!/usr/bin/env bash
# Session coordination v2 (spec 2026-09-27 §5–§6): per-actor records, Bash coverage,
# sibling visibility, collision ask. Throwaway DB like test-session-coord.sh; SKIPS
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
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE)" >/dev/null 2>&1
  rm -rf "$TMPB" "/tmp/claude-session-coord-${ME}.asks" "$SNAPF" 2>/dev/null
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
assert_contains "stale snapshot: new holder seen on the first consult" "$(ctx "$OUT")" "Session ${OTHER:0:8}"
assert_eq "stale snapshot: refreshed holder is confirmed live → ask" "$(dec "$OUT")" "ask"
rm -rf "/tmp/claude-session-coord-${ME}.asks"

# --- collision ask (Task 9) ------------------------------------------------------------------
hold()   { # $1 sid, $2 agent, $3 abs, $4 rel, $5 seconds ago — DB row
  q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path, last_touch) VALUES ('$1', '$2', '$3', '$4', now() - make_interval(secs => $5)) ON CONFLICT (session_id, agent_id, abs_path) DO UPDATE SET last_touch = EXCLUDED.last_touch" >/dev/null
}
q "INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('$ME', '$R1') ON CONFLICT (session_id) DO UPDATE SET expires_at = now() + interval '15 minutes'" >/dev/null
q "UPDATE harness.session_registry SET expires_at = now() + interval '15 minutes'" >/dev/null
rm -rf "/tmp/claude-session-coord-${ME}.asks"

hold "$OTHER" '' "$R1/src/k.ts" src/k.ts 60
snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
LOG_BEFORE=$(q "SELECT count(*) FROM harness.coordination_log WHERE event='ask-collision' AND session_id='$ME'")
OUT=$(consult '' "$R1/src/k.ts")
assert_eq "ask: confirmed live other-session hold" "$(dec "$OUT")" "ask"
assert_contains "ask: reason names the holder" "$(reason "$OUT")" "Session ${OTHER:0:8}"
assert_contains "ask: reason says approve" "$(reason "$OUT")" "Approve to edit anyway."
assert_contains "ask: model context present" "$(ctx "$OUT")" "Collision:"
sleep 1   # log_event is backgrounded
LOG_AFTER=$(q "SELECT count(*) FROM harness.coordination_log WHERE event='ask-collision' AND session_id='$ME'")
assert_eq "ask: exactly one telemetry row for this ask" "$((LOG_AFTER - LOG_BEFORE))" "1"
rm -rf "/tmp/claude-session-coord-${ME}.asks"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/ghost.ts" src/ghost.ts '' 60)]")]"
assert_eq "ask: snapshot hit not confirmed live → warn" "$(dec "$(consult '' "$R1/src/ghost.ts")")" "none"

hold "$OTHER" '' "$R1/src/b14.ts" src/b14.ts 840
snap "[$(ses "$OTHER" "[$(fil "$R1/src/b14.ts" src/b14.ts '' 840)]")]"
assert_eq "ask: boundary 14 min → ask" "$(dec "$(consult '' "$R1/src/b14.ts")")" "ask"
hold "$OTHER" '' "$R1/src/b16.ts" src/b16.ts 960
snap "[$(ses "$OTHER" "[$(fil "$R1/src/b16.ts" src/b16.ts '' 960)]")]"
assert_eq "ask: boundary 16 min → warn" "$(dec "$(consult '' "$R1/src/b16.ts")")" "none"

hold "$ME" agentA1 "$R1/src/sib.ts" src/sib.ts 60
snap "[$(ses "$ME" "[$(fil "$R1/src/sib.ts" src/sib.ts agentA1 60)]")]"
OUT=$(consult agentB "$R1/src/sib.ts")
assert_eq "ask: sibling agent confirmed → warn only (siblings never ask)" "$(dec "$OUT")" "none"
assert_contains "ask: sibling still gets the warn text" "$(ctx "$OUT")" "in this same session"
rm -rf "/tmp/claude-session-coord-${ME}.asks"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
assert_eq "ask: SKIP_COLLISION_ASK=1 → warn" "$(dec "$(SKIP_COLLISION_ASK=1 consult '' "$R1/src/k.ts")")" "none"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
assert_eq "ask: pg down + fresh snapshot → ask" "$(dec "$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" consult '' "$R1/src/k.ts")")" "ask"
rm -rf "/tmp/claude-session-coord-${ME}.asks"
snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"; age_file "$SNAPF" 70
assert_eq "ask: pg down + 70 s snapshot → warn" "$(dec "$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" consult '' "$R1/src/k.ts")")" "none"
rm -rf "/tmp/claude-session-coord-${ME}.asks"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
assert_empty "consult: agent_id with a space is rejected" "$(consult 'agent B' "$R1/src/k.ts")"

# --- ask-once suppression (Task 10) ------------------------------------------------------------
rm -rf "/tmp/claude-session-coord-${ME}.asks"
hold "$OTHER" '' "$R1/src/once.ts" src/once.ts 60
snap "[$(ses "$OTHER" "[$(fil "$R1/src/once.ts" src/once.ts '' 60)]")]"
assert_eq "once: first edit asks" "$(dec "$(consult agentB "$R1/src/once.ts")")" "ask"
POST=$(jq -n --arg s "$ME" --arg f "$R1/src/once.ts" '{session_id:$s, agent_id:"agentB", tool_name:"Edit", tool_input:{file_path:$f}}')
printf '%s' "$POST" | bash "$SHIM" record
M="/tmp/claude-session-coord-${ME}.asks/$(printf '%s\037%s' "$R1/src/once.ts" agentB | shasum | cut -c1-40)"
assert_eq "once: shim promotes synchronously (no wait)" "$(cut -d' ' -f1 "$M" 2>/dev/null)" "approved"
snap "[$(ses "$OTHER" "[$(fil "$R1/src/once.ts" src/once.ts '' 60)]")]"
assert_eq "once: approved holder → warn next time" "$(dec "$(consult agentB "$R1/src/once.ts")")" "none"
assert_eq "once: another agent is asked separately" "$(dec "$(consult agentC "$R1/src/once.ts")")" "ask"
printf 'approved %s:%s %s\n' "$OTHER" "" "$(( $(date +%s) - 960 ))" > "$M"
assert_eq "once: approval older than 15 min → ask again" "$(dec "$(consult agentB "$R1/src/once.ts")")" "ask"
printf 'approved %s:%s %s\n' "someone-else" "" "$(date +%s)" > "$M"
assert_eq "once: approval for a different holder → ask" "$(dec "$(consult agentB "$R1/src/once.ts")")" "ask"
# SESSION_COORD_CLAUDE_PID seams do_deregister's claude_pid() walk so it never touches the
# REAL live session's bridge file (/tmp/claude-session-coord-pid-<realpid>.sid) — every
# other register/deregister call in both suites sets this seam; this one didn't (fix round 1).
SC_STUB_PID=$((50000000 + $$))
jq -n --arg s "$ME" '{session_id:$s}' | SESSION_COORD_CLAUDE_PID="$SC_STUB_PID" bash "$SHIM" deregister
[ ! -d "/tmp/claude-session-coord-${ME}.asks" ] && echo "ok: deregister removes the asks dir" || { echo "FAIL: asks dir survived deregister"; FAIL=1; }

# --- deny then downgrade must never promote a stale pending marker (fix round 1, item 1) ------
rm -rf "/tmp/claude-session-coord-${ME}.asks"
hold "$OTHER" '' "$R1/src/deny.ts" src/deny.ts 60
snap "[$(ses "$OTHER" "[$(fil "$R1/src/deny.ts" src/deny.ts '' 60)]")]"
assert_eq "deny: first edit asks" "$(dec "$(consult agentB "$R1/src/deny.ts")")" "ask"
MD="/tmp/claude-session-coord-${ME}.asks/$(printf '%s\037%s' "$R1/src/deny.ts" agentB | shasum | cut -c1-40)"
assert_eq "deny: marker is pending" "$(cut -d' ' -f1 "$MD" 2>/dev/null)" "pending"
# No record here — the tool never ran, simulating a deny.
assert_eq "deny: later downgraded consult (SKIP_COLLISION_ASK) → warn" "$(dec "$(SKIP_COLLISION_ASK=1 consult agentB "$R1/src/deny.ts")")" "none"
POSTD=$(jq -n --arg s "$ME" --arg f "$R1/src/deny.ts" '{session_id:$s, agent_id:"agentB", tool_name:"Edit", tool_input:{file_path:$f}}')
printf '%s' "$POSTD" | bash "$SHIM" record
assert_eq "deny: stale pending marker is never silently approved" "$([ -f "$MD" ] && cut -d' ' -f1 "$MD" || echo absent)" "absent"
snap "[$(ses "$OTHER" "[$(fil "$R1/src/deny.ts" src/deny.ts '' 60)]")]"
assert_eq "deny: a real collision still asks after the downgrade" "$(dec "$(consult agentB "$R1/src/deny.ts")")" "ask"
rm -rf "/tmp/claude-session-coord-${ME}.asks"

# --- Bash-write promote path (fix round 1, item 4) ---------------------------------------------
bjson() { jq -n --arg s "$ME" --arg a "$1" --arg c "$2" --arg cwd "$R1" \
  '{session_id:$s, agent_id:$a, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}'; }
hold "$OTHER" '' "$R1/src/bpromo.ts" src/bpromo.ts 60
snap "[$(ses "$OTHER" "[$(fil "$R1/src/bpromo.ts" src/bpromo.ts '' 60)]")]"
assert_eq "bash-promote: consult on a Bash write asks" "$(dec "$(bjson agentB 'rm ./src/bpromo.ts' | bash "$SCRIPT" consult --stdin-json 2>/dev/null)")" "ask"
bjson agentB 'rm ./src/bpromo.ts' | bash "$SHIM" record
MB="/tmp/claude-session-coord-${ME}.asks/$(printf '%s\037%s' "$R1/src/bpromo.ts" agentB | shasum | cut -c1-40)"
assert_eq "bash-promote: marker approved via the Bash PostToolUse record" "$(cut -d' ' -f1 "$MB" 2>/dev/null)" "approved"
snap "[$(ses "$OTHER" "[$(fil "$R1/src/bpromo.ts" src/bpromo.ts '' 60)]")]"
assert_eq "bash-promote: next Bash consult is warn-only" "$(dec "$(bjson agentB 'rm ./src/bpromo.ts' | bash "$SCRIPT" consult --stdin-json 2>/dev/null)")" "none"
rm -rf "/tmp/claude-session-coord-${ME}.asks"

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
mutant "sibling collision also asks (own=0 gate dropped)" "scripts/pg-lab/session-coord.sh" \
  's/ && \[ "\$own" = "0" \]; then/; then/'
mutant "ask becomes allow" "scripts/pg-lab/session-coord.sh" \
  's/permissionDecision:"ask"/permissionDecision:"allow"/'
mutant "live confirm skipped (snapshot trusted)" "scripts/pg-lab/session-coord.sh" \
  's/case "\$\(live_confirm "\$osid" "\$oagent" "\$file"\)" in/case "yes" in/'
mutant "touch window 15 min → 150 min" "scripts/pg-lab/session-coord.sh" \
  's/^WINDOW_SECS=900 /WINDOW_SECS=9000 /'
mutant "approved markers ignored" "scripts/pg-lab/session-coord.sh" \
  's/elif ask_suppressed /elif false \&\& ask_suppressed /'
mutant "consult purge of stale pending ask markers disabled" "scripts/pg-lab/session-coord.sh" \
  's/&& rm -f "\$pm"$/\&\& false \&\& rm -f "\$pm"/'
run_mutants "$PROJECT_ROOT" ".claude/hooks/test-session-coord-v2.sh" || FAIL=1

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
