#!/usr/bin/env bash
# Tests for git-safety.sh — run from anywhere. Uses a fake `gh` on PATH and a
# hand-built registry; real git only for the write-shape fixture.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/git-safety.sh"
PASS=0; FAIL=0

# Hermeticity: an inherited GIT_DIR would make the real-git fixture below target
# the CALLER's repo (docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md).
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
CALLER_STATE_BEFORE=$({ git rev-parse HEAD 2>/dev/null; git status --porcelain 2>/dev/null; } || echo not-a-repo)

run_hook() { echo "$1" | bash "$HOOK" 2>/dev/null; }

assert_deny() {
  local name="$1" out; out=$(run_hook "$2")
  if echo "$out" | grep -q '"permissionDecision": "deny"'; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected deny)"; echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
  fi
}
assert_allow() {
  local name="$1" out; out=$(run_hook "$2")
  if [ -z "$out" ]; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name (expected no output)"; echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1)); fi
}
# Advisor must WARN (additionalContext containing $3) and must NOT deny.
assert_warn_contains() {
  local name="$1" out; out=$(run_hook "$2")
  if echo "$out" | grep -q '"permissionDecision"'; then
    echo "FAIL: $name (advisor must never block)"; FAIL=$((FAIL+1)); return
  fi
  if echo "$out" | grep -q '"additionalContext"' && echo "$out" | grep -qF "$3"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected additionalContext containing: $3)"
    echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
  fi
}

json() {  # $1=session $2=cwd $3=command
  printf '{"tool_name":"Bash","session_id":"%s","cwd":"%s","tool_input":{"command":"%s"}}' "$1" "$2" "$3"
}
# jq-encoded envelope for commands containing backslashes / bash $'…' where hand-escaping
# into printf's %s is error-prone (a lone \' is invalid JSON and makes the hook bail to a
# spurious ALLOW). Pass the RAW command; jq handles JSON escaping.
jsonc() {  # $1=session $2=cwd $3=raw command
  jq -cn --arg s "$1" --arg c "$2" --arg cmd "$3" \
    '{tool_name:"Bash",session_id:$s,cwd:$c,tool_input:{command:$cmd}}'
}

# ---------- fake gh ----------
FAKE_BIN=$(mktemp -d)
cat > "$FAKE_BIN/gh" <<'EOF'
#!/usr/bin/env bash
if [ "${FAKE_GH_EXIT:-0}" != "0" ]; then
  echo "${FAKE_GH_STDERR:-no pull requests found}" >&2
  exit "$FAKE_GH_EXIT"
fi
printf '{"number":520,"state":"%s","mergedAt":"2026-07-16T00:00:00Z"}\n' "${FAKE_GH_STATE:-MERGED}"
exit 0
EOF
chmod +x "$FAKE_BIN/gh"
export PATH="$FAKE_BIN:$PATH"

# ---------- registry fixtures ----------
SESSION="test-gitsafety-$$"
REG_DIR="/tmp/claude-worktree-contracts-$SESSION"
WT_A='/Users/x/projects/OCRecipes/.claude/worktrees/agent-aaa'
MAIN='/Users/x/projects/OCRecipes'
mkdir -p "$REG_DIR"
printf '%s' "$WT_A" > "$REG_DIR/aaaa000000000001"
NEST_TMP=""
NOJQ_BIN=""
cleanup() { rm -rf "$REG_DIR" "$FAKE_BIN" ${NEST_TMP:+"$NEST_TMP"} ${NOJQ_BIN:+"$NOJQ_BIN"}; }
trap cleanup EXIT

# ---------- fast path / no-op ----------
assert_allow "plain command with no registry is silent" \
  "$(json no-registry-session "$MAIN" 'echo hi')"
assert_allow "mutating git with NO registry is allowed (fallback is the file guard's job)" \
  "$(json no-registry-session "$MAIN" 'git commit -m x')"

