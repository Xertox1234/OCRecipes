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

do_refresh_snapshot() {
  local sid="" snap tmp json
  while [ $# -gt 0 ]; do case "$1" in --session) sid="${2:-}"; shift ;; esac; shift; done
  [ -n "$sid" ] || exit 0
  snap="/tmp/claude-session-coord-${sid}.json"
  lockdir="/tmp/claude-session-coord-${sid}.refresh-lock"  # script-scope, not local: the EXIT trap fires after this function returns
  # In-flight guard (spec §5.1 flock intent; mkdir because flock(1) is absent on stock
  # macOS): losers exit silently, one refresh per burst. A SIGKILL-orphaned lockdir would
  # otherwise disable refreshes forever, since nothing ever rmdir's it again -- break locks
  # older than 60s (one retry; if that also loses the race, another process won it fairly).
  mkdir "$lockdir" 2>/dev/null || {
    local lock_mt lock_age
    lock_mt=$(stat -f %m "$lockdir" 2>/dev/null || stat -c %Y "$lockdir" 2>/dev/null) || exit 0
    lock_age=$(( $(date +%s) - lock_mt ))
    [ "$lock_age" -gt 60 ] || exit 0
    rmdir "$lockdir" 2>/dev/null
    mkdir "$lockdir" 2>/dev/null || exit 0
  }
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
      log_event "warn-collision" "$sid" "$osid" "{\"file\":$(jq -Rn --arg v "$file" '$v')}" >/dev/null 2>&1 &
      ;;
    worktree)
      msg="Session ${osid:0:8} (${okind}, branch ${obranch}) is editing the same file in another worktree — expect a merge conflict when both land. (Warn-only.)"
      log_event "warn-worktree" "$sid" "$osid" "{\"file\":$(jq -Rn --arg v "$file" '$v')}" >/dev/null 2>&1 &
      ;;
    *) exit 0 ;;
  esac
  emit_context "$msg"
}
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
