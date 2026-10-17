#!/usr/bin/env bash
# Tests for nudge-dependency-add.sh — run from project root. Hermetic: no git, no network.
set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HOOKS_DIR/nudge-dependency-add.sh"
PASS=0; FAIL=0

run_hook() {
  jq -n --arg c "$1" '{"tool_name":"Bash","session_id":"itest-nudge-dep","tool_input":{"command":$c}}' | bash "$HOOK" 2>/dev/null
}
ctx() { run_hook "$1" | jq -r '.hookSpecificOutput.additionalContext // empty'; }

expect_nudge() {
  local name="$1" cmd="$2" out
  out=$(ctx "$cmd")
  if grep -qF "[DEPENDENCY]" <<<"$out"; then echo "PASS: nudges on: $name"; PASS=$((PASS+1))
  else echo "FAIL: nudges on: $name (no [DEPENDENCY] in: ${out:-<empty>})"; FAIL=$((FAIL+1)); fi
}
expect_silent() {
  local name="$1" cmd="$2" out
  out=$(run_hook "$cmd")
  if [ -z "$out" ]; then echo "PASS: silent on: $name"; PASS=$((PASS+1))
  else echo "FAIL: silent on: $name (got: $(printf '%s' "$out" | head -c 160))"; FAIL=$((FAIL+1)); fi
}

# Positive shapes — a package name after the add verb.
expect_nudge "npm install <pkg>"            'npm install lodash'
expect_nudge "npm i <pkg> with flag"         'npm i -D vitest-fetch-mock'
expect_nudge "npm add scoped pkg"            'npm add @sentry/node'
expect_nudge "npx expo install <pkg>"        'npx expo install expo-haptics'
expect_nudge "yarn add <pkg>"                'yarn add date-fns'
expect_nudge "pnpm add <pkg>"                'pnpm add zod'
expect_nudge "chained after cd"              'cd client && npm install react-native-svg'
expect_nudge "inside a substitution"         'echo "$(npm install left-pad)"'
# Shapes the #1476 review measured as silent (2026-10-17): whitespace runs, a tab, wrappers the
# shell absorbs, flags between npx and expo, and an npm global option before the verb.
expect_nudge "double spaces"                 'npm  install  lodash'
expect_nudge "tab between words"             "$(printf 'npm install\tlodash')"
expect_nudge "brace group"                   '{ npm install lodash; }'
expect_nudge "sudo wrapper"                  'sudo npm install lodash'
expect_nudge "time wrapper"                  'time npm install lodash'
expect_nudge "npx --yes expo install"        'npx --yes expo install expo-camera'
expect_nudge "npx -y expo install"           'npx -y expo install expo-camera'
expect_nudge "npm --prefix x install"        'npm --prefix client install lodash'

# Negative shapes — lockfile installs, global installs, unrelated commands, quoted mentions.
expect_silent "bare npm install"             'npm install'
expect_silent "npm ci"                       'npm ci'
expect_silent "npm install flags only"       'npm install --ignore-scripts'
expect_silent "npm install -g"               'npm install -g eas-cli'
expect_silent "npm install --global"         'npm install --global typescript'
expect_silent "npm run script"               'npm run lint'
expect_silent "npx expo install --check"     'npx expo install --check'
expect_silent "npx --yes expo install --fix" 'npx --yes expo install --fix'
expect_silent "npm --prefix x install (bare)" 'npm --prefix client install'
expect_silent "sudo npm ci"                  'sudo npm ci'
# A global flag BEFORE the verb (#1478 review): the pre-verb option loop must still see it.
expect_silent "npm -g install <pkg>"         'npm -g install lodash'
expect_silent "npm --global install <pkg>"   'npm --global install lodash'
expect_silent "sudo npm -g install <pkg>"    'sudo npm -g install eas-cli'
expect_silent "quoted mention in commit msg" 'git commit -m "docs: say npm install foo in README"'
# Non-Bash tool name must exit silently even with a matching command.
out=$(jq -n '{"tool_name":"Edit","tool_input":{"command":"npm install lodash"}}' | bash "$HOOK" 2>/dev/null)
if [ -z "$out" ]; then echo "PASS: silent on: Edit tool with a matching command"; PASS=$((PASS+1)); else echo "FAIL: silent on: Edit tool"; FAIL=$((FAIL+1)); fi
# Malformed input must exit 0 and print nothing (fail open, silent).
out=$(printf 'not json' | bash "$HOOK" 2>/dev/null); rc=$?
if [ "$rc" = 0 ] && [ -z "$out" ]; then echo "PASS: fail-open on malformed input"; PASS=$((PASS+1)); else echo "FAIL: fail-open on malformed input (rc=$rc)"; FAIL=$((FAIL+1)); fi

echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
