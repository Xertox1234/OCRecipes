#!/usr/bin/env bash
# Tests for scripts/checkpoint.sh, .claude/hooks/checkpoint.sh and cmd-detect's
# work-discarder detector (spec 2026-09-27 §4, §7.1). No Postgres needed — runs in CI.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
CKPT="$PROJECT_ROOT/scripts/checkpoint.sh"
HOOK="$HOOK_DIR/checkpoint.sh"
FAIL=0
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected [$3], got [$2]"; FAIL=1; fi; }
assert_ne()       { if [ "$2" != "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — both [$2]"; FAIL=1; fi; }
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got [$2]"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing [$3] in [$2]"; FAIL=1; fi; }

# --- cmd_git_work_discarder_verb --------------------------------------------------------
verb() { ( . "$HOOK_DIR/lib/cmd-detect.sh" >/dev/null 2>&1; cmd_git_work_discarder_verb "$1" ) 2>/dev/null; }
assert_eq "detector: checkout --"          "$(verb 'git checkout -- .')" "checkout"
assert_eq "detector: restore"              "$(verb 'git restore a.ts')" "restore"
assert_eq "detector: reset --hard"         "$(verb 'git reset --hard')" "reset"
assert_eq "detector: stash"                "$(verb 'git stash')" "stash"
assert_eq "detector: clean -fd"            "$(verb 'git clean -fd')" "clean"
assert_eq "detector: switch -f"            "$(verb 'git switch -f b')" "switch"
assert_eq "detector: -C global then verb"  "$(verb 'git -C /tmp/somewhere checkout -- x')" "checkout"
assert_eq "detector: after &&"             "$(verb 'npm test && git stash')" "stash"
assert_empty "detector: status"            "$(verb 'git status')"
assert_empty "detector: -C path holds verb" "$(verb 'git -C /tmp/checkout-dir status')"
assert_eq "detector: -C value that IS a bare verb reports it (documented, harmless)" "$(verb 'git -C checkout status')" "checkout"
assert_empty "detector: quoted mention"    "$(verb 'echo "git checkout -- x"')"
assert_empty "detector: echo then git"     "$(verb 'echo git checkout -- x')"
assert_eq "detector: multiple invocations, first wins" "$(verb 'git stash && git checkout main')" "stash"
assert_eq "detector: glued separator ;"                "$(verb 'git stash;true')" "stash"

# --- scripts/checkpoint.sh ---------------------------------------------------------------
TMPROOT=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/ckpt-test-XXXXXX")" && pwd -P)
trap 'rm -rf "$TMPROOT"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1   # hermetic: no user config/hooks
mkrepo() { # $1 name -> path of a repo with one commit (tracked.txt, other.txt)
  local d="$TMPROOT/$1"; mkdir -p "$d"
  git -C "$d" init -q -b main; git -C "$d" config user.email t@t; git -C "$d" config user.name t
  printf 'base\n' > "$d/tracked.txt"; printf 'keep\n' > "$d/other.txt"
  git -C "$d" add -A; git -C "$d" commit -qm init; printf '%s' "$d"
}
refs_of() { git -C "$1" for-each-ref --format='%(refname)' refs/checkpoints/; }
idx_sum() { shasum "$(git -C "$1" rev-parse --path-format=absolute --git-path index)" | cut -d' ' -f1; }
cap() { bash "$CKPT" capture --session "${2:-sess0001}" --trigger "${3:-agent}" --cwd "$1"; }

# #956 regression: a reviewer's checkout+clean destroys tracked repairs AND a new test file.
R=$(mkrepo r956)
printf 'repair\n' >> "$R/tracked.txt"; mkdir -p "$R/tests"; printf 'new test\n' > "$R/tests/new.test.ts"
cap "$R"
REF=refs/checkpoints/sess0001/main
assert_ne "956: ref created" "$(git -C "$R" rev-parse -q --verify "$REF" || echo none)" "none"
git -C "$R" checkout -q -- . && git -C "$R" clean -qfd
assert_eq "956: precondition — repairs destroyed" "$(cat "$R/tracked.txt")" "base"
git -C "$R" restore --source="$REF" --worktree -- tracked.txt tests/new.test.ts
assert_eq "956: tracked repair recovered" "$(cat "$R/tracked.txt")" "$(printf 'base\nrepair')"
assert_eq "956: untracked test recovered" "$(cat "$R/tests/new.test.ts")" "new test"