# ---------- contract branch: mutating git ----------
assert_deny "registry: git commit with main-checkout cwd is denied" \
  "$(json "$SESSION" "$MAIN" 'git commit -m x')"
assert_deny "registry: git mv with main-checkout cwd is denied (the incident)" \
  "$(json "$SESSION" "$MAIN" 'git mv a.ts b.ts')"
assert_allow "registry: git commit inside the registered worktree is allowed" \
  "$(json "$SESSION" "$WT_A" 'git commit -m x')"
assert_allow "registry: git -C <worktree> commit from main cwd is allowed" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A commit -m x")"
assert_deny "registry: git -C <main> commit from worktree cwd is denied" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN commit -m x")"
assert_allow "registry: read-only git anywhere is allowed" \
  "$(json "$SESSION" "$MAIN" 'git status && git diff HEAD')"
assert_allow "registry: git in /tmp scratch repo is allowlisted" \
  "$(json "$SESSION" '/tmp/scratch-repo' 'git commit -m probe')"

# Compound commands: EVERY mutating segment's effective repo must validate — a
# benign -C elsewhere in the command must not launder a main-checkout mutation.
assert_deny "registry: compound — mutating -C main first, benign -C worktree second" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN commit -m x && git -C $WT_A status")"
assert_deny "registry: compound — benign -C worktree first, mutating -C main second" \
  "$(json "$SESSION" "$WT_A" "git -C $WT_A status && git -C $MAIN commit -m x")"
assert_allow "registry: compound — both mutating segments target the worktree" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A mv a b && git -C $WT_A commit -m x")"

# Dot segments in a -C target must not prefix-match a registered worktree.
assert_deny "registry: git -C with .. escaping the worktree is denied" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A/../.. commit -m x")"

# Single-quoted -C targets must be extracted too (only double quotes were stripped).
assert_deny "registry: single-quoted git -C main checkout is denied" \
  "$(json "$SESSION" "$WT_A" "git -C '$MAIN' commit -m x")"
assert_allow "registry: single-quoted git -C worktree is allowed" \
  "$(json "$SESSION" "$MAIN" "git -C '$WT_A' commit -m x")"

# Quote-AWARE -C extraction (git_c_target). The old `tr -d` + greedy `.*git…-C`
# strip mined the LAST `git -C` anywhere in the string, so a commit MESSAGE that
# mentions `git -C <path>` was read as a real -C override. That is a BIDIRECTIONAL
# bug: a main-path decoy fabricates a violation (false-DENY), and a registered-
# worktree decoy launders a real main-checkout mutation past the gate (BYPASS).
# The tokenizer emits ONLY the FIRST command-position git's -C arg (flag must be
# UNQUOTED; value may be quoted), so a quoted message — one atomic token — is
# ignored. See docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md.
# 2x2: {real -C present?} x {message decoys main | worktree}.
assert_allow "registry: commit msg mentioning 'git -C <main>' is not a real -C (was false-DENY)" \
  "$(json "$SESSION" "$WT_A" "git commit -m \\\"see git -C $MAIN commit\\\"")"
assert_deny "registry: real -C <main> wins over a worktree decoy in the message (was BYPASS)" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN commit -m \\\"see git -C $WT_A\\\"")"
assert_allow "registry: real -C <worktree> is not overridden by a main decoy in the message (was false-DENY)" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A commit -m \\\"see git -C $MAIN\\\"")"
assert_deny "registry: main-checkout commit is not laundered by a worktree decoy in the message (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" "git commit -m \\\"ref git -C $WT_A\\\"")"

