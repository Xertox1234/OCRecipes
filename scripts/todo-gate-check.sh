#!/usr/bin/env bash
# todo-gate-check.sh — deterministic machine-checkable gate for dated / human-led todo blocks.
#
# WHY THIS EXISTS (2026-07-16): a prose gate written into a todo's Updates section
# ("Do NOT flip to backlog before 2026-08-05") was overridden by an autonomous
# /goal -> /todo-fast -> executor chain that treated a generic automation directive as
# authorization to override it. Prose is advisory to an agent whose dispatch prompt says
# "execute this todo." This script makes the gate a frontmatter fact any orchestrator can
# check with a single deterministic command, independent of model compliance.
#
# Convention (binding — see todos/README.md "Date & Human-Led Gates" and todos/TEMPLATE.md):
#   blocked_until: YYYY-MM-DD   — never autonomously dispatched before this date. The gate
#                                 CLEARS ON the date itself (blocked_until <= today passes).
#   blocked_reason: "..."       — optional, human-readable, surfaced in run summaries.
#   human_led: true             — never autonomously dispatched, EVER. Does NOT expire when
#                                 blocked_until passes — a todo may carry both fields, and
#                                 the date clearing does not clear human_led.
#
# STATUS-INDEPENDENT BY DESIGN: this script reads blocked_until/human_led regardless of
# what the todo's `status:` field currently says. The 2026-07-16 incident happened because
# an agent flipped `status: blocked` -> `backlog` itself under a broad /goal directive, and
# every downstream status-only gate then read the new value and let it through. Editing
# `status` (or blocked_until, or human_led) to unblock a todo under any autonomous /
# non-interactive directive is NOT a legitimate use of this repo's automation — see
# .claude/skills/todo/SKILL.md Phase 2, .claude/skills/todo-fast/SKILL.md Phase 0, and
# .claude/agents/todo-executor.md Step 2 for how the one legal override (a human
# interactively naming this specific todo) is threaded through instead.
#
# Usage:
#   scripts/todo-gate-check.sh                 # scan mode: check every todos/*.md
#   scripts/todo-gate-check.sh <todo-file>      # single-file mode: check exactly one todo
#
# Exit 0 = CLEAR   — single-file: safe to autonomously dispatch. scan: no gated todos found.
# Exit 1 = GATED   — single-file: blocked_until is a future date, OR human_led: true, OR the
#                     file's blocked_until value is present but unparseable (fail-closed on
#                     bad data) — NEVER autonomously dispatch. scan: at least one *.md file
#                     directly under todos/ is gated — see stdout for the list.
# Exit 2 = ERROR   — the check itself could not run (missing/unreadable file in single-file
#                     mode, missing todos/ directory in scan mode, bad usage). Callers MUST
#                     treat exit 2 identically to exit 1 — fail-closed, never dispatch on
#                     ERROR.
set -euo pipefail

TODAY="$(date +%Y-%m-%d)"