# Non-mutation. other.txt gets a stat-only change so a plain `git status` WOULD rewrite the
# real index — the regime the --no-optional-locks requirement exists for.
R=$(mkrepo rnm)
printf 'edit\n' >> "$R/tracked.txt"; printf 'u\n' > "$R/untracked.txt"
touch -m -t 202001010000 "$R/other.txt"
H0=$(git -C "$R" rev-parse HEAD); I0=$(idx_sum "$R"); S0=$(git -C "$R" --no-optional-locks status --porcelain)
cap "$R"
assert_eq "non-mutation: HEAD unchanged"             "$(git -C "$R" rev-parse HEAD)" "$H0"
assert_eq "non-mutation: real index bytes unchanged" "$(idx_sum "$R")" "$I0"
assert_eq "non-mutation: status unchanged"           "$(git -C "$R" --no-optional-locks status --porcelain)" "$S0"
assert_empty "non-mutation: untracked stays untracked" "$(git -C "$R" ls-files untracked.txt)"
git -C "$R" status >/dev/null 2>&1
assert_ne "non-mutation positive control: plain status DOES rewrite this index" "$(idx_sum "$R")" "$I0"
git -C "$R" worktree add -q "$TMPROOT/rnm-wt" -b side
W="$TMPROOT/rnm-wt"; printf 'wt edit\n' >> "$W/tracked.txt"; touch -m -t 202001010000 "$W/other.txt"
I1=$(idx_sum "$W"); cap "$W"
assert_eq "non-mutation (linked worktree): real index bytes unchanged" "$(idx_sum "$W")" "$I1"

# Chain + unchanged-tree skip.
R=$(mkrepo rch); printf 'one\n' >> "$R/tracked.txt"; cap "$R"
C1=$(git -C "$R" rev-parse refs/checkpoints/sess0001/main)
cap "$R"
assert_eq "chain: unchanged tree adds no commit" "$(git -C "$R" rev-parse refs/checkpoints/sess0001/main)" "$C1"
printf 'two\n' >> "$R/tracked.txt"; cap "$R"
C2=$(git -C "$R" rev-parse refs/checkpoints/sess0001/main)
assert_ne "chain: changed tree adds a commit" "$C2" "$C1"
assert_eq "chain: first parent is the previous checkpoint" "$(git -C "$R" rev-parse "$C2^1")" "$C1"
assert_eq "chain: second parent is HEAD" "$(git -C "$R" rev-parse "$C2^2")" "$(git -C "$R" rev-parse HEAD)"
assert_eq "chain: first checkpoint has exactly one parent" "$(git -C "$R" rev-list --parents -n1 "$C1" | wc -w | tr -d ' ')" "2"

# Multi-worktree: dirty ones captured under their keys, clean one skipped.
R=$(mkrepo rmw)
git -C "$R" worktree add -q "$TMPROOT/rmw-a" -b wa; git -C "$R" worktree add -q "$TMPROOT/rmw-b" -b wb
printf 'x\n' >> "$R/tracked.txt"; printf 'y\n' >> "$TMPROOT/rmw-a/tracked.txt"
cap "$R"
assert_eq "multi: only dirty worktrees, keyed main / gitdir name" "$(refs_of "$R" | sort | tr '\n' ' ')" "refs/checkpoints/sess0001/main refs/checkpoints/sess0001/rmw-a "

# A MAIN checkout whose path has an ancestor named `worktrees` is still keyed `main`.
mkdir -p "$TMPROOT/worktrees"
R=$(mkrepo worktrees/rnested); printf 'x\n' >> "$R/tracked.txt"; cap "$R"
assert_eq "multi: main checkout under a dir named worktrees keyed main" "$(refs_of "$R")" "refs/checkpoints/sess0001/main"

