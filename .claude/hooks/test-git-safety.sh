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
  if echo "$out" | grep -q '"additionalContext"' && echo "$out" | grep -qF -- "$3"; then
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
# A ref argument that still contains a literal quote character is not a real
# branch name gh could ever resolve — mirror gh's real "no pull requests
# found" for such a garbled ref, so a test using this fixture actually proves
# the caller stripped its quotes rather than passing regardless of $@ (see
# docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md).
for a in "$@"; do
  case "$a" in
    *\"*|*\'*)
      echo "no pull requests found for branch \"${a}\"" >&2
      exit 1
      ;;
  esac
done
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
# The new --git-dir/--work-tree/GIT_DIR/GIT_WORK_TREE recognizers must compose with the SAME $'…'
# quote machine as the -C cases above: a $'…'-quoted separator must not fracture a LATER redirect,
# and that redirect must still resolve to a DENY (drift-guard for the constructs this PR added).
assert_deny "registry: $'a;b' message before && cannot hide a later --git-dir=<main> commit" \
  "$(jsonc "$SESSION" "$WT_A" "git -C $WT_A commit -m \$'a;b' && git --git-dir=$MAIN/.git commit -m x")"
assert_deny "registry: $'a&b' message before && cannot hide a later GIT_WORK_TREE=<main> commit" \
  "$(jsonc "$SESSION" "$WT_A" "git -C $WT_A commit -m \$'a&b' && GIT_WORK_TREE=$MAIN git commit -m x")"

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

# Glued -C<path> with no space. Real git REJECTS this form (`unknown option: -C<path>`,
# EXIT 129 — verified by scratch probe) so NOTHING mutates. The broadened options group
# (below) now matches the single `-C<path>` token as a generic global; git_c_target does
# not recognize it as a real -C and skips it, so the effective repo falls to cwd — and with
# cwd=main that DENYs. A harmless over-DENY on a form git will not run anyway (was ALLOW; the
# ALLOW→DENY flip is the permitted, strict-superset direction).
assert_deny "registry: glued -C<main> → generic-global + cwd=main → deny (git rejects the form anyway)" \
  "$(json "$SESSION" "$MAIN" "git -C$MAIN commit -m x")"
# Empty -C is a git no-op (`git -C "" …` runs in cwd). fold() skips it, so a trailing empty
# -C neither masks the real effective repo nor emits a stray trailing slash on the path.
assert_deny "registry: git -C main -C '' — empty -C is a no-op, effective stays main (DENY)" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN -C '' commit -m x")"
assert_allow "registry: git -C '' resolves to cwd (worktree) — empty -C ignored (ALLOW)" \
  "$(json "$SESSION" "$WT_A" "git -C '' commit -m x")"

# ---------- unmodeled git global options: repo-redirect + generic-global skip ----------
# `-C` is only ONE of several ways git redirects which repo a command targets. The gate
# used to model only -C/-c, so other repo-redirecting globals slipped past the contract.
# Scratch probe (verified): `git --git-dir=<main>/.git commit` and `GIT_DIR=<main>/.git git
# commit` BOTH mutate <main> from any cwd; git accepts --git-dir/--work-tree glued (=) AND
# separate; a benign global (--no-pager/-p/-P) before a real -C still honors that -C.
#
# (A) --git-dir / --work-tree FLAGS and GIT_DIR / GIT_WORK_TREE env vars each redirect ONE of git's
#     two INDEPENDENT write targets. Verified by scratch probe: refs/objects go to the GIT-DIR
#     (--git-dir/GIT_DIR, else the -C fold, else cwd); working FILES go to the WORK-TREE
#     (--work-tree/GIT_WORK_TREE, else the -C fold, else cwd) — a --git-dir redirect does NOT move
#     the work-tree. The gate reconstructs BOTH targets and DENYs if EITHER is outside the registered
#     worktrees. `commit` is the only verb that does not write the work-tree, but we check both
#     anyway (conservative). (cwd = the registered worktree unless noted; contract active.)
#
# git-dir redirect to <main> → DENY (commit lands in main's refs):
assert_deny "registry: --git-dir=<main>/.git commit is denied (git-dir redirect, was BYPASS)" \
  "$(json "$SESSION" "$WT_A" "git --git-dir=$MAIN/.git commit -m x")"
assert_deny "registry: --git-dir <main>/.git (separate form) commit is denied" \
  "$(json "$SESSION" "$WT_A" "git --git-dir $MAIN/.git commit -m x")"
assert_deny "registry: GIT_DIR=<main>/.git git commit is denied (env git-dir redirect, was BYPASS)" \
  "$(json "$SESSION" "$WT_A" "GIT_DIR=$MAIN/.git git commit -m x")"
# work-tree redirect to <main> → DENY (working-file mutations land in main):
assert_deny "registry: --work-tree=<main> commit is denied (work-tree redirect, was BYPASS)" \
  "$(json "$SESSION" "$WT_A" "git --work-tree=$MAIN commit -m x")"
assert_deny "registry: --work-tree <main> (separate form) commit is denied" \
  "$(json "$SESSION" "$WT_A" "git --work-tree $MAIN commit -m x")"
assert_deny "registry: GIT_WORK_TREE=<main> git commit is denied (env work-tree redirect, was BYPASS)" \
  "$(json "$SESSION" "$WT_A" "GIT_WORK_TREE=$MAIN git commit -m x")"
# CRITICAL (review): a work-tree pointing at a SAFE worktree must NOT mask a commit whose git-dir
# (from cwd) is main. cwd=main + GIT_WORK_TREE/--work-tree=<worktree> → the git-dir target (cwd)
# is main → DENY. (The rejected single-target "work-tree wins" precedence would wrongly ALLOW this.)
assert_deny "registry: GIT_WORK_TREE=<worktree> from a main cwd is denied (git-dir=cwd=main, was BYPASS)" \
  "$(json "$SESSION" "$MAIN" "GIT_WORK_TREE=$WT_A git commit -m x")"
assert_deny "registry: --work-tree=<worktree> from a main cwd is denied (git-dir=cwd=main)" \
  "$(json "$SESSION" "$MAIN" "git --work-tree=$WT_A commit -m x")"
# both redirects at main → DENY (either target alone suffices):
assert_deny "registry: --git-dir=<main>/.git --work-tree=<main> commit is denied" \
  "$(json "$SESSION" "$WT_A" "git --git-dir=$MAIN/.git --work-tree=$MAIN commit -m x")"
# CRITICAL (2nd review): a --git-dir/GIT_DIR redirect to a SAFE worktree does NOT move the
# work-tree — a working-file verb (reset --hard/checkout/restore/clean) still writes cwd. Verified:
# `git --git-dir=<other>/.git reset --hard` from cwd=main overwrites main's tracked files. These
# were ALLOW before the fix (one is a regression this PR's GIT_DIR capture introduced):
assert_deny "registry: GIT_DIR=<worktree> reset --hard from a main cwd is denied (work-tree=cwd=main, was regression)" \
  "$(json "$SESSION" "$MAIN" "GIT_DIR=$WT_A/.git git reset --hard HEAD~1")"
assert_deny "registry: --git-dir=<worktree> checkout from a main cwd is denied (work-tree=cwd=main)" \
  "$(json "$SESSION" "$MAIN" "git --git-dir=$WT_A/.git checkout -- f.txt")"
assert_deny "registry: -C main + --git-dir=<worktree> reset --hard is denied (work-tree=-C fold=main)" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN --git-dir=$WT_A/.git reset --hard HEAD~1")"
# Conservative over-block (fail-safe): even `commit` (which does NOT write the work-tree) is DENYed
# when a --git-dir/GIT_DIR redirect leaves the implicit work-tree at a main cwd. The proper form,
# `git -C <worktree> …`, sets BOTH targets to the worktree and is allowed (below).
assert_deny "registry: --git-dir=<worktree> commit from a main cwd is denied (work-tree=cwd=main, over-block)" \
  "$(json "$SESSION" "$MAIN" "git --git-dir=$WT_A/.git commit -m x")"
assert_deny "registry: GIT_DIR=<worktree> git commit from a main cwd is denied (over-block)" \
  "$(json "$SESSION" "$MAIN" "GIT_DIR=$WT_A/.git git commit -m x")"
assert_deny "registry: --git-dir=/tmp/scratch commit from a main cwd is denied (work-tree=cwd=main)" \
  "$(json "$SESSION" "$MAIN" "git --git-dir=/tmp/scratch/.git commit -m x")"
# Fail-open guards — BOTH targets safe:
assert_allow "registry: git -C <worktree> reset --hard is allowed (git-dir AND work-tree = worktree)" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A reset --hard HEAD~1")"
assert_allow "registry: --git-dir=<worktree>/.git commit from the worktree cwd is allowed" \
  "$(json "$SESSION" "$WT_A" "git --git-dir=$WT_A/.git commit -m x")"
assert_allow "registry: --git-dir=/tmp/scratch commit from a /tmp cwd is allowed (both allowlisted)" \
  "$(json "$SESSION" "/tmp/scratch" "git --git-dir=/tmp/scratch/.git commit -m x")"
# work-tree to the worktree AND cwd is the worktree (so the git-dir target is safe too) → ALLOW:
assert_allow "registry: --work-tree=<worktree> from the worktree cwd is allowed" \
  "$(json "$SESSION" "$WT_A" "git --work-tree=$WT_A commit -m x")"
