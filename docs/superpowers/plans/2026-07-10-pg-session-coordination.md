# PG Lab Session Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the reviewed session-coordination spec: a Postgres-backed visibility registry with warn-only collision warnings, drift-detect attribution, and one advisory lock (ephemeral background-psql holder) enforcing the /todo DB-serial convention.

**Architecture:** Two ephemeral lease tables + one append-only ledger in `ocrecipes_lab` schema `harness`; a single fail-silent CLI (`session-coord.sh`) with one thin hook wrapper; a separate `db-serial-lock.sh` whose lock lifetime equals a background psql process's lifetime (crash → connection death → instant release). Hot path never touches psql — PreToolUse consults a local snapshot file refreshed asynchronously.

**Tech Stack:** bash, psql, jq. No new npm dependencies. Spec (canonical): `docs/superpowers/specs/2026-07-10-pg-session-coordination-design.md`.

## Global Constraints

- **Ship as 3 PRs in order** (spec §11): write path → read path → mutex. Hooks are touched, so every PR is automerge-HELD: open it, report it, never arm auto-merge.
- **Never commit to main.** Branches: `pg-lab/session-coord-write-path`, `pg-lab/session-coord-read-path`, `pg-lab/session-coord-mutex`, each cut from fresh `origin/main` after the previous PR merges.
- **Fail-silent rail (doubly binding):** every `session-coord.sh` path exits 0 with empty stdout on any Postgres/parse error. The ONLY non-silent surfaces in the whole feature are `db-serial-lock.sh acquire`'s WARN lines and exit codes 2/3.
- **DB:** `LAB_DATABASE_URL` (default `postgresql://localhost/ocrecipes_lab`), never `nutricam`/`ocrecipes_solutions` — copy the denylist guard from `scripts/pg-lab/log-injection.sh:43-50` verbatim including the query-string strip (docs/solutions/logic-errors/denylist-bypassed-by-connection-string-query-string-2026-07-06.md).
- **psql var rule:** `:'var'` substitution only works on stdin/heredoc input, NEVER in a `-c` string (docs/solutions/runtime-errors/psql-copy-meta-command-no-variable-interpolation-2026-07-09.md). All parameterized SQL goes through `<<'SQL'` heredocs with `-v` flags.
- **`PGCONNECT_TIMEOUT=2`** exported in every script that calls psql (the only phase that can hang locally).
- **Hook tests** live at `.claude/hooks/test-*.sh` (auto-run by `scripts/run-hook-tests.sh`'s glob in the CI Lint job, which has NO Postgres service) — every test must `skip`-exit-0 cleanly when psql or a live local Postgres is missing, and do real round-trips against a throwaway `pg_lab_*_test_$$` DB when one is available. Copy the skeleton of `.claude/hooks/test-pg-lab-log-injection.sh`.
- **TTLs (spec values):** registry lease 10 min; snapshot staleness 25 s. Holder watch interval 30 s (env-tunable `WATCH_INTERVAL_SECS` so tests can use 1).
- **Bash tool ceiling deviation from spec:** spec §5.2 says "15-min bounded wait"; a single synchronous Bash call caps at 600 s. Implemented as `--wait-secs` (default **570**) with the dispatch prompt instructing ONE retry on exit 2 — two attempts ≈ 19 min total, satisfying "bounded wait, then blocked". Task 12 records this amendment in the spec.
- **macOS portability:** no `flock(1)` on stock macOS — the snapshot refresh guard uses an atomic `mkdir` lock instead (spec §5.1's `flock -n` intent, portable mechanism). File mtime reads use `stat -f %m || stat -c %Y` fallback (darwin/linux).
- **TDD:** every task writes its failing test section first, watches it fail, implements, watches it pass, commits. Commit messages use `feat(pg-lab):`/`fix(pg-lab):`/`docs(todos):` prefixes.

## File Structure

| File                                                            | Responsibility                                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `scripts/pg-lab/schema/session-coordination.sql`                | Create: 2 lease tables + `coordination_log` ledger + indexes (PR 1)                                                     |
| `scripts/pg-lab/lib/ps-walk.sh`                                 | Create: sourced helpers `resolve_claude_pid`, `bridge_file`, `resolve_session_id` (PR 1)                                |
| `scripts/pg-lab/session-coord.sh`                               | Create: register/record/reap/deregister (PR 1); refresh-snapshot (PR 1); consult/attribute-drift (PR 2)                 |
| `.claude/hooks/session-coord-hook.sh`                           | Create: single thin wrapper; backgrounds write-path subcommands, runs consult synchronously (PR 1, consult branch PR 2) |
| `.claude/settings.json`                                         | Modify: SessionStart/PostToolUse/SessionEnd entries (PR 1); PreToolUse entry (PR 2)                                     |
| `.claude/hooks/test-session-coord.sh`                           | Create PR 1, extend PR 2: full registry + warnings test suite                                                           |
| `.claude/hooks/drift-detect.sh`                                 | Modify (~6 lines, PR 2): call `attribute-drift`, append result to MSG                                                   |
| `.claude/hooks/test-drift-detect.sh`                            | Modify (PR 2): attribution cases                                                                                        |
| `scripts/pg-lab/db-serial-lock.sh`                              | Create (PR 3): acquire/release/status + internal `__holder`                                                             |
| `.claude/hooks/test-db-serial-lock.sh`                          | Create (PR 3): mutex suite                                                                                              |
| `.claude/skills/todo/SKILL.md`                                  | Modify (PR 3): Phase 3 DB-serial batch rule; dispatch-prompt additions                                                  |
| `todos/P3-2026-07-10-pg-session-coordination-implementation.md` | Modify (PR 3): check ACs, archive                                                                                       |

---

# PR 1 — Write path (`pg-lab/session-coord-write-path`)

### Task 1: Schema file

**Files:**

- Create: `scripts/pg-lab/schema/session-coordination.sql`
- Test: `.claude/hooks/test-session-coord.sh` (new file, grows through PR 2)

**Interfaces:**

- Produces: tables `harness.session_registry` (PK `session_id`), `harness.files_in_flight` (PK `(session_id, abs_path)`, FK cascade), `harness.coordination_log`. Every later task's SQL targets exactly these column names.

- [ ] **Step 1: Write the failing test skeleton + schema-apply assertion**

Create `.claude/hooks/test-session-coord.sh` (mode 755):

```bash
#!/usr/bin/env bash
# Unit test for scripts/pg-lab/session-coord.sh + schema/session-coordination.sql.
# Run by CI (Lint · Types · Patterns job) via scripts/run-hook-tests.sh's glob — that job
# has NO postgres service, so this must SKIP cleanly (exit 0) when Postgres is unreachable,
# mirroring .claude/hooks/test-pg-lab-log-injection.sh.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/session-coord.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/session-coordination.sql"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_exit()     { if [ "$2" -eq "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit $3, got $2"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $2"; FAIL=1; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }
command -v jq   >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

TEST_DB="pg_lab_session_coord_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
cleanup() { psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1; rm -f /tmp/claude-session-coord-*-test-$$* 2>/dev/null; }
trap cleanup EXIT

LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
assert_exit0 "init.sh creates the throwaway DB" "$?"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "session-coordination.sql applies cleanly" "$?"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "schema is idempotent (second apply clean)" "$?"
COLS=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='harness' AND table_name IN ('session_registry','files_in_flight','coordination_log')")
[ "$COLS" -ge 18 ] && echo "ok: expected columns present" || { echo "FAIL: columns missing ($COLS)"; FAIL=1; }

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash .claude/hooks/test-session-coord.sh`
Expected: `FAIL: session-coordination.sql applies cleanly` (schema file doesn't exist; `psql -f` exits non-zero).

- [ ] **Step 3: Write the schema**

Create `scripts/pg-lab/schema/session-coordination.sql`:

```sql
-- scripts/pg-lab/schema/session-coordination.sql
--
-- Schema for cross-terminal session coordination (PG Lab Phase D) — spec:
-- docs/superpowers/specs/2026-07-10-pg-session-coordination-design.md (local-only).
--
-- session_registry and files_in_flight are EPHEMERAL lease tables (TTL 10 min,
-- reap-on-read): drop them mid-session and they repopulate within one heartbeat.
-- Nothing durable may ever read them. coordination_log is the ONLY durable table —
-- an APPEND-ONLY event ledger feeding the ~60-day value probe (spec §10).
--
-- Idempotent: safe to re-run. Safe to apply standalone, without init.sh having run
-- first (CREATE SCHEMA repeated here defensively).

CREATE SCHEMA IF NOT EXISTS harness;

CREATE TABLE IF NOT EXISTS harness.session_registry (
    session_id    TEXT PRIMARY KEY,
    pid           INTEGER,
    repo_root     TEXT NOT NULL,
    branch        TEXT,
    head_sha      TEXT,
    session_kind  TEXT NOT NULL DEFAULT 'unknown',
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);

-- Reap-on-read: every refresh-snapshot/reap DELETEs by this predicate first.
CREATE INDEX IF NOT EXISTS session_registry_expires_idx ON harness.session_registry (expires_at);

CREATE TABLE IF NOT EXISTS harness.files_in_flight (
    session_id   TEXT NOT NULL REFERENCES harness.session_registry(session_id) ON DELETE CASCADE,
    abs_path     TEXT NOT NULL,
    rel_path     TEXT NOT NULL,
    first_touch  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_touch   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, abs_path)
);

-- Cross-worktree comparison (spec §6 level 2) groups by rel_path.
CREATE INDEX IF NOT EXISTS files_in_flight_rel_idx ON harness.files_in_flight (rel_path);

CREATE TABLE IF NOT EXISTS harness.coordination_log (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    event         TEXT NOT NULL, -- warn-collision | warn-worktree | drift-attributed |
                                 -- drift-unattributed | lock-acquired | lock-waited |
                                 -- lock-timeout | lock-released | lock-orphan-released
    session_id    TEXT,
    other_session TEXT,
    detail        JSONB
);

CREATE INDEX IF NOT EXISTS coordination_log_ts_idx ON harness.coordination_log (ts);
CREATE INDEX IF NOT EXISTS coordination_log_event_idx ON harness.coordination_log (event);
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash .claude/hooks/test-session-coord.sh`
Expected: `ALL PASS` (or `skip: no local Postgres reachable` — if so, start Postgres before continuing; PR 1 development requires a live local Postgres).

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/schema/session-coordination.sql .claude/hooks/test-session-coord.sh
git commit -m "feat(pg-lab): session-coordination schema — lease tables + probe ledger"
```

---

### Task 2: ps-walk lib (claude-pid resolution + session-id bridge)

**Files:**

- Create: `scripts/pg-lab/lib/ps-walk.sh`
- Test: append to `.claude/hooks/test-session-coord.sh` (insert BEFORE the live-Postgres gate — these tests need no DB)

**Interfaces:**

- Produces (sourced functions): `resolve_claude_pid [start_pid]` → echoes pid, rc 1 on no match; `bridge_file <claude_pid>` → echoes `/tmp/claude-session-coord-pid-<pid>.sid`; `resolve_session_id` → echoes session_id from bridge, rc 1 if missing. Consumed by `session-coord.sh` (Task 3) and `db-serial-lock.sh` (Task 10).

- [ ] **Step 1: Write the failing tests**

Insert into `.claude/hooks/test-session-coord.sh` immediately AFTER the `command -v jq` line and BEFORE the `psql -d postgres` live-gate (so they run even in the no-Postgres CI job):

```bash
# --- lib/ps-walk.sh (no DB needed) ---------------------------------------------------
PSWALK="$PROJECT_ROOT/scripts/pg-lab/lib/ps-walk.sh"
[ -f "$PSWALK" ] || { echo "FAIL: lib/ps-walk.sh missing"; FAIL=1; }

# resolve_claude_pid: walking from a shell with no claude ancestor must rc-1 quietly.
# (CI runners have no `claude` process; locally the test still passes because we start
# the walk from a detached `sleep` whose ancestry tops out at the test shell.)
WALK_OUT=$( (. "$PSWALK" && resolve_claude_pid 1) 2>&1 ); WALK_RC=$?
assert_eq "ps-walk: pid 1 has no claude ancestor -> rc 1" "$WALK_RC" "1"
assert_empty "ps-walk: failure prints nothing" "$WALK_OUT"

# bridge round-trip: bridge_file is a pure path function; resolve_session_id reads it.
FAKE_PID=99999999
BRIDGE=$( (. "$PSWALK" && bridge_file "$FAKE_PID") )
assert_eq "ps-walk: bridge_file path shape" "$BRIDGE" "/tmp/claude-session-coord-pid-${FAKE_PID}.sid"

# resolve_session_id with a stubbed resolve_claude_pid: overriding the function after
# sourcing proves resolve_session_id composes the two helpers rather than re-walking.
SID_OUT=$( (
  . "$PSWALK"
  resolve_claude_pid() { echo "$FAKE_PID"; }
  printf 'sess-bridge-test' > "/tmp/claude-session-coord-pid-${FAKE_PID}.sid"
  resolve_session_id
  rm -f "/tmp/claude-session-coord-pid-${FAKE_PID}.sid"
) )
assert_eq "ps-walk: resolve_session_id reads the bridge" "$SID_OUT" "sess-bridge-test"
```

- [ ] **Step 2: Run to verify failure**

Run: `bash .claude/hooks/test-session-coord.sh`
Expected: `FAIL: lib/ps-walk.sh missing` plus sourcing failures.

- [ ] **Step 3: Implement**

Create `scripts/pg-lab/lib/ps-walk.sh`:

```bash
#!/usr/bin/env bash
# scripts/pg-lab/lib/ps-walk.sh — sourced helpers shared by session-coord.sh and
# db-serial-lock.sh (spec §5.1a / §5.2): resolve the long-lived Claude Code process pid
# from any descendant shell, and map it to the harness session_id via the bridge file
# written by `session-coord.sh register`.
#
# Sourced, not executed. Fail-soft contract: every function prints NOTHING and returns 1
# on failure — callers are fail-silent hooks and must be able to `|| exit 0`.
#
# Why explicit walking instead of $PPID: hook and Bash-tool shells are transient — their
# ppid chain is the ONLY route to the long-lived `claude` process, and drift-detect.sh's
# header already documents that raw $PPID differs across processes of one session.

# Echo the pid of the nearest `claude` ancestor of $1 (default: current shell).
# Matches either the executable basename (`claude`) or a `claude` token in argv
# (covers `node /path/to/claude` launcher shapes). Returns 1 at pid 0/1 without a match.
resolve_claude_pid() {
  local pid="${1:-$$}" comm args
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
    comm=$(ps -o comm= -p "$pid" 2>/dev/null) || return 1
    case "${comm##*/}" in claude) printf '%s\n' "$pid"; return 0 ;; esac
    args=$(ps -o command= -p "$pid" 2>/dev/null) || return 1
    case " $args" in
      *" claude") printf '%s\n' "$pid"; return 0 ;;
      *"/claude "*|*" claude "*) printf '%s\n' "$pid"; return 0 ;;
    esac
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]') || return 1
  done
  return 1
}