# CAS: a racing writer between the prev read and the update wins; we never overwrite it.
R=$(mkrepo rcas); printf 'x\n' >> "$R/tracked.txt"
PLANT=$(git -C "$R" commit-tree "$(git -C "$R" rev-parse 'HEAD^{tree}')" -m planted)
CHECKPOINT_TEST_RACE="$PLANT" cap "$R"
assert_eq "CAS: first write loses to a racing writer" "$(git -C "$R" rev-parse refs/checkpoints/sess0001/main)" "$PLANT"
printf 'y\n' >> "$R/tracked.txt"
PLANT2=$(git -C "$R" commit-tree "$(git -C "$R" rev-parse 'HEAD^{tree}')" -m planted2)
CHECKPOINT_TEST_RACE="$PLANT2" cap "$R"
assert_eq "CAS: chained write loses to a racing writer" "$(git -C "$R" rev-parse refs/checkpoints/sess0001/main)" "$PLANT2"

# Review Focus 5: two captures at once keep the ref a valid commit.
R=$(mkrepo rpar); printf 'x\n' >> "$R/tracked.txt"
cap "$R" & cap "$R" & wait
assert_eq "parallel: ref is a commit" "$(git -C "$R" cat-file -t refs/checkpoints/sess0001/main 2>/dev/null)" "commit"
assert_eq "parallel: ref tree has the edit" "$(git -C "$R" show refs/checkpoints/sess0001/main:tracked.txt)" "$(printf 'base\nx')"

# Review Focus 3: conflicted index → checkpoint of the marker-laden tree; real index (unmerged entries) untouched.
R=$(mkrepo rconf)
git -C "$R" checkout -q -b b1; printf 'b1\n' > "$R/tracked.txt"; git -C "$R" commit -qam b1
git -C "$R" checkout -q main;  printf 'm\n'  > "$R/tracked.txt"; git -C "$R" commit -qam m
git -C "$R" merge -q b1 >/dev/null 2>&1
assert_ne "conflict: precondition — index has unmerged entries" "$(git -C "$R" ls-files -u)" ""
I0=$(idx_sum "$R"); OUT=$(cap "$R" 2>&1); RC=$?
assert_eq "conflict: exit 0" "$RC" "0"; assert_empty "conflict: silent" "$OUT"
assert_eq "conflict: index untouched" "$(idx_sum "$R")" "$I0"
assert_ne "conflict: real index still has unmerged entries" "$(git -C "$R" ls-files -u)" ""
assert_contains "conflict: checkpoint tree holds the marker-laden file" "$(git -C "$R" show refs/checkpoints/sess0001/main:tracked.txt)" "<<<<<<<"

# Review Focus 4: no commits yet → no ref, no error.
R="$TMPROOT/rempty"; mkdir -p "$R"; git -C "$R" init -q -b main; printf 'u\n' > "$R/u.txt"
OUT=$(cap "$R" 2>&1); RC=$?
assert_eq "no-commits: exit 0" "$RC" "0"; assert_empty "no-commits: silent" "$OUT"
assert_empty "no-commits: no ref" "$(refs_of "$R")"

# reap: 15-day-old ref removed, 13-day-old kept.
R=$(mkrepo rreap); T=$(git -C "$R" rev-parse 'HEAD^{tree}'); NOW=$(date +%s)
OLD=$(GIT_COMMITTER_DATE="@$((NOW - 15*86400)) +0000" git -C "$R" commit-tree "$T" -m old)
NEW=$(GIT_COMMITTER_DATE="@$((NOW - 13*86400)) +0000" git -C "$R" commit-tree "$T" -m new)
git -C "$R" update-ref refs/checkpoints/s1/old "$OLD"; git -C "$R" update-ref refs/checkpoints/s1/new "$NEW"
bash "$CKPT" reap --cwd "$R"
assert_eq "reap: 15d removed, 13d kept" "$(refs_of "$R" | tr '\n' ' ')" "refs/checkpoints/s1/new "