assert_allow "registry: GIT_WORK_TREE=<worktree> from the worktree cwd is allowed" \
  "$(json "$SESSION" "$WT_A" "GIT_WORK_TREE=$WT_A git commit -m x")"
#
# (B) A benign global BEFORE the -C (--no-pager/-p/-P) must not stop the gate reaching the
#     verb — the -C is real and git honors it. Regex must skip the global; git_c_target must
#     fold past it to the real -C.
assert_deny "registry: --no-pager -C <main> commit is denied (regex-skip gap, was BYPASS)" \
  "$(json "$SESSION" "$WT_A" "git --no-pager -C $MAIN commit -m x")"
assert_deny "registry: -p -C <main> commit is denied" \
  "$(json "$SESSION" "$WT_A" "git -p -C $MAIN commit -m x")"
assert_deny "registry: -P -C <main> commit is denied" \
  "$(json "$SESSION" "$WT_A" "git -P -C $MAIN commit -m x")"
assert_allow "registry: --no-pager -C <worktree> commit is allowed (fail-open guard)" \
  "$(json "$SESSION" "$MAIN" "git --no-pager -C $WT_A commit -m x")"
# Compose with chained -C: generic-skip and the cumulative last-absolute-wins fold coexist.
assert_deny "registry: --no-pager then chained -C, last absolute main, is denied" \
  "$(json "$SESSION" "$MAIN" "git --no-pager -C $WT_A -C $MAIN commit -m x")"
assert_allow "registry: --no-pager then chained -C, last absolute worktree, is allowed" \
  "$(json "$SESSION" "$WT_A" "git --no-pager -C $MAIN -C $WT_A commit -m x")"
#
# Bonus (falls out of B): a no-arg global with NO -C — the gate must still reach the verb,
# then cwd decides. Old regex broke on --no-pager → skipped → ALLOW even in the main checkout.
assert_deny "registry: --no-pager commit in the main checkout (no -C) is denied" \
  "$(json "$SESSION" "$MAIN" "git --no-pager commit -m x")"
assert_allow "registry: --no-pager commit in the registered worktree (no -C) is allowed" \
  "$(json "$SESSION" "$WT_A" "git --no-pager commit -m x")"
#
# Tainted decoy before a real redirect (review CRITICAL): a spliced/quoted dash-token
# (`--no-adv'i'ce`, which bash reassembles to the real flag `--no-advice`) must be SKIPPED, not
# mistaken for the verb — otherwise the scan halts before a later, plainly-unquoted `-C <main>`.
# The generic global-skip is taint-INDEPENDENT (no mutating verb starts with `-`).
assert_deny "registry: tainted decoy global then real -C <main> is denied (was BYPASS)" \
  "$(json "$SESSION" "$WT_A" "git --no-adv'i'ce -C $MAIN commit -m x")"
assert_deny "registry: tainted short decoy then real -C <main> is denied" \
  "$(json "$SESSION" "$WT_A" "git -x'y' -C $MAIN commit -m x")"
# Split --git-dir≠--work-tree at DIFFERENT checkouts is CLOSED by multi-target validation: a
# git-dir at the worktree with a --work-tree at main is DENIED (the work-tree target is main).
# Conservative (over-denies an exotic commit whose refs go to the worktree) but never a bypass.
assert_deny "registry: split --git-dir=<worktree> --work-tree=<main> is denied (multi-target, was residual)" \
  "$(json "$SESSION" "$WT_A" "git --git-dir=$WT_A/.git --work-tree=$MAIN commit -m x")"
#
# Documented residuals (a test either way, per the todo):
#  - A QUOTED redirect VALUE under an UNQUOTED flag/name is taint-strict (same within-segment
#    quote-blindness class as a quoted -C flag) — not captured, so the git-dir falls to cwd. From a
#    worktree cwd → ALLOW. The UNQUOTED forms are closed; only the quoted-VALUE variant remains.
assert_allow "registry: quoted GIT_DIR value (taint-strict residual) from a worktree cwd stays allowed" \
  "$(json "$SESSION" "$WT_A" "GIT_DIR='$MAIN/.git' git commit -m x")"
assert_allow "registry: quoted --git-dir VALUE (taint-strict residual) from a worktree cwd stays allowed" \
  "$(json "$SESSION" "$WT_A" "git --git-dir='$MAIN/.git' commit -m x")"
#  - CROSS-SEGMENT env: each ;/|/& segment is validated independently, so an export/assignment in
#    an EARLIER segment does not reach git in a later one → ALLOW. Only the INLINE same-segment
#    GIT_DIR=… prefix is closed; ambient/exported env is unseeable at the command-string layer.
assert_allow "registry: export GIT_DIR in an earlier segment (cross-segment residual) stays allowed" \
  "$(json "$SESSION" "$WT_A" "export GIT_DIR=$MAIN/.git && git commit -m x")"

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

# ---------- shell redirects between `git` and its verb (2026-09-13) ----------
# A redirect token starts with a digit, `>`, `<`, `&` or `{`, so the hand-written globals
# group matched none of them: the segment failed MUTATING_GIT_SEG_RE and took its
# `|| continue`, and the contract was never checked. Closed by adopting lib/cmd-detect.sh's
# `_CMD_GIT_GLOBALS` (interposed + glued) and `_CMD_POS_SUFFIX` (verb-glued).
# Every command below was confirmed to be a REAL git invocation with an argv shim, not a
# shape that only looks like one — the distinction the 144 correctly-missed corpus rows turn on.
assert_deny "registry: interposed 2> redirect before a mutating verb is denied (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'git 2>/dev/null commit -m x')"
assert_deny "registry: interposed > redirect before a mutating verb is denied (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'git >/dev/null commit -m x')"
assert_deny "registry: interposed 1> redirect, reset --hard, is denied (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'git 1>/dev/null reset --hard')"
assert_deny "registry: interposed 2>> redirect is denied (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'git 2>>log merge feature')"
# GLUED to the binary — bash splits at the operator, so no space is required for this to run.
# `_CMD_GIT_GLOBALS` separates its redirect branch with `[[:space:]]*`; a hand-spliced
# `_CMD_REDIR` behind the group's mandatory `[[:space:]]+` misses every row like these.
assert_deny "registry: redirect GLUED to the git binary is denied (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'git>out commit -m x')"
assert_deny "registry: glued < redirect before rebase is denied (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'git<in rebase main')"
# GLUED to the VERB — a different mechanism: this defeats the TRAILING boundary, not the
# globals group. `_CMD_POS_SUFFIX`'s closer class admits `<`/`>` for exactly this.
assert_deny "registry: redirect glued to the VERB is denied (was BYPASS, trailing boundary)" \
  "$(json "$SESSION" "$MAIN" 'git commit>log')"
assert_deny "registry: verb glued to >&2 with a branch-create flag is denied (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'git checkout>&2 -b foo')"
# Between globals, and trailing — the trailing form always matched; kept as a two-sided control.
assert_deny "registry: redirect AFTER a global, before the verb, is denied (was BYPASS)" \
  "$(json "$SESSION" "$MAIN" 'git --no-pager 2>/dev/null commit -m x')"
assert_deny "registry: control — redirect TRAILING the whole command was always seen" \
  "$(json "$SESSION" "$MAIN" 'git commit -m x 2>/dev/null')"

# --- FALSE-DENY sweep: widening a boundary class is the direction that invents denials, and
# a guard that denies ordinary read-only git gets switched off. Every row here must ALLOW.
assert_allow "registry: read-only verb with the SAME interposed redirect stays allowed" \
  "$(json "$SESSION" "$MAIN" 'git 2>/dev/null status')"
assert_allow "registry: read-only log with an interposed redirect stays allowed" \
  "$(json "$SESSION" "$MAIN" 'git 2>/dev/null log --oneline')"
assert_allow "registry: read-only verb GLUED to a redirect stays allowed" \
  "$(json "$SESSION" "$MAIN" 'git status>log')"
assert_allow "registry: read-only log glued to a redirect stays allowed" \
  "$(json "$SESSION" "$MAIN" 'git log>x')"
assert_allow "registry: redirect glued to the binary before a READ-ONLY verb stays allowed" \
  "$(json "$SESSION" "$MAIN" 'git>out status')"
# Near-miss binaries. `gitk>out` matters most: the redirect branch must not let `git` match a
# PREFIX of a longer binary name. (`git2>out` is the one shape that does — see the pinned
# over-denial rows below.)
assert_allow "registry: near-miss binary gitk with a redirect stays allowed" \
  "$(json "$SESSION" "$MAIN" 'gitk>out commit -m x')"
assert_allow "registry: near-miss binary git-foo stays allowed" \
  "$(json "$SESSION" "$MAIN" 'git-foo commit -m x')"
assert_allow "registry: near-miss binary legit stays allowed" \
  "$(json "$SESSION" "$MAIN" 'legit commit -m x')"
# Not a blanket deny: the SAME newly-seen shapes must still pass from a registered worktree,
# or the fix would have converted a false ALLOW into a gate nobody can work behind.
assert_allow "registry: interposed redirect INSIDE the registered worktree is allowed" \
  "$(json "$SESSION" "$WT_A" 'git 2>/dev/null commit -m x')"
assert_allow "registry: verb-glued redirect INSIDE the registered worktree is allowed" \
  "$(json "$SESSION" "$WT_A" 'git commit>log')"