bridge_file() { printf '/tmp/claude-session-coord-pid-%s.sid\n' "$1"; }

# Echo the session_id for the current process tree (bridge written by register).
resolve_session_id() {
  local cpid f
  cpid=$(resolve_claude_pid) || return 1
  f=$(bridge_file "$cpid")
  [ -r "$f" ] || return 1
  cat "$f"
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bash .claude/hooks/test-session-coord.sh`
Expected: the four `ps-walk:` assertions print `ok:`, then `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/lib/ps-walk.sh .claude/hooks/test-session-coord.sh
git commit -m "feat(pg-lab): shared ps-walk lib — claude-pid resolution + session-id bridge"
```

---

### Task 3: session-coord.sh — register / record / reap / deregister

**Files:**

- Create: `scripts/pg-lab/session-coord.sh`
- Test: append to `.claude/hooks/test-session-coord.sh` (after the live-Postgres gate)

**Interfaces:**

- Consumes: `lib/ps-walk.sh` functions (Task 2); tables (Task 1).
- Produces (CLI): `session-coord.sh register --stdin-json` (hook mode: reads hook JSON on stdin, upserts row, writes bridge file); `register --kind <kind>` (CLI mode: session_id via bridge, re-upserts kind/repo_root); `record --stdin-json` (heartbeat + files_in_flight upsert; recreates a reaped registry row); `reap`; `deregister --stdin-json`. ALL paths exit 0 always; stdout empty except `consult` (Task 7).

- [ ] **Step 1: Write the failing tests**

Append to `.claude/hooks/test-session-coord.sh` before the final `[ "$FAIL" ...` line:

```bash
# --- session-coord.sh write path ------------------------------------------------------
export LAB_DATABASE_URL="$TEST_URL"
REPO_ROOT_NOW=$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel)

# Fail-silent + denylist (no live DB needed for these two, but grouped here for flow):
OUT=$(printf '{"session_id":"s1","cwd":"%s"}' "$PROJECT_ROOT" | LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" bash "$SCRIPT" register --stdin-json 2>/dev/null); RC=$?
assert_exit0 "register vs unreachable DB -> exit 0" "$RC"; assert_empty "register vs unreachable DB -> silent" "$OUT"
ERR=$(printf '{}' | LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$SCRIPT" register --stdin-json 2>&1 1>/dev/null); RC=$?
assert_exit0 "denylist refusal still exit 0" "$RC"; assert_contains "denylist names nutricam" "$ERR" "nutricam"

# register (hook mode): upserts row + writes bridge for a stubbed claude pid.
STUB_PID=88888888
printf '{"session_id":"sess-reg","cwd":"%s"}' "$PROJECT_ROOT" \
  | SESSION_COORD_CLAUDE_PID="$STUB_PID" bash "$SCRIPT" register --stdin-json >/dev/null 2>&1
assert_exit0 "register hook-mode exits 0" "$?"
ROW=$(psql -X -qtA -F'|' -d "$TEST_URL" -c "SELECT session_id, repo_root, session_kind FROM harness.session_registry WHERE session_id='sess-reg'")
assert_eq "register row: id+root" "$(cut -d'|' -f1-2 <<<"$ROW")" "sess-reg|$REPO_ROOT_NOW"
assert_eq "register bridge file content" "$(cat "/tmp/claude-session-coord-pid-${STUB_PID}.sid" 2>/dev/null)" "sess-reg"

# register (CLI mode): --kind re-upserts the SAME row via the bridge.
SESSION_COORD_CLAUDE_PID="$STUB_PID" bash "$SCRIPT" register --kind todo-executor >/dev/null 2>&1
KIND=$(psql -X -qtA -d "$TEST_URL" -c "SELECT session_kind FROM harness.session_registry WHERE session_id='sess-reg'")
assert_eq "register --kind re-upserts kind" "$KIND" "todo-executor"
NROWS=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.session_registry")
assert_eq "register --kind did not create a second row" "$NROWS" "1"

# record: files_in_flight upsert with per-file rel_path; heartbeat bumps expires_at.
printf '{"session_id":"sess-reg","tool_name":"Edit","tool_input":{"file_path":"%s/package.json"}}' "$REPO_ROOT_NOW" \
  | bash "$SCRIPT" record --stdin-json >/dev/null 2>&1
FROW=$(psql -X -qtA -F'|' -d "$TEST_URL" -c "SELECT abs_path, rel_path FROM harness.files_in_flight WHERE session_id='sess-reg'")
assert_eq "record: abs+rel path" "$FROW" "$REPO_ROOT_NOW/package.json|package.json"

# record self-heals a reaped row (kind degrades to unknown — informational only).
psql -X -q -d "$TEST_URL" -c "DELETE FROM harness.session_registry" >/dev/null
printf '{"session_id":"sess-reg","tool_name":"Edit","tool_input":{"file_path":"%s/package.json"}}' "$REPO_ROOT_NOW" \
  | bash "$SCRIPT" record --stdin-json >/dev/null 2>&1
NROWS=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.session_registry WHERE session_id='sess-reg'")
assert_eq "record recreates a reaped registry row" "$NROWS" "1"

# reap: expired rows (and their files, via cascade) vanish.
psql -X -q -d "$TEST_URL" -c "UPDATE harness.session_registry SET expires_at = now() - interval '1 minute'" >/dev/null
bash "$SCRIPT" reap >/dev/null 2>&1
NROWS=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.session_registry")
NFILES=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.files_in_flight")
assert_eq "reap deletes expired sessions" "$NROWS" "0"
assert_eq "reap cascades to files" "$NFILES" "0"

# deregister: removes row + bridge file.
printf '{"session_id":"sess-dereg","cwd":"%s"}' "$PROJECT_ROOT" \
  | SESSION_COORD_CLAUDE_PID="$STUB_PID" bash "$SCRIPT" register --stdin-json >/dev/null 2>&1
printf '{"session_id":"sess-dereg"}' | SESSION_COORD_CLAUDE_PID="$STUB_PID" bash "$SCRIPT" deregister --stdin-json >/dev/null 2>&1
NROWS=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.session_registry WHERE session_id='sess-dereg'")
assert_eq "deregister removes the row" "$NROWS" "0"
[ ! -f "/tmp/claude-session-coord-pid-${STUB_PID}.sid" ] && echo "ok: deregister removes bridge" || { echo "FAIL: bridge survived deregister"; FAIL=1; }
```

- [ ] **Step 2: Run to verify failure**

Run: `bash .claude/hooks/test-session-coord.sh`
Expected: FAILs from the first `register` assertion on (script missing).

- [ ] **Step 3: Implement**

Create `scripts/pg-lab/session-coord.sh` (mode 755):

```bash
#!/usr/bin/env bash
# scripts/pg-lab/session-coord.sh — cross-terminal session registry (PG Lab Phase D).
# Spec: docs/superpowers/specs/2026-07-10-pg-session-coordination-design.md.
#
# FAIL-SILENT, doubly binding: every subcommand exits 0 on any error; stdout stays empty
# on every path except `consult` (which may emit hookSpecificOutput JSON). This script is
# invoked backgrounded off hook hot paths and directly by executor Bash calls — a
# coordination failure must never surface in, or block, the caller.
#
# Subcommands (PR 1): register [--stdin-json | --kind <k>], record --stdin-json,
#                     refresh-snapshot --session <sid>, reap, deregister --stdin-json
# Subcommands (PR 2): consult --stdin-json, attribute-drift <session_id> <repo_root>
#
# SESSION_COORD_CLAUDE_PID: test seam — overrides ps-walk resolution of the claude pid.
set -uo pipefail
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-2}"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
TTL='10 minutes'

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ps-walk.sh
. "$SELF_DIR/lib/ps-walk.sh" 2>/dev/null || exit 0

# Hard safety rail — mirrors log-injection.sh:43-50 exactly, incl. query-string strip.
LAB_DB_PATH="${LAB_DATABASE_URL%%\?*}"; LAB_DB_PATH="${LAB_DB_PATH%%\#*}"
case "${LAB_DB_PATH##*/}" in
  nutricam | ocrecipes_solutions)
    echo "session-coord.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DB_PATH##*/}', a real app database" >&2
    exit 0 ;;
esac
command -v psql >/dev/null 2>&1 || exit 0
command -v jq   >/dev/null 2>&1 || exit 0

claude_pid() {
  if [ -n "${SESSION_COORD_CLAUDE_PID:-}" ]; then printf '%s\n' "$SESSION_COORD_CLAUDE_PID"; return 0; fi
  resolve_claude_pid
}

run_sql() { # stdin: SQL heredoc; args: -v pairs. Never fails the caller.
  psql -X -q -d "$LAB_DATABASE_URL" "$@" >/dev/null 2>&1 || true
}

log_event() { # $1 event, $2 session, $3 other, $4 detail-json
  run_sql -v ev="$1" -v sid="$2" -v oth="$3" -v det="${4:-{\}}" <<'SQL'
INSERT INTO harness.coordination_log (event, session_id, other_session, detail)
VALUES (:'ev', NULLIF(:'sid',''), NULLIF(:'oth',''), :'det'::jsonb);
SQL
}

git_root_of() { git -C "$1" rev-parse --show-toplevel 2>/dev/null; }

upsert_registry() { # $1 sid, $2 root, $3 kind-or-empty (empty = don't clobber kind)
  local branch head
  branch=$(git -C "$2" branch --show-current 2>/dev/null || echo "")
  head=$(git -C "$2" rev-parse HEAD 2>/dev/null || echo "")
  run_sql -v sid="$1" -v root="$2" -v kind="$3" -v br="$branch" -v hd="$head" -v pid="$$" -v ttl="$TTL" <<'SQL'
INSERT INTO harness.session_registry (session_id, pid, repo_root, branch, head_sha, session_kind, expires_at)
VALUES (:'sid', :pid, :'root', :'br', :'hd', COALESCE(NULLIF(:'kind',''),'unknown'), now() + :'ttl'::interval)
ON CONFLICT (session_id) DO UPDATE SET
  repo_root    = EXCLUDED.repo_root,
  branch       = EXCLUDED.branch,
  head_sha     = EXCLUDED.head_sha,
  session_kind = COALESCE(NULLIF(:'kind',''), harness.session_registry.session_kind),
  last_seen_at = now(),
  expires_at   = now() + :'ttl'::interval;
SQL
}

do_register() {
  local kind="" stdin_json=0 sid="" cwd="" root cpid
  while [ $# -gt 0 ]; do case "$1" in
    --stdin-json) stdin_json=1 ;;
    --kind) kind="${2:-}"; shift ;;
  esac; shift; done
  if [ "$stdin_json" -eq 1 ]; then
    local input; input=$(cat)
    sid=$(jq -re '.session_id // empty' <<<"$input" 2>/dev/null) || exit 0
    cwd=$(jq -re '.cwd // empty' <<<"$input" 2>/dev/null) || cwd="$PWD"
    [ -n "$cwd" ] || cwd="$PWD"
    # Default kind: tty on the claude process => interactive, else unknown (spec §5.1).
    if [ -z "$kind" ]; then
      cpid=$(claude_pid) || cpid=""
      case "$(ps -o tty= -p "${cpid:-0}" 2>/dev/null | tr -d '[:space:]')" in
        ''|'??'|'?') kind="unknown" ;;
        *)           kind="interactive" ;;
      esac
    fi
    # Bridge write (spec §5.1a) — best-effort.
    if cpid=$(claude_pid); then printf '%s' "$sid" > "$(bridge_file "$cpid")" 2>/dev/null || true; fi
  else
    # CLI mode (executor `--kind` re-upsert): session identity comes from the bridge
    # file, resolved through claude_pid so the SESSION_COORD_CLAUDE_PID test seam works.
    sid=$(bridge_read_via_seam) || exit 0
    cwd="$PWD"
  fi
  root=$(git_root_of "$cwd") || root="$cwd"
  [ -n "$root" ] || root="$cwd"
  upsert_registry "$sid" "$root" "$kind"
  do_reap
}

