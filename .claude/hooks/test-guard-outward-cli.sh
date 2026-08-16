#!/usr/bin/env bash
# Tests for guard-outward-cli.sh — run from anywhere. Feeds command STRINGS
# as JSON and asserts on the hook's decision output ONLY — never executes a
# real eas/railway/npm-publish/gh command (see
# docs/solutions/conventions/never-execute-an-outward-facing-cli-fragment-in-review-2026-08-16.md).
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/guard-outward-cli.sh"
PASS=0; FAIL=0

run_hook() { echo "$1" | bash "$HOOK" 2>/dev/null; }

# Two-sided per docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md:
# assert the SPECIFIC deny reason (not merely a generic deny marker), and pair
# every deny with a matching allow (negative control) below.
assert_deny() {  # $1=name $2=command $3=reason substring
  local name="$1" out; out=$(run_hook "$2")
  if echo "$out" | grep -q '"permissionDecision": "deny"' && echo "$out" | grep -qF -- "$3"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected deny containing: $3)"; echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
  fi
}
assert_allow() {  # $1=name $2=command
  local name="$1" out; out=$(run_hook "$2")
  if [ -z "$out" ]; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected no output / allow)"; echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
  fi
}

json() {  # $1=command
  printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$1"
}
# jq-encoded envelope for commands containing quotes/backslashes — hand-escaping
# into printf's %s is error-prone. Pass the RAW command; jq handles JSON escaping.
jsonc() {  # $1=raw command
  jq -cn --arg cmd "$1" '{tool_name:"Bash",tool_input:{command:$cmd}}'
}

# ---------- eas ----------
assert_deny "eas update denies" \
  "$(json 'eas update --branch preview --platform all')" \
  "eas update/publish/submit"
assert_deny "eas submit denies" \
  "$(json 'eas submit --platform ios')" \
  "eas update/publish/submit"
assert_allow "eas update:list allows (colon-namespaced, read-only)" \
  "$(json 'eas update:list')"
assert_allow "eas update:view allows (colon-namespaced, read-only)" \
  "$(json 'eas update:view abc123')"
assert_allow "eas whoami allows" \
  "$(json 'eas whoami')"
# Mutating eas update:* colon subcommands — a real bypass class found in review
# round 2: the colon-namespace exemption above is for READ-ONLY forms only.
assert_deny "eas update:rollback denies (mutating colon subcommand)" \
  "$(json 'eas update:rollback --branch preview --non-interactive')" \
  "eas update:delete/edit/republish"
assert_deny "eas update:delete denies (mutating colon subcommand)" \
  "$(json 'eas update:delete abc123')" \
  "eas update:delete/edit/republish"
assert_deny "eas update:republish denies (mutating colon subcommand)" \
  "$(json 'eas update:republish --group abc123 --branch preview')" \
  "eas update:delete/edit/republish"

# ---------- railway ----------
assert_deny "railway up denies" \
  "$(json 'railway up')" \
  "railway up/deploy/redeploy"
assert_deny "railway redeploy denies" \
  "$(json 'railway redeploy')" \
  "railway up/deploy/redeploy"
assert_allow "railway status allows" \
  "$(json 'railway status')"
assert_allow "railway logs allows" \
  "$(json 'railway logs')"
# Sub-subcommand mutations — a real bypass class found in review round 2: the
# top-level-verb check above doesn't reach a level deeper.
assert_deny "railway variable set denies (production secret mutation)" \
  "$(json 'railway variable set API_KEY=sk-live-abc --service api --environment production')" \
  "railway variable/vars/var set/delete"
assert_deny "railway service delete denies" \
  "$(json 'railway service delete --service api --yes')" \
  "railway service/environment delete"
assert_deny "railway environment delete denies" \
  "$(json 'railway environment delete --environment production --yes')" \
  "railway service/environment delete"
assert_allow "railway variable list allows (read-only)" \
  "$(json 'railway variable list --service api')"

# ---------- npm publish ----------
assert_deny "npm publish denies" \
  "$(json 'npm publish --access public')" \
  "npm publish"
assert_allow "npm run update:preview allows (different command word than npm publish)" \
  "$(jsonc 'npm run update:preview -- --message "ship it"')"
assert_allow "npm view allows" \
  "$(json 'npm view some-package')"

# ---------- gh pr merge (--auto carve-out) ----------
assert_deny "bare gh pr merge (no --auto) denies" \
  "$(json 'gh pr merge 42')" \
  "gh pr merge"
assert_deny "gh pr merge --squash (no --auto) denies" \
  "$(json 'gh pr merge --squash 42')" \
  "gh pr merge"
assert_allow "gh pr merge --auto ... allows (sanctioned /todo automerge form)" \
  "$(json 'gh pr merge 42 --auto --squash --delete-branch')"
