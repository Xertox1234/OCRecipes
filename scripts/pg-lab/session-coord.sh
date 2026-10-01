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
TTL='15 minutes'

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ps-walk.sh
. "$SELF_DIR/lib/ps-walk.sh" 2>/dev/null || exit 0
# Shared write-target parser (spec 2026-09-27 §5.2). Missing lib = no Bash coverage, never an error.
. "$SELF_DIR/../../.claude/hooks/lib/write-targets.sh" 2>/dev/null || true
WINDOW_SECS=900   # 15-min touch/liveness window (spec §6.1). Single line: mutated by text in tests.
MAX_CANDIDATES=5  # other-session holders judged per consult (hook latency bound). Mutated by text in tests.
MAX_CONFIRMS=3    # live_confirm psql round trips per consult.

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

physical_path() { # $1 absolute path -> same referent, spelled through the PHYSICAL path of
                   # its nearest existing ancestor (macOS symlinks /tmp -> /private/tmp; a
                   # target reached through such a symlink would otherwise record/consult
                   # rel_path == abs_path downstream, since git_root_of always resolves to
                   # the physical spelling and the literal prefix strip against it never
                   # matches an un-normalized $file). Walk-up mirrors record_one/consult_match's
                   # own git-root lookup: the leaf may not exist yet (Write creates it). Fails
                   # safe — echoes $1 unchanged on a relative path or any resolution failure;
                   # never canonicalizes `..` beyond what `pwd -P` resolves for the ancestor.
  local file="$1" dir pdir
  case "$file" in /*) ;; *) printf '%s\n' "$file"; return 0 ;; esac
  dir=$(dirname "$file")
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir=$(dirname "$dir"); done
  pdir=$(cd "$dir" 2>/dev/null && pwd -P)
  if [ -n "$pdir" ]; then file="${pdir}${file#"$dir"}"; fi
  printf '%s\n' "$file"
}

target_paths() { # $1 hook JSON -> absolute target paths, one per line, physical spelling.
                  # Normalized here — the single choke point upstream of both do_record and
                  # do_consult (record_one/consult_match need no changes: rel_path is already
                  # derived correctly once $file arrives pre-normalized). The Bash branch
                  # normalizes BEFORE dedup, so two spellings of the same real file collapse
                  # to one candidate instead of double-spending consult's live-check budget.
  local tool cmd cwd
  tool=$(jq -r '.tool_name // ""' <<<"$1" 2>/dev/null)
  case "$tool" in
    Bash)
      cmd=$(jq -r '.tool_input.command // ""' <<<"$1" 2>/dev/null)
      grep -qE '>|(^|[^[:alnum:]_])(tee|rm|cp|mv)([^[:alnum:]_]|$)|sed[^|;]*-i' <<<"$cmd" || return 0
      declare -F resolve_write_targets >/dev/null || return 0
      cwd=$(jq -r '.cwd // ""' <<<"$1" 2>/dev/null)
      printf '%s' "$cmd" | resolve_write_targets "$cwd" \
        | while IFS= read -r f; do [ -n "$f" ] && physical_path "$f"; done | sort -u ;;
    *) jq -r '.tool_input.file_path // empty' <<<"$1" 2>/dev/null \
        | while IFS= read -r f; do [ -n "$f" ] && physical_path "$f"; done ;;
  esac
}

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

record_one() { # $1 sid, $2 agent ('' = main), $3 absolute file
  local sid="$1" agent="$2" file="$3" dir root rel
  # rel_path from the FILE's containing worktree root — never the session cwd
  # (feedback_subagent_worktree_cwd). Walk up until an existing dir (Write may create).
  dir=$(dirname "$file")
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir=$(dirname "$dir"); done
  root=$(git_root_of "$dir") || return 0
  [ -n "$root" ] || return 0
  rel="${file#"$root"/}"
  upsert_registry "$sid" "$root" ""
  run_sql -v sid="$sid" -v agent="$agent" -v abs="$file" -v rel="$rel" <<'SQL'
INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path)
VALUES (:'sid', :'agent', :'abs', :'rel')
ON CONFLICT (session_id, agent_id, abs_path) DO UPDATE SET last_touch = now();
SQL
}

do_record() {
  local input sid agent f
  input=$(cat)
  sid=$(jq -re '.session_id // empty' <<<"$input" 2>/dev/null) || exit 0
  agent=$(jq -r '.agent_id // ""' <<<"$input" 2>/dev/null)
  case "$agent" in *[!A-Za-z0-9._-]*) exit 0 ;; esac
  while IFS= read -r f; do
    [ -n "$f" ] && record_one "$sid" "$agent" "$f"
  done <<<"$(target_paths "$input")"
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
    lock_mt=$(stat -c %Y "$lockdir" 2>/dev/null || stat -f %m "$lockdir" 2>/dev/null) || exit 0
    lock_age=$(( $(date +%s) - lock_mt ))
    [ "$lock_age" -gt 60 ] || exit 0
    rmdir "$lockdir" 2>/dev/null
    mkdir "$lockdir" 2>/dev/null || exit 0
  }
  trap 'rmdir "$lockdir" 2>/dev/null' EXIT
  trap 'exit 0' TERM
  do_reap
  json=$(psql -X -qtA -d "$LAB_DATABASE_URL" -v sid="$sid" 2>/dev/null <<'SQL'
SELECT COALESCE(json_agg(s ORDER BY s.last_seen_at DESC, s.session_id), '[]'::json) FROM (
  SELECT r.session_id, r.session_kind, r.branch, r.repo_root, r.last_seen_at,
         COALESCE((SELECT json_agg(json_build_object('abs_path', f.abs_path, 'rel_path', f.rel_path,
                                                     'agent_id', f.agent_id,
                                                     'last_touch', extract(epoch FROM f.last_touch)::bigint)
                                                     ORDER BY f.last_touch DESC, f.agent_id, f.abs_path)
                   FROM harness.files_in_flight f WHERE f.session_id = r.session_id), '[]'::json) AS files
  FROM harness.session_registry r
  WHERE r.expires_at > now()
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
  mt=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null) || { echo 999999; return; }
  echo $(( $(date +%s) - mt ))
}

emit_context() { # $1 message -> PreToolUse additionalContext JSON (drift-detect shape)
  jq -n --arg m "$1" '{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": $m } }'
}

emit_block() { # $1 reason — a deny's reason goes to the MODEL, which relays it to the user in chat.
  # Not an "ask": its prompt never showed the reason to the user (live verification 2026-09-28).
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
}

live_confirm() { # $1 holder session, $2 holder agent ('' = main), $3 abs path -> yes | no | error
  local out
  out=$(psql -X -qtA -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v hs="$1" -v ha="$2" -v p="$3" -v win="$WINDOW_SECS" 2>/dev/null <<'SQL'
SELECT 1 FROM harness.files_in_flight f JOIN harness.session_registry r USING (session_id)
WHERE f.session_id = :'hs' AND f.agent_id = :'ha' AND f.abs_path = :'p'
  AND f.last_touch > now() - make_interval(secs => :win) AND r.expires_at > now()
LIMIT 1;
SQL
  ) || { echo error; return 0; }
  if [ "$out" = "1" ]; then echo yes; else echo no; fi
}

# Block once per (file, current agent, holder): the retry after the model has told the user goes through.
block_dir() { printf '/tmp/claude-session-coord-%s.blocked' "$1"; }
block_key() { printf '%s\037%s' "$1" "$2" | shasum | cut -c1-40; }   # $1 abs path, $2 CURRENT agent
block_mark_told() { # $1 sid, $2 agent, $3 file, $4 holder "<sid>:<agent>"
  local d; d=$(block_dir "$1"); mkdir -p "$d" 2>/dev/null || return 0
  # Append: one line per holder, so two live holders are each named once instead of taking turns.
  printf 'told %s %s\n' "$4" "$(date +%s)" >> "$d/$(block_key "$3" "$2")" 2>/dev/null
  return 0
}
block_told() { # rc 0 iff this (file, current agent, holder) was already blocked within the window
  local m st h ts
  m="$(block_dir "$1")/$(block_key "$3" "$2")"
  [ -f "$m" ] || return 1
  while read -r st h ts; do
    [ "$st" = told ] && [ "$h" = "$4" ] && [ $(( $(date +%s) - ${ts:-0} )) -le "$WINDOW_SECS" ] && return 0
  done < "$m"
  return 1
}

refresh_bounded() { # $1 sid — synchronous refresh capped at ~1 s (spec §6.2 step 0)
  bash "$SELF_DIR/session-coord.sh" refresh-snapshot --session "$1" >/dev/null 2>&1 &
  local rpid=$! i=0
  while [ "$i" -lt 10 ] && kill -0 "$rpid" 2>/dev/null; do sleep 0.1; i=$((i + 1)); done
  return 0
}

consult_match() { # $1 abs file, $2 sid, $3 agent, $4 snapshot -> "rank<TAB>-touch<TAB>record" per match
  # rank 0 = other-session collision, 1 = sibling collision, 2 = other worktree; do_consult sorts on it.
  local file="$1" dir root rel
  dir=$(dirname "$file")
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir=$(dirname "$dir"); done
  root=$(git_root_of "$dir") || root=""
  rel=""; [ -n "$root" ] && rel="${file#"$root"/}"
  jq -r --arg f "$file" --arg rel "$rel" --arg root "$root" --arg me "$2" --arg ag "$3" \
        --argjson now "$(date +%s)" --argjson win "$WINDOW_SECS" '
    def fresh($x): ($now - ($x.last_touch // 0)) <= $win;
    def is_self($s; $x): ($s.session_id == $me) and (($x.agent_id // "") == $ag);
    def own_gate($s; $x): ($s.session_id != $me) or fresh($x);
    [ .sessions[]? as $s | $s.files[]? as $x
      | select(is_self($s; $x) | not)
      | select(own_gate($s; $x))
      | ($x.abs_path | if (($x.rel_path // "") != "") and endswith("/" + $x.rel_path)
                       then .[0:(length - ($x.rel_path | length) - 1)] else "" end) as $xroot
      | if $x.abs_path == $f then {lvl: "collision", s: $s, x: $x, xroot: $xroot}
        elif ($rel != "" and ($x.rel_path // "") == $rel and $xroot != $root) then {lvl: "worktree", s: $s, x: $x, xroot: $xroot}
        else empty end ]
    | .[]
    | (if .lvl == "worktree" then 2 elif .s.session_id == $me then 1 else 0 end | tostring) + "\t"
      + (- (.x.last_touch // 0) | tostring) + "\t"
      + ([ $f, .lvl, (if .s.session_id == $me then "1" else "0" end), .s.session_id, (.s.session_kind // "unknown"),
           (.s.branch // "?"), (.s.last_seen_at | tostring), (.x.agent_id // ""),
           ((.x.last_touch // 0) | tostring), $rel, .xroot ] | join("\u001f"))
  ' "$4" 2>/dev/null
}

decide_and_emit() { # $1 sid, $2 agent, $3 snapshot age (s), $4 consult_match record -> rc 0 iff it blocked
  # Judges one other-session holder; the caller walks every holder (a non-qualifying first one must
  # not hide a qualifying one). CANDS / CONFIRMS are the caller's counters (bash dynamic scope).
  local sid="$1" file lvl own osid okind obranch oseen oagent otouch rel xroot mins det
  IFS=$'\x1f' read -r file lvl own osid okind obranch oseen oagent otouch rel xroot <<<"$4"
  if [ "$lvl" = "collision" ] && [ "$own" = "0" ]; then
    CANDS=$((CANDS + 1)); [ "$CANDS" -le "$MAX_CANDIDATES" ] || return 1
    local reason="" wt
    if [ $(( $(date +%s) - ${otouch:-0} )) -gt "$WINDOW_SECS" ]; then reason="stale-touch"
    elif [ "${SKIP_COLLISION_BLOCK:-}" = "1" ]; then reason="bypass"
    elif block_told "$sid" "$2" "$file" "$osid:$oagent"; then reason="already-told"
    elif [ "$CONFIRMS" -ge "$MAX_CONFIRMS" ]; then reason="confirm-cap"
    else
      CONFIRMS=$((CONFIRMS + 1))
      case "$(live_confirm "$osid" "$oagent" "$file")" in
        yes) ;;
        no)  reason="live-unconfirmed" ;;
        *)   [ "${3:-999999}" -lt 60 ] || reason="pg-down-stale-snapshot" ;;
      esac
    fi
    if [ -z "$reason" ]; then
      wt=$(basename "${xroot:-?}")
      mins=$(( ( $(date +%s) - ${otouch:-0} ) / 60 ))
      det="{\"file\":$(jq -Rn --arg v "$file" '$v'),\"agent\":$(jq -Rn --arg v "$oagent" '$v')}"
      block_mark_told "$sid" "$2" "$file" "$osid:$oagent"
      log_event "block-collision" "$sid" "$osid" "$det" >/dev/null 2>&1 &
      emit_block "Blocked once: another Claude session is working on this file. Session ${osid:0:8} (${okind}, branch ${obranch}, worktree ${wt}) edited ${rel:-$file} ${mins} min ago. Ask the user whether to go ahead, and tell them which session this is. Retry only if they say yes; the retry will go through. If they say no, leave the file alone."
      return 0
    fi
    log_event "block-downgraded" "$sid" "$osid" "{\"reason\":\"$reason\",\"file\":$(jq -Rn --arg v "$file" '$v')}" >/dev/null 2>&1 &
  fi
  return 1
}

warn_emit() { # $1 sid, $2 consult_match record — the warn-only context when nothing blocked
  local sid="$1" file lvl own osid okind obranch oseen oagent otouch rel xroot mins who msg det
  IFS=$'\x1f' read -r file lvl own osid okind obranch oseen oagent otouch rel xroot <<<"$2"
  mins=$(( ( $(date +%s) - ${otouch:-0} ) / 60 ))
  det="{\"file\":$(jq -Rn --arg v "$file" '$v'),\"agent\":$(jq -Rn --arg v "$oagent" '$v')}"
  if [ -n "$oagent" ]; then who="Agent ${oagent:0:8} in this same session"; else who="The main agent of this same session"; fi
  if [ "$own" = "1" ]; then
    case "$lvl" in
      collision) msg="${who} touched this same file ${mins} min ago. Coordinate before editing. (Warn-only.)"
                 log_event "warn-collision-sibling" "$sid" "$osid" "$det" >/dev/null 2>&1 & ;;
      worktree)  msg="${who} is editing the same file in another worktree (${mins} min ago) — expect a merge conflict when both land. (Warn-only.)"
                 log_event "warn-worktree-sibling" "$sid" "$osid" "$det" >/dev/null 2>&1 & ;;
      *) return 0 ;;
    esac
  else
    case "$lvl" in
      collision) msg="Session ${osid:0:8} (${okind}, branch ${obranch}, last seen ${oseen}) is mid-edit on this same file in this same checkout. Coordinate before editing — parallel same-file edits here produced tangled commits before. (Warn-only.)"
                 log_event "warn-collision" "$sid" "$osid" "$det" >/dev/null 2>&1 & ;;
      worktree)  msg="Session ${osid:0:8} (${okind}, branch ${obranch}) is editing the same file in another worktree — expect a merge conflict when both land. (Warn-only.)"
                 log_event "warn-worktree" "$sid" "$osid" "$det" >/dev/null 2>&1 & ;;
      *) return 0 ;;
    esac
  fi
  emit_context "$msg"
}

do_consult() {
  local input sid agent files snap age cands rec CANDS=0 CONFIRMS=0
  input=$(cat)
  sid=$(jq -re '.session_id // empty' <<<"$input" 2>/dev/null) || exit 0
  case "$sid" in ''|.|..|*[!A-Za-z0-9._-]*) exit 0 ;; esac
  agent=$(jq -r '.agent_id // ""' <<<"$input" 2>/dev/null)
  case "$agent" in *[!A-Za-z0-9._-]*) exit 0 ;; esac
  files=$(target_paths "$input")
  [ -n "$files" ] || exit 0
  snap="/tmp/claude-session-coord-${sid}.json"
  age=$(snapshot_age_secs "$snap")
  if [ "$age" -gt 25 ]; then refresh_bounded "$sid"; age=$(snapshot_age_secs "$snap"); fi
  [ -f "$snap" ] || exit 0
  # Every match of every target file, other-session collisions first, most recent editor first.
  cands=$(while IFS= read -r f; do [ -n "$f" ] && consult_match "$f" "$sid" "$agent" "$snap"; done <<<"$files" \
          | sort -s -t$'\t' -k1,1n -k2,2n | cut -f3-)
  [ -n "$cands" ] || exit 0
  while IFS= read -r rec; do
    decide_and_emit "$sid" "$agent" "$age" "$rec" && return 0
  done <<<"$cands"
  warn_emit "$sid" "${cands%%$'\n'*}"
}
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
  # psql exits 0 on SQL errors unless ON_ERROR_STOP is set, so the plain query above can't
  # be trusted to distinguish "DB unreachable" from "no match" via rc alone. Re-probe with
  # ON_ERROR_STOP against the actual harness table (not a bare SELECT 1) so a reachable-but-
  # schema-less lab DB fails the probe too, instead of being misattributed as "no other
  # session" — only print that line when the table genuinely answered with no rows.
  if [ -n "$row" ]; then
    local osid okind obranch oseen
    IFS=$'\x1f' read -r osid okind obranch oseen <<<"$row"
    printf 'Attribution: session %s (%s, branch %s) is registered in this checkout, last seen %s.\n' \
      "${osid:0:8}" "$okind" "$obranch" "$oseen"
    log_event "drift-attributed" "$sid" "$osid" '{}' >/dev/null 2>&1 &
  else
    psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -c 'SELECT 1 FROM harness.session_registry LIMIT 1' >/dev/null 2>&1 || exit 0
    printf 'Attribution: no other live session registered here — likely your own manual git op or a stale baseline.\n'
    log_event "drift-unattributed" "$sid" "" '{}' >/dev/null 2>&1 &
  fi
}

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
