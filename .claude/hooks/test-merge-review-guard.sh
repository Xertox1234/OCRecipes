#!/usr/bin/env bash
# Tests for merge-review-guard.sh — run from anywhere. Hermetic: a fake `gh` first on
# PATH, a throwaway REVIEW_STAMP_ROOT, no network, no real merge.
#
# Discovered automatically by scripts/run-hook-tests.sh:24, which globs
# `.claude/hooks/test-*.sh` — a name that does not match that glob is silently NEVER RUN
# (the zero-count guard only fires when the whole glob is empty, not when one file is
# missing from it).
#
# THE DIGEST LITERALS BELOW ARE INDEPENDENTLY COMPUTED CONSTANTS, NOT MEASUREMENTS.
# `reviewed_files_digest` is the one field binding a stamp to a file scope, and both the
# writer and this gate derive it from the same formula
# (`<sorted unique file list>` | shasum | cut -c1-16). A test that derived its expected
# digest by re-running that pipeline would pin NOTHING: it would agree with any formula
# the implementation happened to use, including a broken one. So the two values are
# written out as literals and the fixtures are built around them:
#   client/hooks/useNutritionLookup.ts                      -> 8f4842be754477ff
#   ...that file + client/hooks/__tests__/useNutritionLookup.test.ts -> cf5a596de517834a
# Both are exercised in the ALLOW direction (a stamp carrying the literal permits the
# merge) so a formula change reddens them, and once in the DENY direction (the one-file
# literal against the two-file diff) so a gate that skipped the comparison also reddens.
set -uo pipefail

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HOOKS_DIR/merge-review-guard.sh"
PASS=0; FAIL=0

# The documented emergency bypass would turn every DENY assertion below into a false
# GREEN — the worst possible direction for a test suite guarding a merge gate. Drop it up
# front, the way scripts/run-hook-tests.sh strips inherited GIT_* state.
unset SKIP_MERGE_REVIEW

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq unavailable"; exit 0; }
[ -f "$HOOK" ] || { echo "FAIL: $HOOK not found"; exit 1; }

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/merge-guard-test-$$-XXXX")
BIN=$(mktemp -d "${TMPDIR:-/tmp}/merge-guard-bin-$$-XXXX")
trap 'rm -rf "$ROOT" "$BIN"' EXIT

SHA=1234567890abcdef1234567890abcdef12345678
OTHER_SHA=feedfacefeedfacefeedfacefeedfacefeedface

DIGEST_ONE=8f4842be754477ff   # client/hooks/useNutritionLookup.ts
DIGEST_TWO=cf5a596de517834a   # that file + client/hooks/__tests__/useNutritionLookup.test.ts

FILES_ONE="client/hooks/useNutritionLookup.ts"
FILES_TWO=$'client/hooks/useNutritionLookup.ts\nclient/hooks/__tests__/useNutritionLookup.test.ts'
FILES_SAFE="docs/solutions/foo.md"
FILES_TODO_SAFE=$'docs/solutions/foo.md\ntodos/archive/P3-2026-01-01-x.md'
FILES_TODO_RISKY=$'client/hooks/useNutritionLookup.ts\ntodos/archive/P3-2026-01-01-x.md'

export GH_LOG="$ROOT/gh.log"

# Fake gh. Logs every invocation so STAGE 1's branch-selected policy is OBSERVABLE: the
# full guard runs the TODO GATE (which calls `gh api`), `--paths-only` never does. That
# log line is the only way to tell "stage 1 ran" from "stage 1 was skipped", because
# stage 1's ALLOW set is a strict subset of stage 2's (see the hook's own note) and so can
# never be distinguished by the allow/deny verdict alone.
write_gh() {
  cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
# Stands in for "gh resolves the repository from cwd": when FAKE_PIN_PWD is set, this gh
# only answers from that directory, exactly as a real gh in another checkout would answer
# about a DIFFERENT repository's PR. Without it, a hook that inherited the ambient cwd
# would look identical to one that anchors itself.
if [ -n "${FAKE_PIN_PWD:-}" ] && [ "$PWD" != "$FAKE_PIN_PWD" ]; then exit 1; fi
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "view" ]; then
  # todo-automerge-guard.sh asks this endpoint for the PR's DECLARED changed-file count, so it
  # can refuse a truncated file list. Answer that query with a count that agrees with FAKE_FILES
  # by default, keeping the completeness check a no-op here so only the merge-gate behaviour
  # under test can move.
  for a in "$@"; do
    case "$a" in
      changedFiles)
        printf '%s\n' "${FAKE_CHANGED_FILES:-$(printf '%s\n' "${FAKE_FILES}" | grep -c . || true)}"
        exit 0
        ;;
    esac
  done
  printf '%s\n' "${FAKE_VIEW_JSON}"; exit 0
fi
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "diff" ]; then
  [ -n "${FAKE_DIFF_FAIL:-}" ] && exit 1
  printf '%s\n' "${FAKE_FILES}"; exit 0