# Separator-complete gate (the mutating-git "front door"). The old whole-command
# MUTATING_GIT_RE gate anchored the command position on `(^|&&|\|\||;)` — no single
# `|` or `&` — so a mutating git preceded by a pipe/background (`echo x | git commit -F -`,
# a normal pattern) NEVER fired the gate. Fixed by a cheap permissive `*git*` pre-filter
# plus the anchored, precise per-segment SEG_RE. (Quote-AWARE segmentation — the `-c`-value
# fracture — and `$'…'` completeness are a separate tracked follow-up, deferred because a
# PARTIAL quote-aware split regressed on `$'…'`:
# todos/P2-2026-07-19-git-safety-frontdoor-quote-aware-segmentation.md.)
assert_deny "registry: piped mutating git in main checkout is denied (gate boundary, was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'echo msg | git commit -F -')"
assert_deny "registry: backgrounded mutating git in main checkout is denied (gate boundary, was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'foo & git commit -m x')"
# Guards: the permissive gate must not over-DENY a benign read-only pipe, and an
# after-verb metachar in a message (the quote-blind split's fragment keeps `git … <verb>`,
# so it still resolves the real -C) must stay ALLOWED.
assert_allow "registry: read-only 'git log | grep' stays allowed under the permissive gate" \
  "$(json "$SESSION" "$MAIN" 'git log | grep x')"
assert_allow "registry: worktree -C commit with a ';'-containing quoted message stays allowed" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A commit -m \\\"fixed a; also b\\\"")"

# Quote-torture corpus (shared with split_segments + git_c_target + emit_write_targets so
# the three scanners cannot drift — the drift that caused the $'…' regression). Bash ANSI-C
# $'…' quoting: \' is an ESCAPED apostrophe that does NOT close the span. A $'…'-blind
# scanner inverts state on it and swallows real separators, hiding a main-checkout mutation.
assert_deny "registry: $'…' message before && cannot hide a -C-main reset (was BYPASS)" \
  "$(jsonc "$SESSION" "$WT_A" "git -C $WT_A commit -m \$'don\\'t' && git -C $MAIN reset --hard HEAD~1")"
assert_deny "registry: ANSI-C $'…' inside a -c value does not fracture the segment" \
  "$(jsonc "$SESSION" "$WT_A" "git -C $MAIN -c core.pager=\$'a;b' commit -m x")"
assert_deny "registry: $'…' env-assignment value does not desync the -C extractor" \
  "$(jsonc "$SESSION" "$WT_A" "FOO=\$'a\\'b' git -C $MAIN commit -m x")"
# Guards: a benign $'…' message (with an escaped apostrophe) on a worktree -C stays ALLOWED.
assert_allow "registry: benign $'…' apostrophe message on a worktree -C stays allowed" \
  "$(jsonc "$SESSION" "$MAIN" "git -C $WT_A commit -m \$'don\\'t ship'")"
# $$'…' — bash pairs a run of $ into $$ (PID); only an UNPAIRED $ before ' is ANSI-C. An
# EVEN run ($$'…\\') is a NORMAL single quote in bash (\\' closes), so a scanner that enters
# ANSI-C on the 2nd $ desyncs and swallows the real && separator (an auditor-found regression).
assert_deny "registry: even-dollar-run \$\$'…\\' cannot hide a -C-main reset (was BYPASS)" \
  "$(jsonc "$SESSION" "$WT_A" "git -C $WT_A commit -m \$\$'a\\' && git -C $MAIN reset --hard HEAD~1")"
assert_deny "registry: 4-dollar-run \$\$\$\$'…\\' also cannot hide a -C-main reset" \
  "$(jsonc "$SESSION" "$WT_A" "git -C $WT_A commit -m \$\$\$\$'a\\' && git -C $MAIN reset --hard HEAD~1")"
assert_allow "registry: benign \$\$'ok' (PID + normal single quote) stays allowed" \
  "$(jsonc "$SESSION" "$WT_A" "git -C $WT_A commit -m \$\$'ok'")"