assert_allow "registry: the sanctioned escape still works on a newly-seen shape" \
  "$(json "$SESSION" "$MAIN" 'SKIP_WORKTREE_CONTRACT=1 git 2>/dev/null commit -m x')"

# --- PINNED AS INCORRECT — these ALLOWs are the CURRENT behaviour and the WRONG answer. ---
# Recording a verdict's value without recording whether that value is CORRECT is a trap: the
# next person "fixes" the guard to keep the row green. Each command below IS a real git
# invocation (verified with an argv shim), so the ALLOW is a live bypass, not a safe miss.
#
# CAUSE: split_segments flushes on any unquoted `&` or `|`, unconditionally — before the
# regex ever runs. Four operator families contain one, so the segment is fractured into
# `git 2>` + `1 commit -m x` and neither half matches. The regex change cannot reach them;
# narrowing the splitter instead would merge adjacent commands and break the `^`-anchor that
# makes a following `git commit` visible at all, which is the false-ALLOW direction.
# FILED: todos/P1-2026-09-13-split-segments-fractures-redirect-operators-containing-amp-or-pipe.md
assert_allow "KNOWN-WRONG (filed): 2>&1 fractured by split_segments — real invocation, ALLOWed" \
  "$(json "$SESSION" "$MAIN" 'git 2>&1 commit -m x')"
assert_allow "KNOWN-WRONG (filed): &> fractured by split_segments — real invocation, ALLOWed" \
  "$(json "$SESSION" "$MAIN" 'git &>/dev/null commit -m x')"
assert_allow "KNOWN-WRONG (filed): >& fractured by split_segments — real invocation, ALLOWed" \
  "$(json "$SESSION" "$MAIN" 'git >&2 commit -m x')"
assert_allow "KNOWN-WRONG (filed): >| fractured by split_segments — real invocation, ALLOWed" \
  "$(json "$SESSION" "$MAIN" 'git >|out commit -m x')"
# NOTE on the four rows above: assert_allow passes on EMPTY output, so a hook that crashed
# would satisfy them exactly as a correct ALLOW does. They are green for the stated reason —
# neighbouring rows in this same file DENY through the same hook invocation path — but the
# assertion itself cannot tell the two apart. The positive discriminator is the very next row.
assert_deny "discriminator for the rows above: the hook is alive and still denying" \
  "$(json "$SESSION" "$MAIN" 'git 2>/dev/null commit -m x')"
# The KNOWN-WRONG rows above are all INTERPOSED. The same operator families in the VERB-GLUED
# position are NOT open, so the residual is positional rather than per-family — a distinction
# an earlier revision of the hook comment got wrong while this file already disproved it.
assert_deny "verb-glued >& is newly SEEN (ALLOW on main) — the residual is positional" \
  "$(json "$SESSION" "$MAIN" 'git commit>&out')"
assert_deny "verb-glued >| is newly SEEN (ALLOW on main) — the residual is positional" \
  "$(json "$SESSION" "$MAIN" 'git commit>|out')"
assert_deny "verb-glued &> was ALREADY denied — split_segments flushes its &, leaving 'git commit'" \
  "$(json "$SESSION" "$MAIN" 'git commit&>out')"
assert_allow "verb-glued 2>&1 stays allowed CORRECTLY — bash lexes the verb as commit2" \
  "$(json "$SESSION" "$MAIN" 'git commit2>&1')"

# ---------- git_c_target: a redirect is not the verb (security review, 2026-09-13) ----------
# Widening the MATCHER without widening the TOKENIZER left them disagreeing. git_c_target's
# phase-1 walker skips dash-tokens, but a redirect starts with a digit/`>`/`<`/`&`, so it fell
# through to the "first non-option word = the verb" branch and ENDED the scan — a repo
# redirect AFTER it was never mined and the target silently fell back to cwd. Both directions
# were live, and the second was a REGRESSION introduced by this PR before the walker was fixed.
assert_deny "walker: redirect before -C <main>, cwd=worktree — -C is mined, so DENY" \
  "$(json "$SESSION" "$WT_A" "git 2>/dev/null -C $MAIN commit -m x")"
assert_deny "walker: redirect before --git-dir=<main>, cwd=worktree — mined, so DENY" \
  "$(json "$SESSION" "$WT_A" "git 2>/dev/null --git-dir=$MAIN/.git commit -m x")"
# THE REGRESSION GUARD. `git -C <worktree>` is the spelling CLAUDE.md prescribes for worktree
# sessions; with the matcher widened and the walker not, a redirect before it made the hook
# DENY the sanctioned idiom. A guard that denies the prescribed command gets switched off.
assert_allow "walker: redirect before -C <worktree>, cwd=main — the sanctioned idiom stays ALLOWED" \
  "$(json "$SESSION" "$MAIN" "git 2>/dev/null -C $WT_A commit -m x")"
# Ordering contrast: the SAME tokens with the redirect after the -C always resolved correctly.
# This is what proves the tokenizer, not the regex, was the discriminator.
assert_deny "walker: control — redirect AFTER the -C was always resolved correctly" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN 2>/dev/null commit -m x")"
# The `!tnt` gate on that skip is load-bearing, tested in both directions. A QUOTED
# redirect-shaped token is a literal argument, not a redirect: the argv shim shows bash passes
# `2>/dev/null` to git as its subcommand, which is not a mutating invocation at all.
assert_allow "walker: a QUOTED redirect-shaped token is a literal arg, not a redirect" \
  "$(json "$SESSION" "$MAIN" "git '2>/dev/null' commit -m x")"

# SPACED redirect operator: bash spells `2> /dev/null` as TWO words, so skipping only the
# operator left the TARGET word to be read as the verb — ending the scan and reproducing the
# same regression as the glued spelling. Invisible to the original corpus, which varied WHERE
# the redirect sits while holding operator-to-target spacing glued throughout.
assert_deny "walker: SPACED redirect before -C <main>, cwd=worktree — target consumed, -C mined" \
  "$(json "$SESSION" "$WT_A" "git 2> /dev/null -C $MAIN commit -m x")"
assert_allow "walker: SPACED redirect before -C <worktree>, cwd=main — sanctioned idiom stays ALLOWED" \
  "$(json "$SESSION" "$MAIN" "git 2> /dev/null -C $WT_A commit -m x")"
assert_deny "walker: SPACED bare > before -C <main>, cwd=worktree — target consumed, -C mined" \
  "$(json "$SESSION" "$WT_A" "git > /dev/null -C $MAIN commit -m x")"

# THE TARGET-S LAST CHARACTER IS AN AXIS TOO, and holding it at `/dev/null` across the three
# rows above hid a DENY->ALLOW bypass through a green suite. Deciding "this word ends AT the
# operator" from the word-s last CHARACTER rather than from a complete operator RUN made a
# filename ending in `!` look target-less, so predir swallowed the following `-C <main>` and
# the repo fell back to cwd. Each row is paired with its one-character control so it cannot
# pass for the wrong reason, and the destructive verbs are covered, not just `commit`.
assert_deny "target-last-char: >out! must not swallow the following -C <main> (bypass)" \
  "$(json "$SESSION" "$WT_A" "git >out! -C $MAIN commit -m x")"
assert_deny "target-last-char: control — >out (one char shorter) always denied" \
  "$(json "$SESSION" "$WT_A" "git >out -C $MAIN commit -m x")"
assert_deny "target-last-char: >out! with reset --hard — the destructive family" \
  "$(json "$SESSION" "$WT_A" "git >out! -C $MAIN reset --hard")"
assert_deny "target-last-char: >out! with clean -fdx — the destructive family" \
  "$(json "$SESSION" "$WT_A" "git >out! -C $MAIN clean -fdx")"
assert_deny "target-last-char: 2>err! must not swallow --work-tree=<main>" \
  "$(json "$SESSION" "$WT_A" "git 2>err! --work-tree=$MAIN reset --hard")"
assert_deny "target-last-char: control — 2>err (one char shorter) always denied" \
  "$(json "$SESSION" "$WT_A" "git 2>err --work-tree=$MAIN reset --hard")"
assert_allow "target-last-char: the MIRROR — >out! before -C <worktree> must stay ALLOWED" \
  "$(json "$SESSION" "$MAIN" "git >out! -C $WT_A commit -m x")"
assert_allow "target-last-char: control — >out before -C <worktree> was always allowed" \
  "$(json "$SESSION" "$MAIN" "git >out -C $WT_A commit -m x")"
# A genuinely target-less TRAILING `>` must still take the next word — and here that makes
# ALLOW the correct answer, which is the opposite of what it looks like. Asked of bash with an
# argv shim rather than assumed: `git >a> -C /MAINX commit -m x` creates a file literally named
# `-C` and invokes argv `[/MAINX] [commit] [-m] [x]`, so the `-C` is consumed as the second
# redirect's target and the command never acts on main at all. The one-character control
# separates them: `git >a -C …` keeps `-C` in argv (`[-C] [/MAINX] [commit] …`) and DENIES.
# This row first shipped as an assert_deny because the expectation was written from the shape
# of the string instead of from the lexer. Always ask whether the verdict is CORRECT, not
# whether it matches the guess.
assert_allow "target-last-char: trailing > consumes the -C as its target, so nothing acts on main" \
  "$(json "$SESSION" "$WT_A" "git >a> -C $MAIN commit -m x")"
