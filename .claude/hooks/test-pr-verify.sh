#!/usr/bin/env bash
# Tests for pr-verify.sh — run from project root.
# Hermetic: stubs `gh` on PATH; no real GitHub calls made.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/pr-verify.sh"
PASS=0; FAIL=0

make_stub_gh() {
  local mode="$1"
  local dir
  dir=$(mktemp -d)
  cat > "$dir/gh" <<EOF
#!/usr/bin/env bash
case "$mode" in
  success)
    echo '{"number":42,"url":"https://github.com/x/y/pull/42","state":"OPEN","title":"My PR"}'
    exit 0;;
  fail)
    echo "error: no pull requests found" >&2
    exit 1;;
esac
EOF
  chmod +x "$dir/gh"
  printf '%s' "$dir"
}

run_hook() {
  local cmd="$1" gh_mode="${2:-success}"
  local input stubdir out
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  stubdir=$(make_stub_gh "$gh_mode")
  out=$(echo "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$stubdir"
  printf '%s' "$out"
}

assert_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF "$needle" <<<"$out"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected substring: $needle)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

assert_silent() {
  local name="$1" out="$2"
  if [ -z "$out" ]; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected silence)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

# Negative assertion — REQUIRED alongside the WARNING assertions below. A test that only
# checks for "could not verify" cannot distinguish "the extractor correctly returned empty"
# from "the extractor returned a WRONG ref that then failed lookup", because a stub that
# rejects the wrong ref produces the same WARNING either way. Pairing each WARNING with a
# not-contains on the ref the bug WOULD have produced is what makes these tests mutation-
# sensitive (2026-08-05 round-3 review: reverting a fix left the suite byte-identical).
assert_not_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF "$needle" <<<"$out"; then
    echo "FAIL: $name (unexpected substring present: $needle)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
  else
    echo "PASS: $name"; PASS=$((PASS+1))
  fi
}

# Test 1: gh pr create, gh succeeds → verified message with PR number
OUT=$(run_hook "gh pr create --title 'foo' --body 'bar'" "success")
assert_contains "gh pr create + gh succeeds: PR verified message" "PR state verified" "$OUT"
assert_contains "gh pr create + gh succeeds: PR number present" "42" "$OUT"
assert_contains "gh pr create + gh succeeds: URL present" "https://github.com" "$OUT"

# Test 2: gh pr merge succeeds → verified message with PR number
OUT=$(run_hook "gh pr merge 42 --squash --delete-branch" "success")
assert_contains "gh pr merge + gh succeeds: PR verified message" "PR state verified" "$OUT"
assert_contains "gh pr merge + gh succeeds: PR number present" "42" "$OUT"

# Test 2b: gh pr merge, gh fails → warning message
OUT=$(run_hook "gh pr merge 42 --squash" "fail")
assert_contains "gh pr merge + gh fails: warning emitted" "WARNING: could not verify" "$OUT"

# Test 3: non-matching command → silence
OUT=$(run_hook "git status" "success")
assert_silent "git status does not trigger pr-verify" "$OUT"

# Test 4: gh pr view (read, not write) → silence
OUT=$(run_hook "gh pr view 42" "success")
assert_silent "gh pr view (read command) does not trigger pr-verify" "$OUT"

# Test 5: gh pr close → verified message
OUT=$(run_hook "gh pr close 42" "success")
assert_contains "gh pr close triggers pr-verify" "PR state verified" "$OUT"

# Test 6: gh pr edit → verified message
OUT=$(run_hook "gh pr edit 42 --title 'updated title'" "success")
assert_contains "gh pr edit triggers pr-verify" "PR state verified" "$OUT"

