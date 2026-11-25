#!/usr/bin/env bash
# Unit test for pr-preflight-guard.sh. Run by CI (Lint · Types · Patterns job).
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pr-preflight-guard.sh"
FAIL=0
# Pre-initialized so the EXIT trap below is safe under `set -u` before the fixtures exist.
HELPER_T=""; NOLIB=""
assert_contains() { case "$3" in *"$2"*) echo "ok: $1";; *) echo "FAIL: $1 — expected '$2' in: $3"; FAIL=1;; esac; }
assert_empty()    { if [ -z "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $3"; FAIL=1; fi; }

run_hook() { # $1=command  → stdout of hook
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')" | bash "$HOOK"
}

run_hook_tool() { # $1=tool_name  → stdout of hook (the tool call itself is the PR-create)
  printf '{"tool_name":%s,"tool_input":{"title":"x","body":"y"}}' "$(jq -Rn --arg t "$1" '$t')" | bash "$HOOK"
}

HEAD=$(git rev-parse HEAD 2>/dev/null || echo deadbeef)

# Point the gate at a THROWAWAY stamp file via the shared helper's override, so this
# test never reads or deletes a real pass-stamp (the global-/tmp clobber this fixes).
# Exported so the hook subprocess — which resolves the path through the helper — honors it.
STAMP_FILE="$(mktemp "${TMPDIR:-/tmp}/ocrecipes-preflight-test.XXXXXX")"
rm -f "$STAMP_FILE"   # start with NO stamp present
export PREFLIGHT_STAMP_FILE="$STAMP_FILE"
# This file's 26 pre-existing tests run against THIS real checkout (no GIT_DIR override —
# unlike test-branch-preflight.sh's hermetic temp repo). Once the new base-branch-drift
# check below can fetch `origin`, every test that reaches "stamp fresh -> allow" would
# ALSO fire a REAL network fetch against the real GitHub remote. Blanket-skip it here;
# the new hermetic section near the end unsets this for its own scope.
export SKIP_PR_DRIFT_CHECK=1
# Same reason for the verdict-diff check (harness N7): on a branch that changes a guard or keyword
# file, every "fresh stamp allows" test above would deny for want of a verdict-diff stamp. The
# hermetic section 17 near the end re-enables it for its own scope.
export SKIP_VERDICT_DIFF=1
# Covers the two mktemp -d fixtures too: their inline `rm -rf`s only run on the happy path,
# so an interrupted run (Ctrl-C / SIGTERM — bash runs the EXIT trap for both) leaked them.
trap 'rm -rf "$STAMP_FILE" "$STAMP_FILE.d" "$STAMP_FILE.out" "${HELPER_T:-}" "${NOLIB:-}"' EXIT

# 1. Non-create gh commands pass through (no deny).
OUT=$(run_hook "gh pr view 42")
assert_empty "gh pr view passes through" "" "$OUT"

# 2. gh pr create with NO stamp → deny.
rm -f "$STAMP_FILE"
OUT=$(run_hook "gh pr create --title x --body y")
assert_contains "no stamp denies create" '"permissionDecision": "deny"' "$OUT"

# 3. gh pr create with a FRESH stamp (== HEAD) → allow (no deny output).
echo "$HEAD" > "$STAMP_FILE"
OUT=$(run_hook "gh pr create --title x --body y")
assert_empty "fresh stamp allows create" "" "$OUT"
rm -f "$STAMP_FILE"

# 3b. A stamp for a DIFFERENT sha (stale) → deny (must match HEAD exactly).
echo "0000000000000000000000000000000000000000" > "$STAMP_FILE"
OUT=$(run_hook "gh pr create --title x --body y")
assert_contains "stale stamp (wrong sha) denies" '"permissionDecision": "deny"' "$OUT"
rm -f "$STAMP_FILE"

# 3c. Per-commit stamps (item 8, 2026-11-01): HEAD passed, then a parallel session's push on
# another branch rewrote the single slot. HEAD's own pass must still count — all 6 stale-stamp
# denials in 10-30..11-01 were this.
OTHER=1111111111111111111111111111111111111111
( . "$(dirname "$HOOK")/../../scripts/lib/preflight-stamp-path.sh"
  preflight_stamp_write "$HEAD" && preflight_stamp_write "$OTHER" )
OUT=$(run_hook "gh pr create --title x --body y")
assert_empty "HEAD's pass survives another branch's later stamp" "" "$OUT"
# The single slot names the newest pass, so the deny below can say what it found.
assert_contains "single slot holds the newest pass" "$OTHER" "$(cat "$STAMP_FILE")"
rm -rf "$STAMP_FILE" "$STAMP_FILE.d"

# 3d. Only ANOTHER commit has passed → still deny; the message names what it found.
( . "$(dirname "$HOOK")/../../scripts/lib/preflight-stamp-path.sh"; preflight_stamp_write "$OTHER" )
OUT=$(run_hook "gh pr create --title x --body y")
assert_contains "another commit's pass alone denies" '"permissionDecision": "deny"' "$OUT"
assert_contains "deny names the newest pass" "found: 1111111" "$OUT"
rm -rf "$STAMP_FILE" "$STAMP_FILE.d"

# 3e. A name that is not a sha is never written and never matches (the stamp dir is in /tmp).
( . "$(dirname "$HOOK")/../../scripts/lib/preflight-stamp-path.sh"
  preflight_stamp_write "../escape" ; preflight_stamp_has "../escape" && echo MATCHED ) > "$STAMP_FILE.out" 2>&1
assert_empty "non-sha stamp name refused" "" "$(cat "$STAMP_FILE.out"; ls "$STAMP_FILE.d" 2>/dev/null)"
rm -rf "$STAMP_FILE" "$STAMP_FILE.d" "$STAMP_FILE.out"

# 4. Bypass env → allow.
OUT=$(SKIP_PR_PREFLIGHT=1 run_hook "gh pr create --title x --body y")
assert_empty "bypass env allows create" "" "$OUT"

# 5. The phrase merely CONTAINED in a quoted arg (e.g. a commit message) must pass through — not deny.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'git commit -m "feat(gate): hard-block gh pr create without a stamp"')
assert_empty "phrase inside commit message passes through" "" "$OUT"

# 6. A real chained invocation after && is still caught (deny, no stamp).
rm -f "$STAMP_FILE"
OUT=$(run_hook 'cd /tmp && gh pr create --title x --body y')
assert_contains "chained gh pr create still denies" '"permissionDecision": "deny"' "$OUT"

# 6b. todos/P1-2026-08-17-quoted-command-substitution-inert.md — the
# exact reproduction string from that todo's Background section: `gh pr create
# --fill` hidden inside a quoted $(...) command substitution. bash executes
# $(...)  regardless of the surrounding double quotes, so this genuinely
# invokes gh pr create — verified (before that fix) to return NO stamp-gate
# JSON at all by piping this identical command into this live hook, versus the
# bare form (test 2 above) which correctly triggered the gate.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'echo "$(gh pr create --fill)"')
assert_contains "gh pr create hidden in a quoted \$(...) substitution still denies" \
  '"permissionDecision": "deny"' "$OUT"
# Two-sided control: the SAME text, single-quoted, is genuinely inert in bash
# (single quotes disable command substitution entirely) and must pass through.
rm -f "$STAMP_FILE"
OUT=$(run_hook "echo '\$(gh pr create --fill)'")
assert_empty "the SAME text, single-quoted (genuinely inert), passes through" "" "$OUT"

# 7. MCP create_pull_request with NO stamp → deny (the default /todo PR-create path).
rm -f "$STAMP_FILE"
OUT=$(run_hook_tool "mcp__github__create_pull_request")
assert_contains "mcp create with no stamp denies" '"permissionDecision": "deny"' "$OUT"

# 8. MCP create_pull_request with a FRESH stamp (== HEAD) → allow.
echo "$HEAD" > "$STAMP_FILE"
OUT=$(run_hook_tool "mcp__github__create_pull_request")
assert_empty "mcp create with fresh stamp allows" "" "$OUT"
rm -f "$STAMP_FILE"

# 9. A non-create github MCP tool passes through (only create_pull_request is gated).
OUT=$(run_hook_tool "mcp__github__list_pull_requests")
assert_empty "other github mcp tool passes through" "" "$OUT"

# 10. MCP create with bypass env → allow.
rm -f "$STAMP_FILE"
OUT=$(SKIP_PR_PREFLIGHT=1 run_hook_tool "mcp__github__create_pull_request")
assert_empty "mcp create bypass env allows" "" "$OUT"

# 11. A shell separator INSIDE a quoted arg (echo/grep text) must pass through — not deny.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'echo "see (gh pr create vs the mcp tool)"')
assert_empty "separator-in-quoted-string passes through" "" "$OUT"

# 12. ...but an UNQUOTED `gh pr create` after a separator still denies (regression guard).
rm -f "$STAMP_FILE"
OUT=$(run_hook 'true; gh pr create --title x')
assert_contains "unquoted separator+create still denies" '"permissionDecision": "deny"' "$OUT"

# 12b. Env-assignment prefixes must not evade the gate (2026-07-18 harness-audit M6).
rm -f "$STAMP_FILE"
OUT=$(run_hook 'FOO=1 gh pr create --title x')
assert_contains "env-prefixed create still denies" '"permissionDecision": "deny"' "$OUT"

# 12c. Quoted env value — quote-strip leaves `FOO= ` — still denies.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'GH_TOKEN="x" gh pr create --title x')
assert_contains "quoted-env-prefixed create still denies" '"permissionDecision": "deny"' "$OUT"

# 12d. Separator + env prefix still denies.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'cd /tmp && FOO=1 gh pr create --title x')
assert_contains "chained env-prefixed create denies" '"permissionDecision": "deny"' "$OUT"

# 12e. Escaped-quote GLUE must not evade the gate (Phase 6 review of the 2026-07-18 audit):
# a naive quote-strip pairs the \" inside the first arg with the quote opening --title's arg,
# deleting the separator AND `gh pr create` — the hook then falls through to allow.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'echo "escaped \" quote" && gh pr create --title "x"')
assert_contains "escaped-quote glue still denies" '"permissionDecision": "deny"' "$OUT"

# 12f. Subshell form with no args after create (closing paren, no trailing space) still denies.
rm -f "$STAMP_FILE"
OUT=$(run_hook '(FOO=1 gh pr create)')
assert_contains "parenthesized bare create denies" '"permissionDecision": "deny"' "$OUT"

# 12g. Apostrophe-GLUE must not evade the gate (2026-07-18 audit /code-review, finding #1):
# a bare `'` inside a DOUBLE-quoted span (e.g. the word "don't") is a literal, NOT a delimiter —
# but the two-independent-sed strip pairs it with the next single quote and deletes the real
# `&& gh pr create` between them. A context-AWARE single-pass scan must keep the `'` literal.
rm -f "$STAMP_FILE"
OUT=$(run_hook "echo \"don't\" && gh pr create --title 'fix'")
assert_contains "apostrophe-glue create still denies" '"permissionDecision": "deny"' "$OUT"

# 12h. A command-position runner word (env/command/nohup/...) before the target must not evade
# the gate (2026-07-18 audit /code-review, finding #2): `env NAME=val gh pr create` runs gh in
# command position, but a prefix that only accepts `NAME=val` assignments (not the bare word
# `env`) falls through to allow.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'env GH_TOKEN=x gh pr create --title x')
assert_contains "env-runner-word create still denies" '"permissionDecision": "deny"' "$OUT"

# 12i. A QUOTE inside a command word (2026-08-16). cmd_is_gh_pr_create reads `cmd_words`, which
# DELETES quote characters — so the necessary-substring fast path must read that same rendering.
# While it filtered raw $CMD, `g"h" pr create` contained no literal `gh`, the hook exited 0
# before the matcher ran, and a PR could be opened with no preflight stamp at all.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'g"h" pr create --title x --body y')
assert_contains "quoted-runner-word create still denies (fast path reads \$WORDS)" \
  '"permissionDecision": "deny"' "$OUT"
rm -f "$STAMP_FILE"
OUT=$(run_hook 'gh pr "create" --title x --body y')
assert_contains "quoted-subcommand create still denies" '"permissionDecision": "deny"' "$OUT"
# Negative control for the pair above: the fast path must still let unrelated work through.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'echo "gh pr create is what this gate covers"')
assert_empty "a quoted MENTION of gh pr create passes through" "" "$OUT"

# 12i-b. $-SIGIL fast-path bypass (2026-08-16 review): cmd_words deletes the `$` when
# it immediately precedes a quote, rejoining g$'h' -> gh. The fast-path filter's
# quote-strip omits `$`, so `g$'h' pr create --fill` misses the raw `gh` substring on
# BOTH stages while cmd_words correctly reconstructs `gh pr create --fill` — the hook
# exits 0 before cmd_is_gh_pr_create ever runs, opening a PR with no preflight stamp.
rm -f "$STAMP_FILE"
OUT=$(run_hook "g\$'h' pr create --fill")
assert_contains "\$-sigil-split gh still denies (fast path reads the \$-stripped form)" \
  '"permissionDecision": "deny"' "$OUT"

# 12j. awk PRESENT BUT BROKEN. `declare -F cmd_words` proves the function is DEFINED, not that
# it WORKS — cmd_words is implemented in awk, so a broken awk makes it emit NOTHING while the
# lib still sources cleanly. Both the fast path and cmd_is_gh_pr_create then see an empty
# rendering and report "no match", which used to skip the stamp gate entirely and ALLOW a real
# `gh pr create`. Shadow awk with a failing stub rather than stripping PATH, so every other tool
# this gate needs (git, the stamp helper) stays reachable — a PATH that loses those makes the
# hook exit for an unrelated reason and the result stops meaning anything.
AWKSTUB=$(mktemp -d)
printf '#!/bin/sh\nexit 127\n' > "$AWKSTUB/awk"; chmod +x "$AWKSTUB/awk"
trap 'rm -f "$STAMP_FILE"; rm -rf "${HELPER_T:-}" "${NOLIB:-}" "${AWKSTUB:-}"' EXIT
run_hook_noawk() {
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')" \
    | PATH="$AWKSTUB:$PATH" bash "$HOOK"
}
# Control first: with awk WORKING and no stamp, this denies. If it did not, the two assertions
# below would be measuring a broken fixture rather than the gate.
rm -f "$STAMP_FILE"
OUT=$(run_hook 'gh pr create --title x --body y')
assert_contains "control: awk working + no stamp denies" '"permissionDecision": "deny"' "$OUT"
rm -f "$STAMP_FILE"
OUT=$(run_hook_noawk 'gh pr create --title x --body y')
assert_contains "broken awk still demands a stamp (fails CLOSED)" '"permissionDecision": "deny"' "$OUT"
rm -f "$STAMP_FILE"
OUT=$(run_hook_noawk 'ls -la')
assert_empty "broken awk leaves unrelated bash alone" "" "$OUT"

# 12k. $-SIGIL bypass in the broken-awk fallback (review round 4, 2026-08-17): the
# WORDS_BROKEN fallback's quote-strip (${CMD//[\"\']/}) omits \, newline, and $ —
# narrower than the primary fast path's 5-character strip a few lines above it. A
# $-sigil-split verb reconstructs to `gh pr create --fill` under cmd_words (the
# working-awk control below proves it denies), but on a broken-awk host the
# surviving $ hid it from this weaker fallback filter, exiting 0 with no stamp
# demanded.
rm -f "$STAMP_FILE"
OUT=$(run_hook "g\$'h' pr create --fill")
assert_contains "control: \$-sigil-split gh still denies with awk WORKING" \
  '"permissionDecision": "deny"' "$OUT"
rm -f "$STAMP_FILE"
OUT=$(run_hook_noawk "g\$'h' pr create --fill")
assert_contains "broken awk + \$-sigil-split gh still demands a stamp (fails CLOSED)" \
  '"permissionDecision": "deny"' "$OUT"

# 12l. Brace-grouped invocation must still deny (todos/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md):
# `{ ...; }` executes its body in the CURRENT shell (no subshell), so this genuinely invokes
# `gh pr create` — the shared _CMD_POS_PREFIX previously omitted `{` as a valid opener.
rm -f "$STAMP_FILE"
OUT=$(run_hook '{ gh pr create --title x; }')
assert_contains "brace-grouped create still denies" '"permissionDecision": "deny"' "$OUT"

# 13. Helper UN-SOURCEABLE → DENY. Locks the fail-safe: if the shared stamp-path helper
# can't be found, the guard must block (never silently allow a PR with no stamp).
#
# The hook resolves $ROOT from its OWN location (${BASH_SOURCE[0]}/../..), not from cwd, so
# "make the helper missing" means running a COPY of the hook from a tree that lacks it — a
# cwd change cannot hide the helper any more. (Before that change this test cd'd into a
# throwaway repo; it kept passing afterwards, but via a different branch entirely — the
# throwaway repo's stamp key had no stamp file — so it silently stopped testing the helper.)
#
# Two-sided, per docs/solutions/conventions/gate-test-needs-two-sided-negative-control:
# the ONLY difference between the two runs is whether scripts/lib/ exists in the hook's
# tree, so an ALLOW/DENY split isolates exactly the helper-presence variable.
HELPER_T=$(mktemp -d)
mkdir -p "$HELPER_T/.claude/hooks" "$HELPER_T/scripts/lib"
cp "$HOOK" "$HELPER_T/.claude/hooks/"
cp -R "$(dirname "$HOOK")/lib" "$HELPER_T/.claude/hooks/"        # so cmd-detect.sh still sources
# Absolute, derived from $HOOK — a relative `scripts/lib/...` here would only work while cwd
# happens to be the repo root, which is the very defect this hook set was just fixed for.
cp "$(dirname "$HOOK")/../../scripts/lib/preflight-stamp-path.sh" "$HELPER_T/scripts/lib/"
echo "$HEAD" > "$STAMP_FILE"
# negative control — helper PRESENT and the stamp matches HEAD → allow. Without this, the
# DENY below would be indistinguishable from "this fixture can never allow anything".
OUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x"}}' \
  | bash "$HELPER_T/.claude/hooks/pr-preflight-guard.sh")
assert_empty "helper present + fresh stamp allows (control for the fail-safe below)" "" "$OUT"
# positive — remove ONLY the helper; everything else is identical.
rm -rf "$HELPER_T/scripts"
OUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x"}}' \
  | bash "$HELPER_T/.claude/hooks/pr-preflight-guard.sh")
assert_contains "missing helper denies (fail-safe)" '"permissionDecision": "deny"' "$OUT"
rm -f "$STAMP_FILE"
rm -rf "$HELPER_T"

# 14. Scanner lib UNSOURCEABLE → still DENY (fail-CLOSED). The sourced-scanner refactor must
# not reintroduce a fail-OPEN: run a COPY of the hook from a dir with NO lib/ subdir, so
# cmd-detect.sh cannot be sourced. A plain `gh pr create` with no stamp must still deny via
# the raw-substring fallback.
#
# SCOPE, precisely: $ROOT is ${BASH_SOURCE[0]}-derived (pr-preflight-guard.sh:60), so the
# copy's root is the mktemp dir's GRANDPARENT — the stamp helper does not resolve there
# either, and the rm below has already removed the stamp. The DENY is therefore
# OVER-DETERMINED: it proves "no fail-OPEN when the scanner lib is unsourceable", but it is
# NOT attributable to the missing lib alone. Test 13 above is the lib-ISOLATING, two-sided
# one (docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md).
# The paired `ls -la` assertion below is this test's own control: same fixture, unrelated
# command, must NOT deny — which is what pins the fallback's SCOPE.
rm -f "$STAMP_FILE"
NOLIB=$(mktemp -d)
cp "$HOOK" "$NOLIB/pr-preflight-guard.sh"
OUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x"}}' | bash "$NOLIB/pr-preflight-guard.sh")
assert_contains "lib-missing still denies (fail-closed)" '"permissionDecision": "deny"' "$OUT"
# ...but lib-missing must NOT block unrelated Bash (the fallback is scoped to plausible creates).
OUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | bash "$NOLIB/pr-preflight-guard.sh")
assert_empty "lib-missing leaves unrelated bash alone" "" "$OUT"
# Same $-sigil gap as the WORDS_BROKEN fallback (test 12k) — the lib-unsourceable
# branch uses the identical weaker ${CMD//[\"\']/} strip.
OUT=$(jq -Rn --arg c "g\$'h' pr create --fill" '{tool_name:"Bash",tool_input:{command:$c}}' | bash "$NOLIB/pr-preflight-guard.sh")
assert_contains "lib-missing + \$-sigil-split gh still demands a stamp (fails CLOSED)" \
  '"permissionDecision": "deny"' "$OUT"