# resolve_session_id but honoring the SESSION_COORD_CLAUDE_PID test seam.
bridge_read_via_seam() {
  local cpid f
  cpid=$(claude_pid) || return 1
  f=$(bridge_file "$cpid")
  [ -r "$f" ] || return 1
  cat "$f"
}

do_record() {
  local input sid file dir root rel
  input=$(cat)
  sid=$(jq -re '.session_id // empty' <<<"$input" 2>/dev/null) || exit 0
  file=$(jq -re '.tool_input.file_path // empty' <<<"$input" 2>/dev/null) || exit 0
  [ -n "$file" ] || exit 0
  # rel_path from the FILE's containing worktree root — never the session cwd
  # (feedback_subagent_worktree_cwd). Walk up until an existing dir (Write may create).
  dir=$(dirname "$file")
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir=$(dirname "$dir"); done
  root=$(git_root_of "$dir") || exit 0
  [ -n "$root" ] || exit 0
  rel="${file#"$root"/}"
  upsert_registry "$sid" "$root" ""
  run_sql -v sid="$sid" -v abs="$file" -v rel="$rel" <<'SQL'
INSERT INTO harness.files_in_flight (session_id, abs_path, rel_path)
VALUES (:'sid', :'abs', :'rel')
ON CONFLICT (session_id, abs_path) DO UPDATE SET last_touch = now();
SQL
}

do_reap() {
  run_sql <<'SQL'
DELETE FROM harness.session_registry WHERE expires_at < now();
SQL
}

do_deregister() {
  local input sid cpid
  input=$(cat)
  sid=$(jq -re '.session_id // empty' <<<"$input" 2>/dev/null) || exit 0
  run_sql -v sid="$sid" <<'SQL'
DELETE FROM harness.session_registry WHERE session_id = :'sid';
SQL
  if cpid=$(claude_pid); then rm -f "$(bridge_file "$cpid")" 2>/dev/null || true; fi
}

do_refresh_snapshot() { :; }   # Task 4
do_consult() { :; }            # PR 2
do_attribute_drift() { :; }    # PR 2

SUB="${1:-}"; [ $# -gt 0 ] && shift
case "$SUB" in
  register)         do_register "$@" ;;
  record)           do_record ;;
  reap)             do_reap ;;
  deregister)       do_deregister ;;
  refresh-snapshot) do_refresh_snapshot "$@" ;;
  consult)          do_consult "$@" ;;
  attribute-drift)  do_attribute_drift "$@" ;;