# Run the hook against an MCP tool call (no .tool_input.command).
run_hook_mcp() {
  local tool="$1" gh_mode="${2:-success}"
  local input stubdir out
  input=$(jq -n --arg t "$tool" '{"tool_name":$t,"tool_input":{"title":"foo"},"tool_response":{"number":42}}')
  stubdir=$(make_stub_gh "$gh_mode")
  out=$(echo "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$stubdir"
  printf '%s' "$out"
}

# Test 7: MCP create_pull_request → verified message (resolves via gh pr view)
OUT=$(run_hook_mcp "mcp__github__create_pull_request" "success")
assert_contains "MCP create_pull_request triggers pr-verify" "PR state verified" "$OUT"
assert_contains "MCP create_pull_request: PR number present" "42" "$OUT"

# Test 8: a non-PR MCP tool → silence
OUT=$(run_hook_mcp "mcp__github__get_me" "success")
assert_silent "other MCP tool does not trigger pr-verify" "$OUT"

# Test 9: MCP merge_pull_request → verified message, PR number from tool_input.pullNumber
# (2026-07-18 harness-audit M8: the CLAUDE.md-preferred MCP merge path had no verification).
run_hook_mcp_merge() {
  local gh_mode="${1:-success}"
  local input stubdir out
  input=$(jq -n '{"tool_name":"mcp__github__merge_pull_request","tool_input":{"owner":"x","repo":"y","pullNumber":42},"tool_response":{"merged":true}}')
  stubdir=$(make_stub_gh "$gh_mode")
  out=$(echo "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$stubdir"
  printf '%s' "$out"
}
OUT=$(run_hook_mcp_merge "success")
assert_contains "MCP merge_pull_request triggers pr-verify" "PR state verified" "$OUT"
assert_contains "MCP merge_pull_request: PR number present" "42" "$OUT"

# Test 10: a quoted MENTION of a gh pr write command must stay silent
# (2026-07-18 harness-audit L10: loose matcher fired on strings inside quoted args).
OUT=$(run_hook 'echo "jq arg containing gh pr create text"' "success")
assert_silent "quoted gh-pr-create mention stays silent" "$OUT"

# Test 11: escaped-quote glue must not hide a real gh pr write (Phase 6 review, 2026-07-18
# audit) — naive quote-strip deletes `&& gh pr merge …` by pairing \" with the next quote.
OUT=$(run_hook 'echo "escaped \" quote" && gh pr merge 42 --squash --title "x"' "success")
assert_contains "escaped-quote glue: merge still verified" "PR state verified" "$OUT"

# Test 12: the PR number must be the one FOLLOWING `gh pr <subcommand>`, not the first number
# anywhere in the command (2026-07-18 audit /code-review, findings #3/#4). A wrapper like
# `timeout 30 gh pr merge 42` must resolve PR 42, not the wrapper's argument 30. The stub here
# REFLECTS the numeric arg it was called with (the fixed-42 stub above would mask the bug).
run_hook_reflect() {
  local cmd="$1" dir out
  dir=$(mktemp -d)
  cat > "$dir/gh" <<'GHEOF'
#!/usr/bin/env bash
for a in "$@"; do case "$a" in [0-9]*) printf '{"number":%s,"url":"u","state":"OPEN","title":"t"}\n' "$a"; exit 0;; esac; done
printf '{"number":"NOARG","url":"u","state":"OPEN","title":"t"}\n'; exit 0
GHEOF
  chmod +x "$dir/gh"
  out=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" \
        | PATH="$dir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$dir"
  printf '%s' "$out"
}
OUT=$(run_hook_reflect "timeout 30 gh pr merge 42 --squash")
assert_contains "PR number follows the subcommand, not the wrapper arg" "#42" "$OUT"

# Test 13: apostrophe-glue must not hide a real gh pr write (2026-07-18 audit /code-review,
# finding #1) — a bare `'` inside a double-quoted word is a literal, not a delimiter. The
# trailing `--body 'x'` supplies the single quote the lone apostrophe wrongly pairs with.
OUT=$(run_hook "echo \"don't\" && gh pr merge 42 --squash --body 'x'" "success")
assert_contains "apostrophe-glue: merge still verified" "PR state verified" "$OUT"

# Test 14: lib UNSOURCEABLE → silent (safe direction for a NON-blocking verifier). Run a COPY of
# the hook from a dir with no lib/ subdir; a real `gh pr create` must stay silent rather than
# emit a (possibly wrong) verification message with the scanner unavailable.
NOLIB=$(mktemp -d)
cp "$HOOK" "$NOLIB/pr-verify.sh"
stubdir=$(make_stub_gh "success")
OUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x"}}' | PATH="$stubdir:$PATH" bash "$NOLIB/pr-verify.sh" 2>/dev/null)
assert_silent "lib-missing stays silent (non-blocking safe direction)" "$OUT"
rm -rf "$stubdir" "$NOLIB"

# 2026-07-26 todo: cmd_gh_pr_number matched only a NUMERIC ref, so `gh pr merge/close/edit`
# given a branch name or URL fell through to the no-args `gh pr view` fallback and reported
# the CURRENT branch's PR instead. cmd_gh_pr_ref (the widened extractor) fixes this. The
# stub below REFLECTS the exact ref string passed to `gh pr view`, proving the right value
# was extracted and forwarded (not a stray digit or the wrong argument).
run_hook_reflect_ref() {
  local cmd="$1"
  local dir out
  dir=$(mktemp -d)
  cat > "$dir/gh" <<'GHEOF'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    -*|pr|view) continue ;;
  esac
  printf '{"number":99,"url":"u","state":"OPEN","title":"ref=%s"}\n' "$a"
  exit 0
done
printf '{"number":"NOARG","url":"u","state":"OPEN","title":"NOARG"}\n'
GHEOF
  chmod +x "$dir/gh"
  out=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" \
        | PATH="$dir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$dir"
  printf '%s' "$out"
}

