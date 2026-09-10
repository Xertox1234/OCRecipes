#!/usr/bin/env bash
# PreToolUse — block merging a risk-classified PR unless a review record exists that this
# agent did not write. Design: docs/superpowers/specs/2026-09-08-merge-review-gate-design.md
#
# Escape (emergencies): SKIP_MERGE_REVIEW=1 in the shell that launched Claude Code.
# It is read from THIS PROCESS'S ENVIRONMENT ONLY and never parsed out of the command
# text — otherwise the agent self-authorizes by prefixing the assignment.
#
# TWO DIRECTIONS OF FAILURE, BOTH REAL. Permissive: unreviewed code merges, which is the
# incident this gate exists for. Restrictive: every merge in the repo blocks and someone
# switches the gate off, which costs the same coverage more slowly. So each deny below
# names a CAUSE and a FIX, and the three stage-3 denials are deliberately three distinct
# messages — "no record", "wrong scope" and "unresolved findings" have different causes
# and different remedies, and a reviewer who found only WARNINGs writes no record at all
# (review-stamp-writer.sh residual 3), so "no record" must never read as "you never
# reviewed".
set -uo pipefail

[ -n "${SKIP_MERGE_REVIEW:-}" ] && exit 0

# Without jq this gate cannot read the envelope, classify the PR, or read a review record
# — and review-stamp-writer.sh dies on the same missing tool, so no record exists to read
# either. `|| exit 0` here is the ADVISORY hook convention (drift-detect.sh:21,
# eslint-fix.sh:15, session-recent-issues.sh:12) and in a BLOCKING guard it turns the gate
# silently OFF: measured — sensitive PR, no record, jq off PATH, rc 0, empty output, merge
# allowed. Every other blocking PreToolUse guard fails closed instead, each saying so in
# its own comment (guard-worktree-isolation.sh:34, git-safety.sh:28,
# guard-outward-cli.sh:1328). This mirrors them, with hand-built JSON because jq is
# precisely what is missing.
#
# The crude pre-check MUST cover BOTH merge routes. Spelling only the Bash gh/pr/merge
# shape — the guard-outward-cli spelling — would leave `mcp__github__merge_pull_request`
# wide open, and that is the CLAUDE.md-preferred merge path, so a half-fix is worse than
# none. A payload matching neither shape is unaffected.
#
# Known over-deny on this degraded path, accepted deliberately: the Bash arm reuses the
# fast path's ordered `gh` → `pr` → `merge` shape, so `git commit -m "fix highlight for pr
# merge"` also denies when jq is missing. Every crude no-jq fallback in this repo makes the
# same trade; a denied commit in an already-broken environment carries its own bypass, an
# unreviewed merge does not.
if ! command -v jq >/dev/null 2>&1; then
  RAW=$(cat)
  if grep -Eq '"tool_name"[[:space:]]*:[[:space:]]*"mcp__github__merge_pull_request"' <<< "$RAW" \
     || { grep -Eq '"tool_name"[[:space:]]*:[[:space:]]*"Bash"' <<< "$RAW" \
          && grep -q 'gh.*pr.*merge' <<< "$RAW"; }; then
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"merge-review-guard: jq unavailable - failing closed for what looks like a PR merge. Without jq no review record can be read, and review-stamp-writer.sh cannot write one either. Bypass: SKIP_MERGE_REVIEW=1 in the shell that launched Claude Code."}}'
  fi
  exit 0
fi
INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0

case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
ROOT="$(cd "$HERE/../.." && pwd)" || ROOT=""

BYPASS='Bypass (emergencies only): SKIP_MERGE_REVIEW=1 in the shell that launched Claude Code — not in the command.'

deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
  exit 0
}