fi
if [ "${1:-}" = "api" ]; then
  # todo-automerge-guard.sh reads its file list from pulls/{n}/files so that a rename SOURCE
  # path (previous_filename) is gated and not just the destination. That is also a `gh api`
  # call, so this stub must dispatch on the ENDPOINT: without the case below, the file-list
  # read is answered with todo frontmatter, and under this harness's DEFAULT FAKE_API_FAIL=1
  # -- which models only the TODO GATE being unable to read the archived todo -- it fails
  # closed and every safe-paths ALLOW row turns into an exit-2 ERROR.
  # Scan ALL arguments rather than matching $2: the contents call puts -H at $2 and reaches the
  # frontmatter branch only by falling off the end of a positional case, so a later reordering
  # of the file-list call would misroute it into the frontmatter branch silently -- which under
  # this harness's default FAKE_API_FAIL=1 is exactly the seven-row exit-2 storm this stub was
  # widened to repair.
  _ep=""
  for a in "$@"; do
    case "$a" in */pulls/*/files) _ep="files" ;; esac
  done
  if [ "$_ep" = "files" ]; then
    [ -n "${FAKE_DIFF_FAIL:-}" ] && exit 1
    # Destination CLASS, matching what the guard's own jq emits, so its completeness check
    # counts FILES rather than lines. The `pr diff` branch above is deliberately NOT classed:
    # merge-review-guard.sh consumes that one directly for its own changed-file digest.
    # The guard's STRUCTURAL ROW COUNT check also expects one "N <count>" row ahead of the F
    # rows (the page's own element count) -- without it every row through this stub would read
    # total_N=0 against a non-zero raw F count and fail-closed there instead of exercising the
    # merge-gate behaviour these tests are actually about.
    _n="$(printf '%s\n' "${FAKE_FILES}" | sed -e '/^$/d' | grep -c . || true)"
    printf 'N %s\n' "$_n"
    printf '%s\n' "${FAKE_FILES}" | sed -e '/^$/d' -e 's/^/F /'; exit 0
  fi
  [ -n "${FAKE_API_FAIL:-}" ] && exit 1
  printf '%s\n' "${FAKE_TODO_MD:-}"; exit 0
fi
exit 1
GH
  chmod +x "$BIN/gh"
}
write_gh

export FAKE_DIFF_FAIL=""
export FAKE_API_FAIL="1"          # default: the TODO GATE cannot read the archived todo
export FAKE_TODO_MD=$'---\npriority: low\nlabels: [deferred, hooks]\n---\nbody\n'

ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; [ $# -gt 1 ] && echo "       $2"; FAIL=$((FAIL+1)); }

RC_FILE="$ROOT/.hook-rc"   # dot-prefixed: clear_stamps' [0-9a-f]* glob never matches it

# stdin = hook payload; any arguments are env assignments for this run.
#
# The exit code is recorded because `[ -z "$out" ]` ALONE CANNOT TELL "ALLOW" FROM "CRASH".
# A PreToolUse hook allows by exiting 0 with no output — but a non-zero, non-2 exit is a
# non-blocking ERROR and the tool proceeds anyway, silently, with no output either. So an
# allow assertion that only tests emptiness passes just as happily on a gate that died on
# line 1. Measured: mutating the stage-2 allow to `exit 3` left the suite at 39/39.
# `run` is on the right of a pipe and therefore runs in a subshell, so the code goes
# through a FILE — a variable assignment would not survive back to the caller.
#
# `"$@"` comes LAST, after the defaults. In `env`, a later assignment wins
# (`env FOO=first FOO=second sh -c 'echo $FOO'` -> `second`, measured), so this ordering is
# what lets a caller override PATH — which the no-jq block needs. With `"$@"` first the
# hardcoded PATH won, the no-jq block had to build its own raw pipeline to get around it,
# and its two allow controls silently escaped the exit-code check this function exists to
# provide. Do not move it back.
run() {
  env PATH="$BIN:$PATH" REVIEW_STAMP_ROOT="$ROOT" "$@" bash "$HOOK" 2>/dev/null
  printf '%s' "$?" > "$RC_FILE"
}

# Every ALLOW assertion goes through this: empty output AND a clean exit.
assert_allowed() {  # assert_allowed <label> <captured-output>
  local label="$1" out="${2:-}" rc
  rc=$(cat "$RC_FILE" 2>/dev/null)
  if [ -z "$out" ] && [ "$rc" = "0" ]; then
    ok "$label"
  else
    bad "$label" "out=[$out] rc=[${rc:-<unrecorded>}]"
  fi
}
mcp_payload()  { jq -n --arg n "$1" '{tool_name:"mcp__github__merge_pull_request", tool_input:{pullNumber:($n|tonumber)}}'; }
# The same tool call WITH its owner/repo. Kept separate from mcp_payload on purpose: every
# other MCP assertion in this file omits owner/repo, and those payloads are the evidence
# that an UNASSERTED target still means "the ambient repo" rather than a deny — the Bash
# arm's treatment of a bare `gh pr merge 42`. Folding the fields into mcp_payload would
# delete that evidence and silently re-scope forty assertions.
mcp_payload_repo() {  # $1=pr $2=owner $3=repo
  jq -n --arg n "$1" --arg o "$2" --arg r "$3" \
    '{tool_name:"mcp__github__merge_pull_request",
      tool_input:{owner:$o, repo:$r, pullNumber:($n|tonumber)}}'
}
bash_payload() { jq -n --arg c "$1" '{tool_name:"Bash", tool_input:{command:$c}}'; }
denied()  { grep -q '"permissionDecision":[[:space:]]*"deny"' <<<"${1:-}"; }
reason()  { printf '%s' "${1:-}" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null; }

stamp() {  # stamp <sha> <digest> <verdict> <agent> [unresolved-entry...]
  local sha="$1" digest="$2" verdict="$3" agent="$4"; shift 4
  mkdir -p "$ROOT/$sha"
  jq -n --arg s "$sha" --arg d "$digest" --arg t "$agent" --arg v "$verdict" \
        --args '{head_sha:$s, reviewed_files_digest:$d, agent_type:$t, verdict:$v,
                 unresolved:$ARGS.positional, written_by:"review-stamp-writer.sh",
                 written_at:"2026-09-09T00:00:00Z"}' "$@" \
    > "$ROOT/$sha/${agent}.json"
}
clear_stamps() { rm -rf "${ROOT:?}"/[0-9a-f]*; }

export FAKE_VIEW_JSON="{\"headRefName\":\"fix/thing\",\"headRefOid\":\"$SHA\"}"
export FAKE_FILES="$FILES_ONE"

# ── Fast path / detection ────────────────────────────────────────────────────

# 1. ALLOW CONTROL. An unrelated Bash command is silent — it never reaches gh at all.
out=$(bash_payload "npm run lint" | run)
assert_allowed "unrelated Bash command exits silently" "$out"

# 2. ALLOW CONTROL for the fast path's coarseness. `git commit -m "fix highlight for pr
#    merge"` MATCHES the '*gh*pr*merge*' necessary-substring filter ("gh" inside
#    "highlight", then "pr", then "merge") but is not a merge. A gate that denied on a
#    fast-path hit rather than on the precise detector's verdict would block ordinary
#    commits — the restrictive failure that gets a gate switched off.
out=$(bash_payload 'git commit -m "fix highlight for pr merge"' | run)
assert_allowed "fast-path hit that is not a merge stays silent" "$out"

# 3. A non-merge gh pr subcommand is not this hook's business.
out=$(bash_payload "gh pr create --title x --body y" | run)
assert_allowed "gh pr create is not gated" "$out"

# ── gh api merge route (P2) ──────────────────────────────────────────────────
# todos/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md
# A THIRD merge route: `gh api` against the REST merge endpoint carries no `pr`
# substring at all, so it must be detected independently of
# cmd_gh_pr_write_subcommand/cmd_gh_pr_ref (both scoped to `gh pr <verb>`). These rows
# do not depend on FAKE_FILES/stamp state — the new detector routes straight through
# the ref-less deny (or an early allow) before stage 1/2/3 are ever reached.

# 3a. DENY. --method PUT spelling, an -f field carrying the merge strategy.
out=$(bash_payload 'gh api --method PUT repos/Xertox1234/OCRecipes/pulls/938/merge -f merge_method=squash' | run)
denied "$out" && ok "gh api --method PUT against pulls/N/merge denies" \
              || bad "gh api --method PUT against pulls/N/merge denies" "$out"

# 3a-ter. The GLUED short form, which the first revision of the arm missed entirely, and the
# glued method flag, which it wrongly denied. Both are the same separator mistake in opposite
# directions: on the positive pattern it under-denied, on the negative one it over-denied.
out=$(bash_payload 'gh api -fmerge_method=squash /repos/o/r/pulls/42/merge' | run)
denied "$out" && ok "the GLUED -f short form denies" \
              || bad "the GLUED -f short form denies" "$out"
out=$(bash_payload 'gh api -Fmerge_method=squash /repos/o/r/pulls/42/merge' | run)
denied "$out" && ok "the GLUED -F short form denies" \
              || bad "the GLUED -F short form denies" "$out"
out=$(bash_payload 'gh api -XGET /repos/o/r/pulls/42/merge -f foo=bar' | run)
assert_allowed "a GLUED -XGET with fields is an explicit read" "$out"
# 3a-quater. A REDIRECT GLUED TO THE ENDPOINT. The discriminator originally closed on a
# hand-spelled `([[:space:]]|$)`, which is not a word boundary in bash: `…/merge>/dev/null` puts
# `>` right after `merge`, the pattern missed, and this gate's whole implicit-POST arm was skipped
# for a command whose argv is an unmodified merge. Measured ALLOW before the fix, DENY after.
# The SPACED row below is the non-vacuity control -- it denied BOTH before and after, so a green
# pair here means the glued row is carrying the evidence, not the arm merely being on.
out=$(bash_payload 'gh api -f merge_method=squash /repos/o/r/pulls/42/merge>/dev/null' | run)
denied "$out" && ok "a redirect GLUED to the merge endpoint still denies" \
              || bad "a redirect GLUED to the merge endpoint still denies" "$out"
out=$(bash_payload 'gh api -f merge_method=squash /repos/o/r/pulls/42/merge >/dev/null' | run)
denied "$out" && ok "the SPACED redirect control denies (non-vacuity for the row above)" \
              || bad "the SPACED redirect control denies (non-vacuity for the row above)" "$out"
out=$(bash_payload 'gh api /repos/o/r/pulls/42>/dev/null' | run)
assert_allowed "a glued redirect on a NON-merge path is still not a merge" "$out"
# THE ENDPOINT CHECK reads field VALUES, and the implicit-POST arm made that reachable for
# field-only calls for the first time. An anchored path pattern was tried to keep prose out; it
# failed open FIVE ways across four review rounds (the guard's own comment above its predicate
# lists them) and was REVERTED to main's substring test. These rows now pin the ACCEPTED
# over-denial: prose quoting the endpoint in a field value denies. That is the safe direction; the
# real fix is positional (argv slot, not path shape):
# todos/P3-2026-09-18-gh-api-endpoint-check-should-key-on-argv-position.md.
out=$(bash_payload "gh api repos/o/r/issues/12/comments -f body=see pulls/42/merge for context" | run)
denied "$out" && ok "ACCEPTED OVER-DENIAL: prose quoting the endpoint inside a field value denies under the substring test" \
              || bad "ACCEPTED OVER-DENIAL: prose quoting the endpoint inside a field value denies under the substring test" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls -f title=merge cleanup' | run)
denied "$out" && ok "ACCEPTED OVER-DENIAL: a field value containing the word merge on the pulls list denies" \
              || bad "ACCEPTED OVER-DENIAL: a field value containing the word merge on the pulls list denies" "$out"

# 3a-bis. DENY. gh's IMPLICIT POST — no method flag anywhere.
# todos/archive/P1-2026-09-16-gh-api-field-mutation-passes-both-merge-guards.md. cli/cli
# pkg/cmd/api/api.go:329-330 sets method=POST when no method flag was passed AND there is any
# field parameter or an --input file, so these name no method and are still merges. This gate is
# fail-closed, so before this arm each was a SILENT ALLOW of a real merge route — the worst
# shape a merge gate can have.
out=$(bash_payload 'gh api -f merge_method=squash /repos/o/r/pulls/42/merge' | run)
denied "$out" && ok "gh api -f with no method flag against pulls/N/merge denies" \
              || bad "gh api -f with no method flag against pulls/N/merge denies" "$out"
out=$(bash_payload 'gh api -F merge_method=squash /repos/o/r/pulls/42/merge' | run)
denied "$out" && ok "gh api -F with no method flag against pulls/N/merge denies" \
              || bad "gh api -F with no method flag against pulls/N/merge denies" "$out"
out=$(bash_payload 'gh api --raw-field merge_method=squash /repos/o/r/pulls/42/merge' | run)
denied "$out" && ok "gh api --raw-field with no method flag denies" \
              || bad "gh api --raw-field with no method flag denies" "$out"
out=$(bash_payload 'gh api --field=merge_method=squash /repos/o/r/pulls/42/merge' | run)
denied "$out" && ok "gh api --field=k=v glued with no method flag denies" \
              || bad "gh api --field=k=v glued with no method flag denies" "$out"
out=$(bash_payload 'gh api /repos/o/r/pulls/42/merge --input body.json' | run)
denied "$out" && ok "gh api --input with no method flag denies (api.go:301 ties it to the same switch)" \
              || bad "gh api --input with no method flag denies (api.go:301 ties it to the same switch)" "$out"
# THE ALLOW SIDE, which is what keeps the arm from denying reads. gh's switch is
# `!RequestMethodPassed && params`, so an explicit method beats it: these are GETs.
out=$(bash_payload 'gh api -X GET /repos/o/r/pulls/42/merge -f foo=bar' | run)
assert_allowed "an EXPLICIT -X GET with fields at the merge endpoint is a read and allows" "$out"
out=$(bash_payload 'gh api --method GET /repos/o/r/pulls/42/merge --field foo=bar' | run)
assert_allowed "an EXPLICIT --method GET with fields allows" "$out"
out=$(bash_payload 'gh api /repos/o/r/issues -f title=hello' | run)
assert_allowed "an implicit POST to a NON-merge endpoint is not this gate's business" "$out"

# 3a-bis-2. NON-ARGV TEXT MUST NOT DISARM THE ABSENCE-SHAPED CONJUNCT (2026-09-22).
# todos/archive/P1-2026-09-18-trailing-comment-disarms-grant-shaped-negated-predicates.md
# The negated `! MRG_API_ANYMETHOD` conjunct read a clause that kept an unquoted trailing comment
# and redirect operands, so one method-shaped token in either stood the arm down. Measured ALLOW
# on origin/main (8ff7cfd2) for every DENY row below except the controls, which denied on both
# sides. The fix is byte-identical to guard-outward-cli.sh's, landed in the same change: the
# negated conjunct reads an argv-cut clause, the positive field conjunct reads the full clause,
# so the change can only ADD denials relative to main.
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge -f k=v # -X GET' | run)
denied "$out" && ok "a method flag inside a trailing COMMENT does not disarm the implicit-POST arm" \
              || bad "a method flag inside a trailing COMMENT does not disarm the implicit-POST arm" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge -f k=v # --method GET' | run)
denied "$out" && ok "the long-form method flag inside a trailing comment does not disarm it either" \
              || bad "the long-form method flag inside a trailing comment does not disarm it either" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge -f k=v > -X' | run)
denied "$out" && ok "a method-shaped REDIRECT OPERAND does not disarm the implicit-POST arm" \
              || bad "a method-shaped REDIRECT OPERAND does not disarm the implicit-POST arm" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge -f k=v # harmless note' | run)
denied "$out" && ok "CONTROL: a benign trailing comment denies (the decoy token is what flipped the rows above)" \
              || bad "CONTROL: a benign trailing comment denies (the decoy token is what flipped the rows above)" "$out"
out=$(bash_payload "gh api repos/o/r/pulls/42/merge -f body='a # b'" | run)
denied "$out" && ok "CONTROL: a QUOTED hash is not a comment, so the field still counts" \
              || bad "CONTROL: a QUOTED hash is not a comment, so the field still counts" "$out"
out=$(bash_payload 'gh api -X GET repos/o/r/pulls/42/merge -f k=v # note' | run)
assert_allowed "an EXPLICIT read followed by a comment still allows (the cut removes only non-argv text)" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge -f k=v 2>&1 -X GET' | run)
assert_allowed "an EXPLICIT read with an interior redirect still allows (blanking an operand invents no token)" "$out"
# THE FIELD-FLAG CLOSER. `MRG_API_FIELD` closed its three long flags on a hand-spelled
# `([[:space:]]|=|$)`; a redirect glued to the flag put `>` where that class expected whitespace,
# the field went unseen, and the arm stood down with no decoy token at all. `${_CMD_POS_SUFFIX}`
# (plus `=`) absorbs it. The closer lint below was widened FIRST and watched go red on that line.
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge --field>o k=v' | run)
denied "$out" && ok "a redirect GLUED to --field is still a field (closer widened to the exported suffix)" \
              || bad "a redirect GLUED to --field is still a field (closer widened to the exported suffix)" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge --raw-field>o k=v' | run)
denied "$out" && ok "a redirect glued to --raw-field is still a field" \
              || bad "a redirect glued to --raw-field is still a field" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge --input>o body.json' | run)
denied "$out" && ok "a redirect glued to --input is still an input file" \
              || bad "a redirect glued to --input is still an input file" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge --field k=v' | run)
denied "$out" && ok "CONTROL: the spaced long flag denied before and after (non-vacuity for the glued rows)" \
              || bad "CONTROL: the spaced long flag denied before and after (non-vacuity for the glued rows)" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge --fieldx k=v' | run)
assert_allowed "CONTROL: a longer flag sharing the prefix is still not a field (the closer did not over-widen)" "$out"
# VALUE-POSITION DECOY: a method-shaped token that genuinely reaches argv as another flag's value.
# Neither the cut nor the closer can see it; it needs a flag-arity table. Pinned KNOWN-WRONG with
# its control so the gap stays visible here as well as in the sibling suite.
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge -f k=v --template -X' | run)
assert_allowed "KNOWN-WRONG (residual): --template -X after a field is a live ALLOW here too (value-slot decoy)" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/merge -f k=v --template x' | run)
denied "$out" && ok "CONTROL: the same carrier holding an ordinary value denies (the decoy is what flips it)" \
              || bad "CONTROL: the same carrier holding an ordinary value denies (the decoy is what flips it)" "$out"

# 3a-quinquies. ENDPOINT SPELLINGS THE SEGMENT-CLASS DISCRIMINATOR LET THROUGH (regression vs main,
# found by both reviewers independently, 2026-09-18). Each of these DENIED on main's
# `pulls.*merge` substring test and ALLOWED once the class enumeration replaced it; the plain
# `repos/o/r/...` rows above are their non-vacuity control and deny on both versions. There is no
# combinatorial corpus behind this file -- repro-outward-cli-corpus.sh pins guard-outward-cli.sh
# only -- so these rows ARE the coverage for this predicate.
# LATER THE SAME DAY: after a FIFTH fail-open (`pulls//42/merge`) the anchored predicate was
# reverted to main's substring test. Every row in this block and the next passes trivially under
# it, and that is the point -- they are now the guard against anyone re-narrowing the check.
out=$(bash_payload 'gh api -X PUT repos/$OWNER/$REPO/pulls/42/merge' | run)
denied "$out" && ok "a merge endpoint spelled with shell variables is still an endpoint" \
              || bad "a merge endpoint spelled with shell variables is still an endpoint" "$out"
out=$(bash_payload 'gh api -X PUT "repos/$OWNER/$REPO/pulls/$PR/merge"' | run)
denied "$out" && ok "the quoted variable-segment endpoint denies too" \
              || bad "the quoted variable-segment endpoint denies too" "$out"
out=$(bash_payload 'gh api --method PUT https://api.github.com/repos/o/r/pulls/42/merge' | run)
denied "$out" && ok "a full https:// endpoint URL is a documented gh api spelling and denies" \
              || bad "a full https:// endpoint URL is a documented gh api spelling and denies" "$out"
out=$(bash_payload 'gh api --method PUT repos/o/r/pulls/42/merge?x=1' | run)
denied "$out" && ok "a query string after the endpoint does not end the match" \
              || bad "a query string after the endpoint does not end the match" "$out"
out=$(bash_payload 'gh api --method PUT repos/o/r/pulls/42/merge/' | run)
denied "$out" && ok "a trailing slash after the endpoint does not end the match" \
              || bad "a trailing slash after the endpoint does not end the match" "$out"
out=$(bash_payload 'gh api https://api.github.com/repos/o/r/pulls/42/merge -f merge_method=squash' | run)
denied "$out" && ok "the implicit POST reaches a URL-spelled endpoint too" \
              || bad "the implicit POST reaches a URL-spelled endpoint too" "$out"
# THE WIDENING'S OWN OVER-DENIAL CONTROLS. `[^[:space:]]+` accepts more than the class did, so
# these pin that it did not start swallowing reads or non-merge paths.
out=$(bash_payload 'gh api -X GET https://api.github.com/repos/o/r/pulls/42/merge' | run)
assert_allowed "an EXPLICIT read of a URL-spelled merge endpoint still allows" "$out"
out=$(bash_payload 'gh api repos/o/r/pulls/42/comments -f body=hi' | run)
assert_allowed "a pulls/N/<other> path is still not a merge endpoint" "$out"

# 3a-sexies. THE TRAILING CONTENT, AND THE QUOTING AXIS THAT MADE TWO EARLIER FIXES LOOK DONE.
# Constraining what may follow the endpoint failed open three times: `?query` only, then `[?#]`,
# then `merge/?` hand-counting the slashes at one. The `[?#]` version was defended as EXHAUSTIVE
# over RFC 3986 and was STILL false, because this predicate reads the `cmd_words_deep` rendering
# rather than a URI -- a `#` inside a QUOTED span becomes the placeholder character, so
# `"…/merge#frag"` renders `…/mergexfrag` and matched nothing. A 6 prefix x 8 trailing x 3 QUOTING
# corpus measured 60 of 144 rows as main DENY / arm ALLOW, and 48 of those 60 were quoted.
# EVERY ROW IN THE FIRST VERSION OF THIS BLOCK USED A BARE TOKEN, so the suite went green on
# exactly the spellings that regressed. The tail is now unconstrained and the quoting axis is
# pinned here rather than sampled.
# THEN REVERTED: see the block above. These rows stay as the re-narrowing guard.
out=$(bash_payload 'gh api --method PUT repos/o/r/pulls/42/merge#frag' | run)
denied "$out" && ok "a fragment glued to the endpoint does not end the match" \
              || bad "a fragment glued to the endpoint does not end the match" "$out"
out=$(bash_payload 'gh api --method PUT repos/o/r/pulls/42/merge/#frag' | run)
denied "$out" && ok "a trailing slash then a fragment still denies" \
              || bad "a trailing slash then a fragment still denies" "$out"
out=$(bash_payload 'gh api --method PUT repos/o/r/pulls/42/merge?x=1#frag' | run)
denied "$out" && ok "a query AND a fragment still denies" \
              || bad "a query AND a fragment still denies" "$out"
out=$(bash_payload 'gh api --method PUT repos/o/r/pulls/42/merge#frag>/dev/null' | run)
denied "$out" && ok "a fragment followed by a glued redirect still denies (the tail is greedy, the closer still lands)" \
              || bad "a fragment followed by a glued redirect still denies (the tail is greedy, the closer still lands)" "$out"
out=$(bash_payload 'gh api --method PUT repos/$OWNER/$REPO/pulls/42/merge#frag' | run)
denied "$out" && ok "variable segments AND a fragment together still deny" \
              || bad "variable segments AND a fragment together still deny" "$out"
# The fragment rows' own over-denial controls.
out=$(bash_payload 'gh api -X GET repos/o/r/pulls/42/merge#frag' | run)
assert_allowed "an EXPLICIT read of a fragment-suffixed endpoint still allows" "$out"
out=$(bash_payload 'gh api -X GET repos/o/r/pulls/42/merge #frag' | run)
assert_allowed "a SPACED hash is a shell comment, not a fragment, and is not a merge" "$out"

# THE QUOTING AXIS. Double- and single-quoted spellings reach gh with byte-identical argv to the
# bare form, and the rendering blanks a quoted `#` -- so these are the rows a bare-only block
# cannot see. Each is paired with its quoted-WITHOUT-fragment control, so a failure here can never
# be blamed on quoting alone.
out=$(bash_payload 'gh api -X PUT "repos/o/r/pulls/42/merge#frag"' | run)
denied "$out" && ok "a DOUBLE-QUOTED fragment endpoint still denies (the rendering blanks the hash)" \
              || bad "a DOUBLE-QUOTED fragment endpoint still denies (the rendering blanks the hash)" "$out"
out=$(bash_payload "gh api -X PUT 'repos/o/r/pulls/42/merge#frag'" | run)
denied "$out" && ok "a SINGLE-QUOTED fragment endpoint still denies" \
              || bad "a SINGLE-QUOTED fragment endpoint still denies" "$out"
out=$(bash_payload 'gh api -X PUT "repos/o/r/pulls/42/merge/#frag"' | run)
denied "$out" && ok "a quoted slash-then-fragment endpoint still denies" \
              || bad "a quoted slash-then-fragment endpoint still denies" "$out"
out=$(bash_payload 'gh api -X PUT "repos/o/r/pulls/42/merge"' | run)
denied "$out" && ok "CONTROL: the same endpoint QUOTED with no fragment denies (quoting alone is not the cause)" \
              || bad "CONTROL: the same endpoint QUOTED with no fragment denies (quoting alone is not the cause)" "$out"
# AN EMPTY PATH SEGMENT IS MORE PATH, NOT CONTENT AFTER IT -- `merge/?` counted the slashes at one.
out=$(bash_payload 'gh api -X PUT repos/o/r/pulls/42/merge//' | run)
denied "$out" && ok "a doubled trailing slash is still the merge endpoint" \
              || bad "a doubled trailing slash is still the merge endpoint" "$out"
out=$(bash_payload 'gh api -X PUT repos/o/r/pulls/42/merge///' | run)
denied "$out" && ok "and a tripled one, so the slash count is not enumerated either" \
              || bad "and a tripled one, so the slash count is not enumerated either" "$out"
out=$(bash_payload 'gh api -X PUT "repos/$OWNER/$REPO/pulls/42/merge//"' | run)
denied "$out" && ok "variable segments, quoting and an empty segment together still deny" \
              || bad "variable segments, quoting and an empty segment together still deny" "$out"
# Under the substring test the quoted prose spelling denies too; pinned as the third accepted
# over-denial so a future re-narrowing that "fixes" it has to say so here.
out=$(bash_payload 'gh api repos/o/r/issues/12/comments -f body="see pulls/42/merge here"' | run)
denied "$out" && ok "ACCEPTED OVER-DENIAL: a QUOTED prose mention of the endpoint in a field value denies" \
              || bad "ACCEPTED OVER-DENIAL: a QUOTED prose mention of the endpoint in a field value denies" "$out"

# 3b. DENY. -X spelling, path-only (no -f fields).
out=$(bash_payload 'gh api -X PUT /repos/Xertox1234/OCRecipes/pulls/938/merge' | run)
denied "$out" && ok "gh api -X PUT against pulls/N/merge denies" \
              || bad "gh api -X PUT against pulls/N/merge denies" "$out"

# 3b-i..iv. THE PIGGYBACK. A `gh pr merge` anywhere in the same command used to make the
#     gh-api scan unreachable: the detector was nested inside `if [ "$SUB" != "merge" ]`,
#     so a resolved `gh pr merge` took the else, only that first PR was classified, and the
#     api merge rode through unexamined.
#
#     FILES_SAFE IS LOAD-BEARING HERE, and the first version of this block omitted it and
#     therefore tested nothing. With a RISKY diff the leading `gh pr merge 938` denies on
#     its own for want of a stamp, so all three rows below pass whether or not the api
#     merge is ever seen — measured: the bug reinstated still gave 98/0. A safe diff makes
#     the leading clause legitimately ALLOW, so a deny can only come from the api merge.
#     Case 3b-i is that control and must stay first: without it these are three assertions
#     that cannot fail.
MRG_PIGGY_FILES_SAVE="$FAKE_FILES"
export FAKE_FILES="$FILES_SAFE"

out=$(bash_payload 'gh pr merge 938 --auto --squash' | run)
assert_allowed "CONTROL: the leading pr-merge clause alone allows on a safe diff" "$out"

out=$(bash_payload 'gh pr merge 938 --auto --squash; gh api -X PUT repos/Xertox1234/OCRecipes/pulls/999/merge' | run)
denied "$out" && ok "a gh-api merge piggybacked after pr merge (;) still denies" \
              || bad "a gh-api merge piggybacked after pr merge (;) still denies" "$out"

out=$(bash_payload 'gh pr merge 938 --auto --squash && gh api -X PUT repos/Xertox1234/OCRecipes/pulls/999/merge' | run)
denied "$out" && ok "a gh-api merge piggybacked after pr merge (&&) still denies" \
              || bad "a gh-api merge piggybacked after pr merge (&&) still denies" "$out"

out=$(bash_payload 'gh api -X PUT repos/Xertox1234/OCRecipes/pulls/999/merge; gh pr merge 938 --auto --squash' | run)
denied "$out" && ok "a gh-api merge BEFORE pr merge still denies" \
              || bad "a gh-api merge BEFORE pr merge still denies" "$out"

export FAKE_FILES="$MRG_PIGGY_FILES_SAVE"

# 3c. DENY. The ALLOW_OUTWARD_CLI=1 escape belongs to the SIBLING guard
#     (guard-outward-cli.sh) and must not be inherited here — this gate never reads
#     that variable at all (grep it: zero hits).
out=$(bash_payload 'ALLOW_OUTWARD_CLI=1 gh api -X PUT repos/Xertox1234/OCRecipes/pulls/938/merge' | run)
denied "$out" && ok "ALLOW_OUTWARD_CLI=1 prefix does not bypass the merge gate" \
              || bad "ALLOW_OUTWARD_CLI=1 prefix does not bypass the merge gate" "$out"

# 3d. DENY. A benign gh api clause followed by the REAL merge in a SECOND gh api
#     clause on the same compound command — proves every matched clause is scanned,
#     not only the first (docs/solutions/conventions/one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md).
out=$(bash_payload 'gh api repos/Xertox1234/OCRecipes; gh api -X PUT repos/Xertox1234/OCRecipes/pulls/938/merge' | run)
denied "$out" && ok "a real merge in a LATER gh api clause still denies" \
              || bad "a real merge in a LATER gh api clause still denies" "$out"

# 3e. The deny names the ACTUAL cause (gh api / REST route) and the gh-pr-merge
#     remedy, not just a bare re-use of the missing-number wording.
r=$(reason "$(bash_payload 'gh api -X PUT repos/Xertox1234/OCRecipes/pulls/938/merge' | run)")
if grep -qi 'gh api' <<<"$r" && grep -qi 'gh pr merge' <<<"$r"; then
  ok "gh-api-merge deny names the actual route and the gh pr merge remedy"
else
  bad "gh-api-merge deny names the actual route and the gh pr merge remedy" "$r"
fi

# 3f. ALLOW CONTROL. An ordinary read-only gh api call — no pulls/merge in the path.
out=$(bash_payload 'gh api repos/Xertox1234/OCRecipes' | run)
assert_allowed "ordinary read-only gh api call stays silent" "$out"

# 3g. ALLOW CONTROL. The real, read-only "has PR N been merged?" REST route — same
#     path, no method flag (defaults GET). It does not merge anything.
out=$(bash_payload 'gh api repos/Xertox1234/OCRecipes/pulls/938/merge' | run)
assert_allowed "read-only merge-status check (no method flag) stays silent" "$out"

# 3h. ALLOW CONTROL. A mutating gh api call against an UNRELATED endpoint — this
#     gate's business is the merge sub-resource specifically, not every mutating call.
out=$(bash_payload 'gh api -X POST repos/Xertox1234/OCRecipes/issues/938/lock' | run)
assert_allowed "mutating gh api call against an unrelated endpoint stays silent" "$out"

# 3i. ALLOW CONTROL, the prose direction — the regression this whole route most needs
#     to avoid repeating (see the withdrawn raw-token predicates in the P1 todo). A
#     commit message merely mentioning the endpoint text must never be denied.
out=$(bash_payload 'git commit -m "docs: explain the gh api -X PUT pulls/N/merge route"' | run)
assert_allowed "commit message mentioning the gh-api merge endpoint is not denied" "$out"

# 3j/3k. DENY. A redirect sitting in the flag->value separator (same class
#     guard-outward-cli.sh already fixed for its own gh-api mutating-method check,
#     2026-09-07 "THE FLAG->VALUE SEPARATOR TAKES THE ABSORBER"). Confirmed by
#     construction: `gh api -X 2>&1 PUT repos/o/r/pulls/N/merge` genuinely invokes gh
#     with argv [api -X PUT repos/o/r/pulls/N/merge] under both bash and zsh (an
#     argv-dumping stub), so this is real argv, not decoy text.
out=$(bash_payload 'gh api -X 2>&1 PUT repos/Xertox1234/OCRecipes/pulls/938/merge' | run)
denied "$out" && ok "redirect in the -X/value separator still denies" \
              || bad "redirect in the -X/value separator still denies" "$out"
out=$(bash_payload 'gh api --method 2>&1 PUT repos/Xertox1234/OCRecipes/pulls/938/merge' | run)
denied "$out" && ok "redirect in the --method/value separator still denies" \
              || bad "redirect in the --method/value separator still denies" "$out"

# 3l. DENY. A method value supplied by a live command substitution cannot be verified
#     read-only — the literal-value match alone cannot see it (cmd_words renders the
#     substitution as a placeholder, not "PUT"), so a second, presence-only arm
#     (-X/--method co-occurring with $/backtick anywhere in the clause) is what fails
#     this closed, mirroring guard-outward-cli.sh's own "cannot verify -> deny" check.
out=$(bash_payload 'gh api -X "$(echo PUT)" repos/Xertox1234/OCRecipes/pulls/938/merge' | run)
denied "$out" && ok "a substituted method value fails closed" \
              || bad "a substituted method value fails closed" "$out"

# 3m. DENY CONTROL. The glued short form (-XPUT, no separator at all) must keep
#     denying — the redirect-absorbing separator must not have narrowed this.
out=$(bash_payload 'gh api -XPUT repos/Xertox1234/OCRecipes/pulls/938/merge' | run)
denied "$out" && ok "glued -XPUT still denies" || bad "glued -XPUT still denies" "$out"

# 3n. DENY CONTROL. A redirect glued to the TRAILING boundary of the value
#     (`-X PUT>/dev/null`, not between the flag and the value) is a different
#     position than 3j/3k and must already be covered by the closer class
#     (_CMD_POS_SUFFIX), not by the separator fix.
out=$(bash_payload 'gh api -X PUT>/dev/null repos/Xertox1234/OCRecipes/pulls/938/merge' | run)
denied "$out" && ok "trailing redirect glued to the value still denies" \
              || bad "trailing redirect glued to the value still denies" "$out"

# ── Stage 2: content risk ────────────────────────────────────────────────────

# 4. ALLOW. Safe paths need no stamp.
export FAKE_FILES="$FILES_SAFE"
out=$(mcp_payload 938 | run)
assert_allowed "safe paths allow without a stamp" "$out"

# 5. ALLOW, Bash path. The `--auto` arming call is the form that survives
#    guard-outward-cli.sh, so it must be able to reach stage 2 and be ALLOWED there.
out=$(bash_payload "gh pr merge 938 --auto --squash --delete-branch" | run)
assert_allowed "Bash --auto arming with safe paths allows" "$out"

# 6. DENY. Sensitive paths, no record at all.
export FAKE_FILES="$FILES_ONE"
out=$(mcp_payload 938 | run)
denied "$out" && ok "sensitive paths deny with no record" || bad "sensitive paths deny with no record" "$out"

# 7. The no-record message must not read as "you never reviewed": a reviewer whose
#    findings were all WARNING/SUGGESTION writes NO record (review-stamp-writer.sh
#    residual 3), so absence has more than one cause and more than one fix.
r=$(reason "$out")
if grep -qi 'no review record' <<<"$r" && grep -qi 'warning' <<<"$r"; then
  ok "no-record deny names the WARNING-only cause"
else
  bad "no-record deny names the WARNING-only cause" "$r"
fi

# ── Stage 3: stamp scope ─────────────────────────────────────────────────────

# 8. ALLOW. A clean record whose digest is the ONE-file literal, against a one-file diff.
stamp "$SHA" "$DIGEST_ONE" clean code-reviewer
out=$(mcp_payload 938 | run)
assert_allowed "clean record matching the 1-file digest literal allows" "$out"

# 9. ALLOW. Same, for the TWO-file literal against a two-file diff. Pins the formula at a
#    second point — a digest computed over an unsorted, non-unique, or differently
#    terminated list agrees with neither literal.
clear_stamps
export FAKE_FILES="$FILES_TWO"
stamp "$SHA" "$DIGEST_TWO" clean code-reviewer
out=$(mcp_payload 938 | run)
assert_allowed "clean record matching the 2-file digest literal allows" "$out"

# 10. DENY. Mis-scoped review: the record describes ONE file, the PR changes TWO. Same
#     SHA, same reviewer, clean verdict — only the scope is wrong.
clear_stamps
stamp "$SHA" "$DIGEST_ONE" clean code-reviewer
out=$(mcp_payload 938 | run)
denied "$out" && ok "digest mismatch denies even with a clean verdict" \
              || bad "digest mismatch denies even with a clean verdict" "$out"

# 10b. DENY. A SIBLING record must not rescue a merge a reviewer objected to. The digest
#      test used to run ABOVE the verdict block, so a findings record whose digest did not
#      match was skipped entirely, and a clean record beside it ended the loop MATCHED.
#      Nothing covered this: the suite was green both before and after the reorder.
#
#      Three rows on one fixture, because the middle one alone proves nothing — the ALLOW
#      has to be attributable to the SIBLING rather than to the mismatch itself.
clear_stamps
stamp "$SHA" "$DIGEST_TWO" findings security-auditor "[CRITICAL] client/hooks/useNutritionLookup.ts:42 — fabricates a basis"
stamp "$SHA" "$DIGEST_TWO" clean code-reviewer
out=$(mcp_payload 938 | run)
denied "$out" && ok "control A: findings + CORRECT digest beside a clean record denies" \
              || bad "control A: findings + CORRECT digest beside a clean record denies" "$out"

# The row under test: same pair, but the findings record's scope is wrong. Before the
# reorder this ALLOWED — the objection was filtered out and the clean sibling matched.
clear_stamps
stamp "$SHA" "$DIGEST_ONE" findings security-auditor "[CRITICAL] client/hooks/useNutritionLookup.ts:42 — fabricates a basis"
stamp "$SHA" "$DIGEST_TWO" clean code-reviewer
out=$(mcp_payload 938 | run)
denied "$out" && ok "a MIS-SCOPED findings record still blocks, sibling clean record or not" \
              || bad "a MIS-SCOPED findings record still blocks, sibling clean record or not" "$out"

# Control B: that same mis-scoped findings record ALONE. Without this the row above could
# be passing on the scope deny rather than on the verdict.
clear_stamps
stamp "$SHA" "$DIGEST_ONE" findings security-auditor "[CRITICAL] client/hooks/useNutritionLookup.ts:42 — fabricates a basis"
out=$(mcp_payload 938 | run)
denied "$out" && ok "control B: the mis-scoped findings record denies on its own too" \
              || bad "control B: the mis-scoped findings record denies on its own too" "$out"
clear_stamps
stamp "$SHA" "$DIGEST_ONE" clean code-reviewer
out=$(mcp_payload 938 | run)

# 10c. DENY. An UNREADABLE record must not be skipped past either. Same defect class as
#      10b one line up in the hook: a bare `continue` on the head_sha test let a corrupt
#      record be filtered out while a clean sibling ended the loop MATCHED. Measured before
#      the fix: truncated JSON, a zero-byte file, a JSON array, two concatenated objects and
#      a well-formed record with no head_sha key ALL allowed with a clean sibling present.
#      Reachable because the writer's redirect truncates at open, so an interrupted write
#      leaves exactly this shape.
for shape in 'truncated' 'empty' 'array' 'concatenated' 'no-head-sha'; do
  clear_stamps
  mkdir -p "$ROOT/$SHA"
  case "$shape" in
    truncated)    printf '{'                                    > "$ROOT/$SHA/security-auditor.json" ;;
    empty)        : ;;
    array)        printf '[]'                                   > "$ROOT/$SHA/security-auditor.json" ;;
    concatenated) printf '{"a":1}{"b":2}'                       > "$ROOT/$SHA/security-auditor.json" ;;
    no-head-sha)  printf '{"verdict":"findings","unresolved":["x"]}' > "$ROOT/$SHA/security-auditor.json" ;;
  esac
  [ "$shape" = empty ] && : > "$ROOT/$SHA/security-auditor.json"
  stamp "$SHA" "$DIGEST_TWO" clean code-reviewer
  out=$(mcp_payload 938 | run)
  denied "$out" && ok "unreadable record [$shape] is not rescued by a clean sibling" \
                || bad "unreadable record [$shape] is not rescued by a clean sibling" "$out"
done

# Control: the unreadable record ALONE. Without it the rows above could be passing on the
# no-record deny rather than on the unreadable-record branch.
clear_stamps
mkdir -p "$ROOT/$SHA"
printf '{' > "$ROOT/$SHA/security-auditor.json"
out=$(mcp_payload 938 | run)
denied "$out" && ok "control: an unreadable record denies on its own too" \
              || bad "control: an unreadable record denies on its own too" "$out"
# ...and it must be attributable to the CORRUPTION, not misreported as a scope problem.
r=$(reason "$out")
if grep -qi 'could not be read\|not parseable' <<<"$r"; then
  ok "unreadable-record deny names corruption, not scope"
else
  bad "unreadable-record deny names corruption, not scope" "$r"
fi
# 10d. ALLOW. A STALE record must still be skipped, not denied on — the opposite direction
#      from 10b/10c, and the only fixture that separates the shipped predicate from an
#      over-denying one. 10c made an UNREADABLE record deny (`[ -z "$REC_SHA" ]`); the
#      plausible future "simplification" is to widen that to `[ "$REC_SHA" != "$HEAD_SHA" ]`,
#      which would also block a merge whenever a record for some OTHER commit happened to
#      sit in this head's directory beside a perfectly valid one. Measured: that mutant
#      passes every other assertion in this file, so without this row nothing catches it.
#
#      The sibling is what makes it discriminating. A stale record ALONE denies under BOTH
#      implementations (via the unmatched-at-the-end deny), so pairing it with a valid,
#      correctly-scoped, clean record for the real head is the only shape on which the two
#      disagree. The hook's own comment at the head_sha test states this invariant:
#      "A parseable record naming a DIFFERENT head still `continue`s."
clear_stamps
stamp "$OTHER_SHA" "$DIGEST_ONE" clean security-auditor   # filed under the wrong sha dir…
mkdir -p "$ROOT/$SHA"
mv "$ROOT/$OTHER_SHA/security-auditor.json" "$ROOT/$SHA/security-auditor.json"
stamp "$SHA" "$DIGEST_TWO" clean code-reviewer            # …beside a valid, clean, in-scope one
# DIGEST_TWO, not ONE: the ambient FAKE_FILES here is the two-file list (test 10 depends on
# that), so ONE would mismatch and this row would deny on SCOPE rather than exercise the
# stale-record path at all.
out=$(mcp_payload 938 | run)
assert_allowed "a stale record beside a valid one is skipped, not denied on" "$out"

# Control: the same stale record ALONE must still deny — it is not a licence to merge.
# This is NOT the discriminating half (both implementations deny here); it is here so the
# row above cannot pass on a gate that has stopped denying anything at all.
clear_stamps
stamp "$OTHER_SHA" "$DIGEST_ONE" clean security-auditor
mkdir -p "$ROOT/$SHA"
mv "$ROOT/$OTHER_SHA/security-auditor.json" "$ROOT/$SHA/security-auditor.json"
out=$(mcp_payload 938 | run)
denied "$out" && ok "control: a stale record alone still denies" \
              || bad "control: a stale record alone still denies" "$out"

clear_stamps
stamp "$SHA" "$DIGEST_ONE" clean code-reviewer
out=$(mcp_payload 938 | run)

# 11. That deny must be attributable to SCOPE, not misreported as "no review".
r=$(reason "$out")
if grep -qi 'scope\|changed files\|file set' <<<"$r" && ! grep -qi 'no review record' <<<"$r"; then
  ok "scope-mismatch deny is distinct from the no-record deny"
else
  bad "scope-mismatch deny is distinct from the no-record deny" "$r"
fi

# 12. DENY. A record under a DIFFERENT sha directory does not satisfy the gate.
clear_stamps
export FAKE_FILES="$FILES_ONE"
stamp "$OTHER_SHA" "$DIGEST_ONE" clean code-reviewer
out=$(mcp_payload 938 | run)
denied "$out" && ok "record under a different sha does not satisfy" \
              || bad "record under a different sha does not satisfy" "$out"

# 13. DENY. A record IN the right directory whose head_sha field names another commit.
clear_stamps
mkdir -p "$ROOT/$SHA"
jq -n --arg s "$OTHER_SHA" --arg d "$DIGEST_ONE" \
  '{head_sha:$s, reviewed_files_digest:$d, agent_type:"code-reviewer", verdict:"clean", unresolved:[]}' \
  > "$ROOT/$SHA/code-reviewer.json"
out=$(mcp_payload 938 | run)
denied "$out" && ok "record whose head_sha names another commit does not satisfy" \
              || bad "record whose head_sha names another commit does not satisfy" "$out"

# ── Stage 3: findings ────────────────────────────────────────────────────────

# 14. DENY on findings — with the UNBRACKETED, agent-definition rendering. This fixture is
#     chosen deliberately: review-stamp-writer.sh's `unresolved` holds EVERY line that
#     triggered the findings verdict, and the five roster reviewer definitions mandate
#     `file:line — issue — fix` with no brackets. A gate that filtered the array on
#     `startswith("[CRITICAL]")` would see this record as EMPTY and permit the merge — and
#     a bracketed fixture cannot catch that, because it survives the very filter under
#     test.
clear_stamps
UNBRACKETED='client/hooks/useNutritionLookup.ts:42 — CRITICAL — per-100g basis is read before the null guard'
stamp "$SHA" "$DIGEST_ONE" findings code-reviewer "$UNBRACKETED"
out=$(mcp_payload 938 | run)
denied "$out" && ok "unbracketed findings entry denies" || bad "unbracketed findings entry denies" "$out"

# 15. …and the entry is rendered VERBATIM, so the human sees the actual finding rather
#     than a re-derived summary of it.
r=$(reason "$out")
grep -qF -- "$UNBRACKETED" <<<"$r" \
  && ok "findings deny renders unresolved[0] verbatim" \
  || bad "findings deny renders unresolved[0] verbatim" "$r"

# 16. A bare `[CRITICAL]` token is also a legal entry (the writer admits it explicitly).
clear_stamps
stamp "$SHA" "$DIGEST_ONE" findings security-auditor '[CRITICAL]'
out=$(mcp_payload 938 | run)
denied "$out" && ok "bare [CRITICAL] token entry denies" || bad "bare [CRITICAL] token entry denies" "$out"

# 17. A whole sentence of prose is also a legal entry — the writer over-detects on
#     purpose, so `unresolved` is not a list of parseable findings.
clear_stamps
stamp "$SHA" "$DIGEST_ONE" findings ai-reviewer 'The CRITICAL path here is the nutrition fallback order.'
out=$(mcp_payload 938 | run)
denied "$out" && ok "prose findings entry denies" || bad "prose findings entry denies" "$out"

# 18. DENY. verdict=findings with an EMPTY unresolved array — a truncated or malformed
#     record. `null | length` and `[] | length` are both 0, so a gate that keyed only on
#     the array length would read this as clean.
clear_stamps
stamp "$SHA" "$DIGEST_ONE" findings code-reviewer
out=$(mcp_payload 938 | run)
denied "$out" && ok "verdict=findings with empty unresolved denies" \
              || bad "verdict=findings with empty unresolved denies" "$out"

# 19. DENY. A record with NO verdict field at all — `clean` must be a positive signal.
clear_stamps
mkdir -p "$ROOT/$SHA"
jq -n --arg s "$SHA" --arg d "$DIGEST_ONE" \
  '{head_sha:$s, reviewed_files_digest:$d, agent_type:"code-reviewer", unresolved:[]}' \
  > "$ROOT/$SHA/code-reviewer.json"
out=$(mcp_payload 938 | run)
denied "$out" && ok "record with no verdict field denies" || bad "record with no verdict field denies" "$out"

# 20. DENY. One clean record and one findings record for the same commit and scope: the
#     findings record wins. Two reviewers dispatched in parallel is the normal shape.
clear_stamps
stamp "$SHA" "$DIGEST_ONE" clean code-reviewer
stamp "$SHA" "$DIGEST_ONE" findings security-auditor 'server/x.ts:1 — CRITICAL — nope'
out=$(mcp_payload 938 | run)
denied "$out" && ok "a findings record outvotes a clean one" || bad "a findings record outvotes a clean one" "$out"

# 21. DENY. An INTERNALLY INCONSISTENT record — verdict `clean` alongside a non-empty
#     `unresolved` — is not something review-stamp-writer.sh can produce, which is exactly
#     why the gate must not trust one field to speak for the other. Both halves of the
#     condition are load-bearing: this fixture kills a gate that checked only `verdict`,
#     and the no-verdict record above kills one that checked only the array length.
clear_stamps
stamp "$SHA" "$DIGEST_ONE" clean code-reviewer 'server/x.ts:1 — CRITICAL — still open'
out=$(mcp_payload 938 | run)
denied "$out" && ok "verdict=clean with a non-empty unresolved denies" \
              || bad "verdict=clean with a non-empty unresolved denies" "$out"
clear_stamps

# 22. The three deny causes must be DISTINGUISHABLE, because they have different fixes.
export FAKE_FILES="$FILES_ONE"
r_none=$(reason "$(mcp_payload 938 | run)")
stamp "$SHA" "$DIGEST_TWO" clean code-reviewer
r_scope=$(reason "$(mcp_payload 938 | run)")
clear_stamps
stamp "$SHA" "$DIGEST_ONE" findings code-reviewer 'x.ts:1 — CRITICAL — y'
r_find=$(reason "$(mcp_payload 938 | run)")
clear_stamps
if [ -n "$r_none" ] && [ -n "$r_scope" ] && [ -n "$r_find" ] \
   && [ "$r_none" != "$r_scope" ] && [ "$r_none" != "$r_find" ] && [ "$r_scope" != "$r_find" ]; then
  ok "no-record / scope-mismatch / findings denials are three distinct messages"
else
  bad "no-record / scope-mismatch / findings denials are three distinct messages" \
      "none=[$r_none] scope=[$r_scope] find=[$r_find]"
fi

# ── Stage 1: source type ─────────────────────────────────────────────────────

# 23. ALLOW. A todo/* branch whose paths are safe.
export FAKE_VIEW_JSON="{\"headRefName\":\"todo/P3-2026-01-01-x\",\"headRefOid\":\"$SHA\"}"
export FAKE_FILES="$FILES_TODO_SAFE"
out=$(mcp_payload 938 | run)
assert_allowed "todo/* with safe paths is exempt" "$out"

# 24. STAGE 1 MECHANISM. The branch name — not the file list — selects whether the FULL
#     guard runs. The full guard's TODO GATE reads the archived todo through the API's
#     CONTENTS endpoint; `--paths-only` never does. The endpoint is load-bearing in that
#     sentence: todo-automerge-guard.sh now reads its FILE LIST through the same verb, on the
#     pulls/{n}/files endpoint, and that read happens in BOTH modes -- so a bare `^api ` needle
#     stopped discriminating the moment the file list moved off the diff subcommand (which it
#     did so a rename SOURCE path is gated, not just the destination). Match contents.
export FAKE_API_FAIL=""
: > "$GH_LOG"
mcp_payload 938 | run >/dev/null
grep -q '^api .*/contents/' "$GH_LOG" && ok "todo/* branch runs the FULL guard (stage 1 fires)" \
                          || bad "todo/* branch runs the FULL guard (stage 1 fires)" "$(cat "$GH_LOG")"