# ---------- chained / interleaved global -C (bypass #2 + the -c-before-C sibling) ----------
# Real git applies each -C as a CUMULATIVE chdir — empirically `git -C /a -C /b` targets
# /b and `git -C /a -C rel` targets /a/rel — so the LAST absolute -C wins. The old
# MUTATING_GIT_SEG_RE had `(-C…)?` (0-or-1) and the old git_c_target emitted only the
# FIRST -C, so a chained -C either failed the regex entirely (skipped → ALLOW) or resolved
# to the wrong (first, often allowlisted) target. Both are FALSE-NEGATIVES. Truth table
# (all -C absolute; last absolute wins → the effective repo the gate must judge):
#   -C /tmp   -C <main>  → <main>  DENY   (was ALLOW: bypass #2)
#   -C <wt>   -C <main>  → <main>  DENY   (was ALLOW)
#   -C <main> -C <wt>    → <wt>    ALLOW  (fail-open guard: last wins to the worktree)
#   -C /tmp   -C <wt>    → <wt>    ALLOW
assert_deny "registry: chained -C, last absolute is main (-C /tmp -C main) is denied (was BYPASS)" \
  "$(json "$SESSION" "$WT_A" "git -C /tmp -C $MAIN commit -m x")"
assert_deny "registry: chained -C, last absolute is main (-C wt -C main) is denied (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A -C $MAIN commit -m x")"
assert_allow "registry: chained -C, last absolute is the worktree (-C main -C wt) is allowed" \
  "$(json "$SESSION" "$MAIN" "git -C $MAIN -C $WT_A commit -m x")"
assert_allow "registry: chained -C, last absolute is the worktree (-C /tmp -C wt) is allowed" \
  "$(json "$SESSION" "$MAIN" "git -C /tmp -C $WT_A commit -m x")"
# Interleaved: a -c value BEFORE the -C. Real git accepts global options in any order; the
# old `-C-before-c` regex rejected this (→ skipped → ALLOW) — a sibling of the same grammar gap.
assert_deny "registry: interleaved -c value then -C main is denied (was BYPASS, sibling of chained -C)" \
  "$(json "$SESSION" "$WT_A" "git -c core.pager=x -C $MAIN commit -m x")"
assert_allow "registry: interleaved -c value then -C worktree is allowed" \
  "$(json "$SESSION" "$MAIN" "git -c core.pager=x -C $WT_A commit -m x")"
# Control (already worked before this change): -C before -c must STAY denied for a main target.
assert_deny "registry: -C main then -c value (original ordering) stays denied" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN -c core.pager=x commit -m x")"
# Invariant guard (git_c_target's only fail-open surface): a -C AFTER the verb is the
# SUBCOMMAND's own option — `git commit -C HEAD` reuses a commit's message — NOT git's
# global -C, so it must never be mined as a directory target. Extraction stops at the verb.
assert_allow "registry: post-verb 'commit -C HEAD' is the subcommand's -C, not a repo (stops at verb)" \
  "$(json "$SESSION" "$WT_A" "git commit -C HEAD")"
assert_allow "registry: global -C worktree then post-verb '-C HEAD' still resolves to the worktree" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A commit -C HEAD")"

# Documented residual (a test either way, per the todo): glued -C<path> with no space. Real
# git REJECTS this form (`unknown option: -C<path>`, EXIT 129) — no mutation happens — so
# leaving it unmatched (→ ALLOW) is SAFE, not a bypass. Pinned so a future change cannot
# silently start (mis)treating the glued form as a real -C without a deliberate test update.
assert_allow "registry: glued -C<main> (git rejects the form, EXIT 129) stays allowed (documented residual)" \
  "$(json "$SESSION" "$MAIN" "git -C$MAIN commit -m x")"

# Modern/omitted mutating verbs.
assert_deny "registry: git switch in main checkout is denied" \
  "$(json "$SESSION" "$MAIN" 'git switch -c feature')"
assert_deny "registry: git pull in main checkout is denied" \
  "$(json "$SESSION" "$MAIN" 'git pull origin main')"
assert_deny "registry: git revert in main checkout is denied" \
  "$(json "$SESSION" "$MAIN" 'git revert HEAD')"

# Unresolvable effective repo while a registry is active must fail CLOSED.
assert_deny "registry: mutating git with empty cwd fails closed" \
  "$(json "$SESSION" "" 'git commit -m x')"

