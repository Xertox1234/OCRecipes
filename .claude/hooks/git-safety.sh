#!/usr/bin/env bash
# PreToolUse(Bash) — combined git-safety hook. ONE Bash hook (respecting the
# ~140ms/hook budget), two branches:
#
#  A) CONTRACT branch (deny, fail closed) — active only while the session's
#     worktree-contract registry (/tmp/claude-worktree-contracts-<session_id>/,
#     written by scripts/declare-worktree.sh) is non-empty:
#       - mutating git subcommands (commit|mv|rm|restore|checkout|stash|reset|
#         rebase|merge|cherry-pick|apply|am|clean) whose EFFECTIVE repo (cwd, or
#         the `git -C <path>` override; relative -C resolves against cwd) is not
#         a registered worktree and not allowlisted → DENY.
#       - write-shaped shell commands (>/>> redirects, tee, rm, cp/mv destination,
#         sed -i) with an absolute target UNDER THE MAIN CHECKOUT and outside
#         every registered worktree → DENY. (Scoped to the main checkout — the
#         incident class — to avoid false positives elsewhere.)
#     Bypass: SKIP_WORKTREE_CONTRACT=1.
#
#  B) ADVISOR branch (warn only, NEVER blocks — user decision) — on destructive
#     ops (git branch -D, git push --delete/:ref, gh pr close, git worktree
#     remove --force): inject FRESH per-branch PR state as additionalContext so
#     the decision is made on live data, not a stale snapshot (the PR #520
#     incident). gh failure → "UNVERIFIED" warning, still allowed (fail open).
#
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.1–3.2.
# Tests: .claude/hooks/test-git-safety.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0   # cannot parse anything without jq; the file-tool guard still fails closed

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")

deny() {
  jq -n --arg r "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
  exit 0
}
warn() {
  jq -n --arg c "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":$c}}'
  exit 0
}

REG_DIR=""
[ -n "$SESSION" ] && REG_DIR="/tmp/claude-worktree-contracts-${SESSION}"
registry_active() { [ -n "$REG_DIR" ] && [ -d "$REG_DIR" ] && [ -n "$(ls -A "$REG_DIR" 2>/dev/null)" ]; }

