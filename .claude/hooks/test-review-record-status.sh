#!/usr/bin/env bash
# Tests for scripts/review-record-status.sh — run from project root.
#
# The script replaces the todo-executor's Step 10 inline checks, which Claude Code's worktree
# isolation refused (a sourced library and `$` values in a git-naming command; harness diagnosis
# item 2). `gh` is a stand-in on PATH and REVIEW_STAMP_ROOT a throwaway dir, so nothing real is read.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/review-record-status.sh"
PASS=0; FAIL=0
assert_eq() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name"; echo "  want: $want"; echo "  got:  $got"; FAIL=$((FAIL+1)); fi
}

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
SHA=0123456789abcdef0123456789abcdef01234567
# Stand-in gh: `pr view N --json headRefOid -q .headRefOid` and `pr diff N --name-only`.
mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'EOF'
#!/bin/sh
[ -n "${FAKE_GH_FAIL:-}" ] && exit 1
case "$1 $2" in
  "pr view") [ -z "${FAKE_GRAPHQL_BLOCKED:-}" ] || exit 1   # a cloud session refuses GraphQL
             printf '%s\n' "$FAKE_SHA" ;;
  "api repos/{owner}/{repo}/pulls/42")
             [ -z "${FAKE_REST_FAIL:-}" ] || exit 1
             printf '{"number":42,"html_url":"u","title":"t","state":"open","merged_at":null,"head":{"ref":"b","sha":"%s"}}\n' "$FAKE_SHA" ;;
  "pr diff") if [ -n "${FAKE_TOO_LARGE:-}" ]; then   # GitHub refuses a diff over 20,000 lines
               echo "could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of lines (20000) (PullRequest.diff too_large)" >&2
               exit 1
             fi
             [ -z "${FAKE_DIFF_FAIL:-}" ] || { echo "HTTP 502" >&2; exit 1; }
             printf 'b.ts\n\na.ts\nb.ts\n' ;;   # blank line and a duplicate: the gate drops both
  "api --paginate")   # the REST file list: `--jq .[].filename` prints one name per line
             [ "$3" = 'repos/{owner}/{repo}/pulls/42/files?per_page=100' ] || exit 1
             [ -z "${FAKE_FILES_FAIL:-}" ] || exit 1
             if [ -n "${FAKE_FILES_3000:-}" ]; then i=0; while [ "$i" -lt 3000 ]; do echo "f$i.ts"; i=$((i+1)); done
             else printf 'b.ts\na.ts\n'; fi ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$T/bin/gh"
DIGEST=$(printf 'a.ts\nb.ts\n' | shasum | cut -c1-16)

run() { PATH="$T/bin:$PATH" FAKE_SHA="$SHA" REVIEW_STAMP_ROOT="$T/stamps" bash "$SCRIPT" "$@"; }
field() { sed -n "s/^$1=//p"; }
rec() {   # rec <file> <agent> <verdict> <digest> [unresolved-count] [head]
  local n="${5:-0}" head="${6:-$SHA}" un='[]'
  [ "$n" -gt 0 ] && un='["x"]'
  mkdir -p "$T/stamps/$SHA"
  printf '{"head_sha":"%s","agent_type":"%s","verdict":"%s","unresolved":%s,"reviewed_files_digest":"%s"}\n' \
    "$head" "$2" "$3" "$un" "$4" > "$T/stamps/$SHA/$1.json"
}
reset() { rm -rf "$T/stamps"; }

# 1. No records: head and digest reported, nothing matches, nothing objects.
out=$(run 42); rc=$?
assert_eq "no records: exit 0" 0 "$rc"
assert_eq "head_sha from gh pr view" "$SHA" "$(field head_sha <<<"$out")"
assert_eq "digest = gate's digest (blank + duplicate dropped)" "$DIGEST" "$(field digest <<<"$out")"
assert_eq "no records: match empty" "" "$(field match <<<"$out")"
assert_eq "no records: objecting empty" "" "$(field objecting <<<"$out")"

# 2. A clean record with the matching digest is the match.
reset; rec code-reviewer code-reviewer clean "$DIGEST"
out=$(run 42)
assert_eq "clean + digest: match" "clean code-reviewer" "$(field match <<<"$out")"
assert_eq "clean + digest: nothing objects" "" "$(field objecting <<<"$out")"

# 3. advisory counts, same as the gate.
reset; rec code-reviewer code-reviewer advisory "$DIGEST"
assert_eq "advisory + digest: match" "advisory code-reviewer" "$(run 42 | field match)"

# 4. A clean record over the wrong files neither matches nor objects.
reset; rec code-reviewer code-reviewer clean ffffffffffffffff
out=$(run 42)
assert_eq "wrong digest: no match" "" "$(field match <<<"$out")"
assert_eq "wrong digest: not objecting" "" "$(field objecting <<<"$out")"