# check_one <path> — prints one TSV line "<path>\t<blocked_until-or-dash>\t<reason>" to
# stdout and returns 0 (clear), 1 (gated), or 2 (file missing) as its own exit status.
# Callers capture both via `out="$(check_one "$p")" || rc=$?` — the safe idiom for
# preserving a command's real exit code under `set -e` (see
# docs/solutions/logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md
# and this repo's own scripts/todo-automerge-guard.sh, which uses the same pattern).
check_one() {
  local path="$1"
  if [ ! -f "$path" ]; then
    printf '%s\t-\tERROR: file not found\n' "$path"
    return 2
  fi

  # Frontmatter = lines between the first pair of --- markers. Here-strings, not a
  # producer-pipe into an early-exiting consumer (SIGPIPE-under-pipefail risk — same
  # gotcha todo-automerge-guard.sh documents and avoids).
  local raw fm blocked_until human_led reason
  raw="$(cat "$path")" || { printf '%s\t-\tERROR: could not read file\n' "$path"; return 2; }
  fm="$(awk '/^---[[:space:]]*$/{n++; next} n==1' <<< "$raw")"
  # Strip both quote styles on blocked_until and human_led — a quoted `human_led: "true"`
  # must gate exactly like an unquoted `human_led: true`; a silent fail-open here defeats
  # the whole script. blocked_reason is display-only (never gated on), so it keeps its own
  # sed-based leading/trailing-quote trim instead.
  blocked_until="$(awk '/^blocked_until:/{sub(/^blocked_until:[[:space:]]*/,""); print; exit}' <<< "$fm" | tr -d "\"'" | tr -d '[:space:]')"
  human_led="$(awk '/^human_led:/{sub(/^human_led:[[:space:]]*/,""); print; exit}' <<< "$fm" | tr -d "\"'" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  reason="$(awk '/^blocked_reason:/{sub(/^blocked_reason:[[:space:]]*/,""); print; exit}' <<< "$fm" | sed -e 's/^[[:space:]]*"\{0,1\}//' -e 's/"\{0,1\}[[:space:]]*$//')"

  # human_led: true gates unconditionally and never expires — check it first so a passed
  # blocked_until can never mask it. An unrecognized value (not exactly true/false — e.g. a
  # stray inline comment, "yes"/"on") fails CLOSED, same as blocked_until's PARSE_ERROR
  # branch below: this field's whole job is gating dispatch, so silently reading an
  # unparseable value as "not gated" is exactly the bug this script exists to prevent.
  if [ -n "$human_led" ] && [ "$human_led" != "true" ] && [ "$human_led" != "false" ]; then
    printf '%s\t%s\tPARSE_ERROR: human_led is not true/false (%s) — fail-closed\n' "$path" "${blocked_until:--}" "$human_led"
    return 1
  fi
  if [ "$human_led" = "true" ]; then
    printf '%s\t%s\thuman_led: true (%s)\n' "$path" "${blocked_until:--}" "${reason:-no blocked_reason given}"
    return 1
  fi

  if [ -n "$blocked_until" ]; then
    case "$blocked_until" in
      [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) : ;;
      *)
        printf '%s\t%s\tPARSE_ERROR: blocked_until is not YYYY-MM-DD — fail-closed\n' "$path" "$blocked_until"
        return 1 ;;
    esac
    # ISO-8601 dates sort correctly as plain strings, sidestepping BSD (`date -j -f`) vs
    # GNU (`date -d`) date-arithmetic flag divergence entirely.
    if [[ "$blocked_until" > "$TODAY" ]]; then
      printf '%s\t%s\tblocked_until %s is in the future (%s)\n' "$path" "$blocked_until" "$blocked_until" "${reason:-no blocked_reason given}"
      return 1
    fi
  fi

  printf '%s\t%s\tclear\n' "$path" "${blocked_until:--}"
  return 0
}

if [ "$#" -ge 1 ]; then
  target="$1"
  rc=0
  out="$(check_one "$target")" || rc=$?
  msg="$(printf '%s' "$out" | cut -f3)"
  case "$rc" in
    0) echo "gate-check: CLEAR $target" ;;
    1) echo "gate-check: GATED $target — $msg" ;;
    *) echo "gate-check: ERROR $target — $msg" ;;
  esac
  exit "$rc"
fi

# Scan mode: every *.md directly under todos/, excluding README.md and TEMPLATE.md.
# -maxdepth 1 deliberately excludes todos/archive/ and todos/deployment/ — archived todos
# are done, and deployment todos are parked separately (same exclusion Phase 2 triage uses).
if [ ! -d todos ]; then
  echo "gate-check: ERROR — todos/ directory not found (run from repo root)"
  exit 2
fi

found=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  rc=0
  out="$(check_one "$f")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    found=1
    printf '%s\n' "$out"
  fi
done < <(find todos -maxdepth 1 -name '*.md' ! -name 'README.md' ! -name 'TEMPLATE.md' | sort)

if [ "$found" -eq 0 ]; then
  echo "gate-check: no gated todos found"
  exit 0
fi
exit 1