rm -rf "$NOLIB"

# 15. Base-branch drift/overlap check (2026-08-28) — hermetic: a fake bare "origin" so this
# never touches the network. GIT_DIR/GIT_WORK_TREE override, unset again right after (the same
# hazard as test-branch-preflight.sh's header comment: these vars OVERRIDE `-C` for any other
# repo touched in this shell, so every git call on $CLONE below must strip them via `env -u`).
DREPO=$(mktemp -d); DORIGIN=$(mktemp -d); DCLONE=""
trap 'rm -f "$STAMP_FILE"; rm -rf "${HELPER_T:-}" "${NOLIB:-}" "${AWKSTUB:-}" "$DREPO" "$DORIGIN" "${DCLONE:-}"' EXIT

# --initial-branch=main is REQUIRED, not cosmetic: pr-preflight-guard.sh hardcodes BASE="main"
# (a deliberate scope decision — this repo's PRs always target main), so this fixture's base
# branch must literally be named "main" regardless of the runner's own git-init default.
# git's own built-in default (absent any init.defaultBranch config) is "master" on some
# versions/platforms and "main" on others — this passed locally (macOS git defaults to "main"
# here) but FAILED in CI (ubuntu-latest's git defaulted to something else), because a
# mismatched branch name makes `git rev-parse -q --verify origin/main` fail inside the hook,
# which silently no-ops the whole drift check (allow) instead of the deny these tests expect.
# Reproduced locally by forcing --initial-branch=master and confirming the identical CI
# failure, before landing this fix (2026-08-28).
env -u GIT_DIR -u GIT_WORK_TREE git init -q --initial-branch=main "$DREPO"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" config user.email t@t
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" config user.name T
echo base > "$DREPO/base.txt"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" add base.txt
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" commit -q -m init
DBASE="main"
# The BARE origin needs --initial-branch=main too, not just $DREPO: `git init --bare` sets the
# new repo's HEAD symref from the ambient default at CREATION time, before anything is ever
# pushed to it. Pushing "main" afterward does not retarget that symref — if it was created
# pointing at "refs/heads/master" (this repo's actual default under the CI runner's config),
# it now points at a branch that was never pushed and doesn't exist, and `git clone` (which
# checks out whatever HEAD points to) fails or produces an unrelated/orphan checkout. That
# broken clone is what later reproduced as "failed to push some refs" from advance_origin below.
env -u GIT_DIR -u GIT_WORK_TREE git init --bare -q --initial-branch=main "$DORIGIN"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" remote add origin "$DORIGIN"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" push -q origin "$DBASE"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" switch -c feature/x -q