# Test 15: a branch-name ref (`gh pr merge my-branch`) resolves THAT branch's PR.
OUT=$(run_hook_reflect_ref "gh pr merge my-branch")
assert_contains "branch-name ref resolves the named branch, not current" "ref=my-branch" "$OUT"

# Test 16: a URL ref (`gh pr merge <url>`) is passed through unchanged — gh itself
# resolves a PR URL to its number.
OUT=$(run_hook_reflect_ref "gh pr merge https://github.com/o/r/pull/42")
assert_contains "URL ref is forwarded to gh pr view unchanged" "ref=https://github.com/o/r/pull/42" "$OUT"

# Test 17: a flag BEFORE the ref (`gh pr merge --squash 42`) must still resolve 42 — the
# extractor has to skip flag tokens, not just grab the first number anywhere.
OUT=$(run_hook_reflect_ref "gh pr merge --squash 42")
assert_contains "flag-before-ref: ref still resolves after the flag" "ref=42" "$OUT"

# Test 18: an unresolvable ref (`gh pr merge --auto`, flags only, no positional ref) must
# emit the explicit could-not-verify WARNING and NEVER fall back to the no-args `gh pr view`
# lookup — that would silently report the CURRENT branch's PR as the one `--auto` acted on
# (the exact bug this todo fixes). The stub below returns a confident "success" for a
# genuinely no-args invocation, so a WARNING here proves that path was never taken.
NOARGS_DIR=$(mktemp -d)
cat > "$NOARGS_DIR/gh" <<'GHEOF'
#!/usr/bin/env bash
# argv is `pr view [<ref>] --json …` — $3 is either the ref or `--json`. A
# missing/flag-shaped $3 means no ref was passed (the buggy no-args current-
# branch lookup this test must never reach); a real $3 means a ref WAS passed.
case "${3:-}" in
  ""|-*) echo '{"number":7,"url":"u","state":"OPEN","title":"WRONG - current branch PR"}' ;;
  *) exit 1 ;;
esac
GHEOF
chmod +x "$NOARGS_DIR/gh"
OUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"gh pr merge --auto"}}' \
      | PATH="$NOARGS_DIR:$PATH" bash "$HOOK" 2>/dev/null)
assert_contains "unresolvable ref: WARNING, never the wrong current-branch fallback" "WARNING: could not verify" "$OUT"
rm -rf "$NOARGS_DIR"

# Test 19: a VALUE-taking flag before the ref (`gh pr edit --add-label bug 42`) must still
# resolve 42, not the flag's own value ("bug"). Caught in code review — the flag-skip loop
# originally recognized only single-token (boolean-style) flags, so a value-taking flag's
# separate value token was mistaken for the ref.
OUT=$(run_hook_reflect_ref "gh pr edit --add-label bug 42")
assert_contains "value-flag-before-ref: ref resolves past the flag's own value" "ref=42" "$OUT"

# Test 20: a compound command chaining two gh-pr write subcommands must NOT be answered at
# all. Taking the first match of each extractor was not sufficient: a first match that is
# then REJECTED is never retried against the next occurrence, so
# `gh pr close --delete-branch && gh pr merge 42` paired clause 1's SUBCOMMAND with clause
# 2's REF and reported them as a single invocation. cmd_gh_pr_ref now returns empty when
# the bare text holds more than one `gh pr <merge|close|edit>` occurrence — failing to
# "could not verify" rather than pairing across clauses at all.
OUT=$(run_hook_reflect_ref "gh pr merge 42 && gh pr close some-branch")
assert_contains "compound (both clauses have refs): could-not-verify, never a cross-clause pair" "WARNING: could not verify" "$OUT"
assert_not_contains "compound (both clauses have refs): clause-2 ref never forwarded" "ref=some-branch" "$OUT"