PR=""
case "$TOOL" in
  Bash)
    CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
    # Fast path FIRST — this hook runs on EVERY Bash call (project_per_bash_hook_overhead).
    # It is a NECESSARY-substring filter, not a decision: `git commit -m "fix highlight
    # for pr merge"` matches it ("gh" inside "highlight", then "pr", then "merge"). Only
    # the precise detector below decides, so an ordinary commit is never denied.
    if . "$HERE/lib/fastpath-filter.sh" 2>/dev/null && declare -F cmd_fastpath_has >/dev/null; then
      cmd_fastpath_has "$CMD" '*gh*pr*merge*' || exit 0
    fi
    # Detection and ref resolution go through the SHARED library. Do not re-derive
    # positional extraction: cmd_gh_pr_ref's header documents three construction-proven
    # CRITICAL fixes (2026-09-02) for nested substitution, embedded quotes and backslash
    # escapes, and it REFUSES rather than guessing when any of them is present.
    #
    # BOTH FUNCTIONS TAKE THE COMMAND AS AN ARGUMENT, NOT ON STDIN (see their only other
    # caller, pr-verify.sh:27/35). Piping into them leaves `$1` unset, so `cmd_bare_deep
    # "$1"` sees an empty command, SUBCOMMAND comes back empty, and the `!= merge` early
    # exit below turns EVERY merge into a silent allow. Measured 2026-09-09: piped form
    # returns "" for `gh pr merge 938 --auto --squash`; argument form returns "merge"/938.
    if . "$HERE/lib/cmd-detect.sh" 2>/dev/null \
       && declare -F cmd_gh_pr_write_subcommand >/dev/null \
       && declare -F cmd_gh_pr_ref >/dev/null; then
      # PIPEFAIL MUST BE OFF FOR THIS CALL. cmd_gh_pr_write_subcommand signals REFUSE with
      # an explicit `return 1`, but signals NO MATCH through the rc of its trailing
      # `grep -oE … | head -1` pipeline. Under `set -o pipefail` a no-match grep makes that
      # pipeline rc 1 too, so the two collapse into one value — and reading that as REFUSE
      # denies every ordinary command that merely trips the fast path. Measured 2026-09-09
      # on `git commit -m "fix highlight for pr merge"`: rc 1 with pipefail, rc 0 without;
      # the genuine refuse (`echo "$(gh pr merge 938)" # gh pr create`) is rc 1 in both.
      # pr-verify.sh never hit this because it is advisory and tests output, not rc.
      set +o pipefail
      SUB=$(cmd_gh_pr_write_subcommand "$CMD"); SUB_RC=$?
      set -o pipefail
      # rc 1 is REFUSE, not "no merge here": the function returns it when a `gh pr create`
      # mention co-occurs with a `gh pr merge|close|edit` one, because it cannot tell which
      # clause actually executes. Its own header proves the case is authorable —
      # `echo "$(gh pr merge 42)" # gh pr create` really runs only the merge. Treating that
      # empty answer as "not a merge" would hand the agent a one-comment bypass.
      if [ "$SUB_RC" -ne 0 ]; then
        deny "Blocked: this command mentions more than one \`gh pr\` write subcommand, so merge-review-guard cannot tell which one executes or which PR it targets. Split it into one \`gh pr\` call per command and re-run. $BYPASS"
      fi
      [ "$SUB" = "merge" ] || exit 0
      PR=$(cmd_gh_pr_ref "$CMD") || PR=""
    else
      deny "Blocked: merge-review-guard could not load .claude/hooks/lib/cmd-detect.sh, so it cannot tell which PR this merges. Fail-closed. $BYPASS"
    fi
    ;;
  mcp__github__merge_pull_request)
    PR=$(printf '%s' "$INPUT" | jq -r '.tool_input.pullNumber // empty' 2>/dev/null)
    ;;
  *) exit 0 ;;
esac

case "$PR" in
  ''|*[!0-9]*)
    # Cause order is deliberate. The overwhelmingly common one is NO PR NUMBER AT ALL:
    # `gh pr merge --auto --squash --delete-branch` is legal, documented usage
    # (todo-executor.md:564 minus the number) and guard-outward-cli.sh ALLOWS it — measured,
    # it denies only the non---auto form — so it arrives here and is denied unconditionally,
    # before any risk classification, even on a docs-only PR. A human who reads
    # "obfuscated or --repo" first has to guess that "the ref is missing" is their case.
    deny "Blocked: merge-review-guard could not resolve a PR number from this merge, so it cannot tell which PR to classify. The usual cause is that NO number was given — \`gh pr merge --auto --squash\` merges the current branch's PR, and this gate deliberately will not infer that: the Bash tool's cwd persists and can differ from the branch being merged, so inferring would risk classifying one PR while merging another. Re-run as \`gh pr merge <number> --auto --squash …\`. The other two causes are a ref obfuscated by a shell substitution and a \`--repo\` retarget, both of which the shared extractor refuses to guess at. $BYPASS" ;;
esac

GUARD="$ROOT/scripts/todo-automerge-guard.sh"
if [ -z "$ROOT" ] || [ ! -f "$GUARD" ]; then
  deny "Blocked: merge-review-guard could not locate scripts/todo-automerge-guard.sh, so it cannot classify PR #$PR's risk. Fail-closed. $BYPASS"
