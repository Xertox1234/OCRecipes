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
# Covers the two mktemp -d fixtures too: their inline `rm -rf`s only run on the happy path,
# so an interrupted run (Ctrl-C / SIGTERM — bash runs the EXIT trap for both) leaked them.
trap 'rm -f "$STAMP_FILE"; rm -rf "${HELPER_T:-}" "${NOLIB:-}"' EXIT

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

env -u GIT_DIR -u GIT_WORK_TREE git init -q "$DREPO"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" config user.email t@t
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" config user.name T
echo base > "$DREPO/base.txt"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" add base.txt
env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" commit -q -m init
DBASE=$(env -u GIT_DIR -u GIT_WORK_TREE git -C "$DREPO" symbolic-ref --short HEAD)
env -u GIT_DIR -u GIT_WORK_TREE git init --bare -q "$DORIGIN"
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

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