allowlisted() {
  case "$1" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*|"${HOME:-/nonexistent}"/.claude/*) return 0 ;;
    *) return 1 ;;
  esac
}
in_registered() {
  local p="$1" entry wt
  for entry in "$REG_DIR"/*; do
    wt=$(cat "$entry" 2>/dev/null || echo "")
    [ -n "$wt" ] || continue
    case "$p" in "$wt"|"$wt"/*) return 0 ;; esac
  done
  return 1
}
registered_list() { for e in "$REG_DIR"/*; do printf '  %s\n' "$(cat "$e" 2>/dev/null)"; done; }
ESCAPES="Escapes: SKIP_WORKTREE_CONTRACT=1 (one command) or scripts/declare-worktree.sh --remove/--clear (assignment ended)."

# ============ A) CONTRACT branch ============
MUTATING_GIT_RE='(^|&&|\|\||;)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|mv|rm|restore|checkout|stash|reset|rebase|merge|cherry-pick|apply|am|clean)([[:space:]]|$)'

if [ -z "${SKIP_WORKTREE_CONTRACT:-}" ] && registry_active; then
  # --- mutating git: effective repo must be a registered worktree (or allowlisted scratch) ---
  if printf '%s' "$CMD" | grep -qE "$MUTATING_GIT_RE"; then
    C_TARGET=$(printf '%s' "$CMD" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+"?([^"[:space:]]+)"?.*/\1/p' | head -1)
    EFFECTIVE="${C_TARGET:-$CWD}"
    case "$EFFECTIVE" in
      "") EFFECTIVE="$CWD" ;;
      /*) ;;
      *) EFFECTIVE=$( (cd "$CWD" 2>/dev/null && cd "$EFFECTIVE" 2>/dev/null && pwd) || printf '%s/%s' "$CWD" "$EFFECTIVE") ;;
    esac
    if [ -n "$EFFECTIVE" ] && ! allowlisted "$EFFECTIVE" && ! in_registered "$EFFECTIVE"; then
      deny "Worktree contract violation: a mutating git command would run against
  ${EFFECTIVE}
which is outside every registered worktree:
$(registered_list)
Run it inside the assigned worktree (or with git -C <worktree>). ${ESCAPES}"
    fi
  fi

  # --- write-shaped shell commands: absolute targets under the MAIN checkout ---
  MAIN_ROOT=""
  COMMON=$(git -C "${CWD:-/nonexistent}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
  [ -n "$COMMON" ] && MAIN_ROOT=$(dirname "$COMMON")
  if [ -n "$MAIN_ROOT" ]; then
    WRITE_TARGETS=$(
      {
        # >/>> redirect targets
        printf '%s' "$CMD" | grep -oE '>>?[[:space:]]*/[^[:space:]"'"'"';|&]+' | sed -E 's/^>>?[[:space:]]*//'
        # tee targets
        printf '%s' "$CMD" | grep -oE '(^|[[:space:]|;&])tee([[:space:]]+-[a-zA-Z]+)*[[:space:]]+/[^[:space:]"'"'"';|&]+' | grep -oE '/[^[:space:]"'"'"';|&]+$'
        # rm / sed -i: every absolute token; cp / mv: the trailing (destination) absolute token
        if printf '%s' "$CMD" | grep -qE '(^|[[:space:]|;&])(rm)[[:space:]]' || printf '%s' "$CMD" | grep -qE '(^|[[:space:]|;&])sed[[:space:]][^|;]*-i'; then
          printf '%s\n' "$CMD" | tr ' ' '\n' | grep -E '^/' || true
        fi
        if printf '%s' "$CMD" | grep -qE '(^|[[:space:]|;&])(cp|mv)[[:space:]]'; then
          printf '%s\n' "$CMD" | tr ' ' '\n' | grep -E '^/' | tail -1 || true
        fi
      } | sort -u
    )
    while IFS= read -r t; do
      [ -n "$t" ] || continue
      # No allowlist here (Global Constraints scope it to the file-tool guard +
      # mutating-git branch): a target outside MAIN_ROOT is never denied anyway,
      # and a write INTO the main checkout is the incident class even when the
      # checkout lives under a temp prefix (as in the self-test fixture).
      in_registered "$t" && continue
      case "$t" in
        "$MAIN_ROOT"/*)
          deny "Worktree contract violation: a write-shaped command targets
  ${t}
under the main checkout while worktree assignment(s) are active:
$(registered_list)
${ESCAPES}" ;;
      esac
    done <<EOF
$WRITE_TARGETS
EOF
  fi
fi

# ============ B) ADVISOR branch (never blocks) ============
KIND=""
REF=""
if printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+branch[[:space:]]+-[a-zA-Z]*D[a-zA-Z]*[[:space:]]+'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*git[[:space:]]+branch[[:space:]]+-[a-zA-Z]*D[a-zA-Z]*[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]][^;&|]*--delete[[:space:]]'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*--delete[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]][^;&|]*[[:space:]]:[^[:space:]]'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*[[:space:]]:([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+close[[:space:]]+'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+close[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+worktree[[:space:]]+remove[[:space:]][^;&|]*(--force|[[:space:]]-f)'; then
  warn "⚠ git worktree remove --force discards any uncommitted work in that worktree. Confirm the branch is pushed (or its PR merged) before removal. Recovery runbook: docs/solutions/best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md"
fi

if [ "$KIND" = "delete" ] && [ -n "$REF" ]; then
  REF="${REF#origin/}"
  if PR_JSON=$(gh pr view "$REF" --json number,state,mergedAt 2>/dev/null); then
    NUM=$(printf '%s' "$PR_JSON" | jq -r '.number' 2>/dev/null || echo "?")
    STATE=$(printf '%s' "$PR_JSON" | jq -r '.state' 2>/dev/null || echo "")
    MERGED_AT=$(printf '%s' "$PR_JSON" | jq -r '.mergedAt // "-"' 2>/dev/null || echo "-")
    case "$STATE" in
      MERGED) warn "Fresh PR check: PR #${NUM} for '${REF}' is MERGED (${MERGED_AT}) — deletion is safe." ;;
      OPEN)   warn "⚠ Fresh PR check: PR #${NUM} for '${REF}' is OPEN and NOT merged — deleting this branch will CLOSE THE PR UNMERGED (the PR #520 incident). Stop unless you intend to abandon it. Recovery runbook: docs/solutions/best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md" ;;
      CLOSED) warn "⚠ Fresh PR check: PR #${NUM} for '${REF}' is CLOSED WITHOUT MERGE — a rejection signal. Never sweep this branch silently (keep local AND remote; see the land skill's branch-sweep table)." ;;
      *)      warn "⚠ Fresh PR check for '${REF}': PR state unparseable — treat as UNVERIFIED and confirm merge state manually. Rule: docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md" ;;
    esac
  else
    GH_ERR=$(gh pr view "$REF" --json number 2>&1 >/dev/null || true)
    if printf '%s' "$GH_ERR" | grep -qi 'no pull requests found'; then
      warn "⚠ Fresh PR check: NO PR found for '${REF}' — deleting it may lose never-pushed work. Rule: docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md"
    else
      warn "⚠ Fresh PR check for '${REF}' FAILED (gh unavailable/network) — treat as UNVERIFIED and confirm merge state manually before deleting. Rule: docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md"
    fi
  fi
fi

exit 0