assert_deny "gh pr merge with --auto only inside a QUOTED arg still denies (decoy)" \
  "$(jsonc 'gh pr merge 42 -b "use --auto next time"')" \
  "gh pr merge"
assert_deny "two gh pr merge occurrences denies (ambiguous, safe direction)" \
  "$(json 'gh pr merge 42 && gh pr merge 43 --auto')" \
  "more than one command-position"
# --auto consumed as the VALUE of a preceding value-taking flag is NOT a real
# --auto flag — gh never sees it as a flag, so this merges IMMEDIATELY.
assert_deny "gh pr merge --body --auto denies (--auto consumed as --body's VALUE, not a flag)" \
  "$(json 'gh pr merge 42 --body --auto')" \
  "does not count as --auto"
assert_deny "gh pr merge -b --auto denies (short form of the same decoy)" \
  "$(json 'gh pr merge 42 -b --auto')" \
  "does not count as --auto"
assert_allow "gh pr merge --auto --body x allows (--auto is its OWN token here, not a value)" \
  "$(json 'gh pr merge 42 --auto --body x')"
# --admin contradicts the --auto carve-out's own premise (CI + branch
# protection gating) — deny regardless of --auto.
assert_deny "gh pr merge --auto --admin denies (admin bypass contradicts the carve-out's premise)" \
  "$(json 'gh pr merge 42 --auto --admin --squash --delete-branch')" \
  "administrator privileges"
# Round-2 review found two more --admin spellings that slipped past a
# $CLAUSE/whitespace-only check: the pflag `=value` form, and a QUOTED
# --admin (quotes don't change what argv gh actually receives).
assert_deny "gh pr merge --auto --admin=true denies (=value spelling)" \
  "$(json 'gh pr merge 42 --auto --admin=true --squash --delete-branch')" \
  "administrator privileges"
assert_deny "gh pr merge --auto \"--admin\" denies (quoted --admin is still a real argv token)" \
  "$(jsonc 'gh pr merge 42 --auto "--admin" --squash --delete-branch')" \
  "administrator privileges"

# ---------- gh: other mutating subcommands ----------
assert_deny "gh pr close denies" \
  "$(json 'gh pr close 42')" \
  "mutating 'gh pr/release/repo'"
assert_deny "gh release create denies" \
  "$(json 'gh release create v1.0.0')" \
  "mutating 'gh pr/release/repo'"
assert_deny "gh repo delete denies" \
  "$(json 'gh repo delete some-org/some-repo')" \
  "mutating 'gh pr/release/repo'"
assert_allow "gh pr view allows" \
  "$(json 'gh pr view 42')"
assert_allow "gh pr checks allows" \
  "$(json 'gh pr checks 42')"
assert_allow "gh pr create allows (deliberate judgment-call carve-out)" \
  "$(jsonc 'gh pr create --title x --body y')"
assert_allow "gh pr comment allows (deliberate judgment-call carve-out)" \
  "$(jsonc 'gh pr comment 42 --body "lgtm"')"

# ---------- gh api: mutating HTTP method ----------
# gh api can reach the SAME PR-merge action the dedicated clause above gates,
# via a different subcommand — a real bypass class found in review round 2.
assert_deny "gh api -X PUT denies (arbitrary REST mutation, incl. a PR merge via a different subcommand)" \
  "$(json 'gh api -X PUT repos/xertox1234/OCRecipes/pulls/42/merge')" \
  "mutating HTTP method"
assert_deny "gh api --method POST denies" \
  "$(json 'gh api --method POST repos/xertox1234/OCRecipes/issues/1/comments')" \
  "mutating HTTP method"
assert_allow "gh api with NO method (default GET) allows" \
  "$(json 'gh api repos/xertox1234/OCRecipes/pulls/42')"
assert_allow "gh api -X GET allows (explicit read)" \
  "$(json 'gh api -X GET repos/xertox1234/OCRecipes/pulls/42')"
# Round-2 review found two more bypasses: the glued curl-style short-flag
# spelling (-XPOST, no separator), and a read-only FIRST gh api clause
# shadowing a mutating SECOND one via head -1.
assert_deny "gh api -XPOST denies (glued short-flag spelling, no separator)" \
  "$(json 'gh api -XPOST repos/xertox1234/OCRecipes/pulls/42/merge')" \
  "mutating HTTP method"
assert_deny "gh api -Xpost denies (glued, lowercase)" \
  "$(json 'gh api -Xpost repos/xertox1234/OCRecipes/pulls/42/merge')" \
  "mutating HTTP method"
assert_deny "two gh api occurrences denies (ambiguous — a read-only first call must not shadow a mutating second one)" \
  "$(json 'gh api repos/xertox1234/OCRecipes/pulls/42 && gh api -X PUT repos/xertox1234/OCRecipes/pulls/42/merge')" \
  "more than one command-position 'gh api'"