assert_deny "target-last-char: control — a single >a leaves -C in argv and is a real main mutation" \
  "$(json "$SESSION" "$WT_A" "git >a -C $MAIN commit -m x")"

# The END fail-safe is REACHED today by a route that has nothing to do with redirects: an
# arg-taking global swallows the verb token, so no word reaches the verb branch.
assert_deny "fail-safe: an arg-taking global eating the verb still resolves -C <main>" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN -c commit")"

# A verb GLUED to a redirect is still the verb, so collection must STOP there — the invariant
# git_c_target's own header states. A blanket skip broke it: the walker ran on into post-verb
# territory and a `-C` that git would parse as a SUBCOMMAND option overwrote the real repo
# redirect, landing on a registered target. Deciding on the PREFIX keeps the two apart.
assert_deny "invariant: a post-verb -C must NOT overwrite the real -C <main> when the verb is redirect-glued" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN commit>log -C $WT_A")"
assert_deny "invariant: control — same shape without the glued redirect already stopped at the verb" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN commit -C $WT_A")"

# Verb-glued redirects resolve through the VERB branch. BOTH rows below are CONTROLS: neither
# can tell the prefix-based classification from the earlier blanket skip, because with nothing
# after the glued verb the same target is emitted either way — verified by mutation, which
# reverts the classification and leaves both of these green. The row that actually
# discriminates is the invariant row ABOVE (`git -C <main> commit>log -C <worktree>`), which
# has a trailing token to be wrongly consumed and does redden.
# An earlier revision of this comment called the second row "the discriminating row". That was
# the THIRD wrong claim in this file about which row proves what on this same question — the
# hook-side comment records the other two. When a comment asserts that a row discriminates,
# the way to find out is to run the mutation and see whether that row reddens.
assert_deny "verb-glued redirect, cwd=main — control: DENY comes from the cwd fallback" \
  "$(json "$SESSION" "$MAIN" 'git commit>log')"
assert_allow "verb-glued redirect with -C <worktree> — control: the -C target resolves either way" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A commit>log")"

# --- Two residuals this change does NOT close. Both are real invocations (argv shim) that
# --- main ALSO allows, so they are un-closed gaps rather than regressions. Pinned as WRONG.
# (i) The `!tnt` gate is word-level, so a real redirect whose TARGET is quoted taints the whole
#     word and is not skipped — the walker stops and falls back to cwd. Fails toward DENY from
#     a main cwd; from a worktree cwd it MISSES a real mutation of main, as pinned here.
assert_allow "KNOWN-WRONG: redirect with a QUOTED TARGET is not skipped — real -C <main> mutation MISSED" \
  "$(json "$SESSION" "$WT_A" "git 2>\\\"/dev/null\\\" -C $MAIN commit -m x")"
# (ii) Phase 0 matches the binary as the exact word `git`, so a redirect GLUED to the binary
#     makes `git>out` a different word and the walker never enters phase 1 at all. The regex
#     sees the segment; the tokenizer does not resolve it.
assert_allow "KNOWN-WRONG: redirect glued to the binary — walker never enters phase 1, -C <main> MISSED" \
  "$(json "$SESSION" "$WT_A" "git>out -C $MAIN commit -m x")"

# Inherited over-DENIAL, pinned in the other direction: a DIGIT glued to the binary is SEEN,
# but bash lexes `git2>out` as the word `git2` plus `>out`, so it invokes `git2`, not git.
# Pre-existing property of `_CMD_GIT_GLOBALS` shared by every consumer on main; the direction
# is safe (over-deny can never produce a wrong ALLOW) and narrowing it would delete the
# deliberate `<`/`>` catch above. Pinned so a change of behaviour is noticed, not endorsed.
assert_deny "KNOWN-OVERDENY (inherited, safe direction): git2>out invokes git2, not git" \
  "$(json "$SESSION" "$MAIN" 'git2>out commit -m x')"

# ---------- FAIL-TO-STATUS-QUO on a broken lib (security review, 2026-09-13) ----------
# Sourcing a shared 2258-line lib into a fail-CLOSED gate is a new coupling, and "the source
# returned non-zero" is not the dangerous failure. Each stub below was measured to produce a
# TOTAL silent ALLOW before the subshell + self-test went in. Run against a COPY of the hook
# beside a stub lib/, so the real lib is untouched.
LIBTMP=$(mktemp -d)
mkdir -p "$LIBTMP/lib"
cp "$HOOK" "$LIBTMP/git-safety.sh"
assert_deny_stub() {  # $1=name $2=lib body $3=payload (default: an ordinary mutating git)
  printf '%s\n' "$2" > "$LIBTMP/lib/cmd-detect.sh"
  local out; out=$(json "$SESSION" "$MAIN" "${3:-git commit -m x}" | bash "$LIBTMP/git-safety.sh" 2>/dev/null)
  if echo "$out" | grep -q '"permissionDecision": "deny"'; then
    echo "PASS: $1"; PASS=$((PASS+1))
  else
    echo "FAIL: $1 (expected deny; a broken lib must fall back, never allow)"
    echo "  got: $(echo "$out" | head -2)"; FAIL=$((FAIL+1))
  fi
}
# Control FIRST, and it must be TWO-SIDED. `git commit -m x` is matched identically by the
# shipped fallback and by the adopted regex, so a control using it stays green even if
# adoption silently never engages — it would prove only "the copied hook does not crash".
# A redirect-position command is denied ONLY by the adopted regex, so it fails if the lib is
# not actually adopted. (Found by mutation: forcing the self-test to always fail left the
# old control green while 17 adoption-dependent rows went red.)
assert_deny_stub "broken-lib control: a HEALTHY lib is genuinely ADOPTED (redirect-only shape)" \
  "$(cat "$(dirname "$HOOK")/lib/cmd-detect.sh")" 'git 2>/dev/null commit -m x'
# Second half of the same control: the ordinary payload the broken-lib rows below use must
# ALSO deny with a healthy lib, or those rows would be measuring the wrong thing.
assert_deny_stub "broken-lib control: a HEALTHY lib also denies the ordinary payload" \
  "$(cat "$(dirname "$HOOK")/lib/cmd-detect.sh")"
assert_deny_stub "broken lib: top-level unset var (fatal under set -u) falls back, not ALLOW" \
  'BAD="${DEFINITELY_NOT_SET}"'
assert_deny_stub "broken lib: stray top-level exit 0 falls back, not ALLOW" \
  'exit 0'
assert_deny_stub "broken lib: malformed ERE constant (grep rc=2) falls back, not ALLOW" \
  '_CMD_GIT_GLOBALS="((" ; _CMD_POS_SUFFIX="([[:space:]]|$)"'
assert_deny_stub "broken lib: valid ERE with WRONG semantics falls back, not ALLOW" \
  '_CMD_GIT_GLOBALS="ZZZZNEVERMATCH" ; _CMD_POS_SUFFIX="([[:space:]]|$)"'
# A NARROWER lib is the one the self-test cannot see: it matches the canonical string and
# rejects the non-invocation, so it passes both directions, yet it SUBTRACTS denials the
# shipped fallback made. Only alternating with the fallback (union, never substitute) makes
# adoption monotone. Both stubs below are well-formed and pass the self-test.
# The EOL-anchor case needs the BARE payload `git commit`: with `-m x` appended there is a
# trailing space after the verb, so a suffix of `([[:space:]])` still matches and the dropped
# `$` is invisible. A row whose payload cannot express the defect tests nothing.
assert_deny_stub "narrower lib: dropping the EOL anchor must not lose a bare 'git commit'" \
  '_CMD_GIT_GLOBALS="(([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-[^[:space:]]+)))*" ; _CMD_POS_SUFFIX="([[:space:]])"' \
  'git commit'
STUBNARROW='_CMD_GIT_GLOBALS="([[:space:]]+-p)*" ; _CMD_POS_SUFFIX="([[:space:]]|$)"'
printf '%s\n' "$STUBNARROW" > "$LIBTMP/lib/cmd-detect.sh"
NARROW_OUT=$(json "$SESSION" "$WT_A" "git -C $MAIN commit -m x" | bash "$LIBTMP/git-safety.sh" 2>/dev/null)
if echo "$NARROW_OUT" | grep -q '"permissionDecision": "deny"'; then
  echo "PASS: narrower lib: dropping the -C arm must not lose the incident class itself"; PASS=$((PASS+1))
else
  echo "FAIL: narrower lib: dropping the -C arm LOST 'git -C <main> commit' — the incident class"
  FAIL=$((FAIL+1))
fi
# Contamination needs its OWN assertion, not assert_deny_stub: that helper greps for the deny
# substring, which still matches when junk is PREPENDED, so it would pass either way. Check the
# first byte instead — a strict envelope parser reads a leading non-`{` as a malformed reply,
# i.e. no decision at all, which on a deny gate is an allow.
printf '%s\n' 'echo CONTAMINATION
_CMD_GIT_GLOBALS="(([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-[^[:space:]]+)))*" ; _CMD_POS_SUFFIX="([[:space:]]|$)"' \
  > "$LIBTMP/lib/cmd-detect.sh"
