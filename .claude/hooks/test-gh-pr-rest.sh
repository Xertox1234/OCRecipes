#!/usr/bin/env bash
# Tests for lib/gh-pr-rest.sh — run from anywhere. `gh` is a stand-in on PATH; nothing real is read.
#
# The lib is the REST retry for `gh pr view --json`, which a Claude Code cloud session refuses
# (GraphQL is blocked there). It must answer in `gh pr view`'s own field names and states, and
# must keep "no PR" (rc 1) apart from "could not look" (rc 2): callers warn differently on each.
set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0
assert_eq() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name"; echo "  want: $want"; echo "  got:  $got"; FAIL=$((FAIL+1)); fi
}

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
# Stand-in gh: only `gh api …` answers. It logs its arguments, then prints FAKE_REST_BODY.
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_GH_LOG"
[ "$1" = "api" ] || { echo "HTTP 403: GitHub GraphQL is not available" >&2; exit 1; }
[ -z "${FAKE_REST_FAIL:-}" ] || { echo "HTTP 502" >&2; exit 1; }
printf '%s\n' "$FAKE_REST_BODY"
EOF
chmod +x "$T/bin/gh"
export FAKE_GH_LOG="$T/gh.log"
export PATH="$T/bin:$PATH"

# shellcheck source=/dev/null
. "$HOOKS_DIR/lib/gh-pr-rest.sh"

pr() {  # $1=number $2=state $3=merged_at-json $4=head-ref $5=sha
  printf '{"number":%s,"html_url":"https://github.com/o/r/pull/%s","title":"T%s","state":"%s","merged_at":%s,"head":{"ref":"%s","sha":"%s"}}' \
    "$1" "$1" "$1" "$2" "$3" "$4" "$5"
}
lookup() { : > "$FAKE_GH_LOG"; OUT=$(gh_pr_rest_json "$@" 2>/dev/null); RC=$?; }
# The branch arm percent-encodes EVERY byte of the name (see the lib for why).
enc() { printf '%s' "$1" | od -v -An -tx1 | tr -d ' \n' | sed 's/../%&/g'; }
LIST_REST='repos/{owner}/{repo}/pulls?state=all&per_page=100&head={owner}%3A'
list_call() { printf 'api --paginate %s%s' "$LIST_REST" "$(enc "$1")"; }

# 1. A number: one PR object, mapped to gh pr view's field names.
export FAKE_REST_BODY; FAKE_REST_BODY=$(pr 42 open null feat/x abc123)
lookup 42
assert_eq "number: rc 0" 0 "$RC"
assert_eq "number: fields in gh pr view's shape" \
  '{"number":42,"url":"https://github.com/o/r/pull/42","title":"T42","state":"OPEN","mergedAt":null,"headRefOid":"abc123"}' "$OUT"
assert_eq "number: asks the single-PR resource" 'api repos/{owner}/{repo}/pulls/42' "$(cat "$FAKE_GH_LOG")"

# 2. REST says closed + merged_at; gh pr view says MERGED. Closed without merge stays CLOSED.
FAKE_REST_BODY=$(pr 42 closed '"2026-11-23T00:00:00Z"' feat/x abc123)
lookup 42
assert_eq "merged: state is MERGED" MERGED "$(jq -r .state <<<"$OUT")"
assert_eq "merged: mergedAt carried" 2026-11-23T00:00:00Z "$(jq -r .mergedAt <<<"$OUT")"
FAKE_REST_BODY=$(pr 42 closed null feat/x abc123)
lookup 42
assert_eq "closed unmerged: state is CLOSED" CLOSED "$(jq -r .state <<<"$OUT")"

# 3. A URL on any host the caller let through: owner, repo and number come from the URL.
FAKE_REST_BODY=$(pr 7 open null feat/x abc123)
lookup https://github.com/other/repo/pull/7
assert_eq "url: rc 0" 0 "$RC"
assert_eq "url: asks that repo's PR" 'api repos/other/repo/pulls/7' "$(cat "$FAKE_GH_LOG")"
lookup https://github.com/other/repo/pull/7/files
assert_eq "url with a trailing path: same PR" 'api repos/other/repo/pulls/7' "$(cat "$FAKE_GH_LOG")"
lookup https://github.com/other/repo/issues/7
assert_eq "url that is not a PR: rc 2" 2 "$RC"
assert_eq "url that is not a PR: gh never called" "" "$(cat "$FAKE_GH_LOG")"
lookup //host/o/r/pull/7
assert_eq "protocol-relative ref: rc 2, gh never called" "2|" "$RC|$(cat "$FAKE_GH_LOG")"