# advance_origin <file> — commits+pushes a change to <file> on $DBASE from a throwaway
# clone, so $DORIGIN moves ahead of $DREPO without $DREPO's own branch changing.
advance_origin() {
  DCLONE=$(mktemp -d)
  env -u GIT_DIR -u GIT_WORK_TREE git clone -q "$DORIGIN" "$DCLONE"
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$DCLONE" config user.email t@t
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$DCLONE" config user.name T
  echo changed >> "$DCLONE/$1"
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$DCLONE" add "$1"
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$DCLONE" commit -q -m "landed on $DBASE: $1"
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$DCLONE" push -q origin "$DBASE"
  rm -rf "$DCLONE"; DCLONE=""
}

run_hook_hermetic() { # $1=command  → stdout of hook, against $DREPO with a fresh stamp
  local head; head=$(env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" rev-parse HEAD)
  echo "$head" > "$STAMP_FILE"
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')" \
    | GIT_DIR="$DREPO/.git" GIT_WORK_TREE="$DREPO" bash "$HOOK"
}

# 15a. No drift at all → allow.
OUT=$(SKIP_PR_DRIFT_CHECK= run_hook_hermetic "gh pr create --title x --body y")
assert_empty "no base drift: allow" "" "$OUT"

# 15b. Base advances on an UNRELATED file → still allow (no overlap with this PR's own diff).
echo mine > "$DREPO/pr-file.txt"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" add pr-file.txt
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" commit -q -m "add pr-file.txt"
advance_origin "unrelated.txt"
OUT=$(SKIP_PR_DRIFT_CHECK= run_hook_hermetic "gh pr create --title x --body y")
assert_empty "base drift on an unrelated file: still allow" "" "$OUT"

# 15c. Base advances on a file THIS PR ALSO changed (this session's own incident, replayed) →
# deny, message names the file.
echo mine2 > "$DREPO/shared.txt"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" add shared.txt
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" commit -q -m "add shared.txt"
advance_origin "shared.txt"
OUT=$(SKIP_PR_DRIFT_CHECK= run_hook_hermetic "gh pr create --title x --body y")
assert_contains "overlapping base drift: deny" '"permissionDecision": "deny"' "$OUT"
if grep -q "shared.txt" <<<"$OUT"; then
  echo "ok: deny message names the overlapping file"
else
  echo "FAIL: deny message should name shared.txt"; FAIL=1
fi

# 15d. SKIP_PR_DRIFT_CHECK=1 bypasses just this check, even with a real overlap present.
OUT=$(SKIP_PR_DRIFT_CHECK=1 run_hook_hermetic "gh pr create --title x --body y")
assert_empty "SKIP_PR_DRIFT_CHECK=1 bypasses the drift check" "" "$OUT"

# 15e. A stale-stamp deny still wins over drift (stamp check runs first; unchanged priority).
# Review, 2026-08-28: the original version of this test left SKIP_PR_DRIFT_CHECK=1 globally
# set, which structurally disables the drift check regardless of ordering — it could not have
# distinguished "stamp check wins by priority" from "drift check never engaged at all." Fix:
# explicitly ENABLE the drift check (empty value) with a real overlap still present (shared.txt,
# from 15c), so a priority regression would surface the DRIFT reason instead. A ref-position
# check proves the drift fetch genuinely never ran (silence/wrong-reason alone wouldn't).
#
# SECOND review pass, 2026-08-28: that ref-position check was itself inadequate as first
# written — by this point 15c's own (correctly-enabled) drift check had already fetched
# refs/remotes/origin/$DBASE up to origin's CURRENT tip, so a wrongly-reintroduced fetch here
# would be a no-op against an already-synced ref, and the assertion passed even against a hook
# with the priority bug deliberately reintroduced (verified via mutation testing: removing the
# stamp-deny's `exit 0` left this test green). Advancing the remote ONE MORE TIME immediately
# before capturing REF_BEFORE gives a wrongful fetch something NEW to move the ref to,
# restoring the assertion's power to actually distinguish "never fetched" from "fetched but
# coincidentally no-op'd."
advance_origin "another.txt"
REF_BEFORE=$(env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" rev-parse "refs/remotes/origin/$DBASE")
echo "0000000000000000000000000000000000000000" > "$STAMP_FILE"
OUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x --body y"}}' \
  | SKIP_PR_DRIFT_CHECK= GIT_DIR="$DREPO/.git" GIT_WORK_TREE="$DREPO" bash "$HOOK")
assert_contains "stale stamp denies even with drift enabled+present (stamp check runs first)" \
  '"permissionDecision": "deny"' "$OUT"
if grep -qi "pass-stamp" <<<"$OUT"; then
  echo "ok: the stale-stamp reason, not the drift reason, is what's reported"
else
  echo "FAIL: expected the stamp reason to win"; FAIL=1
fi
# grep -qi "pass-stamp" alone can't rule out a SECOND, concatenated drift-deny JSON following
# the stamp-deny one (both would contain "deny", and the stamp JSON's own text still contains
# "pass-stamp" even with a second JSON appended after it) — count decisions explicitly.
DECISIONS=$(printf '%s' "$OUT" | grep -c '"permissionDecision"')
if [ "$DECISIONS" = 1 ]; then
  echo "ok: exactly one decision object emitted (not the stamp-deny plus a second drift-deny)"
else
  echo "FAIL: expected exactly 1 permissionDecision, got $DECISIONS"; FAIL=1
fi
REF_AFTER=$(env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" rev-parse "refs/remotes/origin/$DBASE")
if [ "$REF_BEFORE" = "$REF_AFTER" ]; then
  echo "ok: the drift check's fetch never ran (remote-tracking ref unchanged) — proves priority, not just silence"
else
  echo "FAIL: the drift fetch ran despite the stamp check already denying"; FAIL=1
fi
rm -f "$STAMP_FILE"

# --- The stamp is checked against the PR's OWN branch, not the cwd's HEAD (2026-10-13) ---
# Work happens in linked worktrees while the session's cwd is the main checkout, so the gate
# read the wrong commit and denied every worktree PR. When the call names a head branch
# (MCP tool_input.head, or `gh pr create --head <b>` / `--head=<b>` / `-H <b>`), the gate
# resolves THAT branch's commit (local ref first, then origin/<b>). With no head named, or an
# unresolvable one, it keeps using HEAD.
PRB="pr-guard-test-$$"
# A fresh parentless commit of HEAD's tree: a sha that differs from HEAD without needing any
# history (CI checks out depth 1, so HEAD~1 does not exist there). Identity is set inline so
# commit-tree works on a runner with no git user configured.
PRB_SHA=$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t \
  git commit-tree "HEAD^{tree}" -m "pr-guard head-branch test" 2>/dev/null || echo "")
if [ -n "$PRB_SHA" ] && git update-ref "refs/heads/$PRB" "$PRB_SHA" 2>/dev/null; then
  # Extends (never replaces) the earlier EXIT traps' cleanup list, plus the temp ref.
  trap 'rm -f "$STAMP_FILE"; rm -rf "${HELPER_T:-}" "${NOLIB:-}" "${AWKSTUB:-}" "${DREPO:-}" "${DORIGIN:-}" "${DCLONE:-}"; git update-ref -d "refs/heads/'"$PRB"'" 2>/dev/null' EXIT
  run_mcp_head() { printf '{"tool_name":"mcp__github__create_pull_request","tool_input":{"title":"x","body":"y","head":%s,"base":"main"}}' "$(jq -Rn --arg h "$1" '$h')" | bash "$HOOK"; }

  echo "$PRB_SHA" > "$STAMP_FILE"
  # Quoted text must never pick the head: a body/title that QUOTES a --head flag naming the
  # stamped branch must not let the stamp cover a different (unstamped) PR branch.
  OUT=$(run_hook "gh pr create --head no-such-branch-$$ --title x --body \"see --head $PRB\"")
  assert_contains "gh: a --head quoted in --body cannot override the real --head" '"permissionDecision": "deny"' "$OUT"
  OUT=$(run_hook "gh pr create --title x --body \"see --head $PRB\"")
  assert_contains "gh: a --head that exists only inside quotes is ignored (cwd HEAD checked)" '"permissionDecision": "deny"' "$OUT"
  OUT=$(run_hook "gh pr create --head $PRB --head no-such-branch-$$ --title x --body y")
  assert_contains "gh: two --head flags are ambiguous, fall back to cwd HEAD (deny)" '"permissionDecision": "deny"' "$OUT"
  OUT=$(run_mcp_head "$PRB")
  assert_empty "MCP: stamp for the named head branch allows (cwd HEAD differs)" "" "$OUT"
  OUT=$(run_mcp_head "Xertox1234:$PRB")
  assert_empty "MCP: owner:branch head form resolves too" "" "$OUT"
  OUT=$(run_hook "gh pr create --head $PRB --base main --title x --body y")
  assert_empty "gh --head <b>: stamp for that branch allows" "" "$OUT"
  OUT=$(run_hook "gh pr create --head=$PRB --title x --body y")
  assert_empty "gh --head=<b>: stamp for that branch allows" "" "$OUT"
  OUT=$(run_hook "gh pr create -H $PRB --title x --body y")
  assert_empty "gh -H <b>: stamp for that branch allows" "" "$OUT"

  echo "$HEAD" > "$STAMP_FILE"
  OUT=$(run_mcp_head "$PRB")
  assert_contains "MCP: a stamp for cwd HEAD does NOT cover a different named branch" '"permissionDecision": "deny"' "$OUT"
  OUT=$(run_hook "gh pr create --head $PRB --title x --body y")
  assert_contains "gh --head: a stamp for cwd HEAD does NOT cover a different named branch" '"permissionDecision": "deny"' "$OUT"

  OUT=$(run_mcp_head "no-such-branch-$$")
  assert_empty "MCP: unresolvable head falls back to cwd HEAD (stamp == HEAD allows)" "" "$OUT"
  rm -f "$STAMP_FILE"
  OUT=$(run_mcp_head "$PRB")
  assert_contains "MCP: named branch with no stamp still denies" '"permissionDecision": "deny"' "$OUT"
  git update-ref -d "refs/heads/$PRB" 2>/dev/null
else
  echo "FAIL: could not create the temp branch ref for the head-branch tests"; FAIL=1
fi

# --- The deny names the missing condition it found (2026-10-25) ---
# After #1436, 5 of 8 stamp denies followed pushes from linked worktrees where git ran NO
# hooks: husky writes a RELATIVE core.hooksPath, git resolves it against each worktree's own
# root, and the generated .husky/_ is absent there, so the push wrote no stamp. 3 retries
# also prefixed SKIP_PR_PREFLIGHT=1 to the command, which never reaches this hook (it reads
# its own environment). The deny now says both. What the gate accepts is unchanged.
assert_not_contains() { case "$3" in *"$2"*) echo "FAIL: $1 — did not expect '$2' in: $3"; FAIL=1;; *) echo "ok: $1";; esac; }
HWT=$(mktemp -d)
trap 'rm -f "$STAMP_FILE"; rm -rf "${HELPER_T:-}" "${NOLIB:-}" "${AWKSTUB:-}" "${DREPO:-}" "${DORIGIN:-}" "${DCLONE:-}" "${HWT:-}"' EXIT
hgit() { env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE \
  GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t git "$@"; }