esac
exit 0
```

Note the one wrinkle in `do_register` CLI mode: it calls `bridge_read_via_seam`, which is defined AFTER `do_register` in the file — fine in bash, since function bodies resolve names at call time and every call happens from the bottom-of-file dispatcher.

- [ ] **Step 4: Run to verify pass**

Run: `bash .claude/hooks/test-session-coord.sh`
Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/session-coord.sh .claude/hooks/test-session-coord.sh
git commit -m "feat(pg-lab): session-coord register/record/reap/deregister — lease upserts + bridge"
```

---

### Task 4: refresh-snapshot (atomic write + mkdir in-flight guard)

**Files:**

- Modify: `scripts/pg-lab/session-coord.sh` (fill `do_refresh_snapshot`)
- Test: append to `.claude/hooks/test-session-coord.sh`

**Interfaces:**

- Produces: `session-coord.sh refresh-snapshot --session <sid>` → writes `/tmp/claude-session-coord-<sid>.json` shaped `{"sessions":[{"session_id":…,"session_kind":…,"branch":…,"repo_root":…,"last_seen_at":…,"files":[{"abs_path":…,"rel_path":…}]}]}` containing every OTHER live session. Consult (Task 7) parses exactly this shape.

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```bash
# --- refresh-snapshot ------------------------------------------------------------------
# Seed two sessions: "me" and an "other" with one in-flight file.
psql -X -q -d "$TEST_URL" >/dev/null <<'SQL'
DELETE FROM harness.session_registry;
INSERT INTO harness.session_registry (session_id, repo_root, session_kind, branch) VALUES
 ('me',    '/tmp/checkout-a', 'interactive', 'main'),
 ('other', '/tmp/checkout-b', 'todo-executor', 'todo/foo');
INSERT INTO harness.files_in_flight (session_id, abs_path, rel_path) VALUES
 ('other', '/tmp/checkout-b/server/index.ts', 'server/index.ts');
SQL
bash "$SCRIPT" refresh-snapshot --session me >/dev/null 2>&1
assert_exit0 "refresh-snapshot exits 0" "$?"
SNAP="/tmp/claude-session-coord-me.json"
N_OTHER=$(jq -r '.sessions | length' "$SNAP" 2>/dev/null)
assert_eq "snapshot lists only OTHER sessions" "$N_OTHER" "1"
assert_eq "snapshot session id" "$(jq -r '.sessions[0].session_id' "$SNAP")" "other"
assert_eq "snapshot carries files" "$(jq -r '.sessions[0].files[0].rel_path' "$SNAP")" "server/index.ts"
rm -f "$SNAP"

# In-flight guard: a held lockdir makes a second refresh a silent no-op.
mkdir "/tmp/claude-session-coord-me.refresh-lock"
bash "$SCRIPT" refresh-snapshot --session me >/dev/null 2>&1
assert_exit0 "guarded refresh still exits 0" "$?"
[ ! -f "$SNAP" ] && echo "ok: guarded refresh wrote nothing" || { echo "FAIL: guard ignored"; FAIL=1; }
rmdir "/tmp/claude-session-coord-me.refresh-lock"
```

- [ ] **Step 2: Run to verify failure** — Expected: `snapshot lists only OTHER sessions` FAILs (no file written).

- [ ] **Step 3: Implement** — replace the `do_refresh_snapshot() { :; }` stub:

```bash
do_refresh_snapshot() {
  local sid="" lockdir snap tmp json
  while [ $# -gt 0 ]; do case "$1" in --session) sid="${2:-}"; shift ;; esac; shift; done
  [ -n "$sid" ] || exit 0
  snap="/tmp/claude-session-coord-${sid}.json"
  lockdir="/tmp/claude-session-coord-${sid}.refresh-lock"
  # In-flight guard (spec §5.1 flock intent; mkdir because flock(1) is absent on stock
  # macOS): losers exit silently, one refresh per burst.
  mkdir "$lockdir" 2>/dev/null || exit 0
  trap 'rmdir "$lockdir" 2>/dev/null' EXIT
  do_reap
  json=$(psql -X -qtA -d "$LAB_DATABASE_URL" -v sid="$sid" 2>/dev/null <<'SQL'
SELECT COALESCE(json_agg(s), '[]'::json) FROM (
  SELECT r.session_id, r.session_kind, r.branch, r.repo_root, r.last_seen_at,
         COALESCE((SELECT json_agg(json_build_object('abs_path', f.abs_path, 'rel_path', f.rel_path))
                   FROM harness.files_in_flight f WHERE f.session_id = r.session_id), '[]'::json) AS files
  FROM harness.session_registry r
  WHERE r.session_id <> :'sid' AND r.expires_at > now()
) s;
SQL
  ) || exit 0
  [ -n "$json" ] || exit 0
  tmp="${snap}.tmp.$$"
  printf '{"sessions":%s}\n' "$json" > "$tmp" 2>/dev/null || { rm -f "$tmp"; exit 0; }
  jq -e '.sessions' "$tmp" >/dev/null 2>&1 || { rm -f "$tmp"; exit 0; }  # never install corrupt JSON
  mv -f "$tmp" "$snap" 2>/dev/null || rm -f "$tmp"
}
```

- [ ] **Step 4: Run to verify pass** — Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/session-coord.sh .claude/hooks/test-session-coord.sh
git commit -m "feat(pg-lab): refresh-snapshot — atomic other-sessions snapshot + mkdir guard"
```

---

### Task 5: Hook wrapper + settings.json wiring (SessionStart / PostToolUse / SessionEnd)

**Files:**

- Create: `.claude/hooks/session-coord-hook.sh`
- Modify: `.claude/settings.json`
- Test: append to `.claude/hooks/test-session-coord.sh`

**Interfaces:**

- Consumes: `session-coord.sh` subcommands (Task 3).
- Produces: `session-coord-hook.sh <register|record|deregister|consult>` — reads hook JSON once from stdin; write-path subcommands are backgrounded with all output discarded (zero added latency); `consult` (wired in PR 2) runs synchronously and passes stdout through.

- [ ] **Step 1: Write the failing tests**

Append (these need no DB — place them BEFORE the live-Postgres gate, after the ps-walk block):

```bash
# --- hook wrapper (no DB needed) -------------------------------------------------------
WRAPPER="$PROJECT_ROOT/.claude/hooks/session-coord-hook.sh"
[ -f "$WRAPPER" ] || { echo "FAIL: session-coord-hook.sh missing"; FAIL=1; }
# Write-path calls must return immediately (<2s even though the child sleeps via an
# unreachable "DB" that has PGCONNECT_TIMEOUT=2), silently, exit 0.
START=$(date +%s)
OUT=$(printf '{"session_id":"w1","cwd":"/tmp"}' | LAB_DATABASE_URL="postgresql://10.255.255.1/lab" bash "$WRAPPER" register 2>/dev/null); RC=$?
ELAPSED=$(( $(date +%s) - START ))
assert_exit0 "wrapper register exit 0" "$RC"
assert_empty "wrapper register silent" "$OUT"
[ "$ELAPSED" -le 1 ] && echo "ok: wrapper backgrounds (returned in ${ELAPSED}s)" || { echo "FAIL: wrapper blocked ${ELAPSED}s"; FAIL=1; }
# Unknown subcommand: silent no-op.
OUT=$(printf '{}' | bash "$WRAPPER" bogus 2>/dev/null); RC=$?
assert_exit0 "wrapper bogus subcommand exit 0" "$RC"; assert_empty "wrapper bogus silent" "$OUT"
# settings.json wiring present:
for pair in "SessionStart:register" "PostToolUse:record" "SessionEnd:deregister"; do
  grep -q "session-coord-hook.sh ${pair#*:}" "$PROJECT_ROOT/.claude/settings.json" \
    && echo "ok: settings wires ${pair}" || { echo "FAIL: settings missing ${pair}"; FAIL=1; }
done
```

- [ ] **Step 2: Run to verify failure** — Expected: wrapper-missing + settings FAILs.

- [ ] **Step 3: Implement wrapper**

Create `.claude/hooks/session-coord-hook.sh` (mode 755):

```bash
#!/usr/bin/env bash
# .claude/hooks/session-coord-hook.sh — thin dispatch shim between Claude Code hook
# events and scripts/pg-lab/session-coord.sh (spec §5.3).
#
# Write-path subcommands (register/record/deregister) are BACKGROUNDED with stdout and
# stderr discarded: the hook returns immediately and a coordination failure can never
# slow or break the hot path. `consult` (PreToolUse, wired in PR 2) is the one
# synchronous subcommand — its stdout IS the hook's additionalContext output.
set -uo pipefail
SUB="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/pg-lab/session-coord.sh"
[ -f "$SCRIPT" ] || exit 0
INPUT=$(cat)
case "$SUB" in
  consult)
    printf '%s' "$INPUT" | bash "$SCRIPT" consult --stdin-json
    ;;
  register|record|deregister)
    printf '%s' "$INPUT" | bash "$SCRIPT" "$SUB" --stdin-json >/dev/null 2>&1 &
    ;;