# list
R=$(mkrepo rlist); printf 'x\n' >> "$R/tracked.txt"; cap "$R" sesslist agent
OUT=$(bash "$CKPT" list --cwd "$R")
assert_contains "list: ref"        "$OUT" "refs/checkpoints/sesslist/main"
assert_contains "list: trigger"    "$OUT" "checkpoint: agent"
assert_contains "list: file count" "$OUT" "1 files"
printf 'y\n' >> "$R/other.txt"; cap "$R" sesslist agent
assert_eq "list: chained checkpoint has 2 parents" "$(git -C "$R" rev-list --parents -n1 refs/checkpoints/sesslist/main | wc -w | tr -d ' ')" "3"
OUT=$(bash "$CKPT" list --cwd "$R")
assert_contains "list: file count still against HEAD, not previous checkpoint" "$OUT" "2 files"

# fail-open + guards
OUT=$(bash "$CKPT" capture --session s --trigger agent --cwd /nonexistent 2>&1); RC=$?
assert_eq "fail-open: bad cwd exit 0" "$RC" "0"; assert_empty "fail-open: bad cwd silent" "$OUT"
R=$(mkrepo rguard); printf 'x\n' >> "$R/tracked.txt"
for bad in '..' '.' 'a/b' ''; do bash "$CKPT" capture --session "$bad" --trigger agent --cwd "$R"; done
assert_empty "charset guard: no refs for bad session ids" "$(refs_of "$R")"
bash "$CKPT" capture --session sessok --trigger 'rm -rf /' --cwd "$R"
assert_contains "trigger token sanitized" "$(git -C "$R" log -1 --format=%s refs/checkpoints/sessok/main)" "checkpoint: unknown "

# budget smoke (skipped inside mutant runs — not a mutant target, and slow)
if [ -z "${MUTANTS_INNER:-}" ]; then
  R=$(mkrepo rperf); mkdir -p "$R/many"
  for i in $(seq 1 2000); do printf '%s\n' "$i" > "$R/many/f$i.txt"; done
  git -C "$R" add -A; git -C "$R" commit -qm many; printf 'x\n' >> "$R/tracked.txt"
  S=$(date +%s); cap "$R"; E=$(( $(date +%s) - S ))
  if [ "$E" -le 5 ]; then echo "ok: budget smoke ${E}s on 2000 tracked files"; else echo "FAIL: budget smoke ${E}s > 5s"; FAIL=1; fi
fi

# --- .claude/hooks/checkpoint.sh ----------------------------------------------------------
hook_in() { jq -n --arg t "$1" --arg c "$2" --arg cwd "$3" --arg sid "$4" \
  '{tool_name:$t, session_id:$sid, cwd:$cwd, tool_input:{command:$c}}'; }
fires() { # $1 label, $2 tool, $3 command, $4 expected yes|no, $5 unique repo suffix
  local R out got
  R=$(mkrepo "rt$5"); printf 'x\n' >> "$R/tracked.txt"
  out=$(hook_in "$2" "$3" "$R" "sesshook-0001" | bash "$HOOK")
  assert_empty "$1: hook stdout empty" "$out"
  if [ -n "$(refs_of "$R")" ]; then got=yes; else got=no; fi
  assert_eq "$1" "$got" "$4"
}
fires "trigger: Agent"                  Agent "" yes 1
fires "trigger: Task (legacy name)"     Task  "" yes 2
fires "trigger: git checkout -- ."      Bash "git checkout -- ." yes 3
fires "trigger: git restore"            Bash "git restore tracked.txt" yes 4
fires "trigger: git reset --hard"       Bash "git reset --hard" yes 5
fires "trigger: git stash"              Bash "git stash" yes 6
fires "trigger: git clean -fd"          Bash "git clean -fd" yes 7
fires "trigger: git switch -f"          Bash "git switch -f b" yes 8
fires "no trigger: git status"          Bash "git status" no 9
fires "no trigger: git log"             Bash "git log -1" no 10
fires "no trigger: git diff"            Bash "git diff" no 11
fires "no trigger: echo git checkout"   Bash "echo git checkout -- x" no 12
fires "no trigger: -C path holds verb"  Bash "git -C /tmp/checkout-dir status" no 13
fires "no trigger: Edit tool"           Edit "" no 14