run_in() { (cd "$1" && printf '{"tool_name":"mcp__github__create_pull_request","tool_input":{"title":"x","body":"y"}}' \
  | env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE bash "$HOOK"); }
hgit -C "$HWT" init -q main
hgit -C "$HWT/main" commit -q --allow-empty -m init
hgit -C "$HWT/main" worktree add -q "$HWT/wt" -b wt
mkdir -p "$HWT/main/.husky/_"
printf '#!/bin/sh\n' > "$HWT/main/.husky/_/pre-push"
chmod +x "$HWT/main/.husky/_/pre-push"
hgit -C "$HWT/main" config core.hooksPath .husky/_
rm -f "$STAMP_FILE"

OUT=$(run_in "$HWT/wt")
assert_contains "worktree with no runnable pre-push hook: still denies" '"permissionDecision": "deny"' "$OUT"
assert_contains "worktree with no runnable pre-push hook: the deny says git runs no pre-push hook here" \
  'runs no pre-push hook' "$OUT"
assert_contains "worktree with no runnable pre-push hook: the deny says to run preflight:fast here" \
  'npm run preflight:fast' "$OUT"
# Control: the main checkout, same relative value, shim present there — deny without the note.
OUT=$(run_in "$HWT/main")
assert_contains "control: main checkout with a runnable pre-push hook still denies" '"permissionDecision": "deny"' "$OUT"
assert_not_contains "control: main checkout with a runnable pre-push hook gets no hooks note" \
  'runs no pre-push hook' "$OUT"