# Inline env-prefix bypass must work as documented ('one command'): the hook
# process does not inherit inline assignments, so it must recognize the prefix.
assert_allow "registry: inline SKIP_WORKTREE_CONTRACT=1 prefix bypasses" \
  "$(json "$SESSION" "$MAIN" 'SKIP_WORKTREE_CONTRACT=1 git commit -m x')"

# Bypass.
out=$(echo "$(json "$SESSION" "$MAIN" 'git commit -m x')" | SKIP_WORKTREE_CONTRACT=1 bash "$HOOK" 2>/dev/null)
if [ -z "$out" ]; then echo "PASS: SKIP_WORKTREE_CONTRACT=1 bypasses contract branch"; PASS=$((PASS+1));
else echo "FAIL: SKIP_WORKTREE_CONTRACT=1 bypasses contract branch"; FAIL=$((FAIL+1)); fi

# ---------- contract branch: write-shaped commands (real git for MAIN_ROOT) ----------
# pwd -P for the same macOS symlink reason as in test-guard-worktree-isolation.sh.
NEST_TMP=$(cd "$(mktemp -d)" && pwd -P)
(
  cd "$NEST_TMP"
  git init -q main && cd main
  git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init
  git worktree add -q ".claude/worktrees/agent-real"
) >/dev/null 2>&1
R_MAIN="$NEST_TMP/main"
R_WT="$R_MAIN/.claude/worktrees/agent-real"
printf '%s' "$R_WT" > "$REG_DIR/dddd000000000004"

assert_deny "registry: redirect into the main checkout is denied" \
  "$(json "$SESSION" "$R_WT" "echo x > $R_MAIN/notes.txt")"
assert_deny "registry: sed -i on a main-checkout file is denied" \
  "$(json "$SESSION" "$R_WT" "sed -i '' s/a/b/ $R_MAIN/server/app.ts")"
assert_allow "registry: redirect inside the registered worktree is allowed" \
  "$(json "$SESSION" "$R_WT" "echo x > $R_WT/notes.txt")"
assert_allow "registry: redirect to /tmp is allowed" \
  "$(json "$SESSION" "$R_WT" 'echo x > /tmp/scratch.txt')"
# Quoted targets are the agent's default style — they must still be extracted.
assert_deny "registry: double-quoted redirect into the main checkout is denied" \
  "$(json "$SESSION" "$R_WT" "echo x > \\\"$R_MAIN/notes.txt\\\"")"
assert_deny "registry: single-quoted sed -i on a main-checkout file is denied" \
  "$(json "$SESSION" "$R_WT" "sed -i '' s/a/b/ '$R_MAIN/server/app.ts'")"
# Target extraction must scope to the matched sub-command: a trailing absolute
# token elsewhere must not shadow the real cp/mv destination, and an rm of /tmp
# scratch must not sweep in unrelated read-only targets.
assert_deny "registry: cp into main checkout with trailing benign -C token is denied" \
  "$(json "$SESSION" "$R_WT" "cp secret.txt $R_MAIN/leaked.txt && git -C $R_WT status")"
assert_allow "registry: main-checkout read plus /tmp rm is allowed (no cross-segment sweep)" \
  "$(json "$SESSION" "$R_WT" "cat $R_MAIN/server/app.ts && rm /tmp/harmless.txt")"
# Dot-segment laundering: an allowlist-prefixed path that collapses INTO the main
# checkout must be judged by where it lands, not its lexical prefix.
assert_deny "registry: /tmp/..-laundered redirect into the main checkout is denied" \
  "$(json "$SESSION" "$R_WT" "echo x > /tmp/..$R_MAIN/notes.txt")"
assert_allow "registry: /tmp/.. path collapsing back into /tmp is allowed" \
  "$(json "$SESSION" "$R_WT" 'echo x > /tmp/../tmp/scratch.txt')"

