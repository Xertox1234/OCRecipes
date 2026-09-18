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
# A THIRD route joined this crude pre-check 2026-09-14, for the same reason the fast path
# below did: `gh.*pr.*merge` alone never sees `gh api --method PUT repos/o/r/pulls/42/merge`
# (no `pr` substring anywhere in that text), so a jq-less environment would silently allow
# exactly the merge route this file otherwise now denies.
# todos/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md
#
# The Bash arm is NOT the fast path repeated. `cmd_fastpath_has` matches the EXTRACTED
# `.tool_input.command`; here there is no jq, so nothing can extract that field and the
# grep runs against the WHOLE RAW ENVELOPE instead. That is a strictly WIDER match — it can
# fire on `gh`/`pr`/`merge` (or `gh`/`api`/`merge`) appearing anywhere in the payload,
# including a `description` field or another tool_input key, not just in the command being
# run. Deliberate: the wider match is the fail-safe direction, and a narrower one is not
# available without the very tool that is missing. Do not "align" it with the fast path.
#
# Known over-deny that follows, accepted: any Bash payload whose raw text carries `gh`,
# then `pr`, then `merge` in that order (or `gh`, then `api`, then `merge`) denies while jq
# is gone — `git commit -m "fix highlight for pr merge"` among them. Every crude no-jq
# fallback in this repo makes the same trade; a denied commit in an already-broken
# environment carries its own bypass, an unreviewed merge does not.
if ! command -v jq >/dev/null 2>&1; then
  RAW=$(cat)
  if grep -Eq '"tool_name"[[:space:]]*:[[:space:]]*"mcp__github__merge_pull_request"' <<< "$RAW" \
     || { grep -Eq '"tool_name"[[:space:]]*:[[:space:]]*"Bash"' <<< "$RAW" \
          && grep -Eq 'gh.*pr.*merge|gh.*api.*merge' <<< "$RAW"; }; then
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
    #
    # A SECOND needle joined this call 2026-09-14: `gh api` against the REST merge
    # endpoint (`PUT /repos/{owner}/{repo}/pulls/{n}/merge`) is a THIRD merge route that
    # carries no literal `pr` substring at all — `gh api --method PUT
    # repos/o/r/pulls/42/merge` matches neither `pr` nor the old single needle, so it
    # never reached the precise detector below and returned a silent allow.
    # todos/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md
    # Widening THIS call site (rather than adding a second, independent
    # cmd_fastpath_has call) keeps test-cmd-detect.sh's assert_wired assertion for this
    # hook meaningful without editing it: that assertion greps this exact line and does a
    # SUBSTRING test (`case "$line" in *"$expect"*)`) against `'*gh*pr*merge*'`, so the
    # original needle staying present — merely joined by a second one — leaves that pin
    # passing unchanged (measured by running the suite after this change).
    if . "$HERE/lib/fastpath-filter.sh" 2>/dev/null && declare -F cmd_fastpath_has >/dev/null; then
      cmd_fastpath_has "$CMD" '*gh*pr*merge*' '*gh*api*merge*' || exit 0
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
    # THE THIRD CONJUNCT IS NOT OPTIONAL, and it was missing for one commit. This preflight
    # exists because an undefined callee returns rc 127, and the gate below is written
    # `if ! cmd_gh_pr_has_merge ...; then exit 0` -- so `!` inverts 127 to true and a lib
    # that sources without defining the function becomes a SILENT ALLOW at the one
    # ALLOW-shaped read in this file. Measured under bash 5.3.15: a defined function
    # returning 1 takes the allow branch (correct, no merge present), a MISSING function
    # takes the same allow branch (wrong), and a defined function returning 0 takes the
    # deny branch. Version skew is the realistic trigger -- this hook cherry-picked without
    # lib/cmd-detect.sh, a partially-merged tree, a stale .claude/ copy. Every function
    # called below this line must appear in this conjunction; the `else` arm's deny is the
    # only correct outcome when one does not. cmd_words_deep -- used by the gh-api route
    # below -- was NOT in it when that sentence was first written, which made the sentence
    # false about its own file. Unreachable in practice (it is defined far above
    # cmd_gh_pr_ref, so any source defining the last necessarily defined it), but an
    # invariant a file does not satisfy is worse than no invariant.
    # THE CONSTANTS ARE CHECKED TOO, and documenting that they were not was not good enough.
    # All four are interpolated unguarded below; under `set -u` an unset one kills the hook
    # before it emits JSON, and a PreToolUse hook that exits without JSON is NON-BLOCKING --
    # i.e. the blocking gate silently disarms, in the one direction that matters. The trigger
    # is the same lib/consumer skew that justified the function checks. Routing them through
    # the same conjunction sends a missing constant to the `else` deny instead of to an
    # unguarded abort. They are tested with -n rather than declare -F because they are
    # assignments, not functions.
    if . "$HERE/lib/cmd-detect.sh" 2>/dev/null \
       && declare -F cmd_gh_pr_write_subcommand >/dev/null \
       && declare -F cmd_gh_pr_has_merge >/dev/null \
       && declare -F cmd_words_deep >/dev/null \
       && declare -F cmd_gh_pr_ref >/dev/null \
       && [ -n "${_CMD_POS_PREFIX:-}" ] && [ -n "${_CMD_GH_GLOBALS:-}" ] \
       && [ -n "${_CMD_POS_SUFFIX:-}" ] && [ -n "${_CMD_REDIR:-}" ]; then
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
      # retarget pointed at THIS repository. That P0 was closed in TWO steps and only the
      # first landed then: naming `-R`/`--repo` covered four spellings, but cobra takes any
      # flag of the TARGET subcommand in root position, so ANY OTHER separate-arg flag still
      # left its value where the namespace belongs -- `gh -t x pr merge 42 -R other/org`, a
      # cross-repository retarget, reached this line as "not a merge" too. Closed 2026-09-13 by
      # giving _CMD_GH_GLOBALS's generic arm an optional non-dash value token, i.e. by modelling
      # the PROPERTY rather than naming more flags; `-Z somevalue` and `--not-a-real-flag v`
      # are pinned in the suite precisely because neither is a real gh flag.
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
      # not quoting as such. RE-MEASURED 2026-09-13 against the value arm, which does NOT
      # help here and was not expected to: the arm anchors on a DASH token, and blanking
      # removes the only one, so there is nothing left for it to attach a value to. The
      # family GREW with that change rather than shrinking -- every newly-covered flag has a
      # quoted spelling too, e.g. `gh "-t" x pr merge 42`, measured ALLOW here and DENY in
      # guard-outward-cli.sh. Closing it means making cmd_bare's blanking preserve token
      # boundaries, which is a lib-wide change and P1's, not this one's. Not a regression (main behaves identically), and
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
      # check - a change of its own. P1 remains open for all of this.
      #
      # CLOSED 2026-09-14, SEPARATELY: the gh-api merge route
      # (todos/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md).
      # This was never an extractor MISS in the sense above — cmd_gh_pr_write_subcommand
      # is built to read the `gh pr <verb>` shape, and a `gh api` call correctly contains
      # no `pr` subcommand for it to find. It is a DIFFERENT shape this file's own
      # `gh pr` extractors were never asked to cover, so the fix lives here, in
      # merge-review-guard.sh, rather than widening lib/cmd-detect.sh's `gh pr` matchers
      # for an unrelated command. See the detector immediately below.
      # RUNS UNCONDITIONALLY, and that is the whole point of this line. An earlier revision
      # nested this scan inside `if [ "$SUB" != "merge" ]`, which made it unreachable in
      # exactly the case that matters: when a `gh pr merge` resolves ANYWHERE in the same
      # command, control took the `else` below, classified only that first PR, and the
      # `gh api` merge rode through unexamined. The matcher was never the problem — it
      # never ran. Measured (security review, 2026-09-14), no stamp, docs-only diff so the
      # leading clause legitimately allows:
      #     gh pr merge 938 --auto --squash; gh api -X PUT repos/o/r/pulls/999/merge  -> ALLOW
      #     gh pr merge 938 --auto --squash && gh api -X PUT .../pulls/999/merge      -> ALLOW
      #     gh api -X PUT .../pulls/999/merge; gh pr merge 938 --auto --squash        -> ALLOW
      # and with both PreToolUse guards in sequence the whole chain permitted an unreviewed
      # merge. The no-jq crude fallback still denied it (it greps the raw envelope), so the
      # hole was specific to the normal, jq-present path — the one that actually runs.
        # `gh api` against the REST merge route (`PUT /repos/{owner}/{repo}/pulls/{n}/merge`)
        # is a merge this gate must also see. Detected independently of
        # cmd_gh_pr_write_subcommand/cmd_gh_pr_ref (both scoped to `gh pr <verb>`), reusing
        # cmd-detect.sh's own shared command-position primitives
        # (_CMD_POS_PREFIX/_CMD_GH_GLOBALS/_CMD_POS_SUFFIX/cmd_words_deep) the same way
        # guard-outward-cli.sh composes its OWN separate gh-api mutation check from them —
        # not a widening of cmd-detect.sh itself, which stays untouched.
        #
        # THE CLAUSE CUT mirrors guard-outward-cli.sh's _GH_API_CUT: from `gh <globals>
        # api` through the next real separator (;&|), so a LATER, unrelated clause on the
        # same compound command cannot donate this one's method flag or endpoint text.
        # cmd_words_deep, not cmd_bare_deep: this predicate is PURELY DENY-shaped (it
        # never grants anything), so per
        # docs/solutions/logic-errors/widening-is-safe-on-every-deny-read-and-a-false-grant-at-the-one-allow-read-2026-09-13.md
        # reusing the wide, shared _CMD_GH_GLOBALS here (rather than a grant-safe narrowed
        # sibling, which only that solution's ONE grant-shaped consumer needs) is the safe
        # direction — over-capture here can only ADD a deny.
        #
        # BOTH CONJUNCTS ARE LOAD-BEARING, mirroring guard-outward-cli.sh's own ambiguity
        # for this exact endpoint:
        #   - a MUTATING method (-X/--method POST/PUT/PATCH/DELETE) — the bare GET default
        #     on this same path is "has PR #n been merged?" (a real, read-only REST route),
        #     not a merge; requiring the method flag is what keeps that read silent below.
        #   - `pulls` then `merge` in the clause — the merge sub-resource path specifically,
        #     not any mutating `gh api` call (an unrelated mutating endpoint is
        #     guard-outward-cli.sh's concern, not this merge-specific gate's).
        # Measured (script, not assumed): a bare `-m "docs: … gh api … pulls/N/merge …"`
        # commit message never reaches this clause — the anchor requires real command
        # position, and inside a quoted arg cmd_words glues the whole span into one token
        # with no real separator for the anchor to match. A `gh api` clause hidden after a
        # PRIOR, benign `gh api` clause on the same line is still caught: every matched
        # clause is scanned, not only the first (a corpus-shape lesson from
        # docs/solutions/conventions/one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md).
        #
        # STILL OPEN, named rather than silently missed (security review, 2026-09-14):
        # `gh api --help` documents that the method defaults to POST, not GET, whenever
        # ANY `-f`/`-F`/`--raw-field`/`--field` is present, with no `-X`/`--method` token
        # anywhere in the text — so a call relying on that implicit POST reaches neither
        # conjunct above. Two constructions confirmed a silent ALLOW here: `gh api
        # repos/o/r/pulls/938/merge -f merge_method=squash` (this endpoint's real-world
        # effect on an implicit POST is unconfirmed — GitHub's merge route is documented
        # PUT-only) and `gh api graphql -f query='mutation { mergePullRequest(...) }'` (a
        # GENUINE, functioning merge — POST is graphql's own correct method, no PUT
        # involved, and this text contains neither `pulls` nor a method flag at all, so it
        # is a different SHAPE this two-conjunct detector was never built to parse, not an
        # extension of the REST-path shape it targets).
        #
        # A THIRD shape is likewise unhandled and belongs in this list: `gh api
        # repos/o/r/pulls/42/merge --input body.json` reaches neither conjunct
        # (probe-confirmed silent ALLOW, no `-X`/`--method` and no field flag present).
        # SETTLED 2026-09-15 against gh's SOURCE, which is what an earlier revision of this
        # comment asked for and then did not do. `gh api --help` ties the implicit-POST
        # switch to FIELD PARAMETERS specifically ("the default HTTP request method is GET
        # normally and POST if any parameters were added"), and documents `--input` only as
        # a body source — so the manual alone left the method question open, and this
        # comment recorded it as UNVERIFIED. The source does not leave it open.
        # cli/cli `pkg/cmd/api/api.go:329-330`:
        #     if !opts.RequestMethodPassed && (len(params) > 0 || opts.RequestInputFile != "") {
        #         method = "POST"
        #     }
        # `RequestInputFile` IS `--input` (api.go:301) and `RequestMethodPassed` is
        # `c.Flags().Changed("method")` (api.go:236). So `--input` alone flips the default
        # to POST exactly like a field parameter — it is a confirmed mutating shape, not an
        # unverified one, and todos/P1-2026-09-07-outward-cli-path-wrapper.md:387 already
        # classifies it that way for the same reason.
        #
        # What remains genuinely open is narrower and worth stating precisely so nobody
        # re-litigates the settled half: the EFFECT of a POST on /pulls/{n}/merge, which
        # GitHub documents as PUT-only. That was deliberately not settled empirically —
        # this is a merge endpoint, and constructing the call to find out is the exact act
        # this guard exists to prevent.
        #
        # Confirmed zero-delta from main:
        # guard-outward-cli.sh (untouched by this change) allows the graphql construction
        # too, so this gate did not remove coverage that existed. Already named, not yet
        # closed, at todos/P1-2026-09-07-outward-cli-path-wrapper.md:387 ("gh api graphql,
        # which is a different shape"). Closing it needs either widening this conjunct to
        # `-f`/`-F` presence (mirroring the unreadable-value arm below) plus a SEPARATE
        # graphql-mutation-body detector — a different scope than this todo's stated REST
        # `/pulls/<n>/merge` route — or is better tracked as its own todo entirely.
        MRG_API_CUT="${_CMD_POS_PREFIX}gh${_CMD_GH_GLOBALS}[[:space:]]+api${_CMD_POS_SUFFIX}([^;&|]|&[0-9-]|&[<>]|[<>]&|&?[<>]+&?[|!])*"
        # THE FLAG->VALUE SEPARATOR MUST ABSORB A REDIRECT, same fix guard-outward-cli.sh
        # already carries for its OWN gh-api mutating-method check (that file, dated
        # 2026-09-07, "THE FLAG->VALUE SEPARATOR TAKES THE ABSORBER" — `gh api ... -X DELETE`
        # denied there while `gh api ... -X 2>&1 DELETE` silently allowed, identical real
        # argv, confirmed by an argv-dumping stub). A hand-spelled `([[:space:]]|=)*` here
        # reintroduced the SAME pre-fix, vulnerable shape: measured (security review,
        # 2026-09-14) that `gh api -X 2>&1 PUT repos/o/r/pulls/938/merge` genuinely invokes
        # `gh` with argv `[api -X PUT repos/o/r/pulls/938/merge]` (confirmed under both bash
        # and zsh with an argv-dumping stub) yet the un-absorbed separator let it through
        # silently. MRG_SEP is built from the SAME `_CMD_REDIR` this file already sources,
        # mirroring guard-outward-cli.sh's `_OUT_SEP` composition rather than re-deriving it.
        MRG_SEP='([[:space:]]*'"$_CMD_REDIR"')*[[:space:]]+'
        # Case-insensitive VALUE, case-SENSITIVE flag (`-X`/`--method`) — same split
        # guard-outward-cli.sh states for itself: a case-insensitive `-x` collides with the
        # lowercase `x` placeholder cmd_words inserts for characters deleted from a quoted
        # span, so a quoted value merely containing enough letters could forge a match.
        MRG_API_M='([Pp][Oo][Ss][Tt]|[Pp][Uu][Tt]|[Pp][Aa][Tt][Cc][Hh]|[Dd][Ee][Ll][Ee][Tt][Ee])'
        # gh's IMPLICIT POST. api.go:329-330 makes the method POST when NO method flag was
        # passed AND there is at least one field parameter or an --input file. Both halves
        # are needed: `-X GET ... -f a=b` is a GET in gh and must stay ALLOW here, so this
        # arm is anchored on the ABSENCE of a method token exactly as gh anchors on
        # `!opts.RequestMethodPassed`. Short flags are matched without a value because gh
        # accepts `-f k=v` and `--field=k=v` alike and the VALUE is irrelevant to the method.
        MRG_API_FIELD='(^|[[:space:]])(-[fF]|(--field|--raw-field|--input)([[:space:]]|=|$))'
        MRG_API_ANYMETHOD='(^|[[:space:]])(-X|--method([^-A-Za-z0-9]|$))'
        set +o pipefail
        MRG_API_WORDS=$(cmd_words_deep "$CMD")
        MRG_API_CLAUSES=$(printf '%s' "$MRG_API_WORDS" | grep -ioE "$MRG_API_CUT")
        set -o pipefail
        MRG_API_HIT=""
        while IFS= read -r MRG_API_CLAUSE; do
          [ -n "$MRG_API_CLAUSE" ] || continue
          # ENDPOINT, NOT TWO WORDS ANYWHERE IN THE CLAUSE. `pulls.*merge` reads field VALUES
          # too, and the implicit-POST conjunct below made that reachable for field-only calls
          # for the first time: `-f body='see pulls/42/merge for context'` on an ISSUES endpoint
          # was classified a merge and denied, with a reason about resolving a PR number from a
          # command that posts a comment. Measured ALLOW before that conjunct, DENY after — an
          # over-denial this change introduced, not a pre-existing one.
          # Requiring at least ONE PATH SEGMENT before `pulls/` is what separates them: a real
          # endpoint is `repos/o/r/pulls/42/merge`, while a prose mention is a bare
          # `pulls/42/merge` with a space in front. RESIDUAL, narrower and named: prose that
          # quotes the FULL path (`body=see repos/o/r/pulls/42/merge …`) still matches. There is
          # no text-level way to tell that from the endpoint itself, and erring toward DENY is
          # the right direction for a merge gate.
          #
          # THE CLOSER IS ${_CMD_POS_SUFFIX}, NOT A HAND-SPELLED `([[:space:]]|$)`.
          # A redirect operator terminates a word without whitespace, so
          # `…/pulls/42/merge>/dev/null` puts `>` immediately after `merge` — neither
          # whitespace nor end-of-string — and a hand-spelled closer does not match,
          # skipping this entire arm for an argv that is an unmodified merge request.
          # Measured ALLOW here before this fix, DENY after, with a SPACED control
          # denying both times so the row is not vacuous (review, 2026-09-18).
          # Identical defect fixed in guard-outward-cli.sh on 2026-09-05 for a glued
          # `-XPOST>`; #992 swept the hand-spelled closers and this one was written
          # new afterwards. Do not re-spell it.
          #
          # THE SEGMENT CLASS WAS THE BUG, AND IT MADE THIS ARM A REGRESSION AGAINST main.
          # This started life as `/?[A-Za-z0-9._{}-]+(/[A-Za-z0-9._{}-]+)*/pulls/...`, replacing
          # main's substring test `pulls.*merge`. Enumerating the legal characters of a path
          # segment silently EXCLUDED the two that appear most often in a real command: `$`, so
          # `repos/$OWNER/$REPO/pulls/42/merge` did not match, and `:`, so a full
          # `https://api.github.com/...` endpoint did not either. Both are ordinary spellings --
          # the sibling guard's own comment names `repos/$OWNER/$REPO` as the routine idiom --
          # and both fell through to `continue`, i.e. ALLOW. Measured against main on 2026-09-18:
          # main DENY / this arm ALLOW for the variable, quoted-variable and full-URL forms, with
          # the plain `repos/o/r/...` form denying on BOTH as the non-vacuity control.
          # The closer had the same shape of bug from the other end: `${_CMD_POS_SUFFIX}` is a
          # SHELL word terminator, and `?` and `/` are neither shell terminators nor in it, so
          # `.../merge?x=1` and `.../merge/` -- both valid endpoint spellings -- also fell through.
          #
          # So: match a non-space run before `/pulls/` instead of enumerating what may appear in
          # it, and allow URL-legal trailing content before the real shell closer.
          #
          # THAT TRAILING CLASS IS `[?#]`, AND THE FIRST ATTEMPT AT THIS FIX SPELLED IT `\?` ALONE,
          # WHICH WAS THE SAME BUG ONE LAYER DOWN. A FRAGMENT also follows a path, so
          # `.../pulls/42/merge#frag` still fell through to ALLOW while main DENIED -- measured on
          # all five prefix spellings, with `?x=1#frag` denying (the query alternative swallowed the
          # fragment) which is what isolated the miss to a bare fragment. The fragment is never put
          # on the wire (RFC 3986 section 3.5), so the request that reaches GitHub is the unmodified
          # merge. `[?#]` is EXHAUSTIVE rather than another enumeration: by RFC 3986 a path can be
          # followed only by `?query` or `#fragment` and nothing else, so there is no third
          # character waiting to be discovered here.
          # WHAT ACTUALLY SEPARATES AN ENDPOINT FROM PROSE IS THE SLASH, NOT THE CHARACTER SET --
          # a prose mention is a bare `pulls/42/merge` with a space in front, and that still has
          # no path segment before it, so it still allows. Do not narrow this back to an
          # enumeration: an allowlist of characters in a deny predicate fails OPEN on every
          # character its author did not think of, which is the whole defect above.
          printf '%s' "$MRG_API_CLAUSE" \
            | grep -qiE "(^|[[:space:]])[^[:space:]]+/pulls/[^[:space:]/]+/merge/?([?#][^[:space:]]*)?${_CMD_POS_SUFFIX}" \
            || continue
          # Two ways this clause proves a mutating method: the value is a recognized
          # literal (glued `-XPUT`, or separated by whitespace/redirect/`=`), OR a
          # -X/--method flag is present at all alongside a `$`/backtick anywhere in the
          # clause — an UNREADABLE value (a substitution supplying it) cannot be verified
          # read-only, so it fails closed exactly like guard-outward-cli.sh's own sibling
          # check for the same reason: "cannot verify -> deny". Measured (security review,
          # 2026-09-14): `gh api -X "$(echo PUT)" repos/o/r/pulls/938/merge` renders the
          # value as the cmd_words placeholder text, not the literal "PUT", so the literal
          # match alone missed it — this second arm is what catches it.
          if printf '%s' "$MRG_API_CLAUSE" | grep -Eq "(^|[[:space:]])(-X${MRG_API_M}${_CMD_POS_SUFFIX}|(-X|--method)(${MRG_SEP}|=)${MRG_API_M}${_CMD_POS_SUFFIX})" \
             || { printf '%s' "$MRG_API_CLAUSE" | grep -Eq '(^|[[:space:]])(-X|--method)([^-A-Za-z0-9]|$)' \
                  && printf '%s' "$MRG_API_CLAUSE" | grep -qE '[$`]'; } \
             || { printf '%s' "$MRG_API_CLAUSE" | grep -Eq "$MRG_API_FIELD" \
                  && ! printf '%s' "$MRG_API_CLAUSE" | grep -Eq "$MRG_API_ANYMETHOD"; }; then
            MRG_API_HIT=1
            break
          fi
        done <<< "$MRG_API_CLAUSES"
        # ORDER MATTERS: the api hit is checked FIRST, before $SUB is consulted at all.
        # A command carrying BOTH a `gh pr merge` and a `gh api` merge names two different
        # merges, and this gate classifies exactly one PR — so there is no answer it could
        # give that covers both. Denying is the only correct response, and it matches the
        # multi-write-subcommand refuse above, which declines for the same reason.
        if [ -n "$MRG_API_HIT" ]; then
          # No new extraction: this raw REST path is not something cmd_gh_pr_ref can
          # resolve a PR number from (it is built for `gh pr <verb> <ref>`, not a URL
          # path), so route through the SAME ref-less deny every other unresolvable-ref
          # cause below already uses — fail closed, uniformly, rather than hand-rolling a
          # second URL parser in a file whose own header already warns against
          # re-deriving positional extraction. Set unconditionally: when a `gh pr merge`
          # also resolved, its ref is deliberately DISCARDED rather than classified, since
          # classifying it would allow the api merge riding alongside it.
          PR=""
        else
          # ANY rc THAT IS NEITHER 0 NOR 1 FAILS CLOSED. `if ! <cmd>` collapses every
          # non-zero status into one answer, and this read -- the only ALLOW-shaped one in
          # the file -- has been bitten by that twice: rc 127 when the function was undefined
          # under lib/consumer skew, and rc 141 when SIGPIPE hit past the 64KB pipe buffer.
          # Both were fixed one spelling at a time. This handles the CLASS: grep's own rc 2,
          # reachable by corrupting a shared constant, inverted to ALLOW under the old shape
          # too. "I could not tell" is not "there is no merge here", and only one of those is
          # safe to answer with exit 0.
          MRG_HAS_RC=0
          cmd_gh_pr_has_merge "$CMD" || MRG_HAS_RC=$?
          if [ "$MRG_HAS_RC" -ne 0 ] && [ "$MRG_HAS_RC" -ne 1 ]; then
            deny "Blocked: merge-review-guard could not determine whether this command contains a \`gh pr merge\`. The existence check returned $MRG_HAS_RC, which is neither \"found\" (0) nor \"absent\" (1) -- so this fails closed rather than guessing. $BYPASS"
          fi
          if [ "$MRG_HAS_RC" -eq 1 ]; then
          # EXISTENCE, NOT FIRST-OCCURRENCE -- this is the one ALLOW-shaped read in this
          # file, so it must be monotone under a widening of the shared grammar. It used to
          # ask `[ "$SUB" != "merge" ]`, i.e. "is the FIRST gh-pr clause a merge", and $SUB
          # comes from a `grep -oE ... | head -1`. Widening _CMD_GH_GLOBALS to admit a
          # separate-arg root flag made a LEADING `gh <flag> <value> pr close ...` clause
          # match where it previously did not; it then won head -1, $SUB read "close", and
          # this branch exited 0 -- allowing the real `gh pr merge` later in the same
          # command through with no review record. Measured DENY -> ALLOW on three flag
          # families, including the ALLOW_OUTWARD_CLI=1-prefixed shape this repo merges
          # with. Asking whether a merge occurrence EXISTS cannot regress that way: a wider
          # grammar finds more occurrences, never fewer.
          # $SUB is still read above -- its rc 1 refuse is handled before this point -- and
          # is still the right value for the advisory consumers; only this gate changed.
          # ACCEPTED COST, so the next reader does not re-litigate it as a bug: a TRAILING
          # comment decoy -- `gh pr close 1 # gh pr merge 42` -- now denies where it
          # previously allowed, because cmd_bare does not strip comments and the mention is
          # real text. The operator sees the ref-less "cannot tell which PR" deny and splits
          # the command. That is the restrictive direction, and it is the identical tradeoff
          # cmd_gh_pr_write_subcommand already accepts and documents for its own trailing
          # create decoy. A QUOTED mention is unaffected -- `git commit -m "gh pr merge 42"`
          # still allows, because cmd_bare blanks the quoted span -- which is the row that
          # would matter if this were over-denying in practice.
            exit 0
          fi
          PR=$(cmd_gh_pr_ref "$CMD") || PR=""
        fi
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
    #
    # A FOURTH cause joined this deny 2026-09-14, without a new message: a `gh api` call
    # against the raw REST merge route also arrives here with PR="" (see the detector
    # above) — it genuinely names a PR number in its URL, but not in a shape
    # cmd_gh_pr_ref can read, so this is still the correct, honest answer ("cannot
    # resolve a PR number FROM THIS MERGE COMMAND'S SHAPE"), and the remedy this message
    # already gives — re-run as `gh pr merge <number> ...` — is the right one for that
    # caller too. Named explicitly in the message so it doesn't read as pure `gh pr
    # merge` advice to someone who typed `gh api`.
    deny "Blocked: merge-review-guard could not resolve a PR number from this merge, so it cannot tell which PR to classify. The usual cause is that NO number was given — \`gh pr merge --auto --squash\` merges the current branch's PR, and this gate deliberately will not infer that: the Bash tool's cwd persists and can differ from the branch being merged, so inferring would risk classifying one PR while merging another. Re-run as \`gh pr merge <number> --auto --squash …\`. The other causes are a ref obfuscated by a shell substitution, a \`--repo\` retarget (both of which the shared extractor refuses to guess at), and a merge attempted via \`gh api\` against the raw REST route — this gate cannot resolve a PR number out of a URL path, only out of \`gh pr merge\`'s own argument shape. $BYPASS" ;;
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