# 25. …and the SAME file list on a non-todo branch does NOT run it. This is the #938
#     shape: an interactive PR that happens to carry a todos/archive file. A stage 1 keyed
#     on "the diff contains a todo file" misclassifies it; one keyed on the branch does
#     not.
export FAKE_VIEW_JSON="{\"headRefName\":\"chore/close-a-todo\",\"headRefOid\":\"$SHA\"}"
: > "$GH_LOG"
mcp_payload 938 | run >/dev/null
grep -q '^api .*/contents/' "$GH_LOG" && bad "non-todo branch does NOT run the full guard" "$(cat "$GH_LOG")" \
                          || ok "non-todo branch does NOT run the full guard"
export FAKE_API_FAIL="1"

# 26. DENY. The #938 shape's verdict: a non-todo branch carrying a todo file plus a
#     sensitive file is not exempt.
export FAKE_FILES="$FILES_TODO_RISKY"
out=$(mcp_payload 938 | run)
denied "$out" && ok "non-todo branch carrying a todo file is not exempt" \
              || bad "non-todo branch carrying a todo file is not exempt" "$out"

# 27. DENY. The #821 shape: stage 1 must not shortcut a todo/* branch whose paths are
#     sensitive. The name selects the policy; the guard enforces it.
export FAKE_VIEW_JSON="{\"headRefName\":\"todo/P3-2026-01-01-x\",\"headRefOid\":\"$SHA\"}"
export FAKE_API_FAIL=""
out=$(mcp_payload 938 | run)
denied "$out" && ok "todo/* with sensitive paths still denies" || bad "todo/* with sensitive paths still denies" "$out"
export FAKE_API_FAIL="1"
export FAKE_VIEW_JSON="{\"headRefName\":\"fix/thing\",\"headRefOid\":\"$SHA\"}"