# An absolute path reaches the shim from the worktree too — no note.
hgit -C "$HWT/main" config core.hooksPath "$HWT/main/.husky/_"
OUT=$(run_in "$HWT/wt")
assert_not_contains "worktree with an absolute hooksPath to a real shim gets no hooks note" \
  'runs no pre-push hook' "$OUT"
assert_contains "the deny says the bypass must come from Claude Code's environment, not a command prefix" \
  'a prefix on the command does not reach this hook' "$OUT"
# Acceptance unchanged: a stamp for the worktree's HEAD allows even where hooks cannot run.
hgit -C "$HWT/main" config core.hooksPath .husky/_
hgit -C "$HWT/wt" rev-parse HEAD > "$STAMP_FILE"
OUT=$(run_in "$HWT/wt")
assert_empty "worktree with no hooks but a fresh stamp for its HEAD still allows" "" "$OUT"
rm -f "$STAMP_FILE"
rm -rf "$HWT"

# 17. Verdict-diff stamp (harness N7, 2026-11-01): a PR whose branch changes a path listed in
# scripts/harness/verdict-diff/targets.tsv (read from the hook's own tree) needs
# <stamp dir>/<head sha>, written by scripts/harness/verdict-diff.sh. Hermetic: a temp repo with a
# hand-set refs/remotes/origin/main, so origin/main...HEAD is exactly the files committed here.
VREPO=$(mktemp -d); VSTAMPS=$(mktemp -d)
vgit() { hgit -C "$VREPO" "$@"; }
vrun() { # $1 = optional MCP head branch → stdout of the hook, run inside $VREPO, check enabled
  local in='{"tool_name":"mcp__github__create_pull_request","tool_input":{"title":"x","body":"y"}}'
  [ -n "${1:-}" ] && in=$(jq -cn --arg h "$1" '{tool_name:"mcp__github__create_pull_request",tool_input:{title:"x",body:"y",head:$h}}')
  (cd "$VREPO" && printf '%s' "$in" | env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u SKIP_VERDICT_DIFF \
    VERDICT_DIFF_STAMP_DIR="$VSTAMPS" bash "$HOOK")
}
vbranch() { # $1 = branch, $2 = file to change → leaves HEAD on the branch, preflight stamp = its sha
  vgit switch -q main; vgit switch -q -c "$1"
  mkdir -p "$VREPO/$(dirname "$2")"; echo "$1" >> "$VREPO/$2"
  vgit add -A; vgit commit -q -m "$1"; vgit rev-parse HEAD > "$STAMP_FILE"
}
vgit init -q --initial-branch=main
vgit commit -q --allow-empty -m init
vgit update-ref refs/remotes/origin/main "$(vgit rev-parse HEAD)"