CONTAM_OUT=$(json "$SESSION" "$MAIN" 'git commit -m x' | bash "$LIBTMP/git-safety.sh" 2>/dev/null)
case "$CONTAM_OUT" in
  '{'*) echo "PASS: broken lib: top-level stdout does not contaminate the decision JSON"; PASS=$((PASS+1)) ;;
  *)    echo "FAIL: broken lib: stdout contaminated the decision JSON"
        echo "  got: $(printf '%s' "$CONTAM_OUT" | head -c 60)"; FAIL=$((FAIL+1)) ;;
esac
# Non-vacuity control for the check just above: the same probe against a lib that prints
# nothing must ALSO start with `{` — and a deliberately contaminated one must NOT, proving the
# first-byte test can actually distinguish them.
printf '%s\n' 'true' > "$LIBTMP/lib/cmd-detect.sh"
CLEAN_OUT=$(json "$SESSION" "$MAIN" 'git commit -m x' | bash "$LIBTMP/git-safety.sh" 2>/dev/null)
printf '%s\n' 'echo JUNK' > "$LIBTMP/lib/noise.sh"
DIRTY_OUT="JUNK$CLEAN_OUT"
if [ "${CLEAN_OUT#\{}" != "$CLEAN_OUT" ] && [ "${DIRTY_OUT#\{}" = "$DIRTY_OUT" ]; then
  echo "PASS: control — the first-byte test separates a clean reply from a contaminated one"; PASS=$((PASS+1))
else
  echo "FAIL: control — the first-byte test cannot distinguish clean from contaminated"; FAIL=$((FAIL+1))
fi
rm -rf "$LIBTMP"

# HERE resolution for the bare-filename (no-slash) invocation shape — this hook now sources
# lib/cmd-detect.sh, so the naive `HERE="${BASH_SOURCE[0]%/*}"` would return the filename
# unchanged and silently lose the redirect grammar. The payload must carry a LIVE registry and
# a mutating git command, or the assignment sits behind two gates and never executes — a
# vacuous pass. test-cmd-detect.sh's equivalent check enumerates other hooks, not this one.
HERE_TRACE=$(cd "$(dirname "$HOOK")" && json "$SESSION" "$MAIN" 'git 2>/dev/null commit -m x' \
  | bash -x "$(basename "$HOOK")" 2>&1 >/dev/null)
if grep -qE '^\+ HERE=\.$' <<< "$HERE_TRACE"; then
  echo "PASS: HERE=. for a bare-filename invocation (and the assignment actually ran)"; PASS=$((PASS+1))
else
  echo "FAIL: HERE did not resolve to '.' for a bare-filename invocation"
  echo "  got: $(grep -E '^\+ HERE=' <<< "$HERE_TRACE" | head -1)"; FAIL=$((FAIL+1))
fi

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

# lib/cmd-detect.sh unsourceable: this lib is used ONLY by the gh-pr-close
# advisory detection (branch B) — branch A's mutating-git deny gate has its
# own independent inline scanners and must keep denying regardless. Copy just
# the hook into a dir with no lib/ sibling (mirrors test-core-bare-guard.sh's
# NOLIB fixture) and prove BOTH halves so a future change that accidentally
# makes branch A depend on this lib is caught here, not in production.
NOLIB=$(mktemp -d)
cp "$HOOK" "$NOLIB/git-safety.sh"
out=$(echo "$(json "$SESSION" "$MAIN" 'git commit -m x')" | bash "$NOLIB/git-safety.sh" 2>/dev/null)
if echo "$out" | grep -q '"permissionDecision": "deny"'; then
  echo "PASS: lib-missing — contract-branch deny is unaffected"; PASS=$((PASS+1))
else
  echo "FAIL: lib-missing — contract-branch deny is unaffected"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi
out=$(echo "$(json no-registry-session "$MAIN" 'gh pr close 520')" | bash "$NOLIB/git-safety.sh" 2>/dev/null)
if [ -z "$out" ]; then
  echo "PASS: lib-missing — gh pr close advisory fails silent (no crash, no revived raw needle)"; PASS=$((PASS+1))
else
  echo "FAIL: lib-missing — gh pr close advisory fails silent"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi
rm -rf "$NOLIB"

# The `*gh*`+`*close*` pre-guard (before the lib is even sourced) must never
# interfere with branch A: a command that is BOTH contract-denied AND
# contains both substrings (inside a quoted, therefore inert, commit message)
# must still deny — pinning that branch A resolves independently of, and
# before, branch B's lib-sourcing attempt.
out=$(echo "$(jsonc "$SESSION" "$MAIN" 'git commit -m "would gh pr close but for real"')" | bash "$HOOK" 2>/dev/null)
if echo "$out" | grep -q '"permissionDecision": "deny"'; then
  echo "PASS: registry: a mutating command containing both gh-pr-close pre-guard substrings still denies"; PASS=$((PASS+1))
else
  echo "FAIL: registry: a mutating command containing both gh-pr-close pre-guard substrings still denies"
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

# Quote-handling fix (P3-2026-07-25-git-safety-delete-advisor-quoted-ref): the
# branch-name extraction never stripped quotes, so a quoted literal OR a
# quoted shell variable both surfaced as a false "NO PR found". Three new
# cases below (quoted-literal resolves normally, variable-quoted is
# unresolvable rather than "no PR", flag-like skips the lookup entirely with
# no second message) plus the existing unquoted "no PR found" sibling just
# above make the AC's four distinct messages. See
# docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md
# for the sibling "blank vs. tokenize" lesson this fix follows.
FAKE_GH_STATE=MERGED assert_warn_contains "advisor: quoted literal branch -D resolves its PR (was: NO PR found)" \
  "$(jsonc no-registry-session "$MAIN" 'git branch -D "todo/foo"')" \
  "MERGED"
FAKE_GH_STATE=MERGED assert_warn_contains "advisor: quoted shell variable is reported unresolvable, not NO PR found" \
  "$(jsonc no-registry-session "$MAIN" 'git branch -D "$B"')" \
  "could not resolve a literal branch name"
out=$(FAKE_GH_EXIT=1 run_hook "$(json no-registry-session "$MAIN" 'git branch -D -f todo/foo')")
if echo "$out" | grep -qF 'looks like a flag' && ! echo "$out" | grep -qi 'NO PR found'; then
  echo "PASS: advisor: flag-like extraction skips the lookup (no additional NO PR found)"; PASS=$((PASS+1))
else
  echo "FAIL: advisor: flag-like extraction skips the lookup (no additional NO PR found)"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi

# An empty ref AFTER quote-stripping (`git branch -D ""`) must never reach
# `gh pr view`: real gh treats an empty positional as "no ref given" and
# resolves the CURRENT branch's PR instead — a confident, wrong-branch
# "MERGED" would be worse than the honest "no PR found" a garbled ref used
# to (accidentally) produce. FAKE_GH_STATE=MERGED here would make a
# fall-through pass this assertion for the wrong reason, so assert the
# skip message and the absence of any gh-derived state word.
out=$(FAKE_GH_STATE=MERGED run_hook "$(jsonc no-registry-session "$MAIN" 'git branch -D ""')")
if echo "$out" | grep -qF 'extracted ref is empty' && ! echo "$out" | grep -qi 'MERGED'; then
  echo "PASS: advisor: empty ref after quote-stripping skips the lookup (no false MERGED)"; PASS=$((PASS+1))
else
  echo "FAIL: advisor: empty ref after quote-stripping skips the lookup (no false MERGED)"
  echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
fi

FAKE_GH_EXIT=8 FAKE_GH_STDERR="network down" assert_warn_contains "advisor: gh hard failure reports UNVERIFIED" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "UNVERIFIED"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close is matched" \
  "$(json no-registry-session "$MAIN" 'gh pr close 520')" \
  "OPEN and NOT merged"

# P3-2026-09-13-git-safety-re-derives-the-gh-pr-close-needle: ported off a raw-$CMD
# needle onto lib/cmd-detect.sh's cmd_gh_pr_write_subcommand/cmd_gh_pr_ref, so this
# advisor inherits the root-position globals slot and quote-aware rendering.
#
# All four root-position `--repo`/`-R` spellings (P0-2026-09-13's own closed set):
# cmd_gh_pr_write_subcommand still resolves "close" (the verb sits after the globals
# slot), but cmd_gh_pr_ref REFUSES on the retarget (it has no way to convey a second
# repository), so the advisory fires the SKIP_REASON path rather than staying silent
# (old behavior: the raw needle required "gh" immediately followed by "pr" and never
# matched any of these at all — see the OLD-NOMATCH control below).
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close with -R <repo> (separate) fires the skip-reason path" \
  "$(json no-registry-session "$MAIN" 'gh -R owner/repo pr close 42')" \
  "could not resolve the PR ref via the shared extractor"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close with --repo <repo> (separate) fires the skip-reason path" \
  "$(json no-registry-session "$MAIN" 'gh --repo owner/repo pr close 42')" \
  "could not resolve the PR ref via the shared extractor"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close with --repo=<repo> (glued) fires the skip-reason path" \
  "$(json no-registry-session "$MAIN" 'gh --repo=owner/repo pr close 42')" \
  "could not resolve the PR ref via the shared extractor"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close with -R<repo> (glued) fires the skip-reason path" \
  "$(json no-registry-session "$MAIN" 'gh -Rowner/repo pr close 42')" \
  "could not resolve the PR ref via the shared extractor"