# ── Self-authorization ───────────────────────────────────────────────────────

# 28. DENY. The env var INSIDE the command text is not the hook's environment. An agent
#     that could authorize itself by prefixing an assignment would defeat the whole gate.
export FAKE_FILES="$FILES_ONE"
out=$(bash_payload "SKIP_MERGE_REVIEW=1 gh pr merge 938 --auto --squash" | run)
denied "$out" && ok "SKIP inside the command does not self-authorize" \
              || bad "SKIP inside the command does not self-authorize" "$out"

# 29. ALLOW CONTROL for 28: the REAL env var does bypass, so 27's deny is evidence about
#     WHERE the variable was read, not merely that the gate denies everything.
out=$(bash_payload "gh pr merge 938 --auto --squash" | run SKIP_MERGE_REVIEW=1)
assert_allowed "real SKIP_MERGE_REVIEW bypasses" "$out"

# ── Ref resolution (must go through lib/cmd-detect.sh) ───────────────────────

# 30. DENY. `gh pr merge 4$(echo 9)2` — cmd_gh_pr_ref refuses to positionally extract from
#     a command carrying a live substitution, so no numeric ref resolves and the gate
#     fails closed. (Measured: the extractor returns the literal `4$(echo`, not 492.)
out=$(bash_payload 'gh pr merge 4$(echo 9)2 --auto' | run)
denied "$out" && ok "substitution-obfuscated ref fails closed" || bad "substitution-obfuscated ref fails closed" "$out"