fi

# cwd is NOT ours to inherit. Hook handlers run in the agent's current directory, the Bash
# tool's cwd persists across calls, and `gh pr view` / `gh pr diff` resolve the repository
# FROM CWD — so from inside another checkout this gate would classify a DIFFERENT repo's
# PR #$PR and could allow on its file list. Anchoring to $ROOT also makes
# review_stamp_dir's `git rev-parse --git-common-dir` resolve the same repo key the writer
# resolved. Same cwd-dependence class as test-settings-hook-paths.sh.
cd "$ROOT" 2>/dev/null \
  || deny "Blocked: merge-review-guard could not enter the project directory to classify PR #$PR. Fail-closed. $BYPASS"

command -v gh >/dev/null 2>&1 \
  || deny "Blocked: merge-review-guard needs \`gh\` to classify PR #$PR and it is not on PATH. Fail-closed. $BYPASS"

VIEW=$(gh pr view "$PR" --json headRefName,headRefOid 2>/dev/null) \
  || deny "Blocked: could not read PR #$PR (gh error — wrong repository, no such PR, or auth/network). Fail-closed. $BYPASS"
BRANCH=$(printf '%s' "$VIEW" | jq -r '.headRefName // empty' 2>/dev/null)
HEAD_SHA=$(printf '%s' "$VIEW" | jq -r '.headRefOid // empty' 2>/dev/null)
[ -n "$HEAD_SHA" ] \
  || deny "Blocked: PR #$PR has no resolvable head sha, so no review can be bound to it. Fail-closed. $BYPASS"