# Control: the OLD raw needle never matched any of the four spellings above (this is
# the bug this todo fixes) — prove it directly rather than asserting it from memory.
#
# NOTE FOR REVIEWERS: this is a TEST-ONLY measurement helper, not a production
# detector. It re-derives the retired raw-$CMD needle deliberately, as a
# negative-control instrument for the "before" behavior — it feeds no decision
# in git-safety.sh itself (the file no longer contains this pattern at all;
# confirm with `grep -n 'pr\[\[:space:\]\]+close' .claude/hooks/git-safety.sh`,
# which matches nothing) and asserts, in code, exactly what several of the
# controls below claim in comments, per the house rule that a measurement
# belongs in an assertion, not only in prose next to one.
old_needle_matches() {
  printf '%s' "$1" | grep -qE '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+close[[:space:]]+'
}
if ! old_needle_matches 'gh -R owner/repo pr close 42' \
   && ! old_needle_matches 'gh --repo owner/repo pr close 42' \
   && ! old_needle_matches 'gh --repo=owner/repo pr close 42' \
   && ! old_needle_matches 'gh -Rowner/repo pr close 42'; then
  echo "PASS: control — the old raw needle really missed all four root-position spellings"; PASS=$((PASS+1))
else
  echo "FAIL: control — the old raw needle unexpectedly matched a root-position spelling; the four PASS rows above are not proving what they claim"; FAIL=$((FAIL+1))
fi

# Quote-aware improvement: a `gh pr close` MENTION sitting inside a quoted commit
# message must NOT fire (cmd_bare blanks the quoted span). The OLD raw needle DID
# fire on this (no quote-awareness at all) — assert the fix, then assert the old
# needle's false positive directly as the control.
assert_allow "advisor: gh pr close mentioned in a quoted commit message is not matched (was a false positive)" \
  "$(jsonc no-registry-session "$MAIN" 'git commit -m "mentions gh pr close 42 in the message"')"
if old_needle_matches 'git commit -m "mentions gh pr close 42 in the message"'; then
  echo "PASS: control — the old raw needle really did false-positive on the quoted-prose case"; PASS=$((PASS+1))
else
  echo "FAIL: control — the old raw needle did not match the quoted-prose case; the assert_allow above is not proving what it claims"; FAIL=$((FAIL+1))
fi

# A `gh pr close` invocation hidden inside a LIVE "$(...)" substitution genuinely
# executes despite the surrounding double quotes — cmd_bare_deep (unlike plain
# cmd_bare) surfaces it, and with no retarget present cmd_gh_pr_ref resolves the
# ref normally.
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close hidden inside a live \"\$(...)\" substitution still resolves its ref" \
  "$(jsonc no-registry-session "$MAIN" 'echo "$(gh pr close 42)"')" \
  "OPEN and NOT merged"

# MEASURED RESIDUAL, not fixed by this port (pinned so it is a decision, not a
# surprise): TWO causes, either independently sufficient for this exact input.
# (1) git-safety.sh's own `*gh*`+`*close*` pre-guard (above the branch B header
# comment) never sets _CMD_DETECT_OK here in the first place — `g"h"` contains
# no literal contiguous "gh" substring, so the library is never even sourced
# for this row. (2) Independently, cmd_gh_pr_write_subcommand/cmd_gh_pr_ref
# read cmd_bare_deep, which BLANKS quoted spans rather than reconstructing
# them — a binary name split across a quote boundary never re-forms into the
# token "gh" even when the library IS reached directly (verified by calling
# the library functions directly, bypassing the pre-guard). This is the SAME
# accepted residual cmd-detect.sh documents for a quoted `-R`/`--repo` flag
# (see _CMD_GH_GLOBALS's own quoted-flag residual note); closing it would need
# a cmd_words-based predicate, which does not exist for `close` and is out of
# this todo's Scope Contract (no new detector). The old raw needle also never
# detected this shape (see the OLD-NOMATCH control), so this is not a
# regression versus main — just a gap the port does not close. Because cause
# (1) alone already suppresses this input, this row would stay green even if
# cause (2) were ever fixed — it does not, on its own, prove cause (2) closed.
assert_allow "advisor: a quote-glued gh binary (g\"h\") is a known, unfixed detection gap" \
  "$(jsonc no-registry-session "$MAIN" 'g"h" pr close 42')"

# Sibling shape (same "necessary substring" pre-guard limitation, different
# token): quote-splicing the VERB defeats the pre-guard's literal-contiguous-
# substring check the same way quote-splicing the binary does — `clo""se`
# still executes as `close` (bash concatenates adjacent quoted/unquoted
# segments into one word), but its raw text contains no contiguous "close"
# substring, so `_CMD_DETECT_OK` is never set. Pre-existing (identical before
# and after narrowing the pre-guard from `*gh*` alone to `*gh*`+`*close*` —
# the single-substring gate already missed this shape too, since it is a
# property of cmd_bare_deep's own tokenizer, not of the pre-guard's substring
# count), so this is not a regression; pinned alongside the g"h" row above so
# a future reader does not mistake the "necessary substring" comment for a
# complete proof.
assert_allow "advisor: quote-splicing the verb (gh pr clo\"\"se) is a known, pre-existing detection gap" \
  "$(jsonc no-registry-session "$MAIN" 'gh pr clo""se 42')"

# THIRD residual in the same family -- AND IT IS NO LONGER A RESIDUAL. Everything this
# paragraph used to assert was measured, was correct on the tree it was written against,
# and is false on this one. It is rewritten rather than patched because the claim it got
# wrong is the one that matters most: whether a deny backstop exists.
#
# WHAT IT SAID: that `_CMD_GH_GLOBALS` admitted `-R v`, `--repo v` and glued `-x` but no
# other flag-plus-value pair, so one separate-arg global was enough to make
# `cmd_gh_pr_write_subcommand` stop matching -- silently, with no SKIP_REASON -- and that
# `guard-outward-cli.sh` did NOT cover the shape either: both stacked forms returned
# BYTE-EMPTY from the deny gate, indistinguishable from an `echo hello` control, so what
# bounded them was gh's own parser refusing a global in the root slot, not a backstop.
#
# WHAT IS TRUE NOW. The root-position-flag-PROPERTY branch gave that alternation a
# separate-arg value arm, so the extractor walks past `--hostname github.com`. Re-measured
# under bash 5.3.15 on BOTH trees in one run, with controls, classifying git-safety output
# as SILENT / SKIP-REASON / RESOLVED-ADVISORY and the deny gate as BYTE-EMPTY / DENY:
#
#   input                                                 main                merged
#   gh --hostname github.com pr close 42             SILENT / EMPTY      RESOLVED / DENY
#   gh --hostname github.com -R other/org pr close 42  SILENT / EMPTY      SKIP-REASON / DENY
#   gh -R other/org --hostname github.com pr close 42  SILENT / EMPTY      SKIP-REASON / DENY
#   gh pr close 42                                       RESOLVED / DENY     RESOLVED / DENY   (+ctl)
#   echo hello                                            SILENT / EMPTY      SILENT / EMPTY    (-ctl)
#
# So the inversion is total and in the SAFE direction: three shapes that reached a mutating
# cross-repo close BYTE-EMPTY at the deny gate on main now DENY. THERE IS NOW A DENY
# BACKSTOP, and the sentence claiming there is not was the single most load-bearing wrong
# line in this file -- it told a reader the hook's silence was bounded by gh's parser, which
# is a much weaker guarantee than a deny.
#
# "Inherited from the UNMODIFIED _CMD_GH_GLOBALS grammar" is also retired: this branch
# MODIFIES that grammar, which is exactly why the behaviour moved. Neither this file nor
# git-safety.sh is touched by the change that moved it -- the grammar is in lib/cmd-detect.sh
# and the consumer was pointed at it by a separate fix on main -- so only the MERGE of the
# two produces this. Widen a detector and its consumers in one change, and when a gap
# CLOSES, name it.
#
# THE ROOT-SLOT BOUND STILL STANDS AND IS STILL NARROW. gh 2.100.0 refuses a global in the
# ROOT slot before `pr` (its root flags are only --help and --version; `gh --hostname
# github.com --version` returns "unknown flag: --hostname"), so the annotated inputs above
# cannot execute as written. Do NOT generalise that to "gh refuses a pre-verb global": gh
# accepts `--repo`/`-R` BETWEEN `pr` and the verb (measured, `gh pr --repo cli/cli view
# --help` resolves while `gh pr --bogus x view --help` errors), and that position is covered
# by the SEPARATE residual below, not here.
#
# The residual's genuinely EXECUTABLE siblings do get a deny, verified in the same run:
# `g"h" pr close 42`, `gh pr clo""se 42` and `gh pr create -t x && gh pr close 42` all DENY.
# Pinned because the todo's AC says "all four root-position spellings" are handled, and
# without this row that reads as full globals-slot coverage, which it is not.
# THIS RESIDUAL CLOSED 2026-09-15, and it closed from files this suite does not test.
# It was pinned as `assert_allow` -- expect SILENCE -- because the shared extractor's
# _CMD_GH_GLOBALS modelled a root-position flag as `-[^[:space:]]+` with no value arm, so
# `--hostname github.com` consumed the slot and the `-R other/org` behind it was never
# reached. The root-position-flag-PROPERTY branch gave that alternation a separate-arg
# value arm, so the extractor now walks past `--hostname github.com`; git-safety.sh, which
# an earlier fix had pointed at the SHARED extractor instead of its own re-derived needle,
# emits its advisory as a result. Two changes in two different files, NEITHER of which
# touches this one, and only their MERGE moves the behaviour -- which is both the reason to
# widen a detector and its consumers in one change, and the reason a gap that CLOSES still
# has to be named rather than quietly re-pinned.
# MEASURED on the merged tree, with controls in the SAME run, before this pin was flipped:
#   gh --hostname github.com -R other/org pr close 42   -> SKIP-REASON advisory (this row)
#   gh -R other/org --hostname github.com pr close 42   -> SKIP-REASON advisory (sibling, pinned below)
#   gh --hostname github.com pr close 42                -> RESOLVED advisory, NOT skip-reason
#   gh -R other/org pr close 42                         -> SKIP-REASON advisory (positive control)
#   gh --hostname github.com pr view 42                 -> silent (verb-scope control)
#   gh pr view 42                                       -> silent (verb-scope control)
# THE THIRD ROW IS THE ONE THAT DISCRIMINATES, and an earlier version of this note did not
# have it. It called the two `pr view` rows "the load-bearing half", which they are not:
# git-safety.sh gates the whole advisory on the verb being `close`, so a `pr view` stays
# silent under ANY extractor -- including a broken one that fired the skip-reason on every
# close. They bound the verb scope and nothing else. The row that separates "the extractor
# walked past --hostname and then reached the -R" from "any root global now forces a
# refusal" is the single-global close, which must come back RESOLVED rather than
# SKIP-REASON -- measured, it does. A control validates only the path it actually runs
# through.
assert_warn_contains "advisor: a root-position -R stacked with another separate-arg global (--hostname) is now SEEN — inherited gap CLOSED by the shared extractor's value arm" \
  "$(jsonc no-registry-session "$MAIN" 'gh --hostname github.com -R other/org pr close 42')" \
  "could not resolve the PR ref via the shared extractor"

