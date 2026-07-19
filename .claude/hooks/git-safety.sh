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

if ! command -v jq >/dev/null 2>&1; then
  # Cannot parse the envelope. The advisor (warn-only) is safely skipped, but the
  # CONTRACT branch must not silently disable: if ANY session's registry exists
  # and the raw input smells like a mutating-git or write-shaped command, fail
  # closed with hand-built JSON (mirrors guard-worktree-isolation.sh's no-jq deny).
  INPUT=$(cat)
  if [ -z "${SKIP_WORKTREE_CONTRACT:-}" ] \
     && ls -d /tmp/claude-worktree-contracts-*/ >/dev/null 2>&1 \
     && printf '%s' "$INPUT" | grep -qE 'git[^a-zA-Z]+(commit|mv|rm|restore|checkout|switch|pull|revert|stash|reset|rebase|merge|cherry-pick|apply|am|clean)|>>?|(^|[^a-zA-Z])(tee|rm|cp|mv)[^a-zA-Z]|sed[^|;]*-i'; then
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"git-safety: jq unavailable while a worktree-contract registry exists - failing closed for git/write-shaped commands. Bypass: SKIP_WORKTREE_CONTRACT=1."}}'
  fi
  exit 0
fi

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

# Dot segments defeat lexical prefix matching ($WT/../x, /tmp/../x) — treat any
# path containing them as matching nothing, which fails toward deny in the
# contract branch.
has_dot_segments() { case "${1}/" in */../*|*/./*) return 0 ;; *) return 1 ;; esac; }
# Lexically collapse . and .. segments (string-only — no symlink resolution, for
# the same reason has_dot_segments avoids realpath) so a laundered
# /tmp/../<main>/x is judged by where it actually lands.
lex_collapse() {
  local rest="${1#/}" out="" seg
  while [ -n "$rest" ]; do
    seg="${rest%%/*}"
    case "$rest" in */*) rest="${rest#*/}" ;; *) rest="" ;; esac
    case "$seg" in
      ''|'.') ;;
      '..') out="${out%/*}" ;;
      *) out="$out/$seg" ;;
    esac
  done
  printf '%s' "${out:-/}"
}
# emit_write_targets: read a shell command on STDIN, emit each ABSOLUTE-path write
# TARGET on its own line, quote/escape-AWARE in a single pass. A redirect (> >> N> &>)
# or write command (rm/tee/cp/mv/sed -i) counts ONLY when its operator/command word is
# UNQUOTED — the target PATH may still be quoted (the agent-default style the previous
# `tr -d` strip was added for). Because quoted content stays inside its word, a write
# op/command mentioned inside a commit MESSAGE (`git commit -m "writes > /main/out"`) is
# never mined — the false-DENY this replaces. Emission mirrors the prior extractors:
# rm/tee/sed -i → every abs-path arg; cp/mv → the last abs path (destination); redirect
# → the following path. Residuals (guardrail, not sandbox): fd-dup `>&`/`2>&1` split on
# the `&`; arg-taking wrappers still expose the command word; $'…' is a plain
# single-quote span. Bypass remains SKIP_WORKTREE_CONTRACT=1.
emit_write_targets() {
  awk '
    function addc(ch){ word = word ch; wstart = 1 }
    function addcq(ch){ word = word ch; wstart = 1; wtaint = 1 }
    function seg_reset(){ np = 0; has_rm = 0; has_tee = 0; has_cp = 0; has_mv = 0; has_sed = 0; has_sedi = 0 }
    function endword(   w, tnt){
      if (!wstart) return
      w = word; tnt = wtaint; word = ""; wstart = 0; wtaint = 0
      if (skipword) { skipword = 0; return }
      if (redir)    { redir = 0; if (substr(w, 1, 1) == "/") print w; return }
      if (!tnt) {
        if (w == "rm") has_rm = 1
        else if (w == "tee") has_tee = 1
        else if (w == "cp") has_cp = 1
        else if (w == "mv") has_mv = 1
        else if (w == "sed") has_sed = 1
        else if (substr(w, 1, 2) == "-i" || substr(w, 1, 10) == "--in-place") has_sedi = 1
      }
      if (substr(w, 1, 1) == "/") paths[++np] = w
    }
    function segend(   k){
      endword()
      if (has_rm || has_tee || (has_sed && has_sedi)) { for (k = 1; k <= np; k++) print paths[k] }
      else if (has_cp || has_mv) { if (np > 0) print paths[np] }
      redir = 0; skipword = 0; seg_reset()
    }
    BEGIN { SQ = sprintf("%c", 39); DQ = "\""; BS = "\\"; seg_reset() }
    { buf = buf $0 "\n" }
    END {
      n = length(buf); st = 0
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1)
        if (st == 0) {
          if (c == BS) { i++; if (i <= n) { ch = substr(buf, i, 1); if (ch != "\n") addc(ch) } }
          else if (c == SQ) { st = 1; wstart = 1 }
          else if (c == DQ) { st = 2; wstart = 1 }
          else if (c == ">") { endword(); if (i < n) { nx = substr(buf, i + 1, 1); if (nx == ">" || nx == "|") i++ } redir = 1 }
          else if (c == "<") { endword(); skipword = 1 }
          else if (c == "|" || c == ";" || c == "&" || c == "(" || c == ")" || c == "\n") { segend() }
          else if (c == " " || c == "\t") { endword() }
          else addc(c)
        } else if (st == 1) {
          if (c == SQ) st = 0; else addcq(c)
        } else {
          if (c == BS) { i++; if (i <= n) addcq(substr(buf, i, 1)) }
          else if (c == DQ) st = 0
          else addcq(c)
        }
      }
      segend()
    }
  '
}
allowlisted() {
  has_dot_segments "$1" && return 1
  case "$1" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*|"${HOME:-/nonexistent}"/.claude/*) return 0 ;;
    *) return 1 ;;
  esac
}
in_registered() {
  local p="$1" entry wt
  has_dot_segments "$p" && return 1
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
MUTATING_GIT_VERBS='commit|mv|rm|restore|checkout|switch|pull|revert|stash|reset|rebase|merge|cherry-pick|apply|am|clean'
MUTATING_GIT_RE="(^|&&|\\|\\||;)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(${MUTATING_GIT_VERBS})([[:space:]]|\$)"
# Same shape anchored at segment start, for per-segment validation below.
MUTATING_GIT_SEG_RE="^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(${MUTATING_GIT_VERBS})([[:space:]]|\$)"

# The hook process does not inherit inline assignments from the tool command, so
# a leading SKIP_WORKTREE_CONTRACT=1 in the command string is recognized here as
# the sanctioned one-shot bypass (otherwise the documented escape would be a no-op).
INLINE_BYPASS=""
case "$CMD" in "SKIP_WORKTREE_CONTRACT=1 "*) INLINE_BYPASS=1 ;; esac

if [ -z "${SKIP_WORKTREE_CONTRACT:-}" ] && [ -z "$INLINE_BYPASS" ] && registry_active; then
  # --- mutating git: EVERY mutating segment's effective repo must be a registered
  # worktree (or allowlisted scratch). Segments split on && || ; | & so a benign
  # cross-segment -C cannot launder a main-checkout mutation. (Shell-wrapped
  # invocations — subshells, eval, xargs, find -exec — remain the accepted
  # best-effort residual; the jq-less fallback's cruder grep catches some.)
  if printf '%s' "$CMD" | grep -qE "$MUTATING_GIT_RE"; then
    VIOLATION=""
    SEGS=$(printf '%s\n' "$CMD" | tr ';|&' '\n')
    while IFS= read -r seg; do
      printf '%s' "$seg" | grep -qE "$MUTATING_GIT_SEG_RE" || continue
      C_TARGET=$(printf '%s' "$seg" | tr -d '\042\047' | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+).*/\1/p' | head -1)
      EFFECTIVE="${C_TARGET:-$CWD}"
      case "$EFFECTIVE" in
        "")
          deny "Worktree contract violation: a mutating git command has no resolvable repository (empty cwd and no -C) while worktree assignment(s) are active:
$(registered_list)
${ESCAPES}" ;;
        /*) ;;
        *) EFFECTIVE=$( (cd "$CWD" 2>/dev/null && cd "$EFFECTIVE" 2>/dev/null && pwd) || printf '%s/%s' "$CWD" "$EFFECTIVE") ;;
      esac
      if ! allowlisted "$EFFECTIVE" && ! in_registered "$EFFECTIVE"; then
        VIOLATION="$EFFECTIVE"
        break
      fi
    done <<EOF
$SEGS
EOF
    if [ -n "$VIOLATION" ]; then
      deny "Worktree contract violation: a mutating git command would run against
  ${VIOLATION}
which is outside every registered worktree:
$(registered_list)
Run it inside the assigned worktree (or with git -C <worktree>). ${ESCAPES}"
    fi
  fi

  # --- write-shaped shell commands: absolute targets under the MAIN checkout ---
  # Cheap grep FIRST — the git rev-parse below must not run for every ls/echo/npm
  # command while a registry is active (~140ms/hook budget).
  if printf '%s' "$CMD" | grep -qE '>>?|(^|[[:space:]|;&])(tee|rm|cp|mv)[[:space:]]|sed[[:space:]][^|;]*-i'; then
  MAIN_ROOT=""
  COMMON=$(git -C "${CWD:-/nonexistent}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
  [ -n "$COMMON" ] && MAIN_ROOT=$(dirname "$COMMON")
  if [ -n "$MAIN_ROOT" ]; then
    # Quote-AWARE target extraction (emit_write_targets, defined above). The prior
    # `tr -d '\042\047'` strip DELETED quote chars but kept their CONTENT, so a commit
    # message like `git commit -m "writes > /main/out"` was mined as a real redirect →
    # false-DENY (2026-07-18 audit follow-up). A write is real only when its OPERATOR or
    # COMMAND word is UNQUOTED; the target PATH may still be quoted (the agent-default
    # style the old strip existed for). See
    # docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md.
    WRITE_TARGETS=$(printf '%s' "$CMD" | emit_write_targets | sort -u)
    while IFS= read -r t; do
      [ -n "$t" ] || continue
      # Judge dot-segment targets by where they LAND: an allowlist-prefixed
      # /tmp/../<main>/x lexically dodges the $MAIN_ROOT/* check below while
      # resolving into the main checkout.
      TC="$t"
      case "${t}/" in */../*|*/./*) TC=$(lex_collapse "$t") ;; esac
      # No allowlist here (Global Constraints scope it to the file-tool guard +
      # mutating-git branch): a target outside MAIN_ROOT is never denied anyway,
      # and a write INTO the main checkout is the incident class even when the
      # checkout lives under a temp prefix (as in the self-test fixture).
      in_registered "$TC" && continue
      case "$TC" in
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
fi

# ============ B) ADVISOR branch (never blocks) ============
KIND=""
REF=""
if printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+branch[[:space:]]+-[a-zA-Z]*D[a-zA-Z]*[[:space:]]+'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*git[[:space:]]+branch[[:space:]]+-[a-zA-Z]*D[a-zA-Z]*[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+branch[[:space:]]+[^;&|]*--delete[^;&|]*--force|(^|[;&|[:space:]])git[[:space:]]+branch[[:space:]]+[^;&|]*--force[^;&|]*--delete'; then
  # Long-form spelling of branch -D.
  KIND="delete"
  REF=$(printf '%s' "$CMD" | tr ' ' '\n' | awk 'f && $0 !~ /^-/ { print; exit } $0 == "branch" { f = 1 }')
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
  # A flag-like extraction must not reach gh in argument position.
  case "$REF" in -*)
    warn "⚠ Fresh PR check skipped: extracted ref '${REF}' looks like a flag — verify the branch's PR state manually before deleting." ;;
  esac
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
