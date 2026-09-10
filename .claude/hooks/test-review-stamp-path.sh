#!/usr/bin/env bash
# Tests for lib/review-stamp-path.sh — run from project root.
set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0

assert_eq() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name"; echo "  want: $want"; echo "  got:  $got"; FAIL=$((FAIL+1)); fi
}
assert_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF -- "$needle" <<<"$out"; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name (expected substring: $needle)"; echo "  got: $out"; FAIL=$((FAIL+1)); fi
}

. "$HOOKS_DIR/lib/review-stamp-path.sh"

# 1. Test seam wins and appends the SHA segment.
out=$(REVIEW_STAMP_ROOT=/tmp/xyz review_stamp_dir abc1234)
assert_eq "REVIEW_STAMP_ROOT honoured" "/tmp/xyz/abc1234" "$out"

# 2. Real path is repo-keyed and SHA-suffixed.
out=$(review_stamp_dir deadbee)
assert_contains "real path is under the stamp root" "/tmp/ocrecipes-review-stamps-" "$out"
assert_contains "real path ends with the SHA" "/deadbee" "$out"

# 3. THE load-bearing property: two SHAs never share a directory. Linked worktrees share
#    --git-common-dir, so a /todo executor's reviewers land under the same repo key; only
#    this segment stops a background executor clobbering an interactive session's stamp.
a=$(review_stamp_dir aaaaaaa); b=$(review_stamp_dir bbbbbbb)
if [ "$a" != "$b" ]; then echo "PASS: distinct SHAs get distinct dirs"; PASS=$((PASS+1))
else echo "FAIL: distinct SHAs collided"; FAIL=$((FAIL+1)); fi

# 4. Same SHA is stable across calls (writer and reader must agree).
assert_eq "same SHA is stable" "$(review_stamp_dir cafe123)" "$(review_stamp_dir cafe123)"

# 5. Missing argument is an error, not a silent shared directory.
if ( review_stamp_dir >/dev/null 2>&1 ); then
  echo "FAIL: missing SHA should error"; FAIL=$((FAIL+1))
else echo "PASS: missing SHA errors"; PASS=$((PASS+1)); fi

echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