# ...and the -R-FIRST sibling, which moved in the same merge with no assertion on it at
# all. Ordering is the whole point: the extractor has to walk past a separate-arg global in
# either position, so pinning only the --hostname-first spelling leaves half the behaviour
# unguarded while the comment above describes both.
assert_warn_contains "advisor: the -R-FIRST ordering of the same stacked pair is SEEN too — both orderings pinned, not one" \
  "$(jsonc no-registry-session "$MAIN" 'gh -R other/org --hostname github.com pr close 42')" \
  "could not resolve the PR ref via the shared extractor"

# THE DISCRIMINATING ROW, which until now existed only in the comment table above -- the
# commit that flipped this residual said it had been "added" when it had only been
# WRITTEN DOWN. Both rows above assert the SKIP-REASON string, and the two `pr view` rows
# below are gated to silence by the verb check, so an extractor that returned the
# skip-reason for EVERY close would keep this entire suite green. Nothing would redden.
# This row is the one that separates "the extractor walked past --hostname and then
# reached the -R" from "any root global now forces a refusal": a SINGLE root global with
# no -R behind it must RESOLVE the ref, not skip it. Measured on this tree --
# `Fresh PR check: PR #520 ... is MERGED` (520 is what this file's fake gh returns; the
# ref in the command is 42, and the two differing is itself the evidence that the hook
# LOOKED THE REF UP rather than echoing it back) -- where the stacked pair returns
# `Fresh PR check skipped: could not resolve ...` instead.
FAKE_GH_STATE=MERGED assert_warn_contains "advisor: a SINGLE root-position global still RESOLVES the ref — the discriminating row, not another skip-reason" \
  "$(jsonc no-registry-session "$MAIN" 'gh --hostname github.com pr close 42')" \
  "Fresh PR check: PR #520"

# FOURTH residual in the same family, and the only one this port INTRODUCES rather than
# inherits. The retired needle matched `(^|[;&|[:space:]])gh`; the shared
# cmd_gh_pr_write_subcommand matches `(^|[[:space:]])gh`, and cmd_bare_deep only BLANKS
# characters, so a separator glued straight to `gh` with no space stays contiguous and
# cannot match. Measured under bash 5.3.15 against both hook versions, with the
# space-separated form as a control:
#   foo;gh pr close 42   old=warn  new=SILENT      foo&&gh …  old=warn  new=SILENT
#   foo|gh pr close 42   old=warn  new=SILENT      foo||gh …  old=warn  new=SILENT
#   foo&gh pr close 42   old=warn  new=SILENT
#   foo; gh pr close 42  old=warn  new=warn        (control, space present)
#   gh pr close 42       old=warn  new=warn        (control, bare)
# All five are real executable bash. NOT WIDENED, deliberately: the fix would be to anchor
# on _CMD_POS_PREFIX, but that class lives in the SHARED lib that also feeds
# guard-outward-cli.sh's DENY decisions, and widening a matcher is the safe direction only
# on a deny-shaped read -- here it would risk false denies for a warning this hook already
# calls optional ("a missed warning, never a wrong one"). Cost bounded by measurement:
# guard-outward-cli.sh returns a DENY for all five, so only the advisory is lost.
assert_allow "advisor: a separator glued to gh with no space (foo;gh) loses the advisory — introduced by the port, bounded by guard-outward-cli's deny" \
  "$(jsonc no-registry-session "$MAIN" 'foo;gh pr close 42')"

# FIFTH residual, and the only one here that BOTH hooks miss. A `--repo`/`-R` retarget
# placed BETWEEN `pr` and the verb reaches neither this advisor nor guard-outward-cli.sh.
# Measured at this head, and the FOUR MID-POSITION ROWS are identical on origin/main --
# scoped deliberately, because the blanket form was false for this table's own control:
# `gh -R o/r pr close 42` is warn HERE and SILENT on main, and that difference is exactly
# the root-slot coverage this PR delivers. Three controls in
# the same run that are all covered:
#   gh pr close 42                    advisory=warn    guard=DENY   (control)
#   gh -R o/r pr close 42             advisory=warn    guard=DENY   (control, ROOT slot)
#   gh pr close 42 --repo o/r         advisory=warn    guard=DENY   (control, POST-verb)
#   gh pr --repo o/r close 42         advisory=SILENT  guard=allow
#   gh pr --repo=o/r close 42         advisory=SILENT  guard=allow
#   gh pr -R o/r close 42             advisory=SILENT  guard=allow
#   gh pr -Ro/r close 42              advisory=SILENT  guard=allow
# The shape PARSES: `gh pr --repo cli/cli view --help` resolves and prints `gh pr view`'s
# help, while `gh pr --bogus x view --help` errors "unknown flag", so that slot genuinely
# binds --repo rather than skipping it. Boundary of the claim: that is a PARSING result --
# no close was executed.
#
# NOT INTRODUCED HERE and not this PR's to fix: guard-outward-cli.sh is not in this PR's
# changed files and main behaves identically, so this port neither creates nor widens it.
# Pinned rather than filed, because guard-outward-cli.sh's own deny text names --repo/-R
# retargeting as the thing it exists to catch, and a gap that contradicts a guard's stated
# purpose should be visible on every run rather than living in one reviewer's report.
# NAME SAYS "advisor", NOT "neither hook", and the gap between those two is the point.
# This row asserts the ADVISORY half only -- it runs git-safety.sh and nothing else. The
# guard=allow half is recorded in the comment above and asserted NOWHERE, because this file
# never executes guard-outward-cli.sh (all eight mentions of it here are comment text). So
# if that guard is ever taught to cover this slot, NOTHING here goes red and the comment
# goes stale silently: re-measure it against .claude/hooks/test-guard-outward-cli.sh, which
# is where that guard's own rows live. The advisory half does stay honest -- teach the
# advisor this slot and this assert_allow reddens, forcing a deliberate update.
assert_allow "advisor: a --repo retarget BETWEEN 'pr' and the verb is SILENT here — pre-existing, identical on main, surfaced not fixed" \
  "$(jsonc no-registry-session "$MAIN" 'gh pr --repo o/r close 42')"

# SIXTH residual, and the one the pre-guard's own justification denied was possible. The
# `*gh*`+`*close*` pre-guard rests on a necessary-substring argument that is unsound:
# cmd_bare_deep routes through cmd_extract_substitutions, which DELETES a nested
# substitution and leaves a zero-width hole, so deletion can synthesise a substring the raw
# text never contained. Measured, with the plain form as control:
#   gh pr close 42                    lib=close  advisory=warn   (control)
#   echo "$(gh pr clo$(echo)se 42)"   lib=close  advisory=SILENT
#   echo "$(g$(echo)h pr close 42)"   lib=close  advisory=SILENT
# Both really execute `gh pr close 42`; the library resolves the verb and only the
# pre-guard drops it. Distinct from the g"h" and clo""se rows above, which cmd_bare_deep's
# tokenizer suppresses even when the library is reached directly — neither of those covers
# this case. Missed warning only: both DENY at guard-outward-cli.sh, and both are SILENT on
# origin/main too.
assert_allow "advisor: a nested substitution that SYNTHESISES the verb is dropped by the cheap pre-guard — deliberate perf trade, deny layer still covers it" \
  "$(jsonc no-registry-session "$MAIN" 'echo "$(gh pr clo$(echo)se 42)"')"