# 31. DENY, and the message must name the MISSING-NUMBER cause FIRST. `gh pr merge --auto
#     --squash --delete-branch` is legal, documented usage (todo-executor.md:564 minus the
#     number) and guard-outward-cli.sh ALLOWS it — measured, that guard denies only the
#     non---auto form — so it arrives here and is denied unconditionally, before any risk
#     classification, even on a docs-only PR. Recovery is SKIP_MERGE_REVIEW=1, the pressure
#     point that gets a gate switched off, so the human must not have to guess which of
#     three causes applies to them.
out=$(bash_payload 'gh pr merge --auto --squash --delete-branch' | run)
r=$(reason "$out")
# Ordering, not mere presence: everything BEFORE the missing-number phrase must mention
# neither of the other two causes. `${r%%phrase*}` is the text preceding the phrase, and a
# strip that changes nothing proves the other cause is absent from it.
head=${r%%NO number was given*}
if denied "$out" \
   && [ "$head" != "$r" ] \
   && [ "${head#*obfuscated}" = "$head" ] \
   && [ "${head#*--repo}" = "$head" ]; then
  ok "bare-ref deny names the missing-number cause before the others"
else
  bad "bare-ref deny names the missing-number cause before the others" "$r"
fi

# 32. DENY. `--repo owner/repo` retargets a repository cmd_gh_pr_ref cannot convey, so it
#     refuses the ref.
out=$(bash_payload 'gh pr merge --repo other/repo 938 --squash' | run)
denied "$out" && ok "--repo retarget fails closed" || bad "--repo retarget fails closed" "$out"

# 33. DENY. A create/merge co-occurrence makes cmd_gh_pr_write_subcommand REFUSE (rc 1,
#     empty output). Treating that empty answer as "not a merge" is a self-authorization
#     bypass an agent can author: the merge really runs, the decoy never does.
out=$(bash_payload 'echo "$(gh pr merge 938)" # gh pr create' | run)
denied "$out" && ok "ambiguous gh pr verb fails closed" || bad "ambiguous gh pr verb fails closed" "$out"

# ── THE EXTRACTOR-MISS GAP, PINNED AS A TRIPWIRE — one row per mechanism the P1 todo
#    names: path-qualified binary, redirect between binary and verb, glued metacharacter,
#    and quoted command substitution. (unnumbered: rows 34-40 are already
#    used by the fail-closed and cwd-independence sections further down) ─────────────────────
# These rows assert the CURRENT, KNOWN-INCOMPLETE behaviour so the gap is visible in the
# suite instead of invisible. It is filed as
# todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md with its
# 537-row corpus. WHEN THAT TODO IS IMPLEMENTED THESE ROWS WILL FAIL, which is the point:
# the fix must come here and convert them to deny rows rather than land silently.
#
# Why they are ALLOW today: cmd_gh_pr_write_subcommand returns ""/rc 0 both for "not a
# merge" and for "I cannot parse this", and the gate cannot tell them apart. A raw-token
# predicate was tried across three review rounds and withdrawn - each version closed the
# family it was aimed at and denied ordinary prose one layer up. The real fix belongs in
# the shared lib/cmd-detect.sh extractor, which feeds the required corpus check.
#
# FILES risk-classified on purpose: stage 2 would HOLD these, so an ALLOW here proves the
# command exited at the miss, not that it earned an exemption.
export FAKE_FILES="client/hooks/useNutritionLookup.ts"

# CLOSED 2026-09-13 — converted from tripwire to deny rows. lib/cmd-detect.sh's new
# _CMD_GH_GLOBALS models the slot between the binary and its NAMESPACE, so a redirect
# sitting THERE no longer hides the verb.
#
# THIS IS HALF OF P1 MECHANISM (b), NOT ALL OF IT. That mechanism is "a word between the
# binary and the VERB", which is two slots; the namespace->verb slot is untouched and is
# pinned as still-open immediately below. The rows after that are mechanisms (a) and (c).
for spelling in \
  'gh 2>/dev/null pr merge 42 --squash' \
  'gh 2> /dev/null pr merge 42 --squash' ; do
  out=$(bash_payload "$spelling" | run)
  denied "$out" && ok "CLOSED, P1 mech (b) redirect: [$spelling]" \
                || bad "CLOSED, P1 mech (b) redirect: [$spelling]" "$out"
done

# CLOSED 2026-09-17 — the OTHER HALF of mechanism (b): a redirect in the NAMESPACE->VERB slot.
# These were pinned as a tripwire precisely so that closing the slot had to come back and
# convert them, and it has. `_CMD_GH_GLOBALS` modelled the binary->namespace slot from
# 2026-09-13; the namespace->verb slot stayed spelled as a bare `[[:space:]]+` at every call
# site, so `gh pr 2>/dev/null merge 42` resolved to NO subcommand and this gate allowed a real
# merge. `_CMD_GH_PR_SEP` now gives that slot the same absorber, applied at every site from one
# constant rather than per call — the per-call spelling is how the two slots drifted apart.
for spelling in \
  'gh pr 2>/dev/null merge 42 --squash' \
  'gh pr>log merge 42 --squash' \
  'gh pr 2>&1 merge 42 --squash' ; do
  out=$(bash_payload "$spelling" | run)
  denied "$out" && ok "namespace->verb slot now resolves, so the merge is gated: [$spelling]" \
                || bad "namespace->verb slot now resolves, so the merge is gated: [$spelling]" "$out"
done
# THE ALLOW SIDE of the same widening. A separator absorber is the direction that invents
# denials, and this gate has no per-command escape — SKIP_MERGE_REVIEW must be set in the shell
# that launched the session — so a false deny here gets the whole gate switched off. A READ verb
# in the same slot must stay allowed, and so must an ordinary command that merely mentions the
# words: the raw-token predicate withdrawn across three review rounds died on exactly that.
#
# EVERY ROW BELOW CARRIES A LITERAL `merge` SOMEWHERE, AND THAT IS LOAD-BEARING, NOT DECORATION.
# The gate opens with a necessary-substring fast path (`cmd_fastpath_has "$CMD" '*gh*pr*merge*'
# '*gh*api*merge*' || exit 0`). A read-verb row spelled `gh pr 2>/dev/null view 42` never
# contains `merge`, so it exits AT THAT PRE-FILTER and never reaches `_CMD_GH_PR_SEP` at all —
# it would pass whatever the separator did, which makes it a vacuous control for this widening.
# That is exactly the failure
# docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md describes,
# and the first draft of this block shipped it. Each row now clears the fast path on its own and
# is then allowed by the REAL reason: the verb in the widened slot is a read, not a merge.
for spelling in \
  'gh pr 2>/dev/null view 42 --comment "not a merge, just checking"' \
  'gh pr>log view 42 --comment "merge later, not now"' \
  'gh pr 2>/dev/null list --search "merge"' ; do
  out=$(bash_payload "$spelling" | run)
  assert_allowed "namespace->verb slot: a READ verb past the fast path stays allowed: [$spelling]" "$out"