# 4. A branch: the list resource filtered by head; the open PR wins, else the newest.
FAKE_REST_BODY="[$(pr 9 closed '"2026-11-23T00:00:00Z"' feat/x new999),$(pr 8 open null feat/x open888),$(pr 3 closed null feat/x old333)]"
lookup feat/x
assert_eq "branch: rc 0" 0 "$RC"
assert_eq "branch: the open PR wins over a newer merged one" 8 "$(jq -r .number <<<"$OUT")"
assert_eq "branch: asks the list, all states, by head" "$(list_call feat/x)" "$(cat "$FAKE_GH_LOG")"
assert_eq "branch: the name is sent fully percent-encoded" \
  'api --paginate repos/{owner}/{repo}/pulls?state=all&per_page=100&head={owner}%3A%66%65%61%74%2f%78' "$(cat "$FAKE_GH_LOG")"
FAKE_REST_BODY="[$(pr 9 closed '"2026-11-23T00:00:00Z"' feat/x new999),$(pr 3 closed null feat/x old333)]"
lookup feat/x
assert_eq "branch, none open: the newest (first listed) PR" "9 MERGED new999" "$(jq -r '"\(.number) \(.state) \(.headRefOid)"' <<<"$OUT")"

# 4b. More PRs than one page: GitHub pages the list at 100, so gh is asked for every page
#     (--paginate prints one array per page). The open PR on a LATER page must still win;
#     reading page one alone took the newest closed PR instead (harness-residuals, 2026-11-24).
FAKE_REST_BODY="[$(pr 9 closed '"2026-11-23T00:00:00Z"' feat/x new999)]
[$(pr 8 open null feat/x open888)]"
lookup feat/x
assert_eq "branch, two pages: the open PR on page two wins" "0|8" "$RC|$(jq -r .number <<<"$OUT")"
assert_eq "branch: every page is asked for" "api --paginate ${LIST_REST}$(enc feat/x)" "$(cat "$FAKE_GH_LOG")"
FAKE_REST_BODY="[$(pr 9 open null feat/x new999)]
[$(pr 8 closed null some/other-branch old888)]"
lookup feat/x
assert_eq "branch, a foreign row on page two: rc 2, nothing printed" "2|" "$RC|$OUT"
FAKE_REST_BODY="[]
[]"
lookup feat/x
assert_eq "branch, empty pages: rc 1 (no PR)" "1|" "$RC|$OUT"

# 5. No PR is rc 1 — only on an EMPTY list. Rows for some other branch mean the head filter
#    was not applied (GitHub ignores a malformed one and lists everything): that is rc 2.
FAKE_REST_BODY='[]'
lookup feat/x
assert_eq "branch, empty list: rc 1 (no PR)" "1|" "$RC|$OUT"
FAKE_REST_BODY="[$(pr 9 open null some/other-branch abc123)]"
lookup feat/x
assert_eq "branch, rows for another branch: rc 2, nothing printed" "2|" "$RC|$OUT"

# 6. Could-not-look is rc 2: gh failing, a body that is not a PR, a non-array for a branch.
FAKE_REST_BODY=$(pr 42 open null feat/x abc123)
FAKE_REST_FAIL=1 lookup 42
assert_eq "gh api fails (number): rc 2" "2|" "$RC|$OUT"
FAKE_REST_FAIL=1 lookup feat/x
assert_eq "gh api fails (branch): rc 2" "2|" "$RC|$OUT"
FAKE_REST_BODY='{"message":"Not Found"}'
lookup 42
assert_eq "body without PR fields: rc 2" "2|" "$RC|$OUT"
lookup feat/x
assert_eq "branch answered with an object: rc 2" "2|" "$RC|$OUT"
FAKE_REST_BODY='not json'
lookup 42
assert_eq "unparseable body: rc 2" "2|" "$RC|$OUT"

# 7. No ref means the current branch — and no branch (detached, not a repo) is rc 2, never a
#    lookup of something else.
REPO="$T/repo"; mkdir -p "$REPO"
git -C "$REPO" init -q -b my-branch
FAKE_REST_BODY="[$(pr 5 open null my-branch abc123)]"
: > "$FAKE_GH_LOG"; OUT=$(cd "$REPO" && gh_pr_rest_json "" 2>/dev/null); RC=$?
assert_eq "no ref: resolves the current branch's PR" "0|5" "$RC|$(jq -r .number <<<"$OUT")"
assert_eq "no ref: asked by the current branch name" "$(list_call my-branch)" "$(cat "$FAKE_GH_LOG")"
: > "$FAKE_GH_LOG"; OUT=$(cd "$T" && GIT_CEILING_DIRECTORIES="$T" gh_pr_rest_json "" 2>/dev/null); RC=$?
assert_eq "no ref outside a repo: rc 2, gh never called" "2|" "$RC|$(cat "$FAKE_GH_LOG")"