# ── STAGE 1 — source type ─────────────────────────────────────────────────────
# `todo/<slug>` is an enforced invariant (.claude/agents/todo-executor.md:474), already
# load-bearing for the executor's batch-merge skip. The NAME selects the policy; the full
# guard ENFORCES it — a todo/* branch touching sensitive paths must not shortcut (#821),
# and a non-todo branch that merely CARRIES a todos/archive file must not be mistaken for
# executor-produced (#938).
#
# NOTE for whoever changes this next: the full guard's TODO GATE runs only when
# --paths-only is absent, and its PATH GATE runs in BOTH modes — so today stage 1's ALLOW
# set is a strict SUBSET of stage 2's and this block cannot change any verdict. It is kept
# because the branch test is the spec's classifier and a TODO-GATE change could make it
# load-bearing again; what it costs meanwhile is the guard's `gh api` reads on todo/*
# merges. Do not infer from "it never flips a verdict" that the branch name is unused.
case "$BRANCH" in
  todo/*)
    if bash "$GUARD" "$PR" >/dev/null 2>&1; then exit 0; fi
    ;;
esac

# ── STAGE 2 — content risk ────────────────────────────────────────────────────
# exit 0 = every changed file allowlist-safe (no review required)
# exit 1 = HOLD, exit 2 = tooling error — both require a review record. A rate-limited or
# unauthenticated gh must not read as "nothing risky here".
GUARD_RC=0
bash "$GUARD" --paths-only "$PR" >/dev/null 2>&1 || GUARD_RC=$?
[ "$GUARD_RC" -eq 0 ] && exit 0

# ── STAGE 3 — review record ───────────────────────────────────────────────────
[ -f "$HERE/lib/review-stamp-path.sh" ] \
  || deny "Blocked: merge-review-guard could not locate lib/review-stamp-path.sh, so it cannot find where reviews are recorded. Fail-closed. $BYPASS"
. "$HERE/lib/review-stamp-path.sh" 2>/dev/null
declare -F review_stamp_dir >/dev/null \
  || deny "Blocked: review_stamp_dir unavailable, so merge-review-guard cannot find where reviews are recorded. Fail-closed. $BYPASS"

# review_stamp_dir uses ${1:?...}, which aborts the SOURCING shell on an empty argument —
# $HEAD_SHA is proven non-empty above, so this call cannot take the process down.
DIR=$(review_stamp_dir "$HEAD_SHA")
RECORDS=$(find "$DIR" -maxdepth 1 -name '*.json' 2>/dev/null | sort)
[ -n "$RECORDS" ] \
  || deny "Blocked: PR #$PR changes risk-classified files and no review record exists for head ${HEAD_SHA:0:7}. This is NOT proof that no review ran — a reviewer whose findings were all WARNING or SUGGESTION writes no record at all, and a review that reported an abbreviated or different SHA files its record under that SHA instead. Dispatch the reviewer roster (docs/AI_WORKFLOW.md) against this exact commit; its report must carry a full 40-character REVIEWED-SHA and a REVIEWED-FILES block covering the PR's changed files. $BYPASS"

# WANT_DIGEST must use the SAME formula review-stamp-writer.sh uses — sorted, de-duplicated
# file list, one per line, `shasum`, first 16 hex characters — or every record mismatches
# and every gated merge denies. The list is captured BEFORE hashing on purpose: piping a
# failed `gh pr diff` straight into shasum yields the digest of the EMPTY STRING, which is
# a perfectly well-formed value that simply matches nothing, so the real cause (gh failed)
# would surface as a scope-mismatch denial pointing at the wrong thing.
CHANGED=$(gh pr diff "$PR" --name-only 2>/dev/null | sed '/^$/d' | sort -u)
[ -n "$CHANGED" ] \
  || deny "Blocked: could not re-read PR #$PR's changed files, so merge-review-guard cannot verify that the recorded review covered them. Fail-closed. $BYPASS"
WANT_DIGEST=$(printf '%s\n' "$CHANGED" | shasum 2>/dev/null | cut -c1-16)
[ -n "$WANT_DIGEST" ] \
  || deny "Blocked: could not compute the changed-file digest for PR #$PR (shasum unavailable). Fail-closed. $BYPASS"

MATCHED=""
while IFS= read -r rec; do
  [ -z "$rec" ] && continue
  [ "$(jq -r '.head_sha // empty' "$rec" 2>/dev/null)" = "$HEAD_SHA" ] || continue
  [ "$(jq -r '.reviewed_files_digest // empty' "$rec" 2>/dev/null)" = "$WANT_DIGEST" ] || continue
  MATCHED=1

  # `unresolved` is NOT "the list of bracketed CRITICAL findings". review-stamp-writer.sh
  # records EVERY line that triggered the findings verdict: a bracketed `[CRITICAL] …`
  # line, a bare `[CRITICAL]` token, an unbracketed agent-definition finding
  # (`file:line — issue — fix`, the shape the five roster reviewer definitions mandate),
  # or a whole sentence of prose that merely mentions the word. So this tests NON-EMPTINESS
  # and renders entry 0 VERBATIM. Filtering it — `select(startswith("[CRITICAL]"))` is the
  # tempting spelling — silently empties a genuine findings verdict and permits the merge.
  #
  # `verdict` is checked TOO, not instead: `.unresolved` absent gives `null | length` = 0,
  # so a truncated record would otherwise read as clean. `clean` is a positive signal here
  # exactly as it is in the writer.
  VERDICT=$(jq -r '.verdict // empty' "$rec" 2>/dev/null)
  NLEFT=$(jq -r '(.unresolved // []) | length' "$rec" 2>/dev/null)
  case "$NLEFT" in ''|*[!0-9]*) NLEFT=1 ;; esac   # unparseable ⇒ treat as unresolved
  if [ "$VERDICT" != "clean" ] || [ "$NLEFT" -ne 0 ]; then
    WHO=$(jq -r '.agent_type // "a reviewer"' "$rec" 2>/dev/null)
    FIRST=$(jq -r '(.unresolved // []) | if length > 0 then (.[0] | tostring) else "" end' "$rec" 2>/dev/null)
    [ -n "$FIRST" ] || FIRST="(no detail recorded)"
    NOUN="unresolved entries"; [ "$NLEFT" = 1 ] && NOUN="unresolved entry"
    deny "Blocked: the review record ${WHO} wrote for head ${HEAD_SHA:0:7} reports verdict '${VERDICT:-<missing>}' with ${NLEFT} ${NOUN}, the first being: ${FIRST} — Resolve it, push, and re-review against the NEW head sha (a record is bound to one commit). Entries are whatever triggered the findings verdict, so this may be an unbracketed finding or prose rather than a bracketed CRITICAL. $BYPASS"
  fi
done <<< "$RECORDS"

[ -n "$MATCHED" ] \
  || deny "Blocked: $(printf '%s\n' "$RECORDS" | wc -l | tr -d ' ') review record(s) exist for head ${HEAD_SHA:0:7}, but none was scoped to PR #$PR's changed files (this diff's digest over $(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ') file(s) is ${WANT_DIGEST}). The recorded review covered a different file set, so its verdict says nothing about this diff. Re-review this commit's actual changed files. $BYPASS"

exit 0