done
out=$(bash_payload 'git commit -m "fix highlight for pr merge"' | run)
assert_allowed "namespace->verb slot: a commit MESSAGE naming the gate stays allowed" "$out"
# STILL OPEN, and named so this block is not read as closing the class: the BINARY renderings.
# A path-qualified binary, a wholly quoted one, and a command substitution all defeat the
# detector BEFORE any slot is reached, so the widening above cannot touch them. Measured on a
# 320-row rendering x separator x slot x verb corpus driven through these fixtures: of 70 real
# `gh pr merge` rows the gate still allows 44 (tab-separator rows excluded — a literal tab
# collides with the harness's own field delimiter and those rows are unreliable). All are
# denied today by guard-outward-cli.sh, so they are a defence-in-depth gap rather than a live
# bypass; the P1 todo carries the corpus.
for spelling in \
  '/opt/homebrew/bin/gh pr merge 42 --squash' \
  '"$(which gh)" pr merge 42 --squash' \
  "'gh' pr merge 42 --squash" ; do
  out=$(bash_payload "$spelling" | run)
  assert_allowed "KNOWN GAP, binary rendering (see P1 todo): [$spelling]" "$out"
done

# TWO STILL OPEN, ONE CLOSED 2026-09-15 -- and the split is the point of this block. The
# 2026-09-13 change closed the binary-to-namespace SLOT; it did not touch how the BINARY
# ITSELF is rendered. Three spellings defeated the detector before the slot was reached:
# the path-qualified binary, P1 mechanism (a) (glued metacharacter) and P1 mechanism (c)
# (quoted substitution).
#
# Mechanism (a) is now CLOSED AT THIS CALL SITE ONLY, as a side effect of unioning
# _CMD_POS_PREFIX into cmd_gh_pr_has_merge's anchor -- that union exists because a merge
# glued to its separator was invisible to the one read that routes to ALLOW. Measured on
# this tree through the helper, with `gh pr merge 42 --squash` SEEN and `npm run lint`
# missed as controls in the same run:
#   /opt/homebrew/bin/gh ...   missed   (still open -- "/" is not a _CMD_POS_PREFIX opener)
#   echo x;gh ...              SEEN     (CLOSED, moved to the deny pin below)
#   "$(which gh)" ...          missed   (still open -- cmd_bare blanks the quoted span)
# The other two remain P1's work. Do NOT read this as the extractor-miss class being fixed:
# it is closed for one mechanism, at one consumer, and the todo stays open.
for spelling in \
  '/opt/homebrew/bin/gh pr merge 42 --squash' \
  '"$(which gh)" pr merge 42 --squash' ; do
  out=$(bash_payload "$spelling" | run)
  assert_allowed "KNOWN GAP, still open (see P1 todo): [$spelling]" "$out"
done

# The closed one, pinned in its new direction rather than deleted -- a gap that closes has
# to be named, and a row that silently changes sides is how a later reader concludes the
# class was never real.
_lbl="P1 mechanism (a) CLOSED: a merge glued to a metacharacter is now seen [echo x;gh ...]"
out=$(bash_payload 'echo x;gh pr merge 42 --squash' | run)
denied "$out" && ok "$_lbl" || bad "$_lbl" "$out"

# ── The P0's own family: a repo-retarget flag in ROOT POSITION ────────────────
# `gh -R owner/repo pr merge 42` is a FUNCTIONAL invocation (cobra strips flags while
# resolving the subcommand), and before 2026-09-13 it resolved no subcommand at all, so it
# reached the `[ "$SUB" = "merge" ]` test as "not a merge" and was silently allowed —
# including with the retarget pointed at THIS repository. Both guards missed the same
# string, so the defence in depth was depth of one.
# todos/archive/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md
for spelling in \
  'gh -R other/org pr merge 42 --squash' \
  'gh --repo other/org pr merge 42 --squash' \
  'gh --repo=other/org pr merge 42 --squash' \
  'gh -Rother/org pr merge 42 --squash' \
  'gh -R Xertox1234/OCRecipes pr merge 42 --squash' ; do
  out=$(bash_payload "$spelling" | run)
  denied "$out" && ok "root-position retarget is no longer a silent allow: [$spelling]" \
                || bad "root-position retarget is no longer a silent allow: [$spelling]" "$out"
done

# A TRAILING retarget must refuse too, and here the DENY ALONE PROVES NOTHING — this
# spelling denied before the fix as well, from stage 3 ("no review record exists for head
# …"), because cmd_gh_pr_ref resolved ref 42 and the gate went on to classify the LOCAL
# PR #42. Its deny text was byte-identical to a bare merge's. So assert the REASON: the
# retarget must be REFUSED at ref resolution, not classified against the wrong repository.
out=$(bash_payload 'gh pr merge 42 --repo other/org' | run)
r=$(reason "$out")
if denied "$out" && printf '%s' "$r" | grep -qi 'could not resolve a PR number'; then
  ok "trailing retarget refuses at ref resolution, not the local PR of that number"
else
  bad "trailing retarget refuses at ref resolution, not the local PR of that number" \
      "denied=$(denied "$out" && echo yes || echo no) reason=[$r]"
fi

# ── The SECOND HALF of the same P0: a root flag this grammar does not NAME ────
# The five spellings above were closed on 2026-09-13 by naming `-R`/`--repo`. That looked
# complete and was not: cobra accepts any flag of the TARGET subcommand in root position, so
# `gh -t x pr merge 42` left `x` where the namespace belongs and resolved no subcommand at all
# — reaching `[ "$SUB" = "merge" ]` as "not a merge", the same silent allow, one spelling over.
# Closed by modelling the PROPERTY (a dash token may consume a following non-dash token)
# rather than by naming more flags, which is why the `-Z` and `--not-a-real-flag` rows are
# here: neither exists in any `gh`, and a membership-list fix would leave both open.
for spelling in \
  'gh -t x pr merge 42 --squash' \
  'gh -b body pr merge 42 --squash' \
  'gh -A a@b.c pr merge 42 --squash' \
  'gh -F notes.md pr merge 42 --squash' \
  'gh --match-head-commit abc123 pr merge 42 --squash' \
  'gh -Z somevalue pr merge 42 --squash' \
  'gh --not-a-real-flag v pr merge 42 --squash' ; do
  out=$(bash_payload "$spelling" | run)
  denied "$out" && ok "an unnamed separate-arg root flag is no longer a silent allow: [$spelling]" \
                || bad "an unnamed separate-arg root flag is no longer a silent allow: [$spelling]" "$out"
done

# THE HEADLINE SHAPE, and again THE DENY ALONE IS NOT THE ASSERTION. `gh -t x pr merge 42
# -R other/org` must refuse at REF RESOLUTION — if it instead reached stage 3 it would be
# classifying the LOCAL PR #42 while gh merges someone else's, and the deny text would be
# byte-identical to a bare merge's. That is the exact trap the trailing-retarget row above
# was written for; it applies here too, so it is asserted here too.
for spelling in \
  'gh -t x pr merge 42 -R other/org' \
  'gh -Z v pr merge 42 --repo other/org' ; do
  out=$(bash_payload "$spelling" | run)
  r=$(reason "$out")
  if denied "$out" && printf '%s' "$r" | grep -qi 'could not resolve a PR number'; then
    ok "root flag + retarget refuses at ref resolution: [$spelling]"
  else
    bad "root flag + retarget refuses at ref resolution: [$spelling]" \
        "denied=$(denied "$out" && echo yes || echo no) reason=[$r]"
  fi
done

# TWO-SIDED for the value arm specifically: a NO-ARG root flag puts the namespace in the very
# next token, so the grammar must DECLINE to consume it. If it consumed it these would go
# silently ALLOW — the value arm's own failure direction, and the one it could have caused.
for spelling in \
  'gh --no-color pr merge 42 --squash' \
  'gh -q -v --no-color pr merge 42 --squash' ; do
  out=$(bash_payload "$spelling" | run)
  denied "$out" && ok "a NO-ARG root flag still reaches the gate: [$spelling]" \
                || bad "a NO-ARG root flag still reaches the gate: [$spelling]" "$out"
done

# THE OTHER DIRECTION, in the same run. A root-position flag on a READ-ONLY command must
# stay silently allowed — widening the extractor must not turn `gh -R owner/repo pr list`
# into a gated call. Without these the deny rows above are a restrictive failure wearing a
# green tick.
for spelling in \
  'gh -R other/org pr list' \
  'gh -R other/org pr view 42' \
  'gh 2>/dev/null pr view 42' \
  'gh -t x pr list' \
  'gh -Z somevalue pr view 42' \
  'gh --no-color pr status' ; do
  out=$(bash_payload "$spelling" | run)
  assert_allowed "read-only usage in the same slot stays allowed: [$spelling]" "$out"
done

# THE PROSE DIRECTION, which is the regression this suite most needs to prevent.
# Every one of these was DENIED by one of the three withdrawn predicates, on a command
# that invokes nothing. A future miss-detection fix must keep them allowed; that is the
# constraint that made the naive versions unshippable.
for prose in \
  'git commit -m "docs: describe the gh pr merge gate"' \
  'git commit -m "highlight: through pr merge notes"' \
  'git commit -m "highlight: cost $var pr merge plan"' \
  'git commit -m "fix highlight for pr merge"' \
  'git commit -m "docs: gh -t x pr merge 42 was allowed by both layers"' ; do
  out=$(bash_payload "$prose" | run)
  assert_allowed "prose must never be denied: [$prose]" "$out"
done

# CONTROL. The plainest spelling the extractor CAN read still reaches stage 3 and
#     denies without a record - without this, the rows above would pass on a gate that
#     had stopped working entirely.
out=$(bash_payload 'gh pr merge 42 --squash' | run)
denied "$out" && ok "control: a readable gh pr merge still denies with no record" \
              || bad "control: a readable gh pr merge still denies with no record" "$out"
unset FAKE_FILES

# ── The MCP arm's mirror of 32: a repository retarget ────────────────────────
# 32b. DENY. The MCP tool takes owner/repo, but the gate resolves the PR from $ROOT
#      (`cd "$ROOT"` then `gh pr view <n>`, which reads the repository from cwd). Reading
#      only pullNumber therefore classified a call naming ANOTHER repository against THIS
#      repo's PR of the same number — measured: owner=x repo=y pullNumber=42 -> ALLOW,
#      authorised by a record earned here. FILES_SAFE is deliberate: stage 2 ALLOWs that
#      path set outright, so the repo check is the ONLY thing in the hook that can produce
#      a deny on this payload.
export FAKE_FILES="$FILES_SAFE"
out=$(mcp_payload_repo 938 not-the-owner not-the-repo | run)
denied "$out" && ok "MCP merge naming another repository fails closed" \
              || bad "MCP merge naming another repository fails closed" "$out"

# 32c. ALLOW CONTROL. Same payload SHAPE, this checkout's real owner/repo, upper-cased.
#      Without it 32b only says "the MCP arm denies whenever owner/repo are present",
#      which is a restrictive failure wearing a green tick. The upper-casing additionally
#      pins the case-insensitive comparison GitHub's own naming requires. The expected
#      value is parsed here from remote.origin.url by a DIFFERENT mechanism than the hook
#      uses (sed regex vs bash parameter expansion), so a broken parse on one side does
#      not silently agree with the other.
SELF_URL=$(git -C "$HOOKS_DIR/../.." config --get remote.origin.url 2>/dev/null)
SELF_NWO=$(printf '%s' "$SELF_URL" | sed -e 's/\.git$//' -e 's#^.*[:/]\([^/]*/[^/]*\)$#\1#')
case "$SELF_NWO" in
  */*/* | *:* | *" "* | "") bad "MCP owner/repo control fixture is usable" "unparseable remote.origin.url [$SELF_URL]" ;;
  ?*/?*)
    out=$(mcp_payload_repo 938 \
            "$(printf '%s' "${SELF_NWO%%/*}" | tr '[:lower:]' '[:upper:]')" \
            "$(printf '%s' "${SELF_NWO##*/}" | tr '[:lower:]' '[:upper:]')" | run)
    assert_allowed "MCP merge naming THIS repository (case-folded) is unaffected" "$out" ;;
  *) bad "MCP owner/repo control fixture is usable" "unparseable remote.origin.url [$SELF_URL]" ;;
esac
export FAKE_FILES="$FILES_ONE"

# ── Fail-closed on tooling ───────────────────────────────────────────────────

# 34. DENY. Stage 2 tooling error (exit 2) requires a stamp, not an allow. A gh whose
#     `pr diff` fails is what a rate-limit looks like to the guard.
export FAKE_DIFF_FAIL=1
out=$(mcp_payload 938 | run)
denied "$out" && ok "stage-2 tooling error denies (fail-closed)" || bad "stage-2 tooling error denies (fail-closed)" "$out"

# 35. …and it still denies when a VALID record exists but the changed-file list cannot be
#     re-read, because the scope comparison is exactly what cannot be performed.
stamp "$SHA" "$DIGEST_ONE" clean code-reviewer
out=$(mcp_payload 938 | run)
denied "$out" && ok "unreadable diff denies even with a valid record" \
              || bad "unreadable diff denies even with a valid record" "$out"