# ---------- false-positive controls: mention inside a quoted string ----------
assert_allow "phrase inside a commit message passes through (quoted mention, not an invocation)" \
  "$(jsonc 'git commit -m "add eas update guard, gh pr merge test, npm publish check"')"
assert_allow "unrelated command passes through untouched" \
  "$(json 'ls -la')"

# ---------- bypass env (ambient) ----------
out=$(ALLOW_OUTWARD_CLI=1 run_hook "$(json 'eas update --branch preview --platform all')")
if [ -z "$out" ]; then
  echo "PASS: ambient ALLOW_OUTWARD_CLI=1 bypasses the deny"; PASS=$((PASS+1))
else
  echo "FAIL: ambient ALLOW_OUTWARD_CLI=1 bypasses the deny"; echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi

# ---------- bypass: inline "ALLOW_OUTWARD_CLI=1 <command>" prefix on the command STRING ----------
# (the documented "one command" escape — an env var typed as a Bash prefix
# never reaches the hook's own process env, which runs before the gated
# command; only recognizing the literal string prefix honors it.)
assert_allow "inline ALLOW_OUTWARD_CLI=1 prefix bypasses the deny" \
  "$(json 'ALLOW_OUTWARD_CLI=1 eas update --branch preview --platform all')"
# Negative control: the SAME command with NO prefix and no ambient var denies —
# proves the allow above is the prefix recognition firing, not a fixture that
# never triggers a deny in the first place.
assert_deny "same command with no bypass still denies (negative control)" \
  "$(json 'eas update --branch preview --platform all')" \
  "eas update/publish/submit"
# The prefix must be at the true start of the command, not merely present —
# a decoy elsewhere in the string must not bypass.
assert_deny "ALLOW_OUTWARD_CLI=1 NOT at the start does not bypass" \
  "$(json 'echo x && ALLOW_OUTWARD_CLI=1 eas update --branch preview --platform all')" \
  "eas update/publish/submit"

# ---------- jq-missing fallback (mirrors test-git-safety.sh's NOJQ_BIN fixture) ----------
NOJQ_BIN=$(mktemp -d)
for b in bash cat grep; do
  ln -s "$(command -v "$b")" "$NOJQ_BIN/$b"
done
trap 'rm -rf "$NOJQ_BIN"' EXIT

out=$(echo "$(json 'eas update --branch preview --platform all')" | env PATH="$NOJQ_BIN" "$NOJQ_BIN/bash" "$HOOK" 2>/dev/null)
if echo "$out" | grep -q 'permissionDecision":"deny"'; then
  echo "PASS: jq-less environment fails closed for an outward-CLI-shaped command"; PASS=$((PASS+1))
else
  echo "FAIL: jq-less environment fails closed for an outward-CLI-shaped command"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi

out=$(echo "$(json 'ls -la')" | env PATH="$NOJQ_BIN" "$NOJQ_BIN/bash" "$HOOK" 2>/dev/null)
if [ -z "$out" ]; then
  echo "PASS: jq-less benign command stays allowed"; PASS=$((PASS+1))
else
  echo "FAIL: jq-less benign command stays allowed"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi

# ---------- lib-unsourceable fallback (jq IS present, lib/cmd-detect.sh is NOT) ----------
# A prior version of this hook silently ALLOWED every command here on the
# false premise that "the no-jq path already covers it" — a DIFFERENT
# condition (jq present, lib missing) that path never runs for. Reproduce the
# broken-install shape: copy ONLY the hook script into a fresh dir with no
# sibling lib/, so `. "$HERE/lib/cmd-detect.sh"` fails to source.
NOLIB_DIR=$(mktemp -d)
cp "$HOOK" "$NOLIB_DIR/guard-outward-cli.sh"
trap 'rm -rf "$NOJQ_BIN" "$NOLIB_DIR"' EXIT

out=$(echo "$(json 'eas update --branch preview --platform all')" | bash "$NOLIB_DIR/guard-outward-cli.sh" 2>/dev/null)
if echo "$out" | grep -q '"permissionDecision": "deny"'; then
  echo "PASS: lib-unsourceable environment fails closed for an outward-CLI-shaped command"; PASS=$((PASS+1))
else
  echo "FAIL: lib-unsourceable environment fails closed for an outward-CLI-shaped command"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi

out=$(echo "$(json 'ls -la')" | bash "$NOLIB_DIR/guard-outward-cli.sh" 2>/dev/null)
if [ -z "$out" ]; then
  echo "PASS: lib-unsourceable benign command stays allowed"; PASS=$((PASS+1))
else
  echo "FAIL: lib-unsourceable benign command stays allowed"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