esac
exit 0
```

- [ ] **Step 4: Wire settings.json**

In `.claude/settings.json`, add to the existing `SessionStart` matcher's `hooks` array (after `session-recent-issues.sh`):

```json
{
  "type": "command",
  "command": "bash .claude/hooks/session-coord-hook.sh register"
}
```

Add to the existing `PostToolUse` `Edit|Write|MultiEdit` matcher (the one running `eslint-fix.sh`):

```json
{
  "type": "command",
  "command": "bash .claude/hooks/session-coord-hook.sh record"
}
```

Add a new top-level `SessionEnd` event (FIRST SessionEnd hook in this repo — spec §5.3 flags its stdin contract as unverified; the wrapper only needs `.session_id`, and a contract surprise degrades to TTL-only cleanup):

```json
"SessionEnd": [
  { "matcher": "*", "hooks": [ { "type": "command", "command": "bash .claude/hooks/session-coord-hook.sh deregister" } ] }
]
```

- [ ] **Step 5: Run to verify pass** — `bash .claude/hooks/test-session-coord.sh` → `ALL PASS`. Also run the full hook-test suite once (`bash scripts/run-hook-tests.sh`) to prove no other hook test broke on the settings change.

- [ ] **Step 6: Live SessionEnd contract check (spec PR-1 verification item)**

Start a throwaway Claude Code session in this repo and exit it; then:

Run: `psql -X -qtA -d ocrecipes_lab -c "SELECT session_id, session_kind FROM harness.session_registry ORDER BY started_at DESC LIMIT 3"`
Expected: the just-exited session's row is GONE (deregister fired) — or, if SessionEnd's JSON lacks `session_id`, the row remains with a future `expires_at` (TTL fallback). Record which one happened in the PR description; if the fallback case, ALSO check `CLAUDE_SESSION_ID` in a Bash call (`env | grep -i claude`) and note availability for the §5.1a simplification.

- [ ] **Step 7: Commit + open PR 1**

```bash
git add .claude/hooks/session-coord-hook.sh .claude/settings.json .claude/hooks/test-session-coord.sh
git commit -m "feat(pg-lab): wire session-coord write path — SessionStart/PostToolUse/SessionEnd"
git push -u origin pg-lab/session-coord-write-path
gh pr create --title "feat(pg-lab): session coordination PR 1/3 — registry write path" \
  --body "Spec §11 PR 1: schema + session-coord.sh write path + hook wiring. No consumer-visible warnings yet (soak). Hooks touched -> individual review, no auto-merge. SessionEnd contract verification result: <fill from Step 6>."