# Accepted trade-off (documented in cmd_gh_pr_write_subcommand's own header): a `gh
# pr create` mention co-occurring with the close means the create-vs-rest guard
# refuses the whole subcommand lookup, so this advisor now stays silent where the
# old raw needle fired. Safe direction — a missed warning, never a wrong one.
assert_allow "advisor: gh pr create co-occurring with gh pr close is a known, accepted missed-warning (create-vs-rest guard)" \
  "$(json no-registry-session "$MAIN" 'gh pr create -t x && gh pr close 42')"

# Gate strictly on "close" (git-safety.sh's own comment above the elif).
# Baseline coverage first (these three alone are NOT discriminating — none
# contains a literal "close" substring, so they never clear the file's own
# `*gh*`+`*close*` pre-source guard and never even reach the comparison this
# block exists to pin; caught by review, code-reviewer round 2, proven by
# mutation below).
assert_allow "advisor: gh pr merge alone is not matched (baseline; not discriminating — see the echo-close row below)" \
  "$(json no-registry-session "$MAIN" 'gh pr merge 42')"
assert_allow "advisor: gh pr edit alone is not matched (baseline; not discriminating — see the echo-close row below)" \
  "$(json no-registry-session "$MAIN" 'gh pr edit 42')"
assert_allow "advisor: gh pr create alone is not matched (baseline; not discriminating — see the echo-close row below)" \
  "$(json no-registry-session "$MAIN" 'gh pr create -t x')"

# THE load-bearing proof that a widened `[ -n "$(cmd_gh_pr_write_subcommand
# ...)" ]` gate (which would ALSO match create|merge|edit) is not what is
# wired in. Each input is constructed to clear the pre-source guard (contains
# both "gh" and "close" as literal substrings, via the "echo close" prefix)
# while resolving via cmd_gh_pr_write_subcommand to a DIFFERENT verb than
# "close" for the real `gh pr <verb>` clause — so these rows fail if the
# comparison is ever widened, where the three baseline rows above would not.
# Verified by mutation: widening `= "close"` to `-n "$(...)"` in a scratch
# copy leaves the three baseline rows above unaffected (still silent — they
# never reach the comparison at all) but makes these three rows emit a real
# "PR #42 ... MERGED" / etc. warning about an unrelated gh pr merge/edit/
# create clause — exactly the "must not widen to those" regression the
# code's own comment warns against, and KIND="delete" is shared with the
# branch -D / push --delete paths this advisor must not widen onto either.
FAKE_GH_STATE=MERGED assert_allow "advisor: gh pr merge co-occurring with a bare 'close' mention is not matched (discriminating — proves close-only gating)" \
  "$(json no-registry-session "$MAIN" 'echo close; gh pr merge 42')"
FAKE_GH_STATE=MERGED assert_allow "advisor: gh pr edit co-occurring with a bare 'close' mention is not matched (discriminating — proves close-only gating)" \
  "$(json no-registry-session "$MAIN" 'echo close; gh pr edit 42')"
FAKE_GH_STATE=MERGED assert_allow "advisor: gh pr create co-occurring with a bare 'close' mention is not matched (discriminating — proves close-only gating)" \
  "$(json no-registry-session "$MAIN" 'echo close; gh pr create -t x')"

# AC's exact two-sided negative-control pairing: a read-only gh -R <repo> pr view
# must not trigger the advisory even WITH the root-position retarget flag present
# (view isn't in cmd_gh_pr_write_subcommand's create|merge|close|edit alternation,
# so the globals slot never matters for it — but the todo names this exact input,
# not just the no-flag form already covered below). Lower-risk than the three
# above (view's exclusion is a finite, separately-tested regex alternation in
# lib/cmd-detect.sh, not a runtime comparison in this file a one-line edit could
# silently widen), but made discriminating the same way for consistency.
FAKE_GH_STATE=MERGED assert_allow "advisor: gh -R owner/repo pr view 42 (read-only, with retarget) is not matched (discriminating)" \
  "$(json no-registry-session "$MAIN" 'echo close; gh -R owner/repo pr view 42')"

# CRITICAL FIX: cmd_gh_pr_ref can return a URL (not just a number or branch
# name). Without a host restriction, `gh pr close <url>` — including one
# hidden inside a live "$(...)" substitution, a shape this port newly
# surfaces — would make this hook's own `gh pr view "$REF"` call open a real
# network connection to an attacker-chosen host, independent of any user
# permission decision. Mirrors pr-verify.sh's GH_ALLOWED_HOST guard.
assert_warn_contains "advisor: gh pr close with an attacker-controlled URL ref is refused, not looked up" \
  "$(jsonc no-registry-session "$MAIN" 'gh pr close https://exfil.example.test/o/r/pull/1')" \
  "is a URL outside the configured GitHub host"
# THE PR-DIRECTION HALF OF THE SUBJ/VERB FIX, previously reachable but asserted nowhere.
# Only the BRANCH direction was pinned; the four -R rows assert a hardcoded prefix that
# never interpolates ${SUBJ}/${VERB}. Measured: deleting the two SUBJ/VERB assignments in
# git-safety.sh left this suite at 153/0 while this very command's guidance flipped to
# "confirm this branch's merge state manually before deleting" -- exactly the mirror the
# hook's own comment says would otherwise stay live. This row is the two-sided pair of the
# branch-side row below.
# The tail alone is NOT unique to this clause -- it is also the verbatim ending of the
# hardcoded close-arm ref-refusal SKIP_REASON, so a row asserting only the tail would be
# satisfied by a DIFFERENT skip path (measured: `gh -R owner/repo pr close 42` and
# `gh --repo=owner/repo pr close 42` both emit it). Pinning the host-guard PREFIX in the
# same row is what ties the assertion to the clause it names.
assert_warn_contains "advisor: the PR-close direction gets PR-shaped guidance, not the branch mirror" \
  "$(jsonc no-registry-session "$MAIN" 'gh pr close https://exfil.example.test/o/r/pull/1')" \
  "is a URL outside the configured GitHub host"
assert_warn_contains "advisor: ... and that same host-guard clause ends with the PR-shaped tail, not the branch mirror" \
  "$(jsonc no-registry-session "$MAIN" 'gh pr close https://exfil.example.test/o/r/pull/1')" \
  "confirm this PR's state manually before closing"
assert_warn_contains "advisor: gh pr close with a URL ref hidden inside a live substitution is refused, not looked up" \
  "$(jsonc no-registry-session "$MAIN" 'echo "$(gh pr close https://exfil.example.test/o/r/pull/1)"')" \
  "is a URL outside the configured GitHub host"
# The host guard sits in the SHARED ref-processing block, so it is reached by all five
# KIND=delete arms — not just `gh pr close`. Its trailing guidance therefore has to name
# the right subject per arm. Measured before that was fixed, this exact input produced
# "confirm this PR's state manually before closing" on a BRANCH deletion, where no PR is
# involved. Pin the branch-side wording here: the three rows above only ever exercise the
# guard through `gh pr close`, so they cannot see a regression on the other four arms.
assert_warn_contains "advisor: a URL ref on a BRANCH delete is refused with branch-shaped guidance, not PR-shaped" \
  "$(jsonc no-registry-session "$MAIN" 'git branch -D https://exfil.example.test/o/r/pull/1')" \
  "confirm this branch's merge state manually before deleting"
# Protocol-relative bypass (found by review, security-auditor round 2,
# CRITICAL): a scheme-less `//host/path` reference contains no colon at all,
# so it matched NEITHER the allowed-host prefix NOR the original `*://*|*:*`
# disqualify pattern — falling through unrestricted. git ref names can never
# contain two consecutive slashes anywhere (git-check-ref-format), so this
# case can only arise from a URL-shaped ref, never collide with a legitimate
# branch name from the other four KIND=delete branches.
assert_warn_contains "advisor: gh pr close with a protocol-relative (//host) ref is refused, not looked up" \
  "$(jsonc no-registry-session "$MAIN" 'gh pr close //exfil.example.test/o/r/pull/1')" \
  "is a URL outside the configured GitHub host"
# Control: a URL ref that IS on the allowed host resolves normally — the
# restriction targets the HOST, not "any URL shape", matching pr-verify.sh's
# own accepted https://github.com/... PR-URL form.
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close with an allowed-host github.com URL ref resolves normally" \
  "$(jsonc no-registry-session "$MAIN" 'gh pr close https://github.com/xertox1234/OCRecipes/pull/42')" \
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

# Pin the assertion TOTAL, mirroring test-cmd-detect.sh's own EXPECTED_TOTAL pin.
# Without it a row that is silently skipped (a helper that dies mid-pipeline,
# incrementing neither PASS nor FAIL) makes N/0 look identical to (N+1)/0. Update
# the number DELIBERATELY when adding assertions.
# 158 -> 159 (2026-09-15): +1 for the -R-FIRST sibling of the stacked root-global pair.
# The --hostname-first spelling was already pinned; its sibling moved in the same merge
# with no assertion on it at all, so the pair was half-covered while the comment above it
# described both orderings. Ordering is the whole point of that row -- the extractor has to
# walk past a separate-arg global in either position.
# 159 -> 160: +1 for the discriminating single-global row, which the previous commit
# described as added while only adding it to a comment.
EXPECTED_TOTAL=160
if [ $((PASS + FAIL)) -ne "$EXPECTED_TOTAL" ]; then
  echo "FAIL: assertion total is $((PASS + FAIL)), expected $EXPECTED_TOTAL — an assertion was skipped (check stderr for 'command not found'), or the total changed without updating this pin"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
