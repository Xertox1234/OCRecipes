#!/usr/bin/env bash
# PreToolUse — block merging a risk-classified PR unless a review record exists for its
# exact head sha and file scope. NOT "a record this agent did not write": the record is an
# unprotected file at a derivable path (spec §6.2, corrected 2026-09-10), so what this gate
# catches is a review OMITTED, stale or mis-scoped — not one deliberately fabricated.
# Design: docs/superpowers/specs/2026-09-08-merge-review-gate-design.md
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
# The Bash arm is NOT the fast path repeated. `cmd_fastpath_has` matches the EXTRACTED
# `.tool_input.command`; here there is no jq, so nothing can extract that field and the
# grep runs against the WHOLE RAW ENVELOPE instead. That is a strictly WIDER match — it can
# fire on `gh`/`pr`/`merge` appearing anywhere in the payload, including a `description`
# field or another tool_input key, not just in the command being run. Deliberate: the wider
# match is the fail-safe direction, and a narrower one is not available without the very
# tool that is missing. Do not "align" it with the fast path.
#
# Known over-deny that follows, accepted: any Bash payload whose raw text carries `gh`,
# then `pr`, then `merge` in that order denies while jq is gone — `git commit -m "fix
# highlight for pr merge"` among them. Every crude no-jq fallback in this repo makes the
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
        # DISTINGUISH TWO SUB-CASES OF THIS SAME REFUSE, message-only — the verdict below is
        # `deny` unconditionally in BOTH: (a) a command-position `gh pr <write-verb>` really
        # executes somewhere in $CMD (e.g. `echo "$(gh pr merge 938)" # gh pr create`, which
        # SUB_RC's own co-occurrence guard above cannot itself tell apart from case b), vs.
        # (b) the command's TEXT merely NAMES two write-verbs with nothing in command
        # position at all — a heredoc body, a ledger comment, a commit message. Case (b)'s
        # old advice ("split it into one `gh pr` call per command") was actively wrong: there
        # is nothing here to split, because nothing here runs `gh`.
        #
        # Composed from cmd_is_gh_pr_create's own building blocks (_CMD_POS_PREFIX,
        # _CMD_GH_GLOBALS, _CMD_POS_SUFFIX, cmd_words_deep) — NOT a new detector, and NOT a
        # widening of cmd_gh_pr_write_subcommand/cmd_bare_deep, which stay exactly as they
        # are (this is the same "compose an existing anchored matcher's primitives at one
        # call site rather than widen the shared extractor" shape PR #964 used elsewhere in
        # this file — see that PR/its solution doc once merged; not restated here since it
        # postdates this branch's base). cmd_words_deep is already loaded by the
        # `. "$HERE/lib/cmd-detect.sh"` above (same file, same `declare -F` guard's success),
        # so no separate sourcing check is added to that top chain — only a local, fail-safe
        # default here: PR_WRITE_EXECUTES starts at 1 (the old, still-true-for-case-a
        # message) and flips to 0 ONLY when the capture below runs `grep` and finds no
        # command-position match. NOT a guarantee against every capture failure — round-2
        # code-reviewer, 2026-09-14: if `cmd_words` were itself broken AND `$CMD` carried no
        # command substitution, `cmd_words_deep`'s trailing `while read ... done < <(...)`
        # still returns 0 on zero iterations (confirmed empirically), so the capture
        # "succeeds" with an empty string and this flips to 0 — the LESS cautious message —
        # not 1. `cmd_is_gh_pr_create` carries the identical exposure and does not claim
        # otherwise; this comment doesn't either. Currently unreachable end-to-end (a broken
        # `cmd_words` also breaks `cmd_bare_deep`, so `cmd_gh_pr_write_subcommand` itself
        # would already have exited via `[ "$SUB" = "merge" ] || exit 0` before this branch
        # runs), but that is a property of the CALLER, not a property this local default can
        # rely on in isolation.
        #
        # RESIDUALS, deliberately not chased (measured 2026-09-14, two independent
        # mechanisms — neither changes the verdict, both stay deny; each is its own gap, not
        # one gap described twice):
        #
        # (1) _CMD_POS_PREFIX anchors on `(^|[;&|(`{!])` and grep's `^` matches PER LINE, so
        # a heredoc body line whose write-verb sits at column 0 with no leading prose —
        #   cat >> ledger.md <<EOF
        #   gh pr merge 900 was run
        #   then gh pr create
        #   EOF
        # — still matches command position and keeps the OLD "split it" message, exactly
        # like a real invocation would, even though nothing here executes either. Pinned as
        # test-merge-review-guard.sh row 33c.
        #
        # (2) A QUOTED heredoc delimiter (`<<'EOF'`) suppresses ALL expansion inside the
        # body — `$(gh pr merge 900)` there is 100% literal text, nothing executes — but
        # cmd_extract_substitutions (the shared, unmodified library) has no heredoc-
        # redirection semantics: it scans the body as ordinary unquoted text and reports the
        # `$(...)` as live regardless of the enclosing `<<'...'` whose entire purpose is
        # suppressing exactly that expansion. Confirmed by construction: the quoted-
        # delimiter form and its unquoted control both return the SAME "split it" message,
        # though only the control genuinely executes. Not pinned as its own row (rows 33/33b
        # already assert the SAME message text this shares; a dedicated row would only
        # re-assert an identical string).
        #
        # Both are library-level extraction gaps (cmd_extract_substitutions / cmd_words),
        # not this call site's own classification logic — closing either needs real heredoc-
        # boundary parsing in the shared lib, a new mechanism, out of this todo's Scope
        # Contract, which composes existing primitives only.
        PR_WRITE_EXECUTES=1
        if PR_WRITE_WORDS=$(cmd_words_deep "$CMD" 2>/dev/null); then
          grep -Eq "${_CMD_POS_PREFIX}gh${_CMD_GH_GLOBALS}[[:space:]]+pr[[:space:]]+(create|merge|close|edit)${_CMD_POS_SUFFIX}" \
            <<< "$PR_WRITE_WORDS" || PR_WRITE_EXECUTES=0
        fi
        if [ "$PR_WRITE_EXECUTES" -eq 1 ]; then
          deny "Blocked: this command mentions more than one \`gh pr\` write subcommand, so merge-review-guard cannot tell which one executes or which PR it targets. Split it into one \`gh pr\` call per command and re-run. $BYPASS"
        else
          deny "Blocked: this command's TEXT names more than one \`gh pr\` write subcommand (e.g. inside a heredoc body, a comment, or a commit/ledger message), but none of them sits in command position — nothing here appears to actually run \`gh\`. merge-review-guard denies out of caution anyway, since it cannot prove a substitution or later edit won't make one executable. If this really is inert text, write it through a file tool (Write/Edit) instead of passing it as a single Bash argument. $BYPASS"
        fi
      fi
      # AN EXTRACTOR MISS IS INDISTINGUISHABLE FROM "NOT A MERGE" HERE, AND THAT IS A
      # KNOWN, MEASURED GAP - see todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md.
      # cmd_gh_pr_write_subcommand signals REFUSE with rc 1 (handled above) but signals
      # "I could not see it" with the SAME empty string and rc 0 it uses for "there is no
      # merge here", so every rendering it cannot parse arrives at this line as "".
      # Measured 2026-09-12 - no bypass token, risk-classified PR, no review record, ALL
      # ALLOWED: a path-qualified binary (what `which gh` prints on a Homebrew box), a
      # redirect sitting between the binary and the verb, a glued metacharacter before the
      # binary, and a quoted command substitution supplying it. 248 of a 537-row
      # combinatorial corpus. The todo carries the corpus and the measurements.
      #
      # PARTIALLY CLOSED 2026-09-13. lib/cmd-detect.sh gained _CMD_GH_GLOBALS, which models
      # the slot between the binary and its NAMESPACE, so a redirect sitting THERE
      # (`gh 2>/dev/null pr merge 42`) now resolves and is denied - those tripwire rows in
      # test-merge-review-guard.sh are converted to deny rows.
      #
      # SCOPE, because an earlier version of this paragraph over-claimed it: P1 defines
      # mechanism (b) as a word between the binary and the VERB, which is TWO slots. Only the
      # first is closed. The namespace->verb slot is still spelled `pr[[:space:]]+(verb)` with
      # no absorber, so `gh pr 2>/dev/null merge 42`, `gh pr>log merge 42`,
      # `gh pr 2>&1 merge 42` and `gh -R o/r pr 2>/dev/null merge 42` all still reach
      # this line with SUB empty and are allowed here. Measured 2026-09-13 against the widened
      # lib, with `gh pr merge 42` denying as a control. Not a regression - main allows them
      # too - and guard-outward-cli.sh denies all four, because its `_OUT_SEP` absorbs a
      # redirect in BOTH slots. The same change closed a
      # separate P0: a repo-retarget flag in ROOT position (`gh -R owner/repo pr <verb> 42`)
      # sat in that same slot and reached this line as "not a merge", including with the
      # retarget pointed at THIS repository.
      # STILL OPEN, re-measured against the widened extractor and still pinned ALLOW: the
      # path-qualified binary, the glued metacharacter, and the quoted substitution. Those
      # three defeat the detector before the slot is ever reached - they are about how the
      # BINARY is rendered, not about what sits after it - so P1 remains open for them.
      # A FIFTH family, and the other half of mechanism (b): a redirect in the NAMESPACE->VERB
      # slot, enumerated in the scope note above.
      # A FOURTH family is open in the slot this change DOES model, named here so the list
      # above is not read as exhaustive: a QUOTED root flag carrying a SEPARATE unquoted
      # value. cmd_bare blanks the quoted span, so `gh "-R" o/r pr merge 42` renders as
      # `gh      o/r pr merge 42` and the VALUE lands where the namespace belongs - SUB
      # comes back empty and this line allows. Isolating control measured the same day:
      # `gh "--no-color" pr merge 42` still resolves, so the cause is the separate value,
      # not quoting as such. Not a regression (main behaves identically), and
      # guard-outward-cli.sh still denies it because that hook reads cmd_words, which
      # DELETES quote characters, rather than cmd_bare, which blanks the span.
      #
      # A raw-token predicate was tried here across three review rounds and WITHDRAWN. It
      # closed each family it was aimed at and re-opened the OPPOSITE failure one layer up
      # every time: first `through` and `enough` were denied, then `$var` and `$5`, then
      # an ordinary `git commit -m` whose message merely described this gate. A merge gate
      # that denies ordinary commit messages has no per-command escape - SKIP_MERGE_REVIEW
      # must be set in the shell that launched the session - so it gets switched off,
      # which costs more than the gap it closes.
      #
      # The gap is NOT a regression introduced by this gate. guard-outward-cli.sh already
      # allows a path-qualified merge on main, and the redirect family defeats the SHARED
      # extractor in lib/cmd-detect.sh as well, so both layers miss the same row. The real
      # fix widens that shared library and re-pins the required `Outward-CLI guard corpus`
      # check - a change of its own, exactly like the gh-api merge route
      # (todos/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md).
      [ "$SUB" = "merge" ] || exit 0
      PR=$(cmd_gh_pr_ref "$CMD") || PR=""
    else
      deny "Blocked: merge-review-guard could not load .claude/hooks/lib/cmd-detect.sh, so it cannot tell which PR this merges. Fail-closed. $BYPASS"
    fi
    ;;
  mcp__github__merge_pull_request)
    PR=$(printf '%s' "$INPUT" | jq -r '.tool_input.pullNumber // empty' 2>/dev/null)
    # OWNER/REPO ARE NOT DECORATIVE. Everything below resolves the PR from $ROOT — `cd
    # "$ROOT"` then `gh pr view <n>`, which takes the repository FROM CWD — so reading
    # only pullNumber classified a call naming ANOTHER repository against THIS repo's PR
    # of the same number, and a review record earned here authorised it. Measured:
    # {"owner":"x","repo":"y","pullNumber":42} -> ALLOW.
    #
    # This mirrors the Bash arm, which refuses a repository RETARGET: cmd_gh_pr_ref
    # returns 1 on `--repo`/`-R`, and the ref-less deny below fires.
    #
    # THAT SENTENCE HELD FOR ONLY ONE FLAG ORDERING UNTIL 2026-09-13, and the correction is
    # worth keeping. cmd_gh_pr_ref scanned for the flag inside $full_match, whose greedy
    # tail must end on a NON-dash token, so a TRAILING `--repo` was backtracked out of the
    # span before the scan ever ran. Measured: `gh pr merge 42 --repo other/org` resolved
    # ref 42, and this gate went on to classify the LOCAL PR #42 - its deny text was
    # byte-identical to a bare one's. The sibling ordering `--repo other/org 42` refused
    # correctly, which is exactly why the gap survived a reader who checked one spelling.
    # The refusal now scans the clause that produced the ref — anchored at it, with only the
    # TAIL truncated — so both orderings refuse. test-cmd-detect.sh pins all four spellings
    # in both positions AND the shapes carrying an EARLIER command separator, which is where
    # two successive versions of that scan silently resolved the ref instead of refusing.
    #
    # Mirrored in BOTH directions, the ABSENT case included — a bare
    # `gh pr merge 42` carries no `--repo` and is allowed to mean the ambient repo, so a
    # payload asserting NO owner/repo is likewise treated as ambient, not denied. Only an
    # ASSERTED-AND-DIFFERENT target is refused. Denying the absent case instead would
    # block every payload the field is optional on — the restrictive failure this hook's
    # header names, which costs the same coverage more slowly.
    #
    # Do NOT "fix" this by plumbing --repo/-R into the gh calls below: that makes the gate
    # classify a foreign repo, which is the same cross-repo confusion moved one step later.
    M_OWNER=$(printf '%s' "$INPUT" | jq -r '.tool_input.owner // empty' 2>/dev/null)
    M_REPO=$(printf '%s' "$INPUT" | jq -r '.tool_input.repo // empty' 2>/dev/null)
    if [ -n "$M_OWNER" ] || [ -n "$M_REPO" ]; then
      # `${var,,}` is bash 4 (docs/rules/harness.md: target is stock macOS bash 3.2), so
      # case-folding goes through tr. GitHub owner/repo names are case-insensitive.
      SELF=$(git -C "$ROOT" config --get remote.origin.url 2>/dev/null)
      SELF=${SELF%.git}; SELF=${SELF%/}
      SELF_REPO=${SELF##*/}
      SELF_OWNER=${SELF%/*}; SELF_OWNER=${SELF_OWNER##*/}; SELF_OWNER=${SELF_OWNER##*:}
      # A remote with no `/` leaves owner and repo as the SAME whole string; test the
      # separator rather than `owner = repo`, which would false-deny a genuine `foo/foo`.
      case "$SELF" in */*) ;; *) SELF_OWNER="" ;; esac
      if [ -z "$SELF_OWNER" ] || [ -z "$SELF_REPO" ]; then
        deny "Blocked: this merge names repository \`$M_OWNER/$M_REPO\`, and merge-review-guard could not determine which repository this checkout is (no readable \`remote.origin.url\`), so it cannot confirm the two are the same. It classifies PRs from this checkout only. Fail-closed. $BYPASS"
      fi
      if [ "$(printf '%s' "$M_OWNER" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$SELF_OWNER" | tr '[:upper:]' '[:lower:]')" ] \
         || [ "$(printf '%s' "$M_REPO" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$SELF_REPO" | tr '[:upper:]' '[:lower:]')" ]; then
        deny "Blocked: this merge targets \`$M_OWNER/$M_REPO\`, but merge-review-guard classifies PRs against \`$SELF_OWNER/$SELF_REPO\` (this checkout) — so any review record it found would describe a DIFFERENT repository's PR #$PR. The Bash route refuses a \`--repo\` retarget for the same reason. Run the merge from a checkout of \`$M_OWNER/$M_REPO\`. $BYPASS"
      fi
    fi
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
  || deny "Blocked: PR #$PR changes risk-classified files and no review record exists for head ${HEAD_SHA:0:7}. This is NOT proof that no review ran — a reviewer whose findings were all WARNING or SUGGESTION writes no record at all, and a review that reported a DIFFERENT SHA files its record under that SHA instead (an abbreviated one is refused outright by the writer, so it writes nothing). Dispatch the reviewer roster (docs/AI_WORKFLOW.md) against this exact commit; its report must carry a full 40-character REVIEWED-SHA and a REVIEWED-FILES block covering the PR's changed files. $BYPASS"

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
  # AN UNREADABLE RECORD IS NOT AN ABSENT ONE. This test used to be a bare `continue`, which
  # made it a third filter deciding whether a record could BLOCK — the same defect the
  # reorder below fixes for the digest, one line up. A record whose JSON jq cannot read
  # yields "" here, mismatches, and was skipped before its verdict was ever consulted.
  # Measured against the live hook with a clean code-reviewer.json sitting beside it: a
  # truncated `{`, a zero-byte file, a JSON array, two concatenated objects, and a
  # well-formed findings record with no head_sha key ALL ALLOWED the merge; each one ALONE
  # denied, which is what attributes the allow to the sibling rather than to the corruption.
  #
  # Reachable narrowly but really: the writer's `> "$DIR/<agent>.json"` is not atomic and
  # truncates at open, so an interrupted write (ENOSPC, or the 10s SubagentStop timeout
  # landing inside jq) leaves exactly this shape — and the record most likely to be
  # half-written is whichever reviewer was still running, not a chosen one.
  #
  # A parseable record naming a DIFFERENT head still `continue`s: that is the ordinary
  # stale-review case, and the unmatched-at-the-end deny already covers it.
  REC_SHA=$(jq -r '.head_sha // empty' "$rec" 2>/dev/null)
  if [ -z "$REC_SHA" ]; then
    deny "Blocked: a review record in head ${HEAD_SHA:0:7}'s stamp directory could not be read — $(basename "$rec") is not parseable JSON, or carries no head_sha. This is NOT the same as no review: a record that exists but cannot be read is not evidence that an objection was withdrawn, and the most likely cause is a write interrupted partway (the writer truncates the file at open). Delete the unreadable record and re-dispatch the reviewer against this exact commit. $BYPASS"
  fi
  [ "$REC_SHA" = "$HEAD_SHA" ] || continue

  # ORDER IS LOAD-BEARING: OBJECT FIRST, THEN SCOPE. The digest test used to sit here,
  # above the verdict block, so a `verdict: findings` record whose digest did NOT match was
  # `continue`d away before anything read its verdict — and if a sibling record passed both
  # tests with `clean`, the loop ended MATCHED and the gate allowed a commit a reviewer had
  # objected to. One filter was doing two jobs. Digest match decides whether a record can
  # SATISFY the requirement; it must not decide whether a record can BLOCK.
  #
  # Measured 2026-09-12 on one fixture, three rows: a findings record with the CORRECT
  # digest beside a clean one denied; the same findings record carrying a MISMATCHED digest
  # beside that clean one ALLOWED; and that mismatched findings record ALONE denied on
  # scope — which is what makes the middle row attributable to the sibling rather than to
  # the mismatch.
  #
  # Reachable with no adversary and no bypass token: review-stamp-writer.sh's own residual
  # 5 enumerates the digests produced when a reviewer writes a bare-token line (`Findings:`,
  # `Notes:`, `---`) between the file list and its findings, and a header reading
  # `Findings:` is likelier from the reviewer that HAS findings than from a clean baseline.
  # The record preferentially corrupted is therefore the one carrying the objection.
  #
  # A findings record for THIS head whose scope differs still blocks. That is deliberate:
  # a reviewer objected to this commit, and a corrupted or differently-scoped digest is not
  # evidence the objection was withdrawn. Fail-closed is the direction that costs a re-review,
  # not a merged defect.

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

  # Scope decides only whether this record SATISFIES the requirement — reached only after
  # the objection test above, so a mismatch can never skip a findings record.
  [ "$(jq -r '.reviewed_files_digest // empty' "$rec" 2>/dev/null)" = "$WANT_DIGEST" ] || continue
  MATCHED=1
done <<< "$RECORDS"

[ -n "$MATCHED" ] \
  || deny "Blocked: $(printf '%s\n' "$RECORDS" | wc -l | tr -d ' ') review record(s) exist for head ${HEAD_SHA:0:7}, but none was scoped to PR #$PR's changed files (this diff's digest over $(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ') file(s) is ${WANT_DIGEST}). The recorded review covered a different file set, so its verdict says nothing about this diff. Re-review this commit's actual changed files. $BYPASS"

exit 0