```

Report the PR for individual review. **Do not arm auto-merge.** PR 2 starts only after PR 1 merges.

---

# PR 2 — Read path (`pg-lab/session-coord-read-path`)

### Task 6: consult — two warning levels, self-suppression, stale-while-revalidate

**Files:**

- Modify: `scripts/pg-lab/session-coord.sh` (fill `do_consult`)
- Test: append to `.claude/hooks/test-session-coord.sh`

**Interfaces:**

- Consumes: snapshot shape from Task 4; `log_event` from Task 3.
- Produces: on match, stdout gets `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"<warning text>"}}` (exact shape drift-detect.sh:66-71 emits); silent otherwise. Wrapper `consult` branch (Task 5) passes it through.

- [ ] **Step 1: Write the failing tests**

Append to the test file (inside the live-Postgres section):

```bash
# --- consult -----------------------------------------------------------------------
SNAPME="/tmp/claude-session-coord-consult-me.json"
mk_consult_input() { printf '{"session_id":"consult-me","tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$1"; }
cat > "$SNAPME" <<JSON
{"sessions":[{"session_id":"other-sess","session_kind":"interactive","branch":"main","repo_root":"/tmp/checkout-a","last_seen_at":"2026-07-10T00:00:00Z","files":[
  {"abs_path":"/tmp/checkout-a/server/index.ts","rel_path":"server/index.ts"},
  {"abs_path":"/tmp/checkout-a/shared/schema.ts","rel_path":"shared/schema.ts"}]}]}
JSON
touch "$SNAPME"  # fresh mtime -> no refresh spawn during these assertions

# Level 1: same abs_path -> collision warning naming the other session.
OUT=$(mk_consult_input "/tmp/checkout-a/server/index.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_contains "consult L1 emits additionalContext" "$OUT" '"hookEventName": "PreToolUse"'
assert_contains "consult L1 names other session" "$OUT" "other-sess"
assert_contains "consult L1 says same checkout" "$OUT" "same checkout"

# Level 2: same rel_path, DIFFERENT repo_root (file lives in /tmp/checkout-b).
OUT=$(mk_consult_input "/tmp/checkout-b/shared/schema.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_contains "consult L2 emits worktree note" "$OUT" "another worktree"

# No match -> silent.
OUT=$(mk_consult_input "/tmp/checkout-b/client/App.tsx" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_empty "consult no-match silent" "$OUT"

# Self-suppression: a snapshot row with OUR session_id must never warn.
cat > "$SNAPME" <<JSON
{"sessions":[{"session_id":"consult-me","session_kind":"interactive","branch":"main","repo_root":"/tmp/checkout-a","last_seen_at":"2026-07-10T00:00:00Z","files":[{"abs_path":"/tmp/x.ts","rel_path":"x.ts"}]}]}
JSON
touch "$SNAPME"
OUT=$(mk_consult_input "/tmp/x.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_empty "consult self-suppressed" "$OUT"

# Corrupt snapshot -> silent, exit 0.
printf 'not json' > "$SNAPME"; touch "$SNAPME"
OUT=$(mk_consult_input "/tmp/x.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null); RC=$?
assert_exit0 "consult corrupt snapshot exit 0" "$RC"; assert_empty "consult corrupt snapshot silent" "$OUT"

# Missing snapshot -> silent AND spawns a refresh (snapshot appears shortly).
rm -f "$SNAPME"
psql -X -q -d "$TEST_URL" -c "INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('consult-me','/tmp/checkout-c') ON CONFLICT (session_id) DO NOTHING" >/dev/null
OUT=$(mk_consult_input "/tmp/x.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_empty "consult missing snapshot silent" "$OUT"
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -f "$SNAPME" ] && break; sleep 0.3; done
[ -f "$SNAPME" ] && echo "ok: consult spawned async refresh" || { echo "FAIL: no refresh spawned"; FAIL=1; }
rm -f "$SNAPME"
```

- [ ] **Step 2: Run to verify failure** — Expected: every `consult` assertion FAILs (stub does nothing).

- [ ] **Step 3: Implement** — replace the `do_consult` stub:

```bash
snapshot_age_secs() { # portable mtime age; huge number when file missing
  local f="$1" mt
  mt=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null) || { echo 999999; return; }
  echo $(( $(date +%s) - mt ))
}

emit_context() { # $1 message -> PreToolUse additionalContext JSON (drift-detect shape)
  jq -n --arg m "$1" '{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": $m } }'
}

do_consult() {
  local input sid file snap age dir root rel match msg
  input=$(cat)
  sid=$(jq -re '.session_id // empty' <<<"$input" 2>/dev/null) || exit 0
  file=$(jq -re '.tool_input.file_path // empty' <<<"$input" 2>/dev/null) || exit 0
  [ -n "$file" ] || exit 0
  snap="/tmp/claude-session-coord-${sid}.json"
  age=$(snapshot_age_secs "$snap")
  # Stale-while-revalidate (spec §5.1): use whatever we have NOW; refresh in background.
  if [ "$age" -gt 25 ]; then
    bash "$SELF_DIR/session-coord.sh" refresh-snapshot --session "$sid" >/dev/null 2>&1 &
  fi
  [ -f "$snap" ] || exit 0
  # rel_path of the target, from the FILE's containing worktree (same walk as record).
  dir=$(dirname "$file")
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir=$(dirname "$dir"); done
  root=$(git_root_of "$dir") || root=""
  rel=""; [ -n "$root" ] && rel="${file#"$root"/}"
  # One jq pass: level|sid|kind|branch|age-minutes for the first match, self excluded.
  match=$(jq -r --arg f "$file" --arg rel "$rel" --arg root "$root" --arg me "$sid" '
    [ .sessions[]? | select(.session_id != $me) | . as $s | .files[]?
      | if .abs_path == $f then {lvl:"collision",s:$s}
        elif ($rel != "" and .rel_path == $rel and $s.repo_root != $root) then {lvl:"worktree",s:$s}
        else empty end
    ] | .[0] // empty
    | "\(.lvl)\u001f\(.s.session_id)\u001f\(.s.session_kind)\u001f\(.s.branch // "?")\u001f\(.s.last_seen_at)"
  ' "$snap" 2>/dev/null) || exit 0
  [ -n "$match" ] || exit 0
  local lvl osid okind obranch oseen
  IFS=$'\x1f' read -r lvl osid okind obranch oseen <<<"$match"
  case "$lvl" in
    collision)
      msg="Session ${osid:0:8} (${okind}, branch ${obranch}, last seen ${oseen}) is mid-edit on this same file in this same checkout. Coordinate before editing — parallel same-file edits here produced tangled commits before. (Warn-only.)"
      log_event "warn-collision" "$sid" "$osid" "{\"file\":$(jq -Rn --arg v "$file" '$v')}" &
      ;;
    worktree)
      msg="Session ${osid:0:8} (${okind}, branch ${obranch}) is editing the same file in another worktree — expect a merge conflict when both land. (Warn-only.)"
      log_event "warn-worktree" "$sid" "$osid" "{\"file\":$(jq -Rn --arg v "$file" '$v')}" &
      ;;
    *) exit 0 ;;
  esac
  emit_context "$msg"
}
```

- [ ] **Step 4: Run to verify pass** — Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/session-coord.sh .claude/hooks/test-session-coord.sh
git commit -m "feat(pg-lab): consult — two-level attributed warnings, self-suppression, SWR snapshot"
```

---

### Task 7: PreToolUse wiring

**Files:**

- Modify: `.claude/settings.json`
- Test: append one assertion to `.claude/hooks/test-session-coord.sh` (no-DB section)

- [ ] **Step 1: Failing test** — add to the settings-wiring loop in the Task 5 test block: change the `for pair in` list to `"SessionStart:register" "PostToolUse:record" "SessionEnd:deregister" "PreToolUse:consult"`.

- [ ] **Step 2: Run to verify failure** — `FAIL: settings missing PreToolUse:consult`.

- [ ] **Step 3: Implement** — in `.claude/settings.json`, add to EACH of the three PreToolUse matchers `Edit`, `Write`, `MultiEdit` (the ones running `inject-patterns.sh`), after `guard-worktree-isolation.sh`:

```json
{
  "type": "command",
  "command": "bash .claude/hooks/session-coord-hook.sh consult"
}
```

- [ ] **Step 4: Run to verify pass**, then run the full suite `bash scripts/run-hook-tests.sh` — all hook tests green.

- [ ] **Step 5: Commit**

```bash
git add .claude/settings.json .claude/hooks/test-session-coord.sh
git commit -m "feat(pg-lab): wire consult into PreToolUse Edit/Write/MultiEdit"
```

---

### Task 8: drift-detect attribution

**Files:**

- Modify: `scripts/pg-lab/session-coord.sh` (fill `do_attribute_drift`)
- Modify: `.claude/hooks/drift-detect.sh:63-64` (append attribution to MSG)
- Test: append to `.claude/hooks/test-session-coord.sh`; extend `.claude/hooks/test-drift-detect.sh`

**Interfaces:**

- Produces: `session-coord.sh attribute-drift <session_id> <repo_root>` → prints EXACTLY ONE line: `Attribution: session <id8> (<kind>, branch <b>) is registered in this checkout, last seen <ts>.` or `Attribution: no other live session registered here — likely your own manual git op or a stale baseline.` Empty stdout on any DB failure (drift-detect then shows today's message unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `test-session-coord.sh`:

```bash
# --- attribute-drift ---------------------------------------------------------------
psql -X -q -d "$TEST_URL" >/dev/null <<'SQL'
DELETE FROM harness.session_registry;
INSERT INTO harness.session_registry (session_id, repo_root, session_kind, branch)
VALUES ('drift-other', '/tmp/checkout-a', 'goal', 'main');
SQL
OUT=$(bash "$SCRIPT" attribute-drift "drift-me" "/tmp/checkout-a" 2>/dev/null)
assert_contains "attribute: names other session" "$OUT" "drift-ot"
assert_contains "attribute: names kind" "$OUT" "goal"
OUT=$(bash "$SCRIPT" attribute-drift "drift-me" "/tmp/checkout-elsewhere" 2>/dev/null)
assert_contains "attribute: empty registry -> own-op line" "$OUT" "no other live session"
OUT=$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" bash "$SCRIPT" attribute-drift "x" "/y" 2>/dev/null); RC=$?
assert_exit0 "attribute: PG down exit 0" "$RC"; assert_empty "attribute: PG down silent" "$OUT"
```

- [ ] **Step 2: Run to verify failure** — attribute assertions FAIL (stub).

- [ ] **Step 3: Implement** — replace the `do_attribute_drift` stub:

```bash
do_attribute_drift() {
  local sid="${1:-}" root="${2:-}" row
  [ -n "$sid" ] && [ -n "$root" ] || exit 0
  row=$(psql -X -qtA -F$'\x1f' -d "$LAB_DATABASE_URL" -v sid="$sid" -v root="$root" 2>/dev/null <<'SQL'
SELECT session_id, session_kind, COALESCE(branch,'?'), last_seen_at
FROM harness.session_registry
WHERE session_id <> :'sid' AND repo_root = :'root' AND expires_at > now()
ORDER BY last_seen_at DESC LIMIT 1;
SQL
  ) || exit 0
  # psql itself failed silently -> $row empty AND rc hidden by || exit 0 above; a reachable
  # DB with no match also yields empty. Disambiguate with a cheap liveness probe: only
  # print the "no other session" line when the DB answered.
  if [ -n "$row" ]; then
    local osid okind obranch oseen
    IFS=$'\x1f' read -r osid okind obranch oseen <<<"$row"
    printf 'Attribution: session %s (%s, branch %s) is registered in this checkout, last seen %s.\n' \
      "${osid:0:8}" "$okind" "$obranch" "$oseen"
    log_event "drift-attributed" "$sid" "$osid" '{}' &
  else
    psql -X -q -d "$LAB_DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1 || exit 0
    printf 'Attribution: no other live session registered here — likely your own manual git op or a stale baseline.\n'
    log_event "drift-unattributed" "$sid" "" '{}' &
  fi
}
```

- [ ] **Step 4: Patch drift-detect.sh**

In `.claude/hooks/drift-detect.sh`, immediately AFTER the `MSG="Drift detected: ..."` line (line 64), insert:

```bash
# Registry attribution (PG Lab session coordination, spec §6) — best-effort: empty when
# Postgres is down or the script is absent, leaving today's message untouched.
COORD="$(git rev-parse --show-toplevel 2>/dev/null)/scripts/pg-lab/session-coord.sh"
if [ -f "$COORD" ]; then
  ATTRIB=$(bash "$COORD" attribute-drift "$SESSION" "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || true)
  [ -n "$ATTRIB" ] && MSG="$MSG $ATTRIB"
fi
```

- [ ] **Step 5: Extend test-drift-detect.sh**

Append to `.claude/hooks/test-drift-detect.sh` (before its final pass/fail line), matching that file's existing helper style:

```bash
# Attribution enrichment: with an unreachable lab DB the drift message must be EXACTLY
# the classic one (no attribution suffix, no error) — the fail-silent contract.
# (Uses the same drift fixture as the case above it; only LAB_DATABASE_URL changes.)
OUT=$(printf '%s' "$DRIFT_INPUT" | LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" bash "$HOOK" 2>/dev/null)
grep -q 'Drift detected' <<<"$OUT" && ! grep -q 'Attribution:' <<<"$OUT" \
  && echo "ok: PG-down drift message has no attribution suffix" \
  || { echo "FAIL: attribution leaked into PG-down drift path"; FAIL=1; }
```

(`$DRIFT_INPUT` / `$HOOK`: reuse whatever variable names the existing drifted-HEAD test case in that file already uses — read the file first and match them.)

- [ ] **Step 6: Run both test files to verify pass**

Run: `bash .claude/hooks/test-session-coord.sh && bash .claude/hooks/test-drift-detect.sh`
Expected: both `ALL PASS`.

- [ ] **Step 7: Commit + open PR 2**

```bash
git add scripts/pg-lab/session-coord.sh .claude/hooks/drift-detect.sh .claude/hooks/test-session-coord.sh .claude/hooks/test-drift-detect.sh
git commit -m "feat(pg-lab): drift-detect attribution via session registry"
git push -u origin pg-lab/session-coord-read-path
gh pr create --title "feat(pg-lab): session coordination PR 2/3 — consult warnings + drift attribution" \
  --body "Spec §11 PR 2: two-level attributed warnings on PreToolUse, drift-detect enrichment. Hooks touched -> individual review, no auto-merge."
```

---

# PR 3 — Mutex (`pg-lab/session-coord-mutex`)

### Task 9: db-serial-lock.sh

**Files:**

- Create: `scripts/pg-lab/db-serial-lock.sh`
- Test: create `.claude/hooks/test-db-serial-lock.sh`

**Interfaces:**

- Consumes: `lib/ps-walk.sh` (Task 2); `coordination_log` (Task 1).
- Produces: `db-serial-lock.sh acquire [--key K] [--watch-pid P] [--wait-secs N]` → exit 0 acquired OR fail-open (WARN printed), exit 2 timeout (holder identity printed), exit 3 watch-pid unresolvable (WARN printed); `release [--key K]`; `status [--key K]` → prints `free` or `held by <application_name>`. Default key `db-serial:nutricam`. Env knobs: `WATCH_INTERVAL_SECS` (default 30), `SESSION_COORD_CLAUDE_PID` (test seam, via ps-walk callers).

- [ ] **Step 1: Write the failing tests**

Create `.claude/hooks/test-db-serial-lock.sh` (mode 755):

```bash
#!/usr/bin/env bash
# Unit test for scripts/pg-lab/db-serial-lock.sh. CI Lint job has no Postgres -> skip
# cleanly; locally exercises real advisory-lock races against a throwaway DB.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
LOCK="$PROJECT_ROOT/scripts/pg-lab/db-serial-lock.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/session-coordination.sql"
FAIL=0
assert_exit() { if [ "$2" -eq "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit $3, got $2"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }

# Fail-open: unreachable DB -> WARN on stderr, exit 0 (proceed unlocked).
OUT=$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" bash "$LOCK" acquire --watch-pid $$ 2>&1); RC=$?
assert_exit "PG down -> fail-open exit 0" "$RC" 0
assert_contains "PG down -> visible WARN" "$OUT" "proceeding unlocked"

# Denylist still applies.
OUT=$(LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$LOCK" acquire --watch-pid $$ 2>&1); RC=$?
assert_exit "denylist refusal exit 0" "$RC" 0
assert_contains "denylist names nutricam" "$OUT" "nutricam"

# Unresolvable watch-pid: no --watch-pid and no claude ancestor -> WARN + exit 3, no lock.
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }
TEST_DB="pg_lab_dbserial_test_$$"; TEST_URL="postgresql://localhost/$TEST_DB"
cleanup() { bash "$LOCK" release --key "k-$$" >/dev/null 2>&1; rm -f /tmp/claude-db-serial-*-k-$$* 2>/dev/null; psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1; }
trap cleanup EXIT
LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
export LAB_DATABASE_URL="$TEST_URL"

OUT=$(SESSION_COORD_PS_WALK_DISABLE=1 bash "$LOCK" acquire --key "k-$$" 2>&1); RC=$?
assert_exit "unresolvable watch-pid -> exit 3" "$RC" 3
assert_contains "exit-3 WARN text" "$OUT" "watch-pid unresolvable"
STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
assert_contains "no lock taken on exit 3" "$STATUS" "free"

# Acquire + status + release round-trip (watch this test shell).
bash "$LOCK" acquire --key "k-$$" --watch-pid $$ --wait-secs 10 >/dev/null 2>&1
assert_exit "acquire succeeds" "$?" 0
STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
assert_contains "status shows held" "$STATUS" "held"
# Second acquirer with a short wait must time out with exit 2 and name the holder.
# WATCH_INTERVAL_SECS=1: the loser's wrapper must notice its psql's lock_timeout death
# promptly (the default 30s poll would outlive the acquirer's own wait budget).
OUT=$(WATCH_INTERVAL_SECS=1 bash "$LOCK" acquire --key "k-$$" --watch-pid $$ --wait-secs 3 2>&1); RC=$?
assert_exit "contended acquire -> exit 2" "$RC" 2
assert_contains "timeout names holder" "$OUT" "db-serial-holder-"
bash "$LOCK" release --key "k-$$" >/dev/null 2>&1
assert_exit "release exits 0" "$?" 0
STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
assert_contains "released -> free" "$STATUS" "free"

# Orphan release: watch a THROWAWAY pid (not the holder) and kill IT — proves the
# resolved watch-pid is what frees the lock (spec-review validation requirement).
sleep 300 & WATCHED=$!
WATCH_INTERVAL_SECS=1 bash "$LOCK" acquire --key "k-$$" --watch-pid "$WATCHED" --wait-secs 10 >/dev/null 2>&1
assert_exit "orphan-test acquire" "$?" 0
kill "$WATCHED" 2>/dev/null
for _ in $(seq 1 20); do
  STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
  grep -q free <<<"$STATUS" && break; sleep 0.5
done
assert_contains "killing WATCHED pid frees the lock" "$STATUS" "free"

# kill -9 the holder's CLIENT psql: connection death frees the lock instantly. Target the
# psql child of the wrapper (pgrep -P) — NOT the wrapper (that would orphan psql, which
# keeps the connection and the lock alive for up to 24h) and NOT the server backend
# (SIGKILL on a Postgres backend triggers cluster-wide crash recovery).
bash "$LOCK" acquire --key "k-$$" --watch-pid $$ --wait-secs 10 >/dev/null 2>&1
WRAPPER_PID=$(cat /tmp/claude-db-serial-*-k-$$*.pid 2>/dev/null | head -1)
PSQL_PID=$(pgrep -P "$WRAPPER_PID" 2>/dev/null | head -1)
kill -9 "$PSQL_PID" 2>/dev/null
for _ in $(seq 1 20); do
  STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
  grep -q free <<<"$STATUS" && break; sleep 0.5
done
assert_contains "kill -9 holder frees the lock" "$STATUS" "free"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
```

- [ ] **Step 2: Run to verify failure** — every assertion FAILs (script missing).

- [ ] **Step 3: Implement**

Create `scripts/pg-lab/db-serial-lock.sh` (mode 755):

```bash
#!/usr/bin/env bash
# scripts/pg-lab/db-serial-lock.sh — the ONE real lock in session coordination
# (spec §5.2): a pg_advisory_lock held by an ephemeral background psql whose lifetime IS
# the lock lifetime. Postgres frees the lock the instant that connection dies — crash,
# kill -9, reboot — so there is no TTL to tune and no reaper to run.
#
# Exit codes (the caller contract, spec §5.2 + failure rows 1/9/14):
#   0  acquired — or fail-open (Postgres unreachable; WARN printed; proceed unlocked)
#   2  bounded wait expired; another holder kept the lock (identity printed) — the /todo
#      executor marks its todo `blocked`, never proceeds
#   3  watch-pid unresolvable — refused to hold an unwatchable lock; proceed unlocked
#
# NOT fail-silent by design: acquire's WARN/identity lines are the feature's only
# non-silent surface. release/status are quiet + exit 0 on any failure.
#
# --wait-secs default 570: one synchronous Bash tool call caps at 600s, so the spec's
# "15-min bounded wait" is delivered as two dispatched attempts (dispatch prompt retries
# exit 2 once) ≈ 19 min total.
set -uo pipefail
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-2}"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
WATCH_INTERVAL_SECS="${WATCH_INTERVAL_SECS:-30}"
DEFAULT_KEY="db-serial:nutricam"

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SELF_DIR="$(dirname "$SELF")"
. "$SELF_DIR/lib/ps-walk.sh" 2>/dev/null || exit 0

LAB_DB_PATH="${LAB_DATABASE_URL%%\?*}"; LAB_DB_PATH="${LAB_DB_PATH%%\#*}"
case "${LAB_DB_PATH##*/}" in
  nutricam | ocrecipes_solutions)
    echo "db-serial-lock.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DB_PATH##*/}', a real app database" >&2
    exit 0 ;;
esac
command -v psql >/dev/null 2>&1 || { echo "WARN: psql missing — proceeding unlocked" >&2; exit 0; }

key_hash() { printf '%s' "$1" | cksum | cut -d' ' -f1; }
sid_or_pid() { resolve_session_id 2>/dev/null || printf 'pid:%s' "${1:-unknown}"; }
log_lock_event() { # $1 event, $2 sid, $3 detail-json — best-effort
  psql -X -q -d "$LAB_DATABASE_URL" -v ev="$1" -v sid="$2" -v det="${3:-{\}}" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO harness.coordination_log (event, session_id, detail) VALUES (:'ev', :'sid', :'det'::jsonb);
SQL
}

parse_common() {
  KEY="$DEFAULT_KEY"; WATCH_PID=""; WAIT_SECS=570
  while [ $# -gt 0 ]; do case "$1" in
    --key)       KEY="${2:-$DEFAULT_KEY}"; shift ;;
    --watch-pid) WATCH_PID="${2:-}"; shift ;;
    --wait-secs) WAIT_SECS="${2:-570}"; shift ;;
  esac; shift; done
  KH=$(key_hash "$KEY")
  # PIDFILE is shared per key but written ONLY by the one successful acquirer (below);
  # STATUSFILE is per-invocation ($$) — a losing acquirer must never truncate or read the
  # winner's status channel (same-machine contention is the mutex's whole reason to exist).
  PIDFILE="/tmp/claude-db-serial-${KH}-${KEY//[^a-zA-Z0-9_-]/_}.pid"
  STATUSFILE="/tmp/claude-db-serial-${KH}-${KEY//[^a-zA-Z0-9_-]/_}.status.$$"
}

do_acquire() {
  parse_common "$@"
  psql -X -q -d "$LAB_DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1 || {
    echo "WARN: lock unavailable (Postgres down) — proceeding unlocked" >&2; exit 0; }
  if [ -z "$WATCH_PID" ]; then
    if [ -n "${SESSION_COORD_PS_WALK_DISABLE:-}" ]; then WATCH_PID=""; else
      WATCH_PID=$(resolve_claude_pid 2>/dev/null || true)
    fi
  fi
  if [ -z "$WATCH_PID" ] || ! kill -0 "$WATCH_PID" 2>/dev/null; then
    echo "WARN: watch-pid unresolvable — refusing to hold an unwatchable lock (pass --watch-pid explicitly); proceeding unlocked" >&2
    exit 3
  fi
  local sid; sid=$(sid_or_pid "$WATCH_PID")
  : > "$STATUSFILE"
  trap 'rm -f "$STATUSFILE"' EXIT   # per-invocation channel; never leave litter
  nohup bash "$SELF" __holder "$KEY" "$WATCH_PID" "$STATUSFILE" "$WAIT_SECS" "$sid" >/dev/null 2>&1 &
  local holder_pid=$!
  local waited=0
  while [ "$waited" -le $(( WAIT_SECS + 15 )) ]; do
    if grep -q '^ACQUIRED$' "$STATUSFILE" 2>/dev/null; then
      # Pidfile written ONLY on success: a timeout loser must never clobber the winner's.
      echo "$holder_pid" > "$PIDFILE"
      log_lock_event "lock-acquired" "$sid" "{\"key\":\"$KEY\"}"
      echo "acquired: $KEY (holder pidfile $PIDFILE)"
      exit 0
    fi
    if grep -q '^TIMEOUT$' "$STATUSFILE" 2>/dev/null; then
      local holder
      holder=$(psql -X -qtA -d "$LAB_DATABASE_URL" -c \
        "SELECT application_name FROM pg_stat_activity WHERE application_name LIKE 'db-serial-holder-${KH}-%' LIMIT 1" 2>/dev/null)
      log_lock_event "lock-timeout" "$sid" "{\"key\":\"$KEY\",\"holder\":\"${holder:-unknown}\"}"
      echo "TIMEOUT: lock '$KEY' still held by ${holder:-db-serial-holder-(unknown)} after ${WAIT_SECS}s" >&2
      exit 2
    fi
    sleep 1; waited=$(( waited + 1 ))
  done
  echo "TIMEOUT: no holder status after $(( WAIT_SECS + 15 ))s" >&2
  exit 2
}

do_holder() { # __holder <key> <watch-pid> <statusfile> <wait-secs> <sid>
  local key="$1" watch="$2" status="$3" wait_ms=$(( $4 * 1000 )) sid="$5"
  local kh; kh=$(key_hash "$key")
  export PGAPPNAME="db-serial-holder-${kh}-${sid}"
  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v k="$key" -v lt="$wait_ms" >> "$status" 2>/dev/null <<'SQL' &
SELECT set_config('lock_timeout', :'lt', false);
SELECT pg_advisory_lock(hashtext(:'k'));
\echo ACQUIRED
SELECT pg_sleep(86400);
SQL
  local psql_pid=$!
  while kill -0 "$psql_pid" 2>/dev/null; do
    if ! kill -0 "$watch" 2>/dev/null; then
      kill "$psql_pid" 2>/dev/null
      log_lock_event "lock-orphan-released" "$sid" "{\"key\":\"$key\"}"
      exit 0
    fi
    sleep "$WATCH_INTERVAL_SECS"
  done
  # psql exited on its own: lock_timeout fired (loser — its acquire is still polling, so
  # write TIMEOUT for it) or the 24h sleep/backend termination ended a stale winner (its
  # acquire is long gone and already removed the statusfile via trap — clean up, don't
  # recreate litter).
  grep -q '^ACQUIRED$' "$status" 2>/dev/null && rm -f "$status" || echo "TIMEOUT" >> "$status"
}

do_release() {
  parse_common "$@"
  local sid; sid=$(sid_or_pid "")
  if [ -f "$PIDFILE" ]; then
    # Kill the holder wrapper AND its psql child (pkill -P), then the wrapper itself.
    local hp; hp=$(cat "$PIDFILE" 2>/dev/null)
    [ -n "$hp" ] && { pkill -P "$hp" 2>/dev/null; kill "$hp" 2>/dev/null; }
    rm -f "$PIDFILE"
  else
    # Fallback (spec §5.2 / failure row 12): terminate server-side by application_name —
    # NEVER by the registry's session pid, which is the Claude Code process.
    psql -X -q -d "$LAB_DATABASE_URL" -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 'db-serial-holder-${KH}-%'" >/dev/null 2>&1 || true
  fi
  log_lock_event "lock-released" "$sid" "{\"key\":\"$KEY\"}"
  exit 0
}

do_status() {
  parse_common "$@"
  local res
  res=$(psql -X -qtA -d "$LAB_DATABASE_URL" -v k="$KEY" 2>/dev/null <<'SQL'
SELECT CASE WHEN pg_try_advisory_lock(hashtext(:'k'))
  THEN (SELECT 'free' FROM pg_advisory_unlock(hashtext(:'k')))
  ELSE 'held' END;
SQL
  ) || { echo "unknown (Postgres unreachable)"; exit 0; }
  if [ "$res" = "held" ]; then
    local holder
    holder=$(psql -X -qtA -d "$LAB_DATABASE_URL" -c \
      "SELECT application_name FROM pg_stat_activity WHERE application_name LIKE 'db-serial-holder-${KH}-%' LIMIT 1" 2>/dev/null)
    echo "held by ${holder:-db-serial-holder-(unknown)}"
  else
    echo "free"
  fi
  exit 0
}

case "${1:-}" in
  acquire)  shift; do_acquire "$@" ;;
  release)  shift; do_release "$@" ;;
  status)   shift; do_status  "$@" ;;
  __holder) shift; do_holder  "$@" ;;
  *) echo "usage: db-serial-lock.sh acquire|release|status [--key K] [--watch-pid P] [--wait-secs N]" >&2; exit 0 ;;
esac
```

- [ ] **Step 4: Run to verify pass**

Run: `bash .claude/hooks/test-db-serial-lock.sh`
Expected: `ALL PASS`. The orphan and kill−9 cases take up to ~15 s combined (poll loops).

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/db-serial-lock.sh .claude/hooks/test-db-serial-lock.sh
git commit -m "feat(pg-lab): db-serial advisory lock — ephemeral holder, watch-pid, bounded wait"
```

---

### Task 10: /todo orchestration wiring + live-fire kind check

**Files:**

- Modify: `.claude/skills/todo/SKILL.md` (Phase 3 batching, line ~211 area; Executor dispatch, line ~250 area)

- [ ] **Step 1: Phase 3 DB-serial batch rule**

In `.claude/skills/todo/SKILL.md`, after step 4 of Phase 3 ("Todos that mention NO specific files must run sequentially."), insert a new step (renumber the following steps):

```markdown
5. **DB-serial todos get their own sequential batch.** A todo whose body mentions
   `shared/schema.ts`, `migrations/`, `drizzle`, or `db:push` performs DDL against the
   shared dev database — mark it `[db-serial]` in the plan display and schedule it alone
   in a sequential batch (feedback_todo_parallel_shared_dev_db). The executor-side
   advisory lock (`scripts/pg-lab/db-serial-lock.sh`, dispatched below) is the enforcement
   backstop for the runs this planning rule cannot see (a second orchestrator, a manual
   session); it does not replace this rule.
```

- [ ] **Step 2: Dispatch-prompt additions**

In the "Executor dispatch (shared by both batch types)" section, extend the `prompt:` string in the Agent call template. After `"Base branch: <BASE_BRANCH>\nMain checkout: <MAIN_CHECKOUT>\n\n"`, add:

```markdown
First action, before any other step: run
`scripts/pg-lab/session-coord.sh register --kind todo-executor`
(registers this session's kind in the coordination registry; silently no-ops if Postgres is down).
```

And append this paragraph to the section, after the `<MAIN_CHECKOUT>` substitution note:

```markdown
**DB-serial todos only** (marked `[db-serial]` in Phase 3): add this block to the dispatch prompt —

> Before your first `db:push`/DDL step: resolve the session pid with
> `WATCH_PID=$(bash -c '. scripts/pg-lab/lib/ps-walk.sh && resolve_claude_pid')`, then run
> `scripts/pg-lab/db-serial-lock.sh acquire --watch-pid "$WATCH_PID"` with a Bash timeout of 600000. Exit 0 → proceed. Exit 2 → retry the acquire ONCE; a second exit 2 means another
> session is live on the shared dev DB — mark this todo `blocked` with an ACTION NEEDED
> reason quoting the holder identity the command printed, and stop. Exit 3 → proceed
> unlocked and note "db-serial lock unavailable (watch-pid unresolvable)" in the PR body.
> On completion — success OR failure — run `scripts/pg-lab/db-serial-lock.sh release`.
```

- [ ] **Step 3: Live-fire kind check (spec-review validation requirement)**

Dispatch one real throwaway executor via the Agent tool (any trivial prompt works — it must follow the new first-action instruction, e.g. "Run `scripts/pg-lab/session-coord.sh register --kind todo-executor` then report done"), then verify post-hoc:

Run: `psql -X -qtA -d ocrecipes_lab -c "SELECT session_kind FROM harness.session_registry ORDER BY last_seen_at DESC LIMIT 1"`
Expected: `todo-executor`. If it reads `interactive`/`unknown`, the bridge resolution failed from the subagent's shell — debug `resolve_claude_pid` from an Agent-tool Bash call before proceeding, and record findings in the PR body.

- [ ] **Step 4: Commit + open PR 3**

```bash
git add .claude/skills/todo/SKILL.md
git commit -m "feat(pg-lab): /todo DB-serial batching rule + executor lock/register dispatch"
git push -u origin pg-lab/session-coord-mutex
gh pr create --title "feat(pg-lab): session coordination PR 3/3 — DB-serial mutex + /todo wiring" \
  --body "Spec §11 PR 3: db-serial-lock.sh + orchestrator dispatch wiring. Live-fire kind check result: <fill from Step 3>. Hooks/skill touched -> individual review, no auto-merge."
```

---

### Task 11: Close-out

**Files:**

- Modify: `docs/superpowers/specs/2026-07-10-pg-session-coordination-design.md` (local-only, no commit)
- Modify → archive: `todos/P3-2026-07-10-pg-session-coordination-implementation.md`

- [ ] **Step 1: Spec amendment** — in §5.2, append to the `--wait-secs` discussion: "Implementation note (2026-07-xx): delivered as `--wait-secs 570` default + one dispatched retry (Bash tool 600s ceiling) ≈ 19 min bounded wait." Update the spec's Status line to "Implemented — PRs #<n1>/#<n2>/#<n3>".
- [ ] **Step 2: Todo close-out** — after PR 3 merges: check all ACs in `todos/P3-2026-07-10-pg-session-coordination-implementation.md` (the live-fire and SessionEnd verification results go in an Updates entry), note the value-probe date (~60 days after PR 3's merge date), `git mv` to `todos/archive/` on a fresh branch, PR it (this one is docs-only — auto-merge is fine), and update the PG Lab roadmap memory's Phase D line.
- [ ] **Step 3: Codify** — run `/codify` over the three merged PRs; candidate solution docs surfaced during implementation (at minimum: "flock is absent on stock macOS — mkdir is the portable atomic lock" and "background holder processes must watch a long-lived ancestor, not the spawning shell") go through its normal overlap-check flow.

---

## Self-Review (performed at write time; second pass fixed four defects inline)

Second-pass fixes, recorded so reviewers know these paths got extra scrutiny: (1) Task 6's jq field separators are the VISIBLE escape `\u001f` — do not "simplify" them away, the `IFS=$'\x1f' read` depends on them; (2) Task 9's statusfile is per-invocation (`.$$`) and the pidfile is written only on successful acquire — both exist to survive same-machine contention, the mutex's core scenario; (3) the contended-acquire test needs `WATCH_INTERVAL_SECS=1` or the loser's TIMEOUT arrives after the acquirer's poll budget; (4) the kill−9 test targets the wrapper's psql CHILD — killing the wrapper orphans the connection, killing the server backend triggers crash recovery.

- **Spec coverage:** §4 schema → Task 1; §5.1 CLI (register/record/refresh/reap/deregister) → Tasks 3–4; §5.1a bridge → Tasks 2–3; §5.2 lock incl. exit codes 2/3, application_name fallback, watch-pid rules → Task 9; §5.3 wiring incl. SessionEnd caveat → Tasks 5, 7; §6 warnings + self-suppression → Task 6; §7 failure rows exercised: 1 (fail-silent tests everywhere), 2 (reap test), 3–4 (L1/L2 consult tests), 6 (corrupt snapshot), 7 (orphan test), 9 (exit 2), 12 (release fallback path), 14 (exit 3), 15 (`sid_or_pid` fallback); §8 test plan incl. both spec-review validation requirements → Tasks 5.6, 9.1, 10.3; §10 probe → ledger events emitted throughout + Task 11 probe date; §11 3-PR split → PR boundaries. Row 5 (subagent paths) is covered by design in `record`'s per-file root walk; row 8 (machine crash) is untestable locally and relies on Postgres semantics — noted, accepted.
- **Placeholder scan:** the two `<fill from Step N>` slots in PR bodies are deliberate runtime-result insertions, not placeholders; no TBDs remain.
- **Type consistency:** snapshot field names (`session_id`, `session_kind`, `branch`, `repo_root`, `last_seen_at`, `files[].abs_path/.rel_path`) match between Task 4 (producer) and Task 6 (consumer); `--stdin-json` flag consistent across wrapper and CLI; pidfile glob in Task 9's test matches `parse_common`'s pidfile pattern; exit codes consistent between Task 9 and Task 10's dispatch text.