# 7b. gh fills placeholders anywhere in an endpoint or a -F value: {owner}, {repo}, {branch}
#     and the legacy :owner, :repo, :branch. Sent as `head={owner}:<name>`, a branch called
#     repo-cleanup became "<repo name>-cleanup" and x{repo}y became another well-formed branch
#     (security review, 2026-11-24). Encoding every byte leaves gh nothing to match.
for b in repo-cleanup owner branch/x 'x{repo}y' '{owner}'; do
  FAKE_REST_BODY="[$(pr 5 open null "$b" abc123)]"
  lookup "$b"
  assert_eq "placeholder-shaped branch '$b': found, and sent encoded" "0|$(list_call "$b")" "$RC|$(cat "$FAKE_GH_LOG")"
done
case "$(enc 'x{repo}y') $(enc repo-cleanup)" in
  *[!%0-9a-f\ ]*) echo "FAIL: an encoded name carries something other than %xx bytes"; FAIL=$((FAIL+1)) ;;
  *) echo "PASS: an encoded name is %xx bytes only, so no placeholder text survives"; PASS=$((PASS+1)) ;;
esac

# 7b2. A long run of one byte: od prints a repeated 16-byte line as a lone "*" unless told -v,
#      which cut the name short (confirmation review, 2026-11-24). The expectation is built
#      without od so it cannot share the defect.
LONG=$(printf 'a%.0s' 1 2 3 4 5 6 7 8); LONG="$LONG$LONG$LONG$LONG$LONG$LONG$LONG$LONG"   # 64 x a
LONG_ENC=${LONG//a/%61}
FAKE_REST_BODY="[$(pr 5 open null "$LONG" abc123)]"
lookup "$LONG"
assert_eq "64 identical bytes: found, every byte sent" \
  "0|api --paginate repos/{owner}/{repo}/pulls?state=all&per_page=100&head={owner}%3A$LONG_ENC" "$RC|$(cat "$FAKE_GH_LOG")"

# 7c. A fork's PR is never "this branch's PR": head repo must equal base repo. A deleted fork
#     has a null head repo and reads the same way — could not look, rc 2.
with_repos() { jq -c --arg h "$2" '.head.repo = (if $h == "" then null else {full_name: $h} end) | .base = {repo: {full_name: "o/r"}}' <<<"$1"; }
FAKE_REST_BODY="[$(with_repos "$(pr 5 open null feat/x abc123)" o/r)]"
lookup feat/x
assert_eq "same-repo PR with repos named: found" "0|5" "$RC|$(jq -r .number <<<"$OUT")"
FAKE_REST_BODY="[$(with_repos "$(pr 5 open null feat/x abc123)" fork/r)]"
lookup feat/x
assert_eq "a fork's PR under the same branch name: rc 2, nothing printed" "2|" "$RC|$OUT"
FAKE_REST_BODY="[$(with_repos "$(pr 5 open null feat/x abc123)" "")]"
lookup feat/x
assert_eq "a deleted fork (null head repo): rc 2, nothing printed" "2|" "$RC|$OUT"

# 7d. A URL whose owner or repo is a dot segment never reaches gh (gh does not normalise
#     the path).
for u in https://github.com/../../pull/1 https://github.com/./r/pull/1 https://github.com/o/../pull/1; do
  lookup "$u"
  assert_eq "dot-segment URL $u: rc 2, gh never called" "2|" "$RC|$(cat "$FAKE_GH_LOG")"
done

# 8. A flag-like ref never reaches gh.
lookup --repo
assert_eq "flag-like ref: rc 2, gh never called" "2|" "$RC|$(cat "$FAKE_GH_LOG")"

echo "$PASS passed, $FAIL failed"
EXPECTED_TOTAL=45
if [ $((PASS + FAIL)) -ne "$EXPECTED_TOTAL" ]; then
  echo "FAIL: assertion total is $((PASS + FAIL)), expected $EXPECTED_TOTAL"; exit 1
fi
[ "$FAIL" = 0 ] || exit 1