# Test 21: a VALUE-taking flag as the ENTIRE tail, with no positional ref at all
# (`gh pr edit --milestone 5`) must emit the could-not-verify WARNING, never resolve "5" as
# if it were a PR number. Caught in round-2 security review: ERE has no negative lookahead,
# so the extractor's regex alone cannot forbid a flag+value pair from being the final
# tokens — it matches that shape via the generic single-token fallback (misreading the
# flag's own value as the ref) unless a second check rejects a match whose second-to-last
# token is itself a known value-flag name. This is a realistic, common invocation shape
# (operating implicitly on the current branch's PR while also setting a field), and a
# milestone/label/comment value can easily coincide with a real PR number.
#
# Rewritten 2026-08-05 (round-3 review) onto run_hook_reflect_ref. The original used a stub
# that exited non-zero for ANY non-flag $3, so "correctly returned empty" and "wrongly
# returned 5, which then failed lookup" produced BYTE-IDENTICAL output — reverting the fix
# left this test green. The reflecting stub SUCCEEDS on whatever ref it is handed, so a
# regression surfaces as `ref=5` in the verified message instead of the WARNING.
OUT=$(run_hook_reflect_ref "gh pr edit --milestone 5")
assert_contains "value-flag-only tail: WARNING, never mistakes the flag's value for a PR ref" "WARNING: could not verify" "$OUT"
assert_not_contains "value-flag-only tail: the flag's value never reaches gh as a ref" "ref=5" "$OUT"

# Test 22: `--repo`/`-R` retargets ANOTHER repository, but the extractor has a single return
# channel and pr-verify.sh calls `gh pr view` with no --repo — so a forwarded ref would be
# resolved against the CURRENT repo. `gh pr merge --repo other-org/other-repo 42` would
# confidently report the LOCAL #42, an unrelated PR, under the "trust these values"
# framing — strictly worse than the numeric-only predecessor, which returned empty here.
# Both spellings must now degrade to could-not-verify.
OUT=$(run_hook_reflect_ref "gh pr merge --repo other-org/other-repo 42")
assert_contains "--repo long form: could-not-verify, never a cross-repo number collision" "WARNING: could not verify" "$OUT"
assert_not_contains "--repo long form: the ref is never resolved in the local repo" "ref=42" "$OUT"

OUT=$(run_hook_reflect_ref "gh pr merge -R other-org/other-repo 42")
assert_contains "-R short form: could-not-verify" "WARNING: could not verify" "$OUT"
assert_not_contains "-R short form: the repo VALUE is never mistaken for the ref" "ref=other-org/other-repo" "$OUT"

# Test 23 (SECURITY): cmd_gh_pr_write_subcommand matches MENTIONS, not invocations. That was
# acceptable while a false positive cost one LOCAL `gh pr view`; once the ref could be a URL,
# inert command TEXT could aim the lookup at any host. The trigger below is a shell COMMENT —
# it does nothing when the user runs it, and cmd_bare strips quotes, not comments — yet the
# hook performed the network I/O on its behalf. This stub RECORDS its argv, so the assertion
# is on whether `gh` was invoked at all, not merely on what the message said.
run_hook_record_argv() {
  local cmd="$1" log="$2"
  local dir out
  dir=$(mktemp -d)
  cat > "$dir/gh" <<GHEOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$log"
printf '{"number":99,"url":"u","state":"OPEN","title":"CALLED"}\n'
GHEOF
  chmod +x "$dir/gh"
  out=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" \
        | PATH="$dir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$dir"
  printf '%s' "$out"
}

EGRESS_LOG=$(mktemp)
OUT=$(run_hook_record_argv 'npm run something # gh pr merge https://exfil.attacker.example/o/r/pull/1' "$EGRESS_LOG")
assert_not_contains "URL ref on a non-github host NEVER reaches gh argv" "exfil.attacker.example" "$(cat "$EGRESS_LOG")"
assert_contains "URL ref on a non-github host: could-not-verify" "WARNING: could not verify" "$OUT"
rm -f "$EGRESS_LOG"

# Control for the test above: proves the argv recorder actually records, so the assertion
# there cannot pass vacuously — and that the github.com allow-path still forwards normally.
ALLOW_LOG=$(mktemp)
OUT=$(run_hook_record_argv 'gh pr merge https://github.com/o/r/pull/42' "$ALLOW_LOG")
assert_contains "recorder control: a github.com URL DOES reach gh argv" "https://github.com/o/r/pull/42" "$(cat "$ALLOW_LOG")"
rm -f "$ALLOW_LOG"