vbranch g1 .claude/hooks/git-safety.sh
OUT=$(vrun)
assert_contains "verdict: guard changed, no verdict stamp → deny" '"permissionDecision": "deny"' "$OUT"
assert_contains "verdict: the deny names the tool to run" 'scripts/harness/verdict-diff.sh' "$OUT"
assert_contains "verdict: the deny names the changed file" '.claude/hooks/git-safety.sh' "$OUT"
touch "$VSTAMPS/$(vgit rev-parse HEAD)"
OUT=$(vrun)
assert_empty "verdict: guard changed, stamp for this head → allow" "" "$OUT"
rm -f "$VSTAMPS"/*
touch "$VSTAMPS/0000000000000000000000000000000000000000"
OUT=$(vrun)
assert_contains "verdict: stamp for another sha → deny" '"permissionDecision": "deny"' "$OUT"
OUT=$(SKIP_VERDICT_DIFF=1 bash -c 'cd "$1" && printf %s "{\"tool_name\":\"mcp__github__create_pull_request\",\"tool_input\":{}}" | env -u GIT_DIR -u GIT_WORK_TREE bash "$2"' _ "$VREPO" "$HOOK")
assert_empty "verdict: SKIP_VERDICT_DIFF=1 in the hook's environment → allow" "" "$OUT"

vbranch d1 docs/notes.md
OUT=$(vrun)
assert_empty "verdict: no registry path changed → allow without a verdict stamp" "" "$OUT"

vbranch l1 .claude/hooks/lib/cmd-detect.sh
OUT=$(vrun)
assert_contains "verdict: a lib/* glob row matches → deny" '"permissionDecision": "deny"' "$OUT"

vbranch k1 shared/constants/allergens.ts
OUT=$(vrun)
assert_contains "verdict: keyword file changed → deny" '"permissionDecision": "deny"' "$OUT"

# The named MCP head is the commit judged (same rule as the preflight stamp): cwd on main.
vbranch g2 .claude/hooks/guard-outward-cli.sh
G2=$(vgit rev-parse HEAD); vgit switch -q main
echo "$G2" > "$STAMP_FILE"
OUT=$(vrun g2)
assert_contains "verdict: named head g2 changed a guard, no stamp → deny" '"permissionDecision": "deny"' "$OUT"
touch "$VSTAMPS/$G2"
OUT=$(vrun g2)
assert_empty "verdict: named head g2 with its stamp → allow" "" "$OUT"

# Fail closed when the changed files cannot be computed.
vbranch g3 .claude/hooks/git-safety.sh
vgit update-ref -d refs/remotes/origin/main
OUT=$(vrun)
assert_contains "verdict: no origin/main to diff against → deny" '"permissionDecision": "deny"' "$OUT"
assert_contains "verdict: that deny names the bypass" 'SKIP_VERDICT_DIFF=1' "$OUT"
rm -f "$STAMP_FILE"
rm -rf "$VREPO" "$VSTAMPS"

# --- The hook's shell must not end without a decision (2026-11-25) -------------------------
# A PreToolUse hook that ends with no output is an ALLOW. Each tree is a COPY of the hook, its
# lib/ and scripts/lib/ (the hook finds scripts/lib relative to itself) with one line appended
# to one lib; the real libs are untouched. Run against THIS checkout with a throwaway stamp
# file, as the tests at the top are. Conditions grep a here-string, never `... | grep -q`.
export SKIP_PR_DRIFT_CHECK=1 SKIP_VERDICT_DIFF=1 PREFLIGHT_STAMP_FILE="$STAMP_FILE"
ND_HEAD=$(git rev-parse HEAD 2>/dev/null || echo deadbeef)
ND_SRC="$(cd "$(dirname "$HOOK")/../.." && pwd)"
ND_TREES=""
nd_tree() {  # $1=lib path relative to the repo root  $2=line appended ; prints the tree's root
  local d; d=$(mktemp -d)
  mkdir -p "$d/.claude/hooks" "$d/scripts"
  cp "$HOOK" "$d/.claude/hooks/pr-preflight-guard.sh"
  cp -R "$ND_SRC/.claude/hooks/lib" "$d/.claude/hooks/lib"
  cp -R "$ND_SRC/scripts/lib" "$d/scripts/lib"
  printf '\n%s\n' "$2" >> "$d/$1"
  printf '%s' "$d"
}
nd_stamp() { rm -rf "$STAMP_FILE" "$STAMP_FILE.d"; [ "$1" = fresh ] && echo "$ND_HEAD" > "$STAMP_FILE"; return 0; }
ND_BASH_CREATE='{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x --body y"}}'
ND_MCP_CREATE='{"tool_name":"mcp__github__create_pull_request","tool_input":{"title":"x","body":"y"}}'
ND_LS='{"tool_name":"Bash","tool_input":{"command":"ls -la"}}'
nd_run() {  # $1=tree root  $2=payload ; sets ND_OUT ND_RC ND_ERR
  local e; e=$(mktemp)
  ND_OUT=$(printf '%s' "$2" | bash "$1/.claude/hooks/pr-preflight-guard.sh" 2>"$e"); ND_RC=$?
  ND_ERR=$(cat "$e"); rm -f "$e"
}
nd_ok() { echo "ok: $1"; }
nd_bad() { echo "FAIL: $1 — got rc=$ND_RC out=${ND_OUT:0:260} err=${ND_ERR:0:160}"; FAIL=1; }
nd_only_deny() {  # exactly one JSON value, a deny, rc 0
  [ "$ND_RC" = 0 ] && [ "$(jq -s 'length' <<<"$ND_OUT" 2>/dev/null)" = 1 ] \
    && [ "$(jq -r '.hookSpecificOutput.permissionDecision' <<<"$ND_OUT" 2>/dev/null)" = deny ]
}
nd_reason_has() { local r; r=$(jq -r '.hookSpecificOutput.permissionDecisionReason' <<<"$ND_OUT" 2>/dev/null); grep -qF -- "$1" <<<"$r"; }
nd_silent() { [ -z "$ND_OUT" ] && [ "$ND_RC" = 0 ]; }
nd_check() { if "$2"; then nd_ok "$1"; else nd_bad "$1"; fi; }
# With NO stamp both ways of creating a PR deny; an ordinary command is silent.
nd_nostamp() {  # $1=label $2=tree
  nd_stamp none
  nd_run "$2" "$ND_BASH_CREATE"; nd_check "$1: gh pr create with no stamp denies, rc 0" nd_only_deny
  nd_run "$2" "$ND_MCP_CREATE";  nd_check "$1: the MCP create with no stamp denies, rc 0" nd_only_deny
  nd_run "$2" "$ND_LS";          nd_check "$1: an ordinary command is allowed, rc 0" nd_silent
}
# With a FRESH stamp: a healthy stamp lib allows; a broken one must still deny (fail closed).
nd_fresh() {  # $1=label $2=tree $3=allow|deny
  nd_stamp fresh
  nd_run "$2" "$ND_BASH_CREATE"
  if [ "$3" = allow ]; then nd_check "$1: gh pr create with a fresh stamp is allowed, rc 0" nd_silent
  else nd_check "$1: gh pr create denies even with a fresh stamp (the stamp cannot be read)" nd_only_deny; fi
  nd_stamp none
}

# ND0. Controls on the real hook, and nothing on stderr.
ND_REAL="$ND_SRC"
nd_nostamp "ND0 control (healthy libs)" "$ND_REAL"
nd_fresh "ND0 control (healthy libs)" "$ND_REAL" allow
nd_stamp none; nd_run "$ND_REAL" "$ND_BASH_CREATE"
if nd_only_deny && [ -z "$ND_ERR" ]; then nd_ok "ND0 a deny writes nothing to stderr"; else nd_bad "ND0 a deny writes nothing to stderr"; fi
nd_stamp fresh; nd_run "$ND_REAL" "$ND_BASH_CREATE"
if nd_silent && [ -z "$ND_ERR" ]; then nd_ok "ND0 an allow writes nothing to stderr"; else nd_bad "ND0 an allow writes nothing to stderr"; fi
nd_stamp none

# ND1. The two libs under .claude/hooks/lib: exits when sourced, a function that exits when
#      called, errexit left on, a shadowed builtin or command, text printed when sourced.
while IFS= read -r spec; do
  T=$(nd_tree ".claude/hooks/lib/${spec%%|*}" "${spec#*|}"); ND_TREES="$ND_TREES $T"
  nd_nostamp "ND1 ${spec%%|*} + '${spec#*|}'" "$T"
  nd_fresh "ND1 ${spec%%|*} + '${spec#*|}'" "$T" allow
done <<'SPECS'
fastpath-filter.sh|exit 0
cmd-detect.sh|exit 0
fastpath-filter.sh|cmd_fastpath_has() { exit 0; }
fastpath-filter.sh|cmd_fastpath_has() { exit 1; }
cmd-detect.sh|cmd_is_gh_pr_create() { exit 0; }
cmd-detect.sh|cmd_is_gh_pr_create() { exit 1; }
cmd-detect.sh|cmd_words() { exit 0; }
fastpath-filter.sh|set -e
cmd-detect.sh|set -e
cmd-detect.sh|jq() { exit 0; }
cmd-detect.sh|declare() { exit 0; }
cmd-detect.sh|git() { exit 0; }
cmd-detect.sh|printf() { :; }
cmd-detect.sh|echo "cmd-detect loaded"
SPECS

# ND1b. Security review of this change (on main too): the PR-create matcher renders the
#      command through cmd_words_deep. With THAT helper broken the matcher answered a clean
#      "not a PR-create" for everything, and an unstamped `gh pr create` was allowed.
while IFS= read -r spec; do
  T=$(nd_tree ".claude/hooks/lib/${spec%%|*}" "${spec#*|}"); ND_TREES="$ND_TREES $T"
  nd_nostamp "ND1b ${spec%%|*} + '${spec#*|}'" "$T"
  nd_fresh "ND1b ${spec%%|*} + '${spec#*|}'" "$T" allow
done <<'SPECS'
cmd-detect.sh|cmd_words_deep() { exit 0; }
cmd-detect.sh|cmd_words_deep() { return 1; }
cmd-detect.sh|unset -f cmd_words_deep
cmd-detect.sh|cmd_words_deep() { set -e; false; }
cmd-detect.sh|cd /
SPECS
# ND1d. A PARTLY broken matcher (confirmation review, on main too): it still says yes to the
#      bare three words, so a self-test on those alone passed, and then it missed a real call.
ND_CREATE_FLAGS='{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill"}}'
ND_CREATE_LINE2='{"tool_name":"Bash","tool_input":{"command":"git push\ngh pr create --fill"}}'
nd_stamp none
T=$(nd_tree .claude/hooks/lib/cmd-detect.sh "_CMD_POS_SUFFIX='\$'"); ND_TREES="$ND_TREES $T"
nd_run "$T" "$ND_CREATE_FLAGS"; nd_check "ND1d a suffix anchor that rejects flags after create: gh pr create --fill denies" nd_only_deny
T=$(nd_tree .claude/hooks/lib/cmd-detect.sh 'eval "_pp_real_$(declare -f cmd_words_deep)"; cmd_words_deep() { _pp_real_cmd_words_deep "$@" | head -1; }'); ND_TREES="$ND_TREES $T"
nd_run "$T" "$ND_CREATE_LINE2"; nd_check "ND1d a renderer that keeps only the first line: a create on line 2 denies" nd_only_deny
nd_run "$ND_REAL" "$ND_CREATE_LINE2"; nd_check "ND1d control: the healthy hook denies that two-line command" nd_only_deny
# ND1c. Control: with healthy libs the self-test does not turn a quoted mention into a deny.
nd_stamp none
nd_run "$ND_REAL" '{"tool_name":"Bash","tool_input":{"command":"echo \"gh pr create\""}}'
nd_check "ND1c control: a quoted mention of gh pr create is still allowed with no stamp" nd_silent
# ND2. The stamp lib under scripts/lib (sourced with no probe): the no-stamp deny must still
#      happen, and a stamp that cannot be read is no stamp, so a fresh one does not allow.
while IFS= read -r spec; do
  T=$(nd_tree "scripts/lib/${spec%%|*}" "${spec#*|}"); ND_TREES="$ND_TREES $T"
  nd_nostamp "ND2 ${spec%%|*} + '${spec#*|}'" "$T"
  nd_fresh "ND2 ${spec%%|*} + '${spec#*|}'" "$T" deny
done <<'SPECS'
preflight-stamp-path.sh|exit 0
preflight-stamp-path.sh|preflight_stamp_has() { exit 0; }
preflight-stamp-path.sh|preflight_stamp_has() { exit 1; }
preflight-stamp-path.sh|set -e
preflight-stamp-path.sh|git() { exit 0; }
SPECS
# A stamp lib that only PRINTS when sourced is harmless now (its text used to land ahead of
# the deny JSON): the stamp is still read, so a fresh one allows.
T=$(nd_tree scripts/lib/preflight-stamp-path.sh 'echo "stamp lib loaded"'); ND_TREES="$ND_TREES $T"
nd_nostamp "ND2 preflight-stamp-path.sh prints when sourced" "$T"
nd_fresh "ND2 preflight-stamp-path.sh prints when sourced" "$T" allow

# ND3. A signal mid-run (a lib function sends it). One deny, rc 0: the trap's, or, where the
#      runner starts the hook with that signal IGNORED (CI does for SIGPIPE), the ordinary one.
for sig in TERM PIPE ALRM USR1 USR2 HUP XCPU PROF IO; do
  T=$(nd_tree scripts/lib/preflight-stamp-path.sh "preflight_stamp_path() { kill -$sig \$\$; sleep 1; printf /nonexistent; }"); ND_TREES="$ND_TREES $T"
  nd_stamp fresh
  nd_run "$T" "$ND_BASH_CREATE"; nd_check "ND3 SIG$sig mid-run on gh pr create: one deny, rc 0" nd_only_deny
  nd_run "$T" "$ND_MCP_CREATE";  nd_check "ND3 SIG$sig mid-run on the MCP create: one deny, rc 0" nd_only_deny
done
nd_stamp none
# ND4. The deny cannot be rendered: a jq on PATH that reads the envelope but prints nothing
#      for `jq -n`. A static deny is printed instead.
ND_JQ=$(mktemp -d); ND_TREES="$ND_TREES $ND_JQ"
printf '#!/usr/bin/env bash\n[ "$1" = -n ] && exit 0\nexec %q "$@"\n' "$(command -v jq)" > "$ND_JQ/jq"; chmod +x "$ND_JQ/jq"
for ND_PAYLOAD in "$ND_BASH_CREATE" "$ND_MCP_CREATE"; do
  ND_OUT=$(printf '%s' "$ND_PAYLOAD" | PATH="$ND_JQ:$PATH" bash "$HOOK" 2>/dev/null); ND_RC=$?; ND_ERR=""
  if nd_only_deny && nd_reason_has 'could not render its reason'; then nd_ok "ND4 the deny cannot be rendered: a static deny, rc 0"
  else nd_bad "ND4 the deny cannot be rendered: a static deny, rc 0"; fi
done
# shellcheck disable=SC2086
rm -rf $ND_TREES
rm -rf "$STAMP_FILE" "$STAMP_FILE.d"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