R=$(mkrepo rh956)
printf 'repair\n' >> "$R/tracked.txt"; mkdir -p "$R/tests"; printf 'new test\n' > "$R/tests/new.test.ts"
hook_in Agent "" "$R" "sess956-hook" | bash "$HOOK"
git -C "$R" checkout -q -- . && git -C "$R" clean -qfd
git -C "$R" restore --source=refs/checkpoints/sess956-/main --worktree -- tracked.txt tests/new.test.ts
assert_eq "hook 956: tracked repair recovered" "$(cat "$R/tracked.txt")" "$(printf 'base\nrepair')"
assert_eq "hook 956: untracked test recovered" "$(cat "$R/tests/new.test.ts")" "new test"
assert_contains "hook 956: trigger token recorded" "$(git -C "$R" log -1 --format=%s refs/checkpoints/sess956-/main)" "checkpoint: agent "

R=$(mkrepo rhbash); printf 'x\n' >> "$R/tracked.txt"
hook_in Bash "git checkout -- ." "$R" "sessbash" | bash "$HOOK"
assert_contains "hook: git trigger token" "$(git -C "$R" log -1 --format=%s refs/checkpoints/sessbash/main)" "checkpoint: git-checkout "

R=$(mkrepo rhguard); printf 'x\n' >> "$R/tracked.txt"
for bad in '..' 'a/b' ''; do hook_in Agent "" "$R" "$bad" | bash "$HOOK"; done
assert_empty "hook charset guard: no refs" "$(refs_of "$R")"

R=$(mkrepo rhbudget); printf 'x\n' >> "$R/tracked.txt"
S=$(date +%s)
OUT=$(hook_in Agent "" "$R" "sessbudget" | CHECKPOINT_BUDGET_SECS=1 CHECKPOINT_TEST_SLEEP=10 bash "$HOOK"); RC=$?
E=$(( $(date +%s) - S ))
assert_eq "budget: exit 0" "$RC" "0"; assert_empty "budget: silent" "$OUT"
if [ "$E" -le 3 ]; then echo "ok: budget: hook returned in ${E}s"; else echo "FAIL: budget: hook took ${E}s"; FAIL=1; fi

OUT=$(printf 'not json' | bash "$HOOK"); RC=$?
assert_eq "hook: malformed input exit 0" "$RC" "0"; assert_empty "hook: malformed input silent" "$OUT"

# --- mutation checks (spec §7.4) -----------------------------------------------------------
. "$HOOK_DIR/lib/mutants.sh"
mutant "capture writes the REAL index (GIT_INDEX_FILE dropped)" "scripts/checkpoint.sh" \
  's/GIT_INDEX_FILE="\$idx" ("\$G" -C "\$wt" add -A)/\1/'
mutant "previous-checkpoint parent dropped" "scripts/checkpoint.sh" \
  's/ -p "\$prev" -p "\$head"/ -p "$head"/'
mutant "unchanged-tree skip removed" "scripts/checkpoint.sh" \
  's/\[ "\$prevtree" = "\$tree" \] && return 0/:/'
mutant "clean worktrees not skipped" "scripts/checkpoint.sh" \
  's/\[ -n "\$st" \] [|][|] return 0/:/'
mutant "status without --no-optional-locks" "scripts/checkpoint.sh" \
  's/ --no-optional-locks//'
mutant "first CAS write unconditional (empty old-value dropped)" "scripts/checkpoint.sh" \
  's/update-ref "\$ref" "\$commit" ""$/update-ref "$ref" "$commit"/'
mutant "restore missing from the work-discarder verbs" ".claude/hooks/lib/cmd-detect.sh" \
  "s/_WORK_DISCARDER='.checkout.restore./_WORK_DISCARDER='(checkout|/"
mutant "wt_key: main checkout keyed as linked" "scripts/checkpoint.sh" \
  's/if \[ "\$gd" = "\$common" \]; then echo main/if false; then echo main/'
run_mutants "$PROJECT_ROOT" ".claude/hooks/test-checkpoint.sh" || FAIL=1

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