# Quote-AWARE write extraction: a commit MESSAGE that merely MENTIONS a write
# operator/command is NOT a real write — the operator/command is quoted, so it must
# not be mined (the CONFIRMED false-DENY class; see quote-strip-escape-glue solution).
# A write is real only when its OPERATOR/COMMAND is UNQUOTED; the target may be quoted.
assert_allow "registry: commit msg mentioning a '>' redirect into main is allowed" \
  "$(json "$SESSION" "$R_WT" "git commit -m \\\"writes > $R_MAIN/out\\\"")"
assert_allow "registry: commit msg mentioning 'tee' into main is allowed" \
  "$(json "$SESSION" "$R_WT" "git commit -m \\\"pipe to tee $R_MAIN/log\\\"")"
assert_allow "registry: commit msg with space-preceded 'rm' + main path is allowed" \
  "$(json "$SESSION" "$R_WT" "git commit -m \\\"then rm $R_MAIN/x happens\\\"")"
assert_allow "registry: backslash-escaped redirect is literal, not a real write" \
  "$(json "$SESSION" "$R_WT" "printf x \\\\> $R_MAIN/out")"

# Real writes must STILL deny — operator/command unquoted, target quoted or not.
assert_deny "registry: real fd-redirect (2>) into main is denied" \
  "$(json "$SESSION" "$R_WT" "build 2> $R_MAIN/err")"
assert_deny "registry: real 'tee -a' into main is denied" \
  "$(json "$SESSION" "$R_WT" "echo x | tee -a $R_MAIN/log")"
assert_deny "registry: real quoted rm of a main-checkout file is denied" \
  "$(json "$SESSION" "$R_WT" "rm \\\"$R_MAIN/x\\\"")"
assert_deny "registry: wrapper-prefixed 'sudo rm' into main is denied" \
  "$(json "$SESSION" "$R_WT" "sudo rm $R_MAIN/x")"
# GNU long-form in-place with a suffix is a real in-place edit — must still deny
# (the loose old regex caught the '-i' inside '--in-place'; the tokenizer must too).
assert_deny "registry: sed --in-place=.bak on a main-checkout file is denied" \
  "$(json "$SESSION" "$R_WT" "sed --in-place=.bak s/a/b/ $R_MAIN/app.ts")"
# Precise detection also FIXES a pre-existing false-positive: a read-only sed whose
# PATH merely contains '-i' must be allowed (the old 'sed …-i' regex matched the path).
assert_allow "registry: read-only sed on a '-i'-containing main path is allowed" \
  "$(json "$SESSION" "$R_WT" "sed -n s/a/b/ $R_MAIN/file-i.txt")"
# ANSI-C $'…' quote-completeness (same corpus class as the mutating tests): a $'…\'…'
# span before a redirect/rm must NOT desync emit_write_targets and hide the write target.
# `echo $'\'' > <main>/f` was a PRE-EXISTING write-shaped bypass (#664) — must now DENY.
assert_deny "registry: $'…' before a redirect into main is denied (was pre-existing BYPASS)" \
  "$(jsonc "$SESSION" "$R_WT" "echo \$'\\'' > $R_MAIN/f.txt")"
assert_deny "registry: $'a\\'b' then a redirect into main is denied" \
  "$(jsonc "$SESSION" "$R_WT" "echo \$'a\\'b' > $R_MAIN/g.txt")"
assert_deny "registry: $'…' then ';' then rm of a main file is denied (no desync)" \
  "$(jsonc "$SESSION" "$R_WT" "printf \$'x\\'y' ; rm $R_MAIN/z.txt")"
assert_allow "registry: benign $'…' redirect to /tmp stays allowed" \
  "$(jsonc "$SESSION" "$R_WT" "echo \$'hi' > /tmp/scratch-ansic.txt")"
assert_deny "registry: even-dollar-run \$\$'…\\' before a redirect into main is denied" \
  "$(jsonc "$SESSION" "$R_WT" "echo \$\$'a\\' > $R_MAIN/dd.txt")"