clear_stamps
export FAKE_DIFF_FAIL=""

# 36. DENY. `gh pr view` failing (no such PR / auth) is not an allow.
cat > "$BIN/gh" <<'GHDEAD'
#!/usr/bin/env bash
exit 1
GHDEAD
chmod +x "$BIN/gh"
out=$(mcp_payload 938 | run)
denied "$out" && ok "unreadable PR denies (fail-closed)" || bad "unreadable PR denies (fail-closed)" "$out"
write_gh

# 37. DENY. lib/cmd-detect.sh unsourceable => deny, never a silent allow. Run the hook from
#     a copy whose lib/ lacks it.
BROKEN=$(mktemp -d "${TMPDIR:-/tmp}/merge-guard-broken-$$-XXXX")
mkdir -p "$BROKEN/lib"
cp "$HOOK" "$BROKEN/merge-review-guard.sh"
cp "$HOOKS_DIR/lib/fastpath-filter.sh" "$BROKEN/lib/" 2>/dev/null
out=$(bash_payload "gh pr merge 938 --auto --squash" \
      | PATH="$BIN:$PATH" REVIEW_STAMP_ROOT="$ROOT" bash "$BROKEN/merge-review-guard.sh" 2>/dev/null)
denied "$out" && ok "missing cmd-detect.sh denies" || bad "missing cmd-detect.sh denies" "$out"
rm -rf "$BROKEN"

# 38. DENY. scripts/todo-automerge-guard.sh unreachable => deny. Same copy trick, with
#     cmd-detect.sh present so the deny is attributable to the guard, not the lib.
BROKEN=$(mktemp -d "${TMPDIR:-/tmp}/merge-guard-noguard-$$-XXXX")
mkdir -p "$BROKEN/lib"
cp "$HOOK" "$BROKEN/merge-review-guard.sh"
cp "$HOOKS_DIR/lib/fastpath-filter.sh" "$HOOKS_DIR/lib/cmd-detect.sh" \
   "$HOOKS_DIR/lib/review-stamp-path.sh" "$BROKEN/lib/" 2>/dev/null
out=$(mcp_payload 938 \
      | PATH="$BIN:$PATH" REVIEW_STAMP_ROOT="$ROOT" bash "$BROKEN/merge-review-guard.sh" 2>/dev/null)
if denied "$out" && grep -qi 'todo-automerge-guard' <<<"$(reason "$out")"; then
  ok "unreachable todo-automerge-guard.sh denies"
else
  bad "unreachable todo-automerge-guard.sh denies" "$out"
fi
rm -rf "$BROKEN"

# ── cwd independence ─────────────────────────────────────────────────────────
# The Bash tool's cwd PERSISTS across calls and can be any directory, including another
# git repository. `gh pr view` / `gh pr diff` resolve the repo FROM CWD, so a gate that
# inherited the ambient cwd could evaluate a different repository's PR #938 and allow on
# its file list. Two-sided: the deny and the allow must both survive the move.

export FAKE_PIN_PWD="$(cd "$HOOKS_DIR/../.." && pwd)"

# 39. DENY from a foreign cwd.
export FAKE_FILES="$FILES_ONE"
out=$( cd / && bash_payload "gh pr merge 938 --auto" | run )
denied "$out" && ok "denies identically from a foreign cwd" || bad "denies identically from a foreign cwd" "$out"

# 40. ALLOW from a foreign cwd. This is the discriminating half: with the pinned gh, a hook
#     that ran gh from the INHERITED cwd gets a gh failure here and denies, so 38's deny
#     alone proves nothing. Only a hook that anchored itself to the project root allows.
export FAKE_FILES="$FILES_SAFE"
out=$( cd / && bash_payload "gh pr merge 938 --auto" | run )
assert_allowed "allows identically from a foreign cwd" "$out"
unset FAKE_PIN_PWD

# ── Missing jq: a BLOCKING guard must fail CLOSED ────────────────────────────
# `command -v jq || exit 0` is the ADVISORY hook convention (drift-detect.sh:21,
# eslint-fix.sh:15). In a blocking guard it turns the gate silently OFF — and
# review-stamp-writer.sh dies on the same missing tool, so no record exists either. Both
# merge routes must be covered: spelling only the Bash shape leaves the CLAUDE.md-preferred
# MCP route wide open, which is worse than not fixing it at all.
NOJQ_BIN=$(mktemp -d "${TMPDIR:-/tmp}/merge-guard-nojq-$$-XXXX")
for b in bash cat grep; do ln -s "$(command -v "$b")" "$NOJQ_BIN/$b" 2>/dev/null; done
# Every check below goes through `run`, overriding PATH to the jq-free directory. An
# earlier revision used its own raw `env -i …` pipeline here — which meant these
# assertions never wrote RC_FILE, so the two ALLOW controls could not tell "allowed" from
# "crashed", reintroducing the exact class the rc fix exists to close, in the same commit
# that closed it. Measured then: mutating this fallback's own `exit 0` to `exit 3` left the
# suite fully green.
# `hash -r` BEFORE the probe, or this fixture silently never runs on stock macOS bash.
# This script has already invoked jq many times by now, so bash has cached its location in
# the command hash table — and `command -v jq` consults that table before searching PATH.
# Under bash 3.2.57 (/bin/bash on macOS, the version this suite's siblings target) the
# probe therefore still reports the ambient /usr/bin/jq even with PATH restricted, the
# guard falls to its else branch, and the four no-jq fail-closed assertions below are
# replaced by a single "fixture is usable" failure. Reproduced 3/3; with `hash -r` the
# four assertions pass. CI runs GNU bash on ubuntu-latest and never saw it, and the hook
# itself is unaffected (it forks a fresh, unhashed bash), so the exposure was exactly this
# suite's own coverage of the jq-missing path.
hash -r 2>/dev/null || true
if [ -x "$NOJQ_BIN/bash" ] && ! PATH="$NOJQ_BIN" command -v jq >/dev/null 2>&1; then
  # 41. The MCP merge route.
  out=$(mcp_payload 938 | run PATH="$NOJQ_BIN")
  denied "$out" && ok "no jq: MCP merge route denies" || bad "no jq: MCP merge route denies" "$out"

  # 42. The Bash merge route.
  out=$(bash_payload "gh pr merge 938 --auto --squash" | run PATH="$NOJQ_BIN")
  denied "$out" && ok "no jq: Bash merge route denies" || bad "no jq: Bash merge route denies" "$out"

  # 42b. The gh-api merge route (P2) — the no-jq fallback's own crude pre-check needed the
  #      same second alternative the fast path did, or a jq-less environment would silently
  #      allow exactly the merge shape the rest of this file now denies.
  out=$(bash_payload 'gh api --method PUT repos/Xertox1234/OCRecipes/pulls/938/merge -f merge_method=squash' | run PATH="$NOJQ_BIN")
  denied "$out" && ok "no jq: gh-api merge route denies" || bad "no jq: gh-api merge route denies" "$out"

  # 43. ALLOW CONTROL — without it, 41/42/42b only say "this hook denies everything once jq
  #     is gone", which would be its own restrictive failure. An unrelated Bash call must
  #     still pass through silently, AND exit 0 while doing so.
  out=$(bash_payload "npm run lint" | run PATH="$NOJQ_BIN")
  assert_allowed "no jq: unrelated Bash command is untouched" "$out"

  # 44. ALLOW CONTROL — the documented bypass still works with no jq (it is read before the
  #     jq probe), so 41/42/42b are evidence about the missing tool, not about a blanket deny.
  out=$(mcp_payload 938 | run PATH="$NOJQ_BIN" SKIP_MERGE_REVIEW=1)
  assert_allowed "no jq: SKIP_MERGE_REVIEW still bypasses" "$out"
else
  bad "no-jq fixture is usable" "could not build a jq-free PATH at $NOJQ_BIN"
fi
rm -rf "$NOJQ_BIN"

# ---------------------------------------------------------------------------------------
# MERGE-GATE MIS-SELECTION (2026-09-15). A leading `gh <root flag> <value> pr close` clause
# used to win cmd_gh_pr_write_subcommand's `head -1`, so the gate read the verb as "close"
# and early-exited ALLOW while a real merge sat later in the same command. Pinned as a
# FAMILY, not a single spelling, because the bug is a property of the flag CLASS (any
# unnamed separate-arg root flag), not of any one flag.
#
# THE FIVE LOOP SPELLINGS ARE NOT ALL THE SAME KIND OF ROW, and an earlier version of this
# header said they were ("every row here was MEASURED flipping main-DENY to branch-ALLOW"),
# which this suite's own measured table contradicts. They split:
#   REGRESSION PINS (3) -- main DENY, pre-fix ALLOW, post-fix DENY:
#       -t x, -Z somevalue, --match-head-commit abc
#   NET-NEW COVERAGE (2) -- main ALLOW, pre-fix ALLOW, post-fix DENY, i.e. a hole main has
#   today and this branch closes:
#       --no-color, -R o/r
# The distinction is load-bearing in one direction: a later reader "restoring main's
# behaviour" would read the old header as licence to delete the two rows main never
# covered. Describing a filtered set as if it were the whole set is the defect this PR's
# own solution docs are about.
export FAKE_FILES="$FILES_ONE"

for _mrgflag in '-t x' '-Z somevalue' '--match-head-commit abc' '--no-color' '-R o/r'; do
  _lbl="a leading pr close clause carrying [$_mrgflag] cannot mask a later merge"
  out=$(bash_payload "gh $_mrgflag pr close 1 ; gh pr merge 938 --squash --delete-branch" | run)
  denied "$out" && ok "$_lbl" || bad "$_lbl" "$out"
done

# The prefixed spelling matters on its own: guard-outward-cli.sh honours the inline
# ALLOW_OUTWARD_CLI=1 escape and this file deliberately does not, so before the fix this
# exact shape was ALLOW through BOTH hooks -- an unreviewed merge with nothing in its way.
_lbl="the ALLOW_OUTWARD_CLI=1-prefixed masking shape still reaches this gate"
out=$(bash_payload "ALLOW_OUTWARD_CLI=1 gh -t x pr close 1 ; gh pr merge 938 --squash --delete-branch" | run)
denied "$out" && ok "$_lbl" || bad "$_lbl" "$out"

# CONTROLS, in the same block, because a gate that denied everything would also turn the
# six rows above green.
_lbl="CONTROL: a bare merge on a risky diff still denies"
out=$(bash_payload 'gh pr merge 938 --squash --delete-branch' | run)
denied "$out" && ok "$_lbl" || bad "$_lbl" "$out"

out=$(bash_payload 'npm run lint' | run)
assert_allowed "CONTROL: a non-gh command is untouched by the existence read" "$out"

# A close with NO merge anywhere must still early-exit ALLOW -- the existence read must not
# become "deny anything mentioning gh pr".
out=$(bash_payload 'gh -t x pr close 1' | run)
assert_allowed "CONTROL: a lone pr close clause still allows (no merge present)" "$out"

# THE ROW ABOVE CANNOT FAIL, AND NEITHER CAN THE `npm run lint` ONE -- which is why this
# third control exists. merge-review-guard.sh:108 runs
# `cmd_fastpath_has "$CMD" '*gh*pr*merge*' '*gh*api*merge*' || exit 0`, and BOTH globs
# require a literal `merge` substring. A lone close clause has none, so the hook exits at
# :108 and never reaches cmd_gh_pr_has_merge at all; a gate that denied everything arriving
# at the existence read would leave both rows green. Measured: `gh -t x pr close 1` and
# `npm run lint` both exit at the fast path, while the row below and a real
# `gh pr merge 938` both reach the gate.
# This row clears `*gh*pr*merge*` on substrings alone -- `gh` inside "highlight", then `pr`,
# then `merge` -- while containing no `gh <globals> pr merge` clause at all, so it
# reaches the existence read and MUST still allow. It is the only one of the three that
# would redden if the read inverted. The shape is borrowed from this file's own earlier
# fast-path documentation rather than invented.
out=$(bash_payload 'git commit -m "fix highlight for pr merge"' | run)
assert_allowed "CONTROL: a command that REACHES the existence read with no merge still allows" "$out"