# Test 24: short-form VALUE-taking flags. `value_flags` and the post-hoc `prev` check
# covered long names only, so the flag's own VALUE was resolved as the ref. Most such values
# degrade to a failed lookup, but a numeric or real-branch value resolves a DIFFERENT REAL
# PR — the exact defect this hook exists to prevent. `-A -b -F -t -c -B` are value-taking
# everywhere they appear across `gh pr merge|close|edit` (gh 2.95.0) and boolean nowhere.
OUT=$(run_hook_reflect_ref "gh pr merge -b message 42")
assert_contains "-b (value-taking): could-not-verify" "WARNING: could not verify" "$OUT"
assert_not_contains "-b (value-taking): the flag's value is never the ref" "ref=message" "$OUT"

OUT=$(run_hook_reflect_ref "gh pr edit -B main 753")
assert_contains "-B (value-taking): could-not-verify" "WARNING: could not verify" "$OUT"
assert_not_contains "-B (value-taking): a real BRANCH value never resolves another PR" "ref=main" "$OUT"

OUT=$(run_hook_reflect_ref "gh pr merge -t subject 42")
assert_not_contains "-t (value-taking): the flag's value is never the ref" "ref=subject" "$OUT"

# Test 25: the BOOLEAN short flags must keep resolving the ref — the fix above adds the
# value-taking short forms to the `prev` rejection list ONLY, deliberately not to the regex
# alternation, precisely so the boolean single-token skip path is preserved.
OUT=$(run_hook_reflect_ref "gh pr merge -s 42")
assert_contains "-s (boolean): ref still resolves past the flag" "ref=42" "$OUT"
OUT=$(run_hook_reflect_ref "gh pr merge -d 42")
assert_contains "-d (boolean): ref still resolves past the flag" "ref=42" "$OUT"

# Test 26: the compound-clause shape the multi-occurrence guard exists for — clause 1
# supplies SUBCOMMAND (close), clause 2 supplies the only ref (42). Reporting them together
# describes an invocation that never happened.
OUT=$(run_hook_reflect_ref "gh pr close --delete-branch && gh pr merge 42")
assert_contains "compound (subcommand in clause 1, ref in clause 2): could-not-verify" "WARNING: could not verify" "$OUT"
assert_not_contains "compound: clause-2 ref never paired with clause-1 subcommand" "ref=42" "$OUT"

# Test 27: the two-clause shape with NO ref anywhere must also warn (not fall through to the
# no-args current-branch lookup).
OUT=$(run_hook_reflect_ref "gh pr close --delete-branch && gh pr merge")
assert_contains "compound with no ref at all: could-not-verify" "WARNING: could not verify" "$OUT"
assert_not_contains "compound with no ref: never the no-args current-branch fallback" "NOARG" "$OUT"

# Test 28: the `#` strip must not re-open dash-leading tokens the regex's first-char class
# excludes — `gh pr merge #-w` would otherwise reach `gh pr view` as the FLAG `-w`.
OUT=$(run_hook_reflect_ref "gh pr merge #-w")
assert_contains "dash-leading ref after the # strip: could-not-verify" "WARNING: could not verify" "$OUT"
assert_not_contains "dash-leading ref after the # strip: never forwarded as a flag" "ref=-w" "$OUT"

# Test 29: command-position anchor on cmd_gh_pr_ref itself. Unreachable through the hook —
# cmd_gh_pr_write_subcommand is anchored too, so `foogh pr merge 42` yields no SUBCOMMAND and
# the hook exits first — but cmd_gh_pr_ref is a fresh export in a lib seven hooks source, so
# assert the anchor at the level where a future caller would actually hit it.
. "$(cd "$(dirname "$HOOK")" && pwd)/lib/cmd-detect.sh"
assert_ref_empty() {
  local name="$1" cmd="$2" got
  got=$(cmd_gh_pr_ref "$cmd")
  if [ -z "$got" ]; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected empty ref, got: $got)"; FAIL=$((FAIL+1))
  fi
}
assert_ref_empty "cmd_gh_pr_ref is command-position anchored (foogh pr merge 42)" "foogh pr merge 42"
assert_ref_empty "cmd_gh_pr_ref rejects --repo=owner/repo spelling" "gh pr merge --repo=o/r 42"
assert_ref_empty "cmd_gh_pr_ref rejects -Rowner/repo spelling" "gh pr merge -Ro/r 42"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