# 5. A findings record objects even beside a matching clean one; so does clean-with-unresolved.
reset; rec code-reviewer code-reviewer clean "$DIGEST"; rec server-reviewer server-reviewer findings "$DIGEST"
rec mobile-reviewer mobile-reviewer clean "$DIGEST" 1
out=$(run 42)
assert_eq "findings beside clean: match still set" "clean code-reviewer" "$(field match <<<"$out")"
assert_eq "findings + unresolved: both object" "mobile-reviewer server-reviewer" "$(field objecting <<<"$out")"

# 6. An unreadable record objects, named by its file.
reset; mkdir -p "$T/stamps/$SHA"; printf 'not json' > "$T/stamps/$SHA/ai-reviewer.json"
assert_eq "unreadable record objects by file name" "ai-reviewer" "$(run 42 | field objecting)"

# 7. A record whose head_sha is another commit is ignored.
reset; rec code-reviewer code-reviewer findings "$DIGEST" 0 fedcba9876543210fedcba9876543210fedcba98
out=$(run 42)
assert_eq "other head: not objecting" "" "$(field objecting <<<"$out")"
assert_eq "other head: no match" "" "$(field match <<<"$out")"

# 8. gh failing is an error, never an empty "nothing found".
reset
FAKE_GH_FAIL=1 run 42 >/dev/null 2>&1; rc=$?
assert_eq "gh failure: exit 3" 3 "$rc"

# 8b. GraphQL refused (a Claude Code cloud session): the head comes from the REST API instead,
#     and the answer is the same as over GraphQL. Both routes failing is still exit 3.
reset; rec code-reviewer code-reviewer clean "$DIGEST"
out=$(FAKE_GRAPHQL_BLOCKED=1 run 42); rc=$?
assert_eq "graphql refused: exit 0" 0 "$rc"
assert_eq "graphql refused: head_sha from REST" "$SHA" "$(field head_sha <<<"$out")"
assert_eq "graphql refused: the record still matches" "clean code-reviewer" "$(field match <<<"$out")"
FAKE_GRAPHQL_BLOCKED=1 FAKE_REST_FAIL=1 run 42 >/dev/null 2>&1; rc=$?
assert_eq "graphql refused and REST failing: exit 3" 3 "$rc"

# 8c. The digest is the gate's, whatever the caller's locale: byte order, not LC_COLLATE.
# A stand-in `sort` for a locale whose collation is not byte order (en_CA.UTF-8 puts `_x a b B`
# where C puts `B _x a b`). CI and the cloud container have only C locales installed, so the
# real thing cannot be reproduced there: this one sorts in REVERSE unless it is run with
# LC_ALL=C. A digest computed through it is therefore right only if the hook pins the locale.
LOCALE_BIN=$(mktemp -d)
REAL_SORT=$(command -v sort)
cat > "$LOCALE_BIN/sort" <<EOF
#!/bin/sh
if [ "\${LC_ALL:-}" = C ]; then exec "$REAL_SORT" "\$@"; else exec "$REAL_SORT" -r "\$@"; fi
EOF
chmod +x "$LOCALE_BIN/sort"
reset; rec code-reviewer code-reviewer clean "$DIGEST"
out=$(PATH="$LOCALE_BIN:$PATH" run 42)
assert_eq "non-C collation: digest is still the byte-order one" "$DIGEST" "$(field digest <<<"$out")"
assert_eq "non-C collation: the record still matches" "clean code-reviewer" "$(field match <<<"$out")"
rm -rf "$LOCALE_BIN"

# 8d. A PR over 20,000 diff lines: `gh pr diff --name-only` is refused (too_large), so the
#     names come from the REST file list and the digest is the same one.
reset; rec code-reviewer code-reviewer clean "$DIGEST"
out=$(FAKE_TOO_LARGE=1 run 42); rc=$?
assert_eq "too-large diff: exit 0" 0 "$rc"
assert_eq "too-large diff: same digest from the REST file list" "$DIGEST" "$(field digest <<<"$out")"
assert_eq "too-large diff: the record still matches" "clean code-reviewer" "$(field match <<<"$out")"
# Any OTHER gh failure is not retried: exit 3, as before.
FAKE_DIFF_FAIL=1 run 42 >/dev/null 2>&1; rc=$?
assert_eq "pr diff failing for another reason: exit 3, no REST retry" 3 "$rc"
FAKE_TOO_LARGE=1 FAKE_FILES_FAIL=1 run 42 >/dev/null 2>&1; rc=$?
assert_eq "too-large diff and the REST list failing: exit 3" 3 "$rc"
# GitHub's file list stops at 3,000 files; a list that long may be cut, so it is not trusted.
FAKE_TOO_LARGE=1 FAKE_FILES_3000=1 run 42 >/dev/null 2>&1; rc=$?
assert_eq "too-large diff with 3,000 listed files (GitHub's cap): exit 3" 3 "$rc"

# 9. Usage.
run >/dev/null 2>&1; rc=$?
assert_eq "no PR number: exit 2" 2 "$rc"
run abc >/dev/null 2>&1; rc=$?
assert_eq "non-numeric PR: exit 2" 2 "$rc"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
