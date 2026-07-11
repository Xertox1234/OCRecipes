#!/usr/bin/env bash
# scripts/pg-lab/db-serial-lock.sh — the ONE real lock in session coordination
# (spec §5.2): a pg_advisory_lock held by an ephemeral background psql whose lifetime IS
# the lock lifetime. Postgres frees the lock within ~2s of that connection dying — crash,
# kill -9, reboot — so there is no TTL to tune and no reaper to run. (The holder arms
# client_connection_check_interval; without it a backend inside pg_sleep would not
# notice client death until query end.)
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
SELECT set_config('client_connection_check_interval', '2s', false);
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
  # Server-side termination is the AUTHORITATIVE release (spec §5.2 / failure row 12):
  # pg_terminate_backend by application_name is synchronous — the lock is free the moment
  # it returns. A client-side kill alone leaves the backend holding the lock until the
  # connection check fires. NEVER terminate by the registry's session pid, which is the
  # Claude Code process.
  psql -X -q -d "$LAB_DATABASE_URL" -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 'db-serial-holder-${KH}-%'" >/dev/null 2>&1 || true
  if [ -f "$PIDFILE" ]; then
    # Local-process hygiene, no longer the correctness path: kill the holder wrapper AND
    # its psql child (pkill -P), then the wrapper itself.
    local hp; hp=$(cat "$PIDFILE" 2>/dev/null)
    [ -n "$hp" ] && { pkill -P "$hp" 2>/dev/null; kill "$hp" 2>/dev/null; }
    rm -f "$PIDFILE"
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