assert_deny "registry: 4-dollar-run \$\$\$\$'…\\' before a redirect into main is denied" \
  "$(jsonc "$SESSION" "$R_WT" "echo \$\$\$\$'a\\' > $R_MAIN/ee.txt")"
rm -f "$REG_DIR/dddd000000000004"

# jq missing must fail CLOSED for git/write-shaped commands while any registry
# exists (mirrors guard-worktree-isolation.sh) — never silently disable the
# contract. PATH-stripping is environment-dependent (Ubuntu ships /usr/bin/jq),
# so build a PATH with exactly the binaries the jq-less path needs and no jq.
NOJQ_BIN=$(mktemp -d)
for b in bash cat ls grep; do
  ln -s "$(command -v "$b")" "$NOJQ_BIN/$b"
done
out=$(echo "$(json "$SESSION" "$MAIN" 'git commit -m x')" | env PATH="$NOJQ_BIN" "$NOJQ_BIN/bash" "$HOOK" 2>/dev/null)
if echo "$out" | grep -q '"permissionDecision":"deny"'; then
  echo "PASS: jq-less environment fails closed for mutating git under a registry"; PASS=$((PASS+1))
else
  echo "FAIL: jq-less environment fails closed for mutating git under a registry"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi
# The fail-open side of the same gate: benign commands must pass untouched even
# jq-less with a registry present. (The no-registry-anywhere side is not
# automatable here — other sessions' registries may legitimately exist in /tmp.)
out=$(echo "$(json "$SESSION" "$MAIN" 'ls /tmp')" | env PATH="$NOJQ_BIN" "$NOJQ_BIN/bash" "$HOOK" 2>/dev/null)
if [ -z "$out" ]; then
  echo "PASS: jq-less benign command stays allowed"; PASS=$((PASS+1))
else
  echo "FAIL: jq-less benign command stays allowed"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi

# ---------- advisor branch (fires with or without a registry) ----------
FAKE_GH_STATE=MERGED assert_warn_contains "advisor: branch -D with MERGED PR reports safe" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "MERGED"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: branch -D with OPEN PR warns loudly" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "OPEN and NOT merged"
FAKE_GH_STATE=CLOSED assert_warn_contains "advisor: CLOSED-unmerged PR is a rejection signal" \
  "$(json no-registry-session "$MAIN" 'git push origin --delete todo/foo')" \
  "CLOSED WITHOUT MERGE"
FAKE_GH_EXIT=1 assert_warn_contains "advisor: no PR found warns about never-pushed work" \
  "$(json no-registry-session "$MAIN" 'git branch -D scratch-branch')" \
  "NO PR found"
FAKE_GH_EXIT=8 FAKE_GH_STDERR="network down" assert_warn_contains "advisor: gh hard failure reports UNVERIFIED" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "UNVERIFIED"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close is matched" \
  "$(json no-registry-session "$MAIN" 'gh pr close 520')" \
  "OPEN and NOT merged"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: long-form branch --delete --force is matched" \
  "$(json no-registry-session "$MAIN" 'git branch --delete --force todo/foo')" \
  "OPEN and NOT merged"
assert_warn_contains "advisor: worktree remove --force warns about uncommitted work" \
  "$(json no-registry-session "$MAIN" 'git worktree remove --force .claude/worktrees/agent-x')" \
  "uncommitted"

# Non-destructive gh/git stays silent.
assert_allow "advisor: gh pr view is not matched" \
  "$(json no-registry-session "$MAIN" 'gh pr view 520')"

CALLER_STATE_AFTER=$({ git rev-parse HEAD 2>/dev/null; git status --porcelain 2>/dev/null; } || echo not-a-repo)
if [ "$CALLER_STATE_BEFORE" = "$CALLER_STATE_AFTER" ]; then
  echo "PASS: caller repo untouched (hermetic)"; PASS=$((PASS+1))
else
  echo "FAIL: caller repo untouched (hermetic)"; FAIL=$((FAIL+1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