# THE 64KB SIGPIPE ROW. The existence helper used to answer through `printf | grep -q`, and
# `grep -q` closes the pipe on its first match. Past the 64KB pipe buffer, with the match on
# an early LINE, the writer took SIGPIPE, the pipeline returned 141 under the pipefail this
# hook sets, and `if ! ...` inverted 141 into a silent ALLOW. Measured before the fix:
# 57,713 bytes detected, 96,913 bytes MISSED, and the same 96,913 bytes detected once the
# pipe was replaced with a herestring. SINGLE-LINE input of the same size never trips it --
# grep cannot exit mid-line, so the writer never blocks -- which is exactly why an earlier
# review measured this shape and called it safe. No other row in this file is large enough
# to reach the buffer, so without this one the whole class is unpinned.
_big=$'gh pr merge 938 --squash'
for _i in $(seq 1 2000); do _big+=$'\n# padding line to push this command past the 64KB pipe buffer'; done
# REGIME PRECONDITION -- the convention is named in test-cmd-detect.sh, in the block headed
# `CONVENTION: REGIME PRECONDITION`, which says to name it when a third pin adopts it. This
# is that third pin, and the first outside that file. The deny row below does NOT imply it:
# the 23-byte `gh pr merge 42 --squash` earlier in this file is denied too (the row labelled
# "control: a readable gh pr merge still denies with no record"), so if seq went missing, the
# loop bound were edited, or the padding string shortened, the row would go green having
# exercised a string that never approaches the pipe buffer -- and by this row's own header,
# no other row here is large enough to reach it.
#
# PART 2, MEASURE WHAT CROSSES THE PIPE. cmd_gh_pr_has_merge reads cmd_bare_deep's output, so
# that rendering -- not the raw command -- is what a regression to the piped form would write.
# The two coincide today at 124,024 bytes each; an assertion on raw $_big would agree with the
# coincidence and go inert the moment the rendering changed. This file sources nothing, so the
# rendering is obtained in a subshell and only its measurements cross back as text.
#
# PART 3, ASSERT EVERY PROPERTY THE REGIME NEEDS -- and size alone is the wrong one, because
# the mechanism is line-structured. grep cannot exit mid-line, so what decides SIGPIPE is how
# much printf still has pending at the first moment grep can conclude: the merge must sit on
# the FIRST line, and more than a buffer's worth must remain behind that line. Measured
# against four drifts that each leave the deny row GREEN: padding cut to 20 lines leaves 1,240
# bytes behind; folding the padding onto one line leaves 0; moving the merge to the last line
# clears the first-line test; and holding the total at 124,024 while growing line 1 to 99,224
# bytes leaves 24,800 behind -- that last one passes a byte-offset-from-the-match formulation
# and fails this one, which is why the cut is taken at the newline.
# No separator assertion, unlike the retarget pin in test-cmd-detect.sh: that one needs it
# because cmd_gh_pr_ref cuts its clause at the first [;&|]
# (`repo_clause="$full_match${clause_tail%%[;&|]*}"`), while cmd_gh_pr_has_merge greps the
# rendering whole. Read out of the two function bodies, not assumed from their similarity.
_mb_probe=$(
  if . "$HOOKS_DIR/lib/cmd-detect.sh" >/dev/null 2>&1 && declare -F cmd_bare_deep >/dev/null; then
    _w=$(cmd_bare_deep "$_big")
    _f="${_w%%$'\n'*}"
    case "$_f" in *"gh pr merge"*) _on=yes;; *) _on=no;; esac
    printf '%s %s %s' "$_on" "$(( ${#_w} - ${#_f} ))" "${#_w}"
  else
    printf 'unsourceable 0 0'
  fi
)
[ -n "$_mb_probe" ] || _mb_probe='killed 0 0'
_mb_onfirst="${_mb_probe%% *}"; _mb_rest="${_mb_probe#* }"
_mb_behind="${_mb_rest%% *}"; _mb_total="${_mb_rest##* }"
case "$_mb_behind" in ''|*[!0-9]*) _mb_behind=0;; esac
_mb_lbl="the 64KB SIGPIPE pin still renders a first-line merge with a full buffer behind it"
if [ "$_mb_onfirst" = yes ] && [ "$_mb_behind" -gt 65536 ]; then
  ok "$_mb_lbl"
else
  bad "$_mb_lbl" "merge on first line: $_mb_onfirst; bytes behind that line: $_mb_behind (need >65536); rendered total: $_mb_total; probe=[$_mb_probe]"
fi
_lbl="a >64KB MULTI-LINE command with an early merge still denies (SIGPIPE rc-141 inversion)"
out=$(bash_payload "$_big" | run)
denied "$out" && ok "$_lbl" || bad "$_lbl" "$out"
unset _big _mb_probe _mb_onfirst _mb_rest _mb_behind _mb_total _mb_lbl

# GLUED SEPARATORS. `(^|[[:space:]])gh` does not see a binary glued to its separator, so a
# real merge hid from the one read that routes to ALLOW. Unioned with _CMD_POS_PREFIX.
# Measured as MISSED before and detected after, with the negative controls above unchanged.
for _glue in ';' '&&' '|'; do
  _lbl="a merge glued to [$_glue] is still seen by the existence read"
  out=$(bash_payload "gh -t x pr close 1${_glue}gh pr merge 938 --squash" | run)
  denied "$out" && ok "$_lbl" || bad "$_lbl" "$out"
done

# NEGATIVE CONTROL FOR THE UNION, in the same block: widening the anchor must not start
# denying a quoted mention. cmd_bare blanks the quoted span, so this stays ALLOW.
out=$(bash_payload 'git commit -m "gh pr merge 42"' | run)
assert_allowed "CONTROL: a QUOTED merge mention is still not a merge" "$out"

# ---------------------------------------------------------------------------------------
# THE PREFLIGHT INVARIANT, ENFORCED RATHER THAN ASSERTED. merge-review-guard.sh's loader
# checks `declare -F` for each cmd_* function and `-n` for each _CMD_* constant it uses, and
# routes a miss to a deny -- because an undefined callee returns 127 and the gate below
# inverts that to an allow, and an unset constant kills the hook under `set -u` without
# emitting JSON, which for a PreToolUse hook is non-blocking. The invariant was written as a
# comment and was ALREADY FALSE ONCE: cmd_words_deep was called below the line and missing
# from the conjunction. A hand-maintained invariant with no test is a comment, not a guard.
# This derives both sets from the file and fails if anything used below the conjunction is
# unchecked -- so adding a callee without wiring it reddens here instead of silently
# disarming the gate.
_mrg_src="$HOOK"
_mrg_conj_line=$(grep -n 'declare -F cmd_gh_pr_write_subcommand' "$_mrg_src" | head -1 | cut -d: -f1)
_mrg_conj=$(sed -n "$((_mrg_conj_line-2)),$((_mrg_conj_line+8))p" "$_mrg_src")
_mrg_missing=""
# FULL-LINE COMMENTS ARE STRIPPED FIRST, and only those. The first version of this check
# scanned the raw file and reported cmd_bare/cmd_bare_deep as unchecked -- six occurrences,
# every one of them PROSE explaining what those helpers do. A check that cannot tell a call
# from a sentence about a call reports the file's documentation as a defect. Trailing
# comments on code lines are deliberately NOT stripped: a call followed by `# note` must
# stay visible, and erring toward MORE matches is the safe direction for a guard whose job
# is to notice an unwired callee.
for _mrg_sym in $(sed -n "$((_mrg_conj_line+8)),\$p" "$_mrg_src" | grep -vE '^[[:space:]]*#' \
                   | grep -oE '(^|[^_A-Za-z])cmd_[a-z_]+' | grep -oE 'cmd_[a-z_]+' | sort -u); do
  case "$_mrg_sym" in cmd_fastpath_has) continue;; esac
  printf '%s' "$_mrg_conj" | grep -q -- "declare -F $_mrg_sym" || _mrg_missing="$_mrg_missing $_mrg_sym"
done
for _mrg_sym in $(sed -n "$((_mrg_conj_line+8)),\$p" "$_mrg_src" | grep -vE '^[[:space:]]*#' \
                   | grep -oE '_CMD_[A-Z_]+' | sort -u); do
  printf '%s' "$_mrg_conj" | grep -q -- "$_mrg_sym" || _mrg_missing="$_mrg_missing $_mrg_sym"
done
_mrg_lbl="every cmd_*/_CMD_* used below the preflight is checked BY the preflight"
if [ -z "$_mrg_missing" ]; then
  ok "$_mrg_lbl"
else
  bad "$_mrg_lbl" "unchecked:$_mrg_missing"
fi
unset _mrg_src _mrg_conj_line _mrg_conj _mrg_missing _mrg_sym _mrg_lbl

# THE CLOSER-CLASS INVARIANT, PORTED FROM THE SIBLING SUITE (2026-09-18, review round 3).
# test-guard-outward-cli.sh has asserted this for guard-outward-cli.sh since the 2026-09-17
# closer sweep, and its comment names the principle: fixing one arm and leaving its siblings is
# the most repeated mistake in that file. The invariant was asserted WITHIN one file and never
# ported ACROSS to this one -- the same mistake one level up, and precisely how round 3's
# CRITICAL survived: the merge-endpoint discriminator hand-spelled `([[:space:]]|$)`, a glued
# redirect walked past it, and a 151-assertion green suite had nothing to say about it.
# A redirect operator terminates a word without whitespace, so `…/merge>/dev/null` presents `>`
# where the hand-spelled class expects whitespace or end-of-string; ${_CMD_POS_SUFFIX} absorbs it.
# COUNTS OCCURRENCES with `grep -o | wc -l`, never `grep -c` (which counts LINES and would read
# two on one line as one). COMMENT LINES ARE EXCLUDED deliberately: this guard's own comments
# quote the fragment verbatim when explaining the defect, and a check that counted prose would
# force the explanation to be deleted to stay green.
# WIDENED 2026-09-22, in lock-step with the sibling suite: the literal grep saw only
# `([[:space:]]|$)`, so `MRG_API_FIELD`'s closer `([[:space:]]|=|$)` -- the same defect with one
# extra alternative -- reported PASS on the line this check exists to catch. The pattern now admits
# ONE extra alternative between the space class and `$` (anything without `|` or `)`). Widened
# FIRST and watched go red on that line before the closer was fixed:
# todos/archive/P1-2026-09-18-trailing-comment-disarms-grant-shaped-negated-predicates.md.
_mrgcloser_hits=$(grep -nE '\(\[\[:space:\]\]\|([^|)]+\|)?\$\)' "$HOOK" | grep -vE '^[0-9]+:[[:space:]]*#' | grep -oE '\(\[\[:space:\]\]\|([^|)]+\|)?\$\)' | wc -l | tr -d ' ')
if [ "$_mrgcloser_hits" = "0" ]; then
  echo "PASS: no code line in merge-review-guard.sh hand-spells a closer class that \${_CMD_POS_SUFFIX} provides"; PASS=$((PASS+1))
else
  echo "FAIL: $_mrgcloser_hits code-line closer class(es) hand-spelled as ([[:space:]]|\$) or a one-alternative variant such as ([[:space:]]|=|\$) instead of \${_CMD_POS_SUFFIX} -- a glued < or > escapes them"; FAIL=$((FAIL+1))
fi
# NON-VACUITY, because a structural grep that matches nothing passes for the wrong reason just as
# readily as one that matches nothing for the right one. The same pipeline over COMMENT lines must
# still find the fragment, proving the pattern itself is live rather than silently broken.
_mrgcloser_prose=$(grep -nE '\(\[\[:space:\]\]\|([^|)]+\|)?\$\)' "$HOOK" | grep -E '^[0-9]+:[[:space:]]*#' | grep -oE '\(\[\[:space:\]\]\|([^|)]+\|)?\$\)' | wc -l | tr -d ' ')
if [ "$_mrgcloser_prose" -gt 0 ]; then
  echo "PASS: the closer-class pattern still matches merge-review-guard.sh's own prose (check is live)"; PASS=$((PASS+1))
else
  echo "FAIL: the closer-class pattern matches nothing anywhere -- the structural check above is vacuous"; FAIL=$((FAIL+1))
fi
unset _mrgcloser_hits _mrgcloser_prose

# Pin the assertion TOTAL, mirroring test-cmd-detect.sh's own EXPECTED_TOTAL pin. Without it a row that is
# skipped -- a `command not found` on a tool a fixture needs, an early `exit` in a helper,
# a truncated file -- subtracts silently and the suite still prints a clean pass/0 fail.
# Same caveat as the sibling pin: this catches a MISSING assertion, not an assertion that
# never ran because the process died before reaching it.
# 114 -> 123 (2026-09-15): +9 for the merge-gate mis-selection family above -- 5 flag
# spellings x the masking shape, plus the prefixed spelling, plus three controls.
# 123 -> 124: +1 for the control that actually REACHES the existence read (the two beside
# it exit at the fast path and cannot redden).
# 124 -> 129: +1 SIGPIPE row, +3 glued-separator rows, +1 quoted-mention control for the
# widened anchor.
# 129 -> 130: +1 for the row that derives the preflight's required symbol set from the file
# instead of trusting the comment that states it.
# 151 -> 154 -> 156 (2026-09-18, review round 3): +3 behavioural rows for a redirect GLUED
# to the merge endpoint (glued, a SPACED non-vacuity control, and a negative control on a
# non-merge path), then +2 structural rows porting the closer-class invariant from the
# sibling suite so the next hand-spelled closer in THIS file reddens instead of shipping.
# 130 -> 131: +1 regime precondition for THE 64KB SIGPIPE ROW, which until now asserted its
# DENY outcome with nothing asserting the input still reached the pipe buffer.
# 131 -> 138 (2026-09-17, namespace->verb slot): +7. The three KNOWN GAP tripwire rows were
# CONVERTED in place from assert_allowed to a deny assertion, so they contribute 0 to this
# delta — the count moves only on genuinely new rows: +3 read-verb rows and +1 commit-message
# row pinning the ALLOW side of a separator widening (the direction that invents denials, and
# the one that killed the withdrawn raw-token predicate), and +3 rows pinning the BINARY
# renderings that remain open so the block is not read as closing the whole class.
# 179 -> 193 (2026-09-22, non-argv text in the implicit-POST arm, block 3a-bis-2): +14 = 3 deny
# rows for the comment/redirect-operand decoys, 2 deny controls, 2 allow controls, 3 glued
# field-closer denies with 1 deny + 1 allow control, and the value-slot decoy beside its control.
EXPECTED_TOTAL=193
if [ $((PASS + FAIL)) -ne "$EXPECTED_TOTAL" ]; then
  echo "FAIL: assertion total is $((PASS + FAIL)), expected $EXPECTED_TOTAL — an assertion was skipped, or the total changed without updating this pin"
  FAIL=$((FAIL + 1))
fi

echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
