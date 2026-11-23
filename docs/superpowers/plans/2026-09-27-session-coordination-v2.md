# Session Coordination v2 Implementation Plan

> **STATUS: SHIPPED — history, not instructions.** Checked 2026-11-22: the files this plan creates are on `main`. The current code and `docs/OWNER_RULINGS.md` win over anything below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WIP checkpoints before risky actions, per-agent same-run visibility, Bash-write coverage, and a collision `ask` prompt to the existing pg-lab session-coordination layer.

**Architecture:** Four PRs on top of the shipped pg-lab registry (`scripts/pg-lab/session-coord.sh`). PR 0 adds a generic mutation-test runner for bash hook suites. PR 1 adds a side-effect-only PreToolUse checkpoint hook backed by `scripts/checkpoint.sh` (temp-index snapshots → `refs/checkpoints/<sid8>/<wt-key>`). PR 2 moves the quote-aware write-target parser into a shared lib, keys `files_in_flight` on `(session_id, agent_id)`, and teaches `record`/`consult` about Bash and sibling subagents. PR 3 upgrades a confirmed live collision from warn to `permissionDecision: "ask"` with ask-once suppression.

**Tech Stack:** bash 5 (hooks), awk, jq, git (`/usr/bin/git`), PostgreSQL (`ocrecipes_lab`, schema `harness`), Claude Code hooks (PreToolUse / PostToolUse / SessionStart / SessionEnd).

**Spec:** `docs/superpowers/specs/2026-09-27-session-coordination-v2-design.md` (approved 2026-09-27 incl. §5.3 amendment and §9.0.1 probe results). Executors read both. The spec and this plan are local-only (`docs/superpowers/` is gitignored — `.gitignore:104`); never `git add -f` them.

## Global Constraints

- Liveness / touch window: **15 minutes** — `TTL='15 minutes'`, `WINDOW_SECS=900`.
- Checkpoint retention: **14 days**. Checkpoint hook wait budget: **5 s** (`CHECKPOINT_BUDGET_SECS`, default 5).
- Stale-snapshot threshold **25 s**; synchronous refresh cap **1 s**; pg-down ask threshold: snapshot age **< 60 s**.
- Refs: `refs/checkpoints/<session_id[0:8]>/<wt-key>`; `<wt-key>` = linked worktree's gitdir name, `main` for the main checkout. Never pushed.
- Trigger tokens are fixed: `agent`, `git-checkout`, `git-restore`, `git-reset`, `git-stash`, `git-clean`, `git-switch`; anything else → `unknown`.
- Bypass env var: `SKIP_COLLISION_ASK=1` (ask → warn). Existing bypass `SKIP_WORKTREE_CONTRACT=1` unchanged.
- All git calls in `scripts/checkpoint.sh` use `/usr/bin/git` (RTK proxy — `reference_rtk_worktree_guard_blocks_git`), falling back to `git` when absent.
- Every session id that reaches a path or ref passes the guard `''|.|..|*[!A-Za-z0-9._-]*` → skip.
- Hooks are fail-open and silent on stdout except where they emit a hook JSON decision. `checkpoint.sh` never emits a decision.
- Hook tests live in `.claude/hooks/test-*.sh` (auto-globbed by `scripts/run-hook-tests.sh` in CI's Lint job, which has **no Postgres** — PG-dependent suites must print `skip: …` and exit 0 when Postgres is unreachable).
- One review pass per PR (user ruling 2026-09-22, still binding). The 2026-09-22 harness freeze is lifted for this work (user, 2026-09-27) — review findings against these hooks are fixed in-PR, not filed to `docs/harness-residuals.md`.
- Never run `test:run`, `check:types`, or `lint` ad hoc; the pre-push `preflight:fast` gate and CI are the verification. Running an individual `bash .claude/hooks/test-*.sh` during TDD is the TDD loop, not ad-hoc verification — do it.
- **Spec refinements adopted in this plan** (same intent, different mechanism — call them out in each PR body):
  1. §4.4 budget: the hook stops **waiting** after the budget and lets the capture finish detached; it does not kill it. (bash defers a trapped TERM until its foreground child — `git add` — returns, so a kill cannot bound the wait.)
  2. §7.4 runner: instead of a `HOOKS_ROOT` seam, the runner executes the **copied** test file, whose `BASH_SOURCE`-derived `PROJECT_ROOT` is the temp root — every script it reaches is the mutated copy with no seam.
  3. §5.1 `own`: computed in `consult` as `session_id == me` rather than stored in the snapshot (equivalent; keeps old fixture snapshots valid).
  4. §5.2 extraction: `git-safety.sh` gains a **fail-closed** check (`declare -F emit_write_targets || deny`) for write-shaped commands while a contract is active — moving the parser into a sourced lib otherwise adds a silent-ALLOW path if the lib fails to load.

## PR Procedure (referenced by the last task of each PR)

Run from the main checkout `/Users/williamtower/projects/OCRecipes` unless stated.

1. **Worktree:** `git fetch origin && git worktree add .claude/worktrees/<wt> -b <branch> origin/main`, then `bash scripts/declare-worktree.sh "$PWD/.claude/worktrees/<wt>"`. Inside the worktree: `sh .husky/post-checkout 0 0 1` (symlinks `.env*`) and `ln -s /Users/williamtower/projects/OCRecipes/node_modules node_modules` (the pre-push `preflight:fast` needs it). Use `/usr/bin/git` for git commands inside the worktree. If `git config core.hooksPath` is empty, run `npm run preflight:fast` by hand before pushing (`reference_worktree_hooks_did_not_run`).
2. **Commits:** write each message with the Write tool to the session scratchpad, then `/usr/bin/git commit -F <file>`. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
3. **Push:** `/usr/bin/git push -u origin <branch>` (runs `preflight:fast`, writes the HEAD stamp).
4. **PR:** `mcp__github__create_pull_request` (base `main`). Body: summary, spec refinements used, test evidence (suite `ALL PASS` + `mutants: killed K / applied A / declared D` lines, pasted from real runs), and end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
5. **Review (one pass):** commit everything first (`feedback_commit_before_dispatching_reviewers`), then dispatch the `code-reviewer` agent using the `docs/AI_WORKFLOW.md` → Review Policy dispatch prompt **verbatim**, REVIEWED-SHA on the same line (`feedback_reviewed_sha_same_line`). Fix blocking findings in-PR.
6. **Codify:** run `/codify` for emergent patterns.
7. **Merge:** `/land`.
8. **Cleanup:** remove the worktree; `bash scripts/declare-worktree.sh --remove "$PWD/.claude/worktrees/<wt>"`.

## Review Focus

1. **Paths with spaces** in Bash targets (`rm "my file.ts"`) — expected: recorded and consulted as one path. Test pinned in Task 7.
2. **Path spelling** — a Bash target written `./src/x.ts` must match a snapshot entry recorded as `<root>/src/x.ts`. Test pinned in Task 9.
3. **Conflicted index** (mid-merge) — `add -A` on the _copied_ index stages the conflicted files, so a checkpoint of the marker-laden files may be written; expected either way: exit 0, silent, and the real index (with its unmerged entries) untouched so the merge can still be resolved. Test pinned in Task 3.
4. **Repo with no commits** (fresh `git init` + untracked files) — expected: no ref, no error. Test pinned in Task 3.
5. **Parallel Agent dispatches** fire two captures at once on the same worktree — expected: CAS keeps the ref a valid commit; no corruption. Test pinned in Task 3.

---

## File Structure

| File                                                    | Status                       | Responsibility                                                                     |
| ------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `.claude/hooks/lib/mutants.sh`                          | create (PR 0)                | `mutant` / `run_mutants` — mutation runner for bash hook suites                    |
| `.claude/hooks/test-mutants.sh`                         | create (PR 0)                | self-test of the runner against a toy fixture                                      |
| `.claude/hooks/lib/cmd-detect.sh`                       | modify (PR 1)                | add `_CMD_GIT_VERBS_WORK_DISCARDER` + `cmd_git_work_discarder_verb`                |
| `scripts/checkpoint.sh`                                 | create (PR 1)                | `capture` / `list` / `reap` — the checkpoint mechanism                             |
| `.claude/hooks/checkpoint.sh`                           | create (PR 1)                | PreToolUse decision shim: trigger detection + bounded wait                         |
| `.claude/hooks/test-checkpoint.sh`                      | create (PR 1)                | tests + mutants for the three above                                                |
| `.claude/hooks/lib/write-targets.sh`                    | create (PR 2)                | `emit_write_targets [--relative]`, `resolve_write_targets <cwd>`                   |
| `.claude/hooks/git-safety.sh`                           | modify (PR 2)                | source the lib; fail closed if it is missing                                       |
| `.claude/hooks/test-write-targets.sh`                   | create (PR 2)                | relative-mode tests, fail-closed test, mutants                                     |
| `scripts/pg-lab/schema/session-coordination.sql`        | modify (PR 2)                | `agent_id` column, 3-col PK, 15-min default, legacy migration                      |
| `scripts/pg-lab/session-coord.sh`                       | modify (PR 2, PR 3)          | record/refresh/consult per actor + Bash; PR 3: ask, live confirm, markers, promote |
| `.claude/hooks/session-coord-hook.sh`                   | modify (PR 3)                | synchronous `promote` before backgrounded `record`; asks-dir cleanup               |
| `.claude/hooks/test-session-coord.sh`                   | modify (PR 2)                | update the two assertions PR 2 intentionally changes                               |
| `.claude/hooks/test-session-coord-v2.sh`                | create (PR 2, extended PR 3) | actor/Bash/ask tests + mutants on a throwaway DB                                   |
| `.claude/settings.json`                                 | modify (PR 1, PR 2)          | hook wiring                                                                        |
| `docs/rules/harness.md`                                 | modify (PR 1, PR 3)          | recovery commands; `SKIP_COLLISION_ASK`                                            |
| `.github/copilot-instructions.md`                       | regenerate (PR 1, PR 3)      | `npm run build:copilot-instructions`                                               |
| `docs/verification/session-coordination-two-session.md` | create (after PR 3)          | the two-session verification prompt                                                |

---

# PR 0 — Mutation runner

Branch `feat/coord-mutants-runner`, worktree `coord-pr0`.

### Task 1: `lib/mutants.sh` + self-test

**Files:**

- Create: `.claude/hooks/lib/mutants.sh`
- Test: `.claude/hooks/test-mutants.sh`

**Interfaces:**

- Produces: `mutant <label> <repo-relative-target> <sed -E expression>` (appends to the declared list); `run_mutants <project-root> <repo-relative-test-file>` → prints `mutants: killed K / applied A / declared D` (or `mutants: SKIPPED …`), returns 0 iff every declared mutant applied and was killed (or the baseline skipped). Returns 0 immediately, silently, when `MUTANTS_INNER` is set. Test files call it as `run_mutants "$PROJECT_ROOT" ".claude/hooks/test-<name>.sh" || FAIL=1`.

- [ ] **Step 1: Write the failing self-test**

Create `.claude/hooks/test-mutants.sh`:

```bash
#!/usr/bin/env bash
# Self-test for .claude/hooks/lib/mutants.sh (spec 2026-09-27 §7.4).
# Builds a toy project root (toy.sh + test-toy.sh) and drives run_mutants through every
# verdict: killed, survived, unapplied, missing target, skipped baseline, failing baseline,
# and the MUTANTS_INNER re-entry guard.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HOOK_DIR/lib/mutants.sh"
FAIL=0
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected [$3], got [$2]"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing [$3] in: $2"; FAIL=1; fi; }

FX=$(mktemp -d "${TMPDIR:-/tmp}/mutants-selftest-XXXXXX")
trap 'rm -rf "$FX"' EXIT
mkdir -p "$FX/.claude/hooks"
cat > "$FX/.claude/hooks/toy.sh" <<'EOF'
#!/usr/bin/env bash
# toy: add one
echo $(( $1 + 1 ))
EOF
cat > "$FX/.claude/hooks/test-toy.sh" <<'EOF'
#!/usr/bin/env bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -n "${TOY_SKIP:-}" ] && { echo "skip: toy skip requested"; exit 0; }
[ -n "${TOY_BROKEN:-}" ] && exit 1
[ "$(bash "$HERE/toy.sh" 1)" = "2" ] || exit 1
exit 0
EOF

run() { ( . "$LIB"; eval "$1"; run_mutants "$FX" ".claude/hooks/test-toy.sh" ) 2>&1; }

OUT=$(run 'mutant "plus two" ".claude/hooks/toy.sh" "s/\\+ 1/+ 2/"'); RC=$?
assert_eq "killed mutant → rc 0" "$RC" "0"
assert_contains "killed mutant → counts" "$OUT" "mutants: killed 1 / applied 1 / declared 1"

OUT=$(run 'mutant "comment only" ".claude/hooks/toy.sh" "s/# toy/# yot/"'); RC=$?
assert_eq "surviving mutant → rc 1" "$RC" "1"
assert_contains "surviving mutant → named" "$OUT" "MUTANT SURVIVED: comment only"

OUT=$(run 'mutant "inert" ".claude/hooks/toy.sh" "s/NOMATCH_XYZ/x/"'); RC=$?
assert_eq "unapplied mutant → rc 1" "$RC" "1"
assert_contains "unapplied mutant → named" "$OUT" "MUTANT UNAPPLIED: inert"

OUT=$(run 'mutant "no file" ".claude/hooks/nope.sh" "s/a/b/"'); RC=$?
assert_eq "missing target → rc 1" "$RC" "1"
assert_contains "missing target → named" "$OUT" "MUTANT UNAPPLIED (no such file): no file"

OUT=$(TOY_SKIP=1 run 'mutant "plus two" ".claude/hooks/toy.sh" "s/\\+ 1/+ 2/"'); RC=$?
assert_eq "skipping baseline → rc 0" "$RC" "0"
assert_contains "skipping baseline → counted, not silent" "$OUT" "mutants: SKIPPED (baseline skipped live cases) — declared 1"

OUT=$(TOY_BROKEN=1 run 'mutant "plus two" ".claude/hooks/toy.sh" "s/\\+ 1/+ 2/"'); RC=$?
assert_eq "failing baseline → rc 1" "$RC" "1"
assert_contains "failing baseline → named" "$OUT" "unmutated baseline copy failed"

OUT=$(MUTANTS_INNER=1 run 'mutant "plus two" ".claude/hooks/toy.sh" "s/\\+ 1/+ 2/"'); RC=$?
assert_eq "MUTANTS_INNER → rc 0" "$RC" "0"
assert_eq "MUTANTS_INNER → silent" "$OUT" ""

OUT=$(run ':'); RC=$?
assert_eq "no mutants declared → rc 1" "$RC" "1"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash .claude/hooks/test-mutants.sh`
Expected: FAIL lines (the lib does not exist; `.` fails, `run_mutants: command not found`), final `FAILURES`, exit 1.

- [ ] **Step 3: Implement the runner**

Create `.claude/hooks/lib/mutants.sh`:

```bash
#!/usr/bin/env bash
# .claude/hooks/lib/mutants.sh — automated mutation checks for hook test suites.
# Spec: docs/superpowers/specs/2026-09-27-session-coordination-v2-design.md §7.4.
#
# Usage, at the END of a .claude/hooks/test-*.sh, after its own assertions:
#   . "$HOOK_DIR/lib/mutants.sh"
#   mutant "<label>" "<repo-relative target file>" '<sed -E expression>'
#   run_mutants "$PROJECT_ROOT" ".claude/hooks/test-<name>.sh" || FAIL=1
#
# Per mutant: copy .claude/hooks, scripts/pg-lab and scripts/checkpoint.sh (whichever exist)
# into a temp root PRESERVING relative paths; apply the sed to the target copy; REQUIRE a
# changed file (an unapplied mutant proves nothing, so it FAILS the run); run the COPIED
# test file with MUTANTS_INNER=1 — its BASH_SOURCE-derived PROJECT_ROOT is the temp root,
# so every script it reaches is the mutated copy; count the mutant killed iff the suite
# exits non-zero. Any survivor or unapplied mutant → return 1.
#
# Baseline gate: the unmutated copy runs first. It must exit 0, and it must not print a
# line starting with "skip:" — a suite that skipped its live cases lets every mutant
# "survive" for the wrong reason. A skipping baseline prints a SKIPPED line with the
# declared count and returns 0: skipped and counted, never silent.
_MUT_LABEL=(); _MUT_FILE=(); _MUT_SED=()
mutant() { _MUT_LABEL+=("$1"); _MUT_FILE+=("$2"); _MUT_SED+=("$3"); }

_mut_copy_tree() { # $1 source project root, $2 destination root
  mkdir -p "$2/.claude" "$2/scripts" || return 1
  cp -R "$1/.claude/hooks" "$2/.claude/hooks" || return 1
  if [ -d "$1/scripts/pg-lab" ]; then cp -R "$1/scripts/pg-lab" "$2/scripts/pg-lab" || return 1; fi
  if [ -f "$1/scripts/checkpoint.sh" ]; then cp "$1/scripts/checkpoint.sh" "$2/scripts/checkpoint.sh" || return 1; fi
  return 0
}

run_mutants() { # $1 project root, $2 repo-relative test file
  [ -n "${MUTANTS_INNER:-}" ] && return 0
  local root="$1" test_rel="$2" declared=${#_MUT_LABEL[@]} applied=0 killed=0 fail=0 i tmp target out rc
  if [ "$declared" -eq 0 ]; then echo "mutants: FAIL — none declared"; return 1; fi
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/mutants-XXXXXX") || return 1
  _mut_copy_tree "$root" "$tmp/base" || { echo "mutants: FAIL — could not copy tree"; rm -rf "$tmp"; return 1; }
  out=$(MUTANTS_INNER=1 bash "$tmp/base/$test_rel" 2>&1); rc=$?
  if [ "$rc" -ne 0 ]; then echo "mutants: FAIL — unmutated baseline copy failed (rc $rc)"; rm -rf "$tmp"; return 1; fi
  if grep -q '^skip:' <<<"$out"; then
    echo "mutants: SKIPPED (baseline skipped live cases) — declared $declared"; rm -rf "$tmp"; return 0
  fi
  for i in "${!_MUT_LABEL[@]}"; do
    rm -rf "$tmp/m"
    _mut_copy_tree "$root" "$tmp/m" || { echo "mutants: FAIL — could not copy tree"; fail=1; continue; }
    target="$tmp/m/${_MUT_FILE[$i]}"
    if [ ! -f "$target" ]; then echo "MUTANT UNAPPLIED (no such file): ${_MUT_LABEL[$i]}"; fail=1; continue; fi
    cp "$target" "$tmp/orig"
    sed -E -i.mutbak "${_MUT_SED[$i]}" "$target" 2>/dev/null; rm -f "$target.mutbak"
    if cmp -s "$target" "$tmp/orig"; then echo "MUTANT UNAPPLIED: ${_MUT_LABEL[$i]}"; fail=1; continue; fi
    applied=$((applied + 1))
    if MUTANTS_INNER=1 bash "$tmp/m/$test_rel" >/dev/null 2>&1; then
      echo "MUTANT SURVIVED: ${_MUT_LABEL[$i]}"; fail=1
    else
      killed=$((killed + 1))
    fi
  done
  rm -rf "$tmp"
  echo "mutants: killed $killed / applied $applied / declared $declared"
  return "$fail"
}
```

- [ ] **Step 4: Run the self-test to verify it passes**

Run: `bash .claude/hooks/test-mutants.sh`
Expected: every line `ok:`, final `ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add .claude/hooks/lib/mutants.sh .claude/hooks/test-mutants.sh
/usr/bin/git commit -F <scratchpad>/msg-pr0.txt   # "Hooks: add a mutation-check runner for hook test suites" + body + Co-Authored-By
```

- [ ] **Step 6: Ship** — run the PR Procedure (steps 3–8) for branch `feat/coord-mutants-runner`.

---

# PR 1 — Checkpoints

Branch `feat/coord-checkpoints`, worktree `coord-pr1`, based on `main` **after PR 0 merged**.

### Task 2: work-discarding git detector

**Files:**

- Modify: `.claude/hooks/lib/cmd-detect.sh` (after line 345 `_CMD_GIT_VERBS_HEAD_MOVER=…`; after the `cmd_is_git_head_mover` function ending near line 1721)
- Test: `.claude/hooks/test-checkpoint.sh` (created here; extended in Tasks 3–4)

**Interfaces:**

- Produces: `cmd_git_work_discarder_verb <command-string>` → prints the verb (`checkout|restore|reset|stash|clean|switch`) of the first positional `git … <verb>` invocation and returns 0; returns 1 with no output when none.

- [ ] **Step 1: Write the failing test**

Create `.claude/hooks/test-checkpoint.sh`:

```bash
#!/usr/bin/env bash
# Tests for scripts/checkpoint.sh, .claude/hooks/checkpoint.sh and cmd-detect's
# work-discarder detector (spec 2026-09-27 §4, §7.1). No Postgres needed — runs in CI.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
CKPT="$PROJECT_ROOT/scripts/checkpoint.sh"
HOOK="$HOOK_DIR/checkpoint.sh"
FAIL=0
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
assert_empty "detector: quoted mention"    "$(verb 'echo "git checkout -- x"')"
assert_empty "detector: echo then git"     "$(verb 'echo git checkout -- x')"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash .claude/hooks/test-checkpoint.sh`
Expected: `FAIL: detector: checkout -- — expected [checkout], got []` (and the other positive cases), exit 1.

- [ ] **Step 3: Implement the detector**

In `.claude/hooks/lib/cmd-detect.sh`, directly after the `_CMD_GIT_VERBS_HEAD_MOVER=…` line add:

```bash
# Verbs that can DISCARD uncommitted work (checkpoint triggers — spec 2026-09-27 §4.2).
# Keep this a single line: .claude/hooks/test-checkpoint.sh mutates it by text.
_CMD_GIT_VERBS_WORK_DISCARDER='(checkout|restore|reset|stash|clean|switch)'
```

Directly after the closing `}` of `cmd_is_git_head_mover`, add:

```bash
# Print the verb of the first positional `git [globals] <work-discarding verb>` invocation;
# rc 1 and no output when there is none. The verb is read from the END of the matched span,
# so a verb-looking word inside a -C/--git-dir value (`git -C /tmp/checkout-x status`) is
# never reported — only the verb in verb position can end the span.
cmd_git_work_discarder_verb() {
  local words span
  words=$(cmd_words_deep "$1")
  span=$(grep -oE "${_CMD_POS_PREFIX}git${_CMD_GIT_GLOBALS}[[:space:]]+${_CMD_GIT_VERBS_WORK_DISCARDER}${_CMD_POS_SUFFIX}" <<< "$words" | head -1)
  [ -n "$span" ] || return 1
  span=$(printf '%s' "$span" | sed -E 's/[^A-Za-z]+$//')
  printf '%s\n' "${span##*[[:space:]]}"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash .claude/hooks/test-checkpoint.sh`
Expected: all `ok:`, `ALL PASS`. Also run `bash .claude/hooks/test-cmd-detect.sh` — expected `ALL PASS` (the lib change is additive).

- [ ] **Step 5: Commit** — `lib/cmd-detect.sh` + `test-checkpoint.sh`, message "Hooks: detect git commands that discard uncommitted work".

### Task 3: `scripts/checkpoint.sh` — capture, list, reap

**Files:**

- Create: `scripts/checkpoint.sh`
- Test: `.claude/hooks/test-checkpoint.sh` (append before the final `ALL PASS` line)

**Interfaces:**

- Produces (CLI): `bash scripts/checkpoint.sh capture --session <sid8> --trigger <token> [--cwd <dir>]` (silent, exit 0); `… list [--cwd <dir>]` (prints `<ref>\t<date>\t<N> files\t<subject>` per ref); `… reap [--days N] [--cwd <dir>]` (silent, exit 0). Test seams: `CHECKPOINT_TEST_RACE=<sha>` plants that sha at the ref between the read of `prev` and the CAS update; `CHECKPOINT_TEST_SLEEP=<secs>` sleeps before capturing.

- [ ] **Step 1: Write the failing tests** — insert above the final `[ "$FAIL" -eq 0 ] …` line of `test-checkpoint.sh`:

```bash
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

# Review Focus 3: conflicted index → silent skip, nothing touched.
R=$(mkrepo rconf)
git -C "$R" checkout -q -b b1; printf 'b1\n' > "$R/tracked.txt"; git -C "$R" commit -qam b1
git -C "$R" checkout -q main;  printf 'm\n'  > "$R/tracked.txt"; git -C "$R" commit -qam m
git -C "$R" merge -q b1 >/dev/null 2>&1
I0=$(idx_sum "$R"); OUT=$(cap "$R" 2>&1); RC=$?
assert_eq "conflict: exit 0" "$RC" "0"; assert_empty "conflict: silent" "$OUT"
assert_eq "conflict: index untouched" "$(idx_sum "$R")" "$I0"

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
```

- [ ] **Step 2: Run to verify failure**

Run: `bash .claude/hooks/test-checkpoint.sh`
Expected: detector cases `ok:`; checkpoint cases FAIL (`956: ref created — both [none]`, …), exit 1.

- [ ] **Step 3: Implement `scripts/checkpoint.sh`**

```bash
#!/usr/bin/env bash
# scripts/checkpoint.sh — WIP checkpoints to refs/checkpoints/<sid8>/<wt-key>.
# Spec: docs/superpowers/specs/2026-09-27-session-coordination-v2-design.md §4.
#
#   capture --session <sid8> --trigger <token> [--cwd <dir>]   snapshot every DIRTY worktree
#   list    [--cwd <dir>]                                       human recovery aid
#   reap    [--days N] [--cwd <dir>]                            delete refs older than N days (14)
#
# Recovery: git restore --source=<ref> --worktree -- <path>
#
# Invariants: never modifies HEAD, any worktree's real index, or any working tree; runs no
# git hooks (commit-tree / update-ref invoke none). Snapshots go through a COPY of the real
# index (its stat cache makes `add -A` hash only changed/untracked files; mktemp's 0-byte
# file is not a valid index). Fail-silent: exit 0 always; only `list` prints.
# Test seams: CHECKPOINT_TEST_RACE=<sha> plants a racing writer before the CAS update;
# CHECKPOINT_TEST_SLEEP=<secs> delays the capture.
set -uo pipefail
exec 2>/dev/null
G=/usr/bin/git          # bypass the RTK proxy (reference_rtk_worktree_guard_blocks_git)
[ -x "$G" ] || G=git
export GIT_AUTHOR_NAME="checkpoint" GIT_AUTHOR_EMAIL="checkpoint@localhost"
export GIT_COMMITTER_NAME="checkpoint" GIT_COMMITTER_EMAIL="checkpoint@localhost"

SUB="${1:-}"; [ $# -gt 0 ] && shift
SID=""; TRIGGER=""; CWD="$PWD"; DAYS=14
while [ $# -gt 0 ]; do
  case "$1" in
    --session) SID="${2:-}"; shift ;;
    --trigger) TRIGGER="${2:-}"; shift ;;
    --cwd)     CWD="${2:-}"; shift ;;
    --days)    DAYS="${2:-14}"; shift ;;
  esac
  shift
done
case "$DAYS" in ''|*[!0-9]*) DAYS=14 ;; esac
case "$TRIGGER" in agent|git-checkout|git-restore|git-reset|git-stash|git-clean|git-switch) ;; *) TRIGGER=unknown ;; esac

TMPD=""
trap '[ -n "$TMPD" ] && rm -rf "$TMPD"' EXIT

wt_key() { # $1 worktree -> gitdir name for a linked worktree, "main" for the main checkout
  local gd
  gd=$("$G" -C "$1" rev-parse --absolute-git-dir) || return 1
  case "$gd" in */worktrees/*) basename "$gd" ;; *) echo main ;; esac
}

capture_one() { # $1 worktree path
  local wt="$1" st idx tree key ref prev prevtree head msg commit
  st=$("$G" --no-optional-locks -C "$wt" status --porcelain --untracked-files=normal) || return 0
  [ -n "$st" ] || return 0
  head=$("$G" -C "$wt" rev-parse -q --verify HEAD) || return 0
  TMPD=$(mktemp -d "${TMPDIR:-/tmp}/ckpt-XXXXXX") || return 0
  idx="$TMPD/index"
  cp "$("$G" -C "$wt" rev-parse --path-format=absolute --git-path index)" "$idx" || { rm -rf "$TMPD"; TMPD=""; return 0; }
  GIT_INDEX_FILE="$idx" "$G" -C "$wt" add -A >/dev/null 2>&1 || { rm -rf "$TMPD"; TMPD=""; return 0; }
  tree=$(GIT_INDEX_FILE="$idx" "$G" -C "$wt" write-tree) || { rm -rf "$TMPD"; TMPD=""; return 0; }
  rm -rf "$TMPD"; TMPD=""
  key=$(wt_key "$wt") || return 0
  ref="refs/checkpoints/$SID/$key"
  prev=$("$G" -C "$wt" rev-parse -q --verify "$ref^{commit}") || prev=""
  if [ -n "$prev" ]; then
    prevtree=$("$G" -C "$wt" rev-parse "$prev^{tree}") || return 0
    [ "$prevtree" = "$tree" ] && return 0
  fi
  msg="checkpoint: $TRIGGER $(date -u +%Y-%m-%dT%H:%M:%SZ) session=$SID wt=$key"
  if [ -n "$prev" ]; then
    commit=$("$G" -C "$wt" commit-tree "$tree" -p "$prev" -p "$head" -m "$msg") || return 0
  else
    commit=$("$G" -C "$wt" commit-tree "$tree" -p "$head" -m "$msg") || return 0
  fi
  [ -n "${CHECKPOINT_TEST_RACE:-}" ] && "$G" -C "$wt" update-ref "$ref" "$CHECKPOINT_TEST_RACE"
  if [ -n "$prev" ]; then
    "$G" -C "$wt" update-ref "$ref" "$commit" "$prev"
  else
    "$G" -C "$wt" update-ref "$ref" "$commit" ""
  fi
  return 0
}

do_capture() {
  case "$SID" in ''|.|..|*[!A-Za-z0-9._-]*) return 0 ;; esac
  [ -n "${CHECKPOINT_TEST_SLEEP:-}" ] && sleep "$CHECKPOINT_TEST_SLEEP"
  local wt
  while IFS= read -r wt; do
    [ -d "$wt" ] || continue
    capture_one "$wt"
  done < <("$G" -C "$CWD" worktree list --porcelain | sed -n 's/^worktree //p')
  return 0
}

do_list() {
  local ref base n date subj
  "$G" -C "$CWD" for-each-ref --format='%(refname)' refs/checkpoints/ | while IFS= read -r ref; do
    base=$("$G" -C "$CWD" rev-parse "$ref^@" | tail -1)
    n=$("$G" -C "$CWD" diff --name-only "$base" "$ref" | wc -l | tr -d ' ')
    date=$("$G" -C "$CWD" log -1 --format=%ci "$ref")
    subj=$("$G" -C "$CWD" log -1 --format=%s "$ref")
    printf '%s\t%s\t%s files\t%s\n' "$ref" "$date" "$n" "$subj"
  done
  return 0
}

do_reap() {
  local cutoff ref ts
  cutoff=$(( $(date +%s) - DAYS * 86400 ))
  "$G" -C "$CWD" for-each-ref --format='%(refname) %(committerdate:unix)' refs/checkpoints/ |
  while read -r ref ts; do
    [ -n "$ts" ] && [ "$ts" -lt "$cutoff" ] && "$G" -C "$CWD" update-ref -d "$ref"
  done
  return 0
}

case "$SUB" in
  capture) do_capture ;;
  list)    do_list ;;
  reap)    do_reap ;;
esac
exit 0
```

`chmod +x scripts/checkpoint.sh`.

- [ ] **Step 4: Run to verify pass**

Run: `bash .claude/hooks/test-checkpoint.sh`
Expected: all `ok:` (incl. `non-mutation positive control`), `ALL PASS`. If the positive control fails, the stat-only touch did not put the index in the regime — fix the fixture, never delete the control.

- [ ] **Step 5: Commit** — `scripts/checkpoint.sh` + test, message "Checkpoints: snapshot dirty worktrees to refs/checkpoints without touching HEAD, index, or files".

### Task 4: the PreToolUse hook, wiring, docs, mutants

**Files:**

- Create: `.claude/hooks/checkpoint.sh`
- Modify: `.claude/settings.json` (PreToolUse array; SessionStart array)
- Modify: `docs/rules/harness.md`; regenerate `.github/copilot-instructions.md`
- Test: `.claude/hooks/test-checkpoint.sh`

**Interfaces:**

- Consumes: `cmd_git_work_discarder_verb` (Task 2); `scripts/checkpoint.sh capture` (Task 3).
- Produces: hook reading PreToolUse JSON (`tool_name`, `session_id`, `cwd`, `tool_input.command`), no stdout, exit 0. Env: `CHECKPOINT_BUDGET_SECS` (default 5).

- [ ] **Step 1: Write the failing hook tests** — insert above the final line of `test-checkpoint.sh`:

```bash
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
```

- [ ] **Step 2: Run to verify failure** — `bash .claude/hooks/test-checkpoint.sh` → hook cases FAIL (`trigger: Agent — expected [yes], got [no]`), exit 1.

- [ ] **Step 3: Implement the hook**

Create `.claude/hooks/checkpoint.sh`:

```bash
#!/usr/bin/env bash
# .claude/hooks/checkpoint.sh — PreToolUse: checkpoint every dirty worktree BEFORE an Agent
# dispatch or a work-discarding git command (spec 2026-09-27 §4). #956's loss — a reviewer's
# `git checkout --` destroying five uncommitted repairs — is the case this exists for.
#
# Side-effect-only: never prints, never emits a permission decision, always exits 0.
# Waits for scripts/checkpoint.sh up to CHECKPOINT_BUDGET_SECS (default 5), then returns and
# lets the capture finish detached — bash defers a TERM until its foreground `git add`
# returns, so killing it could not bound the wait (plan refinement 1).
# Recovery: bash scripts/checkpoint.sh list; git restore --source=<ref> --worktree -- <path>
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
TOOL=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null) || exit 0
SID=$(jq -r '.session_id // empty' <<<"$INPUT" 2>/dev/null) || exit 0
CWD=$(jq -r '.cwd // empty' <<<"$INPUT" 2>/dev/null) || exit 0
[ -n "$CWD" ] || CWD="$PWD"
case "$SID" in ''|.|..|*[!A-Za-z0-9._-]*) exit 0 ;; esac

case "$TOOL" in
  Agent|Task) TRIGGER=agent ;;
  Bash)
    CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null) || exit 0
    { . "$HERE/lib/cmd-detect.sh"; } >/dev/null 2>&1
    declare -F cmd_git_work_discarder_verb >/dev/null || exit 0
    VERB=$(cmd_git_work_discarder_verb "$CMD") || exit 0
    TRIGGER="git-$VERB" ;;
  *) exit 0 ;;
esac

bash "$ROOT/scripts/checkpoint.sh" capture --session "${SID:0:8}" --trigger "$TRIGGER" --cwd "$CWD" >/dev/null 2>&1 &
CPID=$!
BUDGET="${CHECKPOINT_BUDGET_SECS:-5}"
case "$BUDGET" in ''|*[!0-9]*) BUDGET=5 ;; esac
i=0
while [ "$i" -lt $((BUDGET * 10)) ] && kill -0 "$CPID" 2>/dev/null; do
  sleep 0.1; i=$((i + 1))
done
exit 0
```

`chmod +x .claude/hooks/checkpoint.sh`.

- [ ] **Step 4: Run to verify pass** — `bash .claude/hooks/test-checkpoint.sh` → `ALL PASS`.

- [ ] **Step 5: Wire it** — in `.claude/settings.json`:

Append to the `PreToolUse` array:

```json
      {
        "matcher": "Agent|Task",
        "hooks": [
          { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/checkpoint.sh\"", "timeout": 15 }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/checkpoint.sh\"", "timeout": 15 }
        ]
      }
```

Append to the `SessionStart` array:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/checkpoint.sh\" reap --cwd \"$CLAUDE_PROJECT_DIR\"",
      "timeout": 15
    }
  ]
}
```

Run: `jq . .claude/settings.json >/dev/null && bash .claude/hooks/test-settings-hook-paths.sh` → valid JSON, `ALL PASS`.

- [ ] **Step 6: Add the mutants** — insert immediately above the final line of `test-checkpoint.sh`:

```bash
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
run_mutants "$PROJECT_ROOT" ".claude/hooks/test-checkpoint.sh" || FAIL=1
```

Run: `bash .claude/hooks/test-checkpoint.sh`
Expected: `mutants: killed 7 / applied 7 / declared 7`, `ALL PASS`. Any `UNAPPLIED` means the sed no longer matches the script text — fix the expression, never delete the mutant. Any `SURVIVED` means a test is missing — add the test.

- [ ] **Step 7: Docs** — append to `docs/rules/harness.md`:

```markdown
## Checkpoints (session coordination v2)

- Before every Agent dispatch and every `git checkout/restore/reset/stash/clean/switch`, `.claude/hooks/checkpoint.sh` snapshots each dirty worktree to `refs/checkpoints/<sid8>/<worktree>` (local only, 14-day retention). It never touches HEAD, the index, or files.
- Recover lost uncommitted work: `bash scripts/checkpoint.sh list`, then `git restore --source=<ref> --worktree -- <path>`.
```

Run: `npm run build:copilot-instructions` and stage the regenerated `.github/copilot-instructions.md`.

- [ ] **Step 8: Commit** — hook, settings, test, docs; message "Checkpoints: capture before Agent dispatch and work-discarding git commands".

- [ ] **Step 9: Ship** — PR Procedure steps 3–8 for `feat/coord-checkpoints`.

---

# PR 2 — Per-agent visibility and Bash coverage

Branch `feat/coord-visibility-bash`, worktree `coord-pr2`, based on `main` **after PR 0 merged** (independent of PR 1).

### Task 5: move `emit_write_targets` into a lib (verbatim) + fail closed

**Files:**

- Create: `.claude/hooks/lib/write-targets.sh`
- Modify: `.claude/hooks/git-safety.sh` (remove lines 84–156 — the comment block and function; add sourcing; add the fail-closed check before `WRITE_TARGETS=$(…)` near line 907)
- Test: `.claude/hooks/test-write-targets.sh` (create)

**Interfaces:**

- Produces: `emit_write_targets` (unchanged behavior, stdin → absolute targets, one per line).

- [ ] **Step 1: Write the failing test** — create `.claude/hooks/test-write-targets.sh`:

```bash
#!/usr/bin/env bash
# Tests for .claude/hooks/lib/write-targets.sh (spec 2026-09-27 §5.2) and git-safety.sh's
# fail-closed behavior when that lib is missing (plan refinement 4). No Postgres needed.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
FAIL=0
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected [$3], got [$2]"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing [$3] in [$2]"; FAIL=1; fi; }
. "$HOOK_DIR/lib/write-targets.sh" 2>/dev/null
abs() { printf '%s' "$1" | emit_write_targets | tr '\n' ' '; }

assert_eq "default: absolute rm target" "$(abs 'rm /abs/x.ts')" "/abs/x.ts "
assert_eq "default: relative ignored"    "$(abs 'rm foo.ts /abs/x')" "/abs/x "
assert_eq "default: quoted message"      "$(abs 'git commit -m "writes > /main/out"')" ""

# git-safety fails CLOSED when the lib is missing and a contract is active; the same
# command with the lib intact is ALLOWED (target outside the main checkout) — the pair is
# what shows the deny comes from the missing lib, not from the ordinary contract check.
FX=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/wt-failclosed-XXXXXX")" && pwd -P)
SID="wtfc-$$"; REG="/tmp/claude-worktree-contracts-$SID"
trap 'rm -rf "$FX" "$REG"' EXIT
mkdir -p "$FX/intact" "$FX/broken" "$FX/main" "$REG"
cp -R "$HOOK_DIR/." "$FX/intact/"; cp -R "$HOOK_DIR/." "$FX/broken/"; rm -f "$FX/broken/lib/write-targets.sh"
git -C "$FX/main" init -q
printf '%s' "$FX/some-worktree" > "$REG/wt1"
IN=$(jq -n --arg c "rm $FX/elsewhere/x.ts" --arg cwd "$FX/main" --arg sid "$SID" \
  '{tool_name:"Bash", session_id:$sid, cwd:$cwd, tool_input:{command:$c}}')
DEC_OK=$(printf '%s' "$IN" | bash "$FX/intact/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)
DEC_BAD=$(printf '%s' "$IN" | bash "$FX/broken/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)
assert_eq "git-safety: lib intact → write outside main allowed" "${DEC_OK:-none}" "none"
assert_eq "git-safety: lib missing → fails CLOSED" "$DEC_BAD" "deny"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
```

- [ ] **Step 2: Run to verify failure** — `bash .claude/hooks/test-write-targets.sh` → `default:` cases FAIL (function undefined) and `lib missing → fails CLOSED` FAIL (`none`), exit 1. If the `lib intact → … allowed` control does not print `none` on the unmodified `git-safety.sh`, the fixture has tripped a different git-safety rule: change the target path (keep it outside `$FX/main`) until the intact copy allows it — the pair only proves fail-closed when the intact side allows.

- [ ] **Step 3: Extract verbatim** — create `.claude/hooks/lib/write-targets.sh` with this header followed by **the exact bytes of `git-safety.sh` lines 84–156** (the comment block starting `# emit_write_targets: read a shell command on STDIN` through the function's closing `}`), cut from `git-safety.sh` with no edits:

```bash
#!/usr/bin/env bash
# .claude/hooks/lib/write-targets.sh — the quote-aware write-target parser, shared by
# git-safety.sh (contract guard) and scripts/pg-lab/session-coord.sh (record/consult).
# Moved verbatim from git-safety.sh (spec 2026-09-27 §5.2); its residuals move with it.
```

In `git-safety.sh`, where the function was, add:

```bash
# emit_write_targets lives in lib/write-targets.sh (shared with session-coord.sh). If the lib
# fails to load, the write-shaped branch below FAILS CLOSED rather than seeing zero targets.
case "${BASH_SOURCE[0]}" in */*) _WT_HERE="${BASH_SOURCE[0]%/*}" ;; *) _WT_HERE=. ;; esac
{ . "$_WT_HERE/lib/write-targets.sh"; } >/dev/null 2>&1
```

Immediately before `WRITE_TARGETS=$(printf '%s' "$CMD" | emit_write_targets | sort -u)` add:

```bash
    declare -F emit_write_targets >/dev/null || deny "git-safety: lib/write-targets.sh did not load while a worktree contract is active — failing closed for write-shaped commands. Bypass: SKIP_WORKTREE_CONTRACT=1."
```

- [ ] **Step 4: Verify** — `bash .claude/hooks/test-write-targets.sh` → `ALL PASS`; `bash .claude/hooks/test-git-safety.sh` → `ALL PASS` **with `test-git-safety.sh` unedited** (`/usr/bin/git diff --stat -- .claude/hooks/test-git-safety.sh` prints nothing).

- [ ] **Step 5: Commit** — message "Hooks: move the write-target parser into lib/write-targets.sh; git-safety fails closed if it is missing".

### Task 6: relative mode + `resolve_write_targets`

**Files:**

- Modify: `.claude/hooks/lib/write-targets.sh`
- Test: `.claude/hooks/test-write-targets.sh`

**Interfaces:**

- Produces: `emit_write_targets --relative` (absolute targets as before, printed per segment; relative targets buffered and printed after them, suppressed entirely when an unquoted `cd`/`pushd` word appears anywhere); `resolve_write_targets <cwd>` (stdin command → absolute paths; relative ones joined to `cwd` with a leading `./` stripped; dropped when `cwd` is empty).

- [ ] **Step 1: Failing tests** — insert above the fail-closed block of `test-write-targets.sh`:

```bash
rel() { printf '%s' "$1" | emit_write_targets --relative | tr '\n' ' '; }
res() { printf '%s' "$1" | resolve_write_targets "$2" | tr '\n' ' '; }
assert_eq "rel: rm file"                 "$(rel 'rm foo.ts')" "foo.ts "
assert_eq "rel: rm -rf skips options"    "$(rel 'rm -rf dir/a')" "dir/a "
assert_eq "rel: redirect"                "$(rel 'echo x > out.txt')" "out.txt "
assert_eq "rel: append redirect"         "$(rel 'echo x >> log/out.txt')" "log/out.txt "
assert_eq "rel: cp destination only"     "$(rel 'cp a.ts b.ts')" "b.ts "
assert_eq "rel: tee after a pipe"        "$(rel 'echo x | tee t1.txt t2.txt')" "t1.txt t2.txt "
assert_eq "rel: sed -i skips the script" "$(rel "sed -i 's/a/b/' f.ts")" "f.ts "
assert_eq "rel: sed -i -e skips the script" "$(rel "sed -i -e 's/a/b/' f.ts")" "f.ts "
assert_eq "rel: after cd → none"         "$(rel 'cd sub && rm foo.ts')" ""
assert_eq "rel: pushd → none"            "$(rel 'pushd sub; rm foo.ts')" ""
assert_eq "rel: absolute kept after cd"  "$(rel 'cd sub && rm /abs/x.ts')" "/abs/x.ts "
assert_eq "rel: env prefix not a target" "$(rel 'FOO=1 rm x.ts')" "x.ts "
assert_eq "rel: quoted write word"       "$(rel 'git commit -m "rm foo.ts"')" ""
assert_eq "rel: non-writing command"     "$(rel 'ls -la src')" ""
assert_eq "rel: mixed abs + rel"         "$(rel 'rm /abs/a.ts b.ts')" "/abs/a.ts b.ts "
# Review Focus 1: a quoted path with a space is ONE target.
SP=$(printf '%s' 'rm "my file.ts"' | emit_write_targets --relative)
assert_eq "rel: quoted path with a space is one line" "$(printf '%s\n' "$SP" | wc -l | tr -d ' ')" "1"
assert_eq "rel: quoted path with a space intact" "$SP" "my file.ts"
assert_eq "resolve: joined to cwd, ./ stripped" "$(res 'rm ./foo.ts' /repo)" "/repo/foo.ts "
assert_eq "resolve: absolute kept"              "$(res 'rm /x/y.ts' /repo)" "/x/y.ts "
assert_eq "resolve: no cwd → relative dropped"  "$(res 'rm foo.ts' '')" ""
```

- [ ] **Step 2: Run to verify failure** — the `rel:`/`resolve:` cases FAIL, exit 1.

- [ ] **Step 3: Implement** — in `lib/write-targets.sh`, apply these edits to the moved function (every addition is guarded by `rel`, so default output is unchanged):

Replace the function's first lines `emit_write_targets() {` / `  awk '` with:

```bash
emit_write_targets() {
  local rel=0
  [ "${1:-}" = "--relative" ] && rel=1
  awk -v rel="$rel" '
```

Replace `seg_reset` with:

```awk
    function seg_reset(){ np = 0; has_rm = 0; has_tee = 0; has_cp = 0; has_mv = 0; has_sed = 0; has_sedi = 0; nrp = 0; cmdseen = 0; sedpend = 0; skipnext = 0; lastrel = 0 }
```

Replace `endword` with:

```awk
    function endword(   w, tnt, iscmd){
      if (!wstart) return
      w = word; tnt = wtaint; word = ""; wstart = 0; wtaint = 0
      if (skipword) { skipword = 0; return }
      if (redir)    { redir = 0; if (substr(w, 1, 1) == "/") print w; else if (rel && w != "") relout[++nro] = w; return }
      iscmd = 0
      if (!tnt) {
        if (w == "rm") { has_rm = 1; iscmd = 1 }
        else if (w == "tee") { has_tee = 1; iscmd = 1 }
        else if (w == "cp") { has_cp = 1; iscmd = 1 }
        else if (w == "mv") { has_mv = 1; iscmd = 1 }
        else if (w == "sed") { has_sed = 1; iscmd = 1; sedpend = 1 }
        else if (substr(w, 1, 2) == "-i" || substr(w, 1, 10) == "--in-place") has_sedi = 1
        if (w == "cd" || w == "pushd") saw_cd = 1
      }
      if (substr(w, 1, 1) == "/") { paths[++np] = w; if (rel && has_sed && sedpend && !iscmd) sedpend = 0; lastrel = 0 }
      else if (rel && cmdseen && !iscmd) {
        if (skipnext) skipnext = 0
        else if (substr(w, 1, 1) == "-") { if (has_sed && (w == "-e" || w == "-f" || w == "--expression" || w == "--file")) { skipnext = 1; sedpend = 0 } }
        else if (w ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { }
        else if (has_sed && sedpend) sedpend = 0
        else { rpaths[++nrp] = w; lastrel = 1 }
      }
      if (iscmd) cmdseen = 1
    }
```

Replace `segend` with:

```awk
    function segend(   k){
      endword()
      if (has_rm || has_tee || (has_sed && has_sedi)) { for (k = 1; k <= np; k++) print paths[k]; if (rel) for (k = 1; k <= nrp; k++) relout[++nro] = rpaths[k] }
      else if (has_cp || has_mv) { if (np > 0) print paths[np]; if (rel && lastrel && nrp > 0) relout[++nro] = rpaths[nrp] }
      redir = 0; skipword = 0; seg_reset()
    }
```

In the `END` block, after its final `segend()` add:

```awk
      if (rel && !saw_cd) for (k = 1; k <= nro; k++) print relout[k]
```

After the function, add:

```bash
# resolve_write_targets <cwd>: stdin command → ABSOLUTE write targets, one per line. Relative
# targets (only reported when the command has no cd/pushd) are joined to cwd, a leading ./
# stripped; with no cwd they are dropped. No other normalization — `..` segments are
# compared as spelled.
resolve_write_targets() {
  local cwd="${1:-}" t
  emit_write_targets --relative | while IFS= read -r t; do
    case "$t" in
      /*) printf '%s\n' "$t" ;;
      *)  [ -n "$cwd" ] || continue; t="${t#./}"; printf '%s/%s\n' "${cwd%/}" "$t" ;;
    esac
  done
}
```

- [ ] **Step 4: Verify** — `bash .claude/hooks/test-write-targets.sh` → `ALL PASS`; `bash .claude/hooks/test-git-safety.sh` → `ALL PASS`, still unedited.

- [ ] **Step 5: Mutants** — insert above the final line of `test-write-targets.sh`:

```bash
. "$HOOK_DIR/lib/mutants.sh"
mutant "cd/pushd guard dropped" ".claude/hooks/lib/write-targets.sh" \
  's/if \(rel && !saw_cd\) for/if (rel) for/'
mutant "sed script not skipped" ".claude/hooks/lib/write-targets.sh" \
  's/else if \(has_sed && sedpend\) sedpend = 0/else if (0) sedpend = 0/'
mutant "git-safety fail-closed check removed" ".claude/hooks/git-safety.sh" \
  's/declare -F emit_write_targets >\/dev\/null [|][|] deny/true || deny/'
run_mutants "$PROJECT_ROOT" ".claude/hooks/test-write-targets.sh" || FAIL=1
```

Run: `bash .claude/hooks/test-write-targets.sh` → `mutants: killed 3 / applied 3 / declared 3`, `ALL PASS`.

- [ ] **Step 6: Commit** — message "Hooks: write-target parser reports relative targets on request, never after a cd".

### Task 7: schema + record per actor and for Bash

**Files:**

- Modify: `scripts/pg-lab/schema/session-coordination.sql`
- Modify: `scripts/pg-lab/session-coord.sh` (TTL line; source the lib; add `target_paths`; replace `do_record`)
- Modify: `.claude/hooks/test-session-coord.sh` (the column-count assertion is `-ge 18`; it stays valid at 19 — no edit needed here)
- Test: `.claude/hooks/test-session-coord-v2.sh` (create)

**Interfaces:**

- Consumes: `resolve_write_targets` (Task 6).
- Produces: `target_paths <hook-json>` → absolute target paths (Edit/Write/MultiEdit: `tool_input.file_path`; Bash: pre-filtered + `resolve_write_targets "$cwd"`, `sort -u`); rows `files_in_flight(session_id, agent_id, abs_path, rel_path, first_touch, last_touch)` keyed `(session_id, agent_id, abs_path)`; `WINDOW_SECS=900`.

- [ ] **Step 1: Failing tests** — create `.claude/hooks/test-session-coord-v2.sh`:

```bash
#!/usr/bin/env bash
# Session coordination v2 (spec 2026-09-27 §5–§6): per-actor records, Bash coverage,
# sibling visibility, collision ask. Throwaway DB like test-session-coord.sh; SKIPS
# (prints "skip:", exit 0) when Postgres is unreachable — CI's Lint job has none.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/session-coord.sh"
SHIM="$HOOK_DIR/session-coord-hook.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/session-coordination.sql"
FAIL=0
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected [$3], got [$2]"; FAIL=1; fi; }
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got [$2]"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing [$3] in [$2]"; FAIL=1; fi; }
command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }
command -v jq   >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

ME="v2me-$$"; OTHER="v2other-$$"
TEST_DB="pg_lab_session_coord_v2_$$"; TEST_URL="postgresql://localhost/$TEST_DB"
TMPB=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/sc-v2-XXXXXX")" && pwd -P)
SNAPF="/tmp/claude-session-coord-${ME}.json"
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE)" >/dev/null 2>&1
  rm -rf "$TMPB" "/tmp/claude-session-coord-${ME}.asks" "$SNAPF" 2>/dev/null
  rmdir "/tmp/claude-session-coord-${ME}.refresh-lock" 2>/dev/null
}
trap cleanup EXIT
age_file() { perl -e '$t = time - $ARGV[1]; utime $t, $t, $ARGV[0]' "$1" "$2"; }
q() { psql -X -qtA -F'|' -d "$TEST_URL" -c "$1"; }

# Legacy (pre-v2) tables first, so applying the schema exercises the migration path.
LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" >/dev/null 2>&1 <<'SQL'
CREATE TABLE harness.session_registry (session_id TEXT PRIMARY KEY, pid INTEGER, repo_root TEXT NOT NULL,
  branch TEXT, head_sha TEXT, session_kind TEXT NOT NULL DEFAULT 'unknown',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes');
CREATE TABLE harness.files_in_flight (session_id TEXT NOT NULL REFERENCES harness.session_registry(session_id) ON DELETE CASCADE,
  abs_path TEXT NOT NULL, rel_path TEXT NOT NULL, first_touch TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_touch TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (session_id, abs_path));
INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('legacy', '/tmp/l');
INSERT INTO harness.files_in_flight (session_id, abs_path, rel_path) VALUES ('legacy', '/tmp/l/a.ts', 'a.ts');
SQL
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_eq "schema: migrates a legacy DB cleanly" "$?" "0"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_eq "schema: idempotent" "$?" "0"
assert_eq "schema: legacy row kept with agent_id ''" "$(q "SELECT agent_id FROM harness.files_in_flight WHERE session_id='legacy'")" ""
assert_eq "schema: PK is (session_id, agent_id, abs_path)" \
  "$(q "SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum WHERE c.conrelid = 'harness.files_in_flight'::regclass AND c.contype = 'p'")" \
  "session_id,agent_id,abs_path"
q "DELETE FROM harness.session_registry" >/dev/null
export LAB_DATABASE_URL="$TEST_URL"

mkgit() { mkdir -p "$TMPB/$1"; git -C "$TMPB/$1" init -q; printf '%s' "$TMPB/$1"; }
R1=$(mkgit r1); R2=$(mkgit r2)
rec() { bash "$SCRIPT" record --stdin-json; }

# --- record (Task 7) ---------------------------------------------------------------------
jq -n --arg s "$ME" --arg f "$R1/src/a.ts" '{session_id:$s, agent_id:"agentA1", tool_name:"Write", tool_input:{file_path:$f}}' | rec
assert_eq "record: subagent row keyed by agent_id" "$(q "SELECT agent_id, rel_path FROM harness.files_in_flight WHERE abs_path='$R1/src/a.ts'")" "agentA1|src/a.ts"
jq -n --arg s "$ME" --arg f "$R1/src/a.ts" '{session_id:$s, tool_name:"Edit", tool_input:{file_path:$f}}' | rec
assert_eq "record: main agent row is agent_id ''" "$(q "SELECT count(*) FROM harness.files_in_flight WHERE abs_path='$R1/src/a.ts'")" "2"
jq -n --arg s "$ME" --arg c "rm src/b.ts && echo hi > c.txt" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | rec
assert_eq "record: Bash targets recorded" "$(q "SELECT string_agg(rel_path, ',' ORDER BY rel_path) FROM harness.files_in_flight WHERE abs_path IN ('$R1/src/b.ts','$R1/c.txt')")" "c.txt,src/b.ts"
jq -n --arg s "$ME" --arg c "cd src && rm d.ts" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | rec
assert_eq "record: Bash after cd records nothing relative" "$(q "SELECT count(*) FROM harness.files_in_flight WHERE abs_path LIKE '%d.ts'")" "0"
assert_eq "record: TTL is 15 minutes" "$(q "SELECT extract(epoch FROM expires_at - last_seen_at)::int FROM harness.session_registry WHERE session_id='$ME'")" "900"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
```

- [ ] **Step 2: Run to verify failure** — `bash .claude/hooks/test-session-coord-v2.sh` → schema PK / agent_id / Bash / TTL FAIL, exit 1.

- [ ] **Step 3: Schema** — in `scripts/pg-lab/schema/session-coordination.sql`: change the `expires_at` default in `CREATE TABLE harness.session_registry` to `interval '15 minutes'`; replace the `files_in_flight` `CREATE TABLE` with:

```sql
CREATE TABLE IF NOT EXISTS harness.files_in_flight (
    session_id   TEXT NOT NULL REFERENCES harness.session_registry(session_id) ON DELETE CASCADE,
    agent_id     TEXT NOT NULL DEFAULT '',   -- hook input agent_id; '' = the session's main agent
    abs_path     TEXT NOT NULL,
    rel_path     TEXT NOT NULL,
    first_touch  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_touch   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, agent_id, abs_path)
);
```

and append (after the existing `CREATE INDEX` statements):

```sql
-- v2 migration (spec 2026-09-27 §5.3) — idempotent for DBs created before agent_id existed.
ALTER TABLE harness.files_in_flight ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT '';
ALTER TABLE harness.session_registry ALTER COLUMN expires_at SET DEFAULT now() + interval '15 minutes';
DO $$
BEGIN
  IF (SELECT array_length(conkey, 1) FROM pg_constraint
      WHERE conrelid = 'harness.files_in_flight'::regclass AND contype = 'p') = 2 THEN
    ALTER TABLE harness.files_in_flight DROP CONSTRAINT files_in_flight_pkey;
    ALTER TABLE harness.files_in_flight ADD PRIMARY KEY (session_id, agent_id, abs_path);
  END IF;
END $$;
```

- [ ] **Step 4: `session-coord.sh`** — change `TTL='10 minutes'` to `TTL='15 minutes'`. After the `. "$SELF_DIR/lib/ps-walk.sh" …` line add:

```bash
# Shared write-target parser (spec 2026-09-27 §5.2). Missing lib = no Bash coverage, never an error.
. "$SELF_DIR/../../.claude/hooks/lib/write-targets.sh" 2>/dev/null || true
WINDOW_SECS=900   # 15-min touch/liveness window (spec §6.1). Single line: mutated by text in tests.
```

Add after `git_root_of`:

```bash
target_paths() { # $1 hook JSON -> absolute target paths, one per line
  local tool cmd cwd
  tool=$(jq -r '.tool_name // ""' <<<"$1" 2>/dev/null)
  case "$tool" in
    Bash)
      cmd=$(jq -r '.tool_input.command // ""' <<<"$1" 2>/dev/null)
      grep -qE '>|(^|[^[:alnum:]_])(tee|rm|cp|mv)([^[:alnum:]_]|$)|sed[^|;]*-i' <<<"$cmd" || return 0
      declare -F resolve_write_targets >/dev/null || return 0
      cwd=$(jq -r '.cwd // ""' <<<"$1" 2>/dev/null)
      printf '%s' "$cmd" | resolve_write_targets "$cwd" | sort -u ;;
    *) jq -r '.tool_input.file_path // empty' <<<"$1" 2>/dev/null ;;
  esac
}
```

Replace `do_record` with:

```bash
record_one() { # $1 sid, $2 agent ('' = main), $3 absolute file
  local sid="$1" agent="$2" file="$3" dir root rel
  # rel_path from the FILE's containing worktree root — never the session cwd
  # (feedback_subagent_worktree_cwd). Walk up until an existing dir (Write may create).
  dir=$(dirname "$file")
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir=$(dirname "$dir"); done
  root=$(git_root_of "$dir") || return 0
  [ -n "$root" ] || return 0
  rel="${file#"$root"/}"
  upsert_registry "$sid" "$root" ""
  run_sql -v sid="$sid" -v agent="$agent" -v abs="$file" -v rel="$rel" <<'SQL'
INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path)
VALUES (:'sid', :'agent', :'abs', :'rel')
ON CONFLICT (session_id, agent_id, abs_path) DO UPDATE SET last_touch = now();
SQL
}

do_record() {
  local input sid agent f
  input=$(cat)
  sid=$(jq -re '.session_id // empty' <<<"$input" 2>/dev/null) || exit 0
  agent=$(jq -r '.agent_id // ""' <<<"$input" 2>/dev/null)
  while IFS= read -r f; do
    [ -n "$f" ] && record_one "$sid" "$agent" "$f"
  done <<<"$(target_paths "$input")"
}
```

- [ ] **Step 5: Verify** — `bash .claude/hooks/test-session-coord-v2.sh` → `ALL PASS`; `bash .claude/hooks/test-session-coord.sh` → still `ALL PASS` (record inputs without `agent_id` map to `''`).

- [ ] **Step 6: Commit** — message "Session coordination: record per agent and for Bash writes; 15-minute liveness".

### Task 8: snapshot, consult per actor + Bash, synchronous stale refresh, wiring

**Files:**

- Modify: `scripts/pg-lab/session-coord.sh` (`do_refresh_snapshot` SQL + TERM trap; replace `do_consult`; add `refresh_bounded`, `consult_match`, `decide_and_emit`)
- Modify: `.claude/hooks/test-session-coord.sh` (lines 181–182: the "only OTHER sessions" assertion)
- Modify: `.claude/settings.json` (PreToolUse Bash consult; PostToolUse Bash record)
- Test: `.claude/hooks/test-session-coord-v2.sh`

**Interfaces:**

- Consumes: `target_paths`, `WINDOW_SECS` (Task 7).
- Produces: snapshot `{"sessions":[{session_id, session_kind, branch, repo_root, last_seen_at, files:[{abs_path, rel_path, agent_id, last_touch}]}]}` including the caller's own session (`last_touch` = epoch seconds); `consult_match <file> <sid> <agent> <snap>` → one record `lvl␟own␟osid␟okind␟obranch␟oseen␟oagent␟otouch␟rel␟xroot` (␟ = `\x1f`; `lvl` ∈ collision|worktree; `own` ∈ 1|0) or nothing; `decide_and_emit <sid> <agent> <snap_age> <file> <record>` → prints hook JSON; `refresh_bounded <sid>`.

- [ ] **Step 1: Failing tests** — insert above the final line of `test-session-coord-v2.sh`:

```bash
# --- snapshot (Task 8) ---------------------------------------------------------------------
q "INSERT INTO harness.session_registry (session_id, repo_root, session_kind, branch) VALUES ('$OTHER', '$R2', 'todo-executor', 'todo/foo') ON CONFLICT DO NOTHING" >/dev/null
q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path) VALUES ('$OTHER', '', '$R2/src/z.ts', 'src/z.ts')" >/dev/null
rm -f "$SNAPF"; bash "$SCRIPT" refresh-snapshot --session "$ME"
assert_eq "snapshot: includes own session" "$(jq -r --arg me "$ME" '[.sessions[] | select(.session_id == $me)] | length' "$SNAPF")" "1"
assert_eq "snapshot: file carries agent_id" "$(jq -r --arg me "$ME" '.sessions[] | select(.session_id == $me) | .files[] | select(.rel_path == "src/a.ts" and .agent_id == "agentA1") | .agent_id' "$SNAPF")" "agentA1"
assert_eq "snapshot: last_touch is epoch seconds" "$(jq -r '[.sessions[].files[].last_touch | type] | unique | join(",")' "$SNAPF")" "number"

# --- consult cells (Task 8: warn tiers) ----------------------------------------------------
NOW=$(date +%s)
snap() { # $1 = JSON array of session objects -> fresh snapshot file
  printf '{"sessions":%s}\n' "$1" > "$SNAPF"
}
ses() { # $1 sid, $2 files JSON array
  printf '{"session_id":"%s","session_kind":"interactive","branch":"b","repo_root":"%s","last_seen_at":"t","files":%s}' "$1" "$R1" "$2"
}
fil() { # $1 abs, $2 rel, $3 agent, $4 seconds ago
  printf '{"abs_path":"%s","rel_path":"%s","agent_id":"%s","last_touch":%s}' "$1" "$2" "$3" "$((NOW - $4))"
}
consult() { # $1 current agent ('' = main), $2 abs path
  jq -n --arg s "$ME" --arg a "$1" --arg f "$2" \
    '{session_id:$s, tool_name:"Edit", tool_input:{file_path:$f}} + (if $a == "" then {} else {agent_id:$a} end)' \
    | bash "$SCRIPT" consult --stdin-json 2>/dev/null
}
ctx()  { jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$1" 2>/dev/null; }

snap "[$(ses "$OTHER" "[$(fil "$R1/src/x.ts" src/x.ts '' 60)]")]"
assert_contains "cell other/same abs: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "same checkout"
snap "[$(ses "$OTHER" "[$(fil "$R2/src/x.ts" src/x.ts '' 60)]")]"
assert_contains "cell other/same rel other root: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "another worktree"
snap "[$(ses "$ME" "[$(fil "$R1/src/x.ts" src/x.ts agentA1 60)]")]"
assert_contains "cell own/different agent/same abs: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "Agent agentA1 in this same session"
snap "[$(ses "$ME" "[$(fil "$R1/src/x.ts" src/x.ts agentA1 60)]")]"
assert_empty "cell own/same agent/same abs: silent" "$(consult agentA1 "$R1/src/x.ts")"
snap "[$(ses "$ME" "[$(fil "$R1/src/x.ts" src/x.ts '' 60)]")]"
assert_contains "cell own/main-agent row vs subagent: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "main agent of this same session"
snap "[$(ses "$ME" "[$(fil "$R2/src/x.ts" src/x.ts agentA1 60)]")]"
assert_contains "cell own/different agent/other worktree fresh: warns" "$(ctx "$(consult agentB "$R1/src/x.ts")")" "another worktree"
snap "[$(ses "$ME" "[$(fil "$R2/src/x.ts" src/x.ts agentA1 960)]")]"
assert_empty "cell own/different agent/other worktree 16 min old: silent" "$(consult agentB "$R1/src/x.ts")"

# Bash consult (Review Focus 2: ./ spelling matches the recorded path)
snap "[$(ses "$OTHER" "[$(fil "$R1/src/x.ts" src/x.ts '' 60)]")]"
bcon() { jq -n --arg s "$ME" --arg c "$1" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | bash "$SCRIPT" consult --stdin-json 2>/dev/null; }
assert_contains "Bash consult: rm ./src/x.ts matches" "$(ctx "$(bcon 'rm ./src/x.ts')")" "same checkout"
assert_empty "Bash consult: after cd → silent" "$(bcon 'cd src && rm x.ts')"
assert_empty "Bash consult: non-writing → silent" "$(bcon 'ls src')"

# Stale snapshot + a holder that appeared since → refreshed synchronously (spec §6.2 step 0)
q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path) VALUES ('$OTHER', '', '$R1/src/late.ts', 'src/late.ts')" >/dev/null
snap "[]"; age_file "$SNAPF" 600
assert_contains "stale snapshot: new holder seen on the first consult" "$(ctx "$(consult '' "$R1/src/late.ts")")" "Session ${OTHER:0:8}"
```

- [ ] **Step 2: Run to verify failure** — snapshot/own/Bash/stale cases FAIL, exit 1.

- [ ] **Step 3: Refresh** — in `do_refresh_snapshot`, directly after `trap 'rmdir "$lockdir" 2>/dev/null' EXIT` add `trap 'exit 0' TERM`, and replace the SELECT with:

```sql
SELECT COALESCE(json_agg(s), '[]'::json) FROM (
  SELECT r.session_id, r.session_kind, r.branch, r.repo_root, r.last_seen_at,
         COALESCE((SELECT json_agg(json_build_object('abs_path', f.abs_path, 'rel_path', f.rel_path,
                                                     'agent_id', f.agent_id,
                                                     'last_touch', extract(epoch FROM f.last_touch)::bigint))
                   FROM harness.files_in_flight f WHERE f.session_id = r.session_id), '[]'::json) AS files
  FROM harness.session_registry r
  WHERE r.expires_at > now()
) s;
```

(`WHERE r.expires_at > now()` must stay on its own line exactly as written — a mutant targets it.)

- [ ] **Step 4: Consult** — replace `do_consult` with:

```bash
refresh_bounded() { # $1 sid — synchronous refresh capped at ~1 s (spec §6.2 step 0)
  bash "$SELF_DIR/session-coord.sh" refresh-snapshot --session "$1" >/dev/null 2>&1 &
  local rpid=$! i=0
  while [ "$i" -lt 10 ] && kill -0 "$rpid" 2>/dev/null; do sleep 0.1; i=$((i + 1)); done
  return 0
}

consult_match() { # $1 abs file, $2 sid, $3 agent, $4 snapshot -> one ␟-joined record or nothing
  local file="$1" dir root rel
  dir=$(dirname "$file")
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir=$(dirname "$dir"); done
  root=$(git_root_of "$dir") || root=""
  rel=""; [ -n "$root" ] && rel="${file#"$root"/}"
  jq -r --arg f "$file" --arg rel "$rel" --arg root "$root" --arg me "$2" --arg ag "$3" \
        --argjson now "$(date +%s)" --argjson win "$WINDOW_SECS" '
    def fresh($x): ($now - ($x.last_touch // 0)) <= $win;
    def is_self($s; $x): ($s.session_id == $me) and (($x.agent_id // "") == $ag);
    def own_gate($s; $x): ($s.session_id != $me) or fresh($x);
    [ .sessions[]? as $s | $s.files[]? as $x
      | select(is_self($s; $x) | not)
      | select(own_gate($s; $x))
      | ($x.abs_path | if (($x.rel_path // "") != "") and endswith("/" + $x.rel_path)
                       then .[0:(length - ($x.rel_path | length) - 1)] else "" end) as $xroot
      | if $x.abs_path == $f then {lvl: "collision", s: $s, x: $x, xroot: $xroot}
        elif ($rel != "" and ($x.rel_path // "") == $rel and $xroot != $root) then {lvl: "worktree", s: $s, x: $x, xroot: $xroot}
        else empty end ]
    | (map(select(.lvl == "collision")) + map(select(.lvl == "worktree"))) | .[0] // empty
    | [ .lvl, (if .s.session_id == $me then "1" else "0" end), .s.session_id, (.s.session_kind // "unknown"),
        (.s.branch // "?"), (.s.last_seen_at | tostring), (.x.agent_id // ""),
        ((.x.last_touch // 0) | tostring), $rel, .xroot ] | join("\u001f")
  ' "$4" 2>/dev/null
}

decide_and_emit() { # $1 sid, $2 agent, $3 snapshot age (s), $4 target file, $5 consult_match record
  local sid="$1" file="$4" lvl own osid okind obranch oseen oagent otouch rel xroot mins who msg det
  IFS=$'\x1f' read -r lvl own osid okind obranch oseen oagent otouch rel xroot <<<"$5"
  mins=$(( ( $(date +%s) - ${otouch:-0} ) / 60 ))
  det="{\"file\":$(jq -Rn --arg v "$file" '$v'),\"agent\":$(jq -Rn --arg v "$oagent" '$v')}"
  if [ -n "$oagent" ]; then who="Agent ${oagent:0:8} in this same session"; else who="The main agent of this same session"; fi
  if [ "$own" = "1" ]; then
    case "$lvl" in
      collision) msg="${who} touched this same file ${mins} min ago. Coordinate before editing. (Warn-only.)"
                 log_event "warn-collision-sibling" "$sid" "$osid" "$det" >/dev/null 2>&1 & ;;
      worktree)  msg="${who} is editing the same file in another worktree (${mins} min ago) — expect a merge conflict when both land. (Warn-only.)"
                 log_event "warn-worktree-sibling" "$sid" "$osid" "$det" >/dev/null 2>&1 & ;;
      *) return 0 ;;
    esac
  else
    case "$lvl" in
      collision) msg="Session ${osid:0:8} (${okind}, branch ${obranch}, last seen ${oseen}) is mid-edit on this same file in this same checkout. Coordinate before editing — parallel same-file edits here produced tangled commits before. (Warn-only.)"
                 log_event "warn-collision" "$sid" "$osid" "$det" >/dev/null 2>&1 & ;;
      worktree)  msg="Session ${osid:0:8} (${okind}, branch ${obranch}) is editing the same file in another worktree — expect a merge conflict when both land. (Warn-only.)"
                 log_event "warn-worktree" "$sid" "$osid" "$det" >/dev/null 2>&1 & ;;
      *) return 0 ;;
    esac
  fi
  emit_context "$msg"
}

do_consult() {
  local input sid agent files snap age f match best="" bestfile=""
  input=$(cat)
  sid=$(jq -re '.session_id // empty' <<<"$input" 2>/dev/null) || exit 0
  case "$sid" in ''|.|..|*[!A-Za-z0-9._-]*) exit 0 ;; esac
  agent=$(jq -r '.agent_id // ""' <<<"$input" 2>/dev/null)
  files=$(target_paths "$input")
  [ -n "$files" ] || exit 0
  snap="/tmp/claude-session-coord-${sid}.json"
  age=$(snapshot_age_secs "$snap")
  if [ "$age" -gt 25 ]; then refresh_bounded "$sid"; age=$(snapshot_age_secs "$snap"); fi
  [ -f "$snap" ] || exit 0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    match=$(consult_match "$f" "$sid" "$agent" "$snap")
    [ -n "$match" ] || continue
    if [ "${match%%$'\x1f'*}" = "collision" ]; then best="$match"; bestfile="$f"; break; fi
    [ -n "$best" ] || { best="$match"; bestfile="$f"; }
  done <<<"$files"
  [ -n "$best" ] || exit 0
  decide_and_emit "$sid" "$agent" "$age" "$bestfile" "$best"
}
```

- [ ] **Step 5: Update the old suite's intentional change** — in `.claude/hooks/test-session-coord.sh` replace the two lines

```bash
assert_eq "snapshot lists only OTHER sessions" "$N_OTHER" "1"
assert_eq "snapshot session id" "$(jq -r '.sessions[0].session_id' "$SNAP")" "$OTHERSID"
```

with

```bash
assert_eq "snapshot lists all live sessions, own included (v2 §5.1)" "$N_OTHER" "2"
assert_eq "snapshot carries the other session" "$(jq -r --arg o "$OTHERSID" '[.sessions[] | select(.session_id == $o)] | length' "$SNAP")" "1"
```

and replace the following line with:

```bash
assert_eq "snapshot carries files" "$(jq -r --arg o "$OTHERSID" '.sessions[] | select(.session_id == $o) | .files[0].rel_path' "$SNAP")" "server/index.ts"
```

- [ ] **Step 6: Verify** — `bash .claude/hooks/test-session-coord-v2.sh` → `ALL PASS`; `bash .claude/hooks/test-session-coord.sh` → `ALL PASS`.

- [ ] **Step 7: Wire** — `.claude/settings.json`: append to `PreToolUse`:

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/session-coord-hook.sh\" consult",
      "timeout": 10
    }
  ]
}
```

append to `PostToolUse`:

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/session-coord-hook.sh\" record"
    }
  ]
}
```

Run: `jq . .claude/settings.json >/dev/null && bash .claude/hooks/test-settings-hook-paths.sh && bash .claude/hooks/test-session-coord.sh` → all pass (the old suite's `for pair in … "PreToolUse:consult"` wiring check still finds its entries).

- [ ] **Step 8: Mutants** — insert above the final line of `test-session-coord-v2.sh`:

```bash
. "$HOOK_DIR/lib/mutants.sh"
mutant "is_self ignores agent_id (all own rows = self)" "scripts/pg-lab/session-coord.sh" \
  's/^( *def is_self\(\$s; \$x\): \(\$s\.session_id == \$me\)) and .*;$/\1;/'
mutant "is_self never true (own same-agent rows collide)" "scripts/pg-lab/session-coord.sh" \
  's/^( *def is_self\(\$s; \$x\):).*;$/\1 false;/'
mutant "own-session 15-min gate dropped" "scripts/pg-lab/session-coord.sh" \
  's/^( *def own_gate\(\$s; \$x\):).*;$/\1 true;/'
mutant "refresh excludes own session again" "scripts/pg-lab/session-coord.sh" \
  "s/^  WHERE r\\.expires_at > now\\(\\)\$/  WHERE r.session_id <> :'sid' AND r.expires_at > now()/"
mutant "stale snapshot refreshed in background only" "scripts/pg-lab/session-coord.sh" \
  's/then refresh_bounded "\$sid";/then refresh_bounded "$sid" \&/'
run_mutants "$PROJECT_ROOT" ".claude/hooks/test-session-coord-v2.sh" || FAIL=1
```

Run: `bash .claude/hooks/test-session-coord-v2.sh` → `mutants: killed 5 / applied 5 / declared 5`, `ALL PASS`.

- [ ] **Step 9: Commit** — message "Session coordination: sibling agents see each other; Bash writes are consulted; stale snapshots refresh before judging".

- [ ] **Step 10: Ship** — PR Procedure steps 3–8 for `feat/coord-visibility-bash`. **After merge**, migrate the live lab DB:

```bash
psql -X -q -v ON_ERROR_STOP=1 -d postgresql://localhost/ocrecipes_lab -f scripts/pg-lab/schema/session-coordination.sql
psql -X -qtA -d postgresql://localhost/ocrecipes_lab -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='harness' AND table_name='files_in_flight' AND column_name='agent_id'"
```

Expected: second command prints `1`. Until this runs, `record`'s 3-column `ON CONFLICT` fails silently and nothing is recorded — do it immediately after the merge.

---

# PR 3 — Collision ask

Branch `feat/coord-collision-ask`, worktree `coord-pr3`, based on `main` **after PR 2 merged and the live DB migrated**.

### Task 9: ask on a confirmed live collision

**Files:**

- Modify: `scripts/pg-lab/session-coord.sh` (add `emit_ask`, `live_confirm`; extend `decide_and_emit`)
- Test: `.claude/hooks/test-session-coord-v2.sh`

**Interfaces:**

- Consumes: `decide_and_emit`, `consult_match` record format, `WINDOW_SECS` (Task 8).
- Produces: `emit_ask <reason> <context>`; `live_confirm <holder_sid> <holder_agent> <abs>` → `yes|no|error`; `ask_dir <sid>`, `ask_key <abs> <current_agent>`, `ask_mark_pending <sid> <agent> <abs> <holder>`, `ask_suppressed <sid> <agent> <abs> <holder>` (holder = `"<sid>:<agent>"`). This task implements the marker functions in full because `decide_and_emit` calls them; Task 10 adds `promote` and the shim wiring that flips a marker to `approved`.

- [ ] **Step 1: Failing tests** — insert above the mutants block of `test-session-coord-v2.sh`:

```bash
# --- collision ask (Task 9) ------------------------------------------------------------------
dec()    { jq -r '.hookSpecificOutput.permissionDecision // "none"' <<<"$1" 2>/dev/null; }
reason() { jq -r '.hookSpecificOutput.permissionDecisionReason // ""' <<<"$1" 2>/dev/null; }
hold()   { # $1 sid, $2 agent, $3 abs, $4 rel, $5 seconds ago — DB row
  q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path, last_touch) VALUES ('$1', '$2', '$3', '$4', now() - make_interval(secs => $5)) ON CONFLICT (session_id, agent_id, abs_path) DO UPDATE SET last_touch = EXCLUDED.last_touch" >/dev/null
}
q "INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('$ME', '$R1') ON CONFLICT (session_id) DO UPDATE SET expires_at = now() + interval '15 minutes'" >/dev/null
q "UPDATE harness.session_registry SET expires_at = now() + interval '15 minutes'" >/dev/null
rm -rf "/tmp/claude-session-coord-${ME}.asks"

hold "$OTHER" '' "$R1/src/k.ts" src/k.ts 60
snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
LOG_BEFORE=$(q "SELECT count(*) FROM harness.coordination_log WHERE event='ask-collision' AND session_id='$ME'")
OUT=$(consult '' "$R1/src/k.ts")
assert_eq "ask: confirmed live other-session hold" "$(dec "$OUT")" "ask"
assert_contains "ask: reason names the holder" "$(reason "$OUT")" "Session ${OTHER:0:8}"
assert_contains "ask: reason says approve" "$(reason "$OUT")" "Approve to edit anyway."
assert_contains "ask: model context present" "$(ctx "$OUT")" "Collision:"
sleep 1   # log_event is backgrounded
LOG_AFTER=$(q "SELECT count(*) FROM harness.coordination_log WHERE event='ask-collision' AND session_id='$ME'")
assert_eq "ask: exactly one telemetry row for this ask" "$((LOG_AFTER - LOG_BEFORE))" "1"
rm -rf "/tmp/claude-session-coord-${ME}.asks"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/ghost.ts" src/ghost.ts '' 60)]")]"
assert_eq "ask: snapshot hit not confirmed live → warn" "$(dec "$(consult '' "$R1/src/ghost.ts")")" "none"

hold "$OTHER" '' "$R1/src/b14.ts" src/b14.ts 840
snap "[$(ses "$OTHER" "[$(fil "$R1/src/b14.ts" src/b14.ts '' 840)]")]"
assert_eq "ask: boundary 14 min → ask" "$(dec "$(consult '' "$R1/src/b14.ts")")" "ask"
hold "$OTHER" '' "$R1/src/b16.ts" src/b16.ts 960
snap "[$(ses "$OTHER" "[$(fil "$R1/src/b16.ts" src/b16.ts '' 960)]")]"
assert_eq "ask: boundary 16 min → warn" "$(dec "$(consult '' "$R1/src/b16.ts")")" "none"

hold "$ME" agentA1 "$R1/src/sib.ts" src/sib.ts 60
snap "[$(ses "$ME" "[$(fil "$R1/src/sib.ts" src/sib.ts agentA1 60)]")]"
assert_eq "ask: sibling agent confirmed → ask" "$(dec "$(consult agentB "$R1/src/sib.ts")")" "ask"
rm -rf "/tmp/claude-session-coord-${ME}.asks"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
assert_eq "ask: SKIP_COLLISION_ASK=1 → warn" "$(dec "$(SKIP_COLLISION_ASK=1 consult '' "$R1/src/k.ts")")" "none"

snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"
assert_eq "ask: pg down + fresh snapshot → ask" "$(dec "$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" consult '' "$R1/src/k.ts")")" "ask"
rm -rf "/tmp/claude-session-coord-${ME}.asks"
snap "[$(ses "$OTHER" "[$(fil "$R1/src/k.ts" src/k.ts '' 60)]")]"; age_file "$SNAPF" 70
assert_eq "ask: pg down + 70 s snapshot → warn" "$(dec "$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" consult '' "$R1/src/k.ts")")" "none"
```

(The existing cells from Task 8 that asserted warn text for `cell other/same abs` and `cell own/different agent/same abs` use fixture snapshots with **no DB row**, so live confirm answers `no` and they stay warns — they keep passing unchanged.)

- [ ] **Step 2: Run to verify failure** — ask cases FAIL (`expected [ask], got [none]`), exit 1.

- [ ] **Step 3: Implement** — add to `session-coord.sh` after `emit_context`:

```bash
emit_ask() { # $1 reason (shown to the user), $2 context (delivered to the model — probe §9.0.1)
  jq -n --arg r "$1" --arg c "$2" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r,additionalContext:$c}}'
}

live_confirm() { # $1 holder session, $2 holder agent ('' = main), $3 abs path -> yes | no | error
  local out
  out=$(psql -X -qtA -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v hs="$1" -v ha="$2" -v p="$3" -v win="$WINDOW_SECS" 2>/dev/null <<'SQL'
SELECT 1 FROM harness.files_in_flight f JOIN harness.session_registry r USING (session_id)
WHERE f.session_id = :'hs' AND f.agent_id = :'ha' AND f.abs_path = :'p'
  AND f.last_touch > now() - make_interval(secs => :win) AND r.expires_at > now()
LIMIT 1;
SQL
  ) || { echo error; return 0; }
  if [ "$out" = "1" ]; then echo yes; else echo no; fi
}

ask_dir() { printf '/tmp/claude-session-coord-%s.asks' "$1"; }
ask_key() { printf '%s\037%s' "$1" "$2" | shasum | cut -c1-40; }   # $1 abs path, $2 CURRENT agent
ask_mark_pending() { # $1 sid, $2 agent, $3 file, $4 holder "<sid>:<agent>"
  local d; d=$(ask_dir "$1"); mkdir -p "$d" 2>/dev/null || return 0
  printf 'pending %s %s\n' "$4" "$(date +%s)" > "$d/$(ask_key "$3" "$2")" 2>/dev/null
  return 0
}
ask_suppressed() { # rc 0 iff an APPROVED marker for this (file, current agent, holder) is within the window
  local m st h ts
  m="$(ask_dir "$1")/$(ask_key "$3" "$2")"
  [ -f "$m" ] || return 1
  read -r st h ts < "$m" || return 1
  [ "$st" = approved ] && [ "$h" = "$4" ] && [ $(( $(date +%s) - ${ts:-0} )) -le "$WINDOW_SECS" ]
}
```

In `decide_and_emit`, insert immediately before the `if [ "$own" = "1" ]; then` line:

```bash
  if [ "$lvl" = "collision" ]; then
    local reason="" ask_reason ctx ev wt
    if [ $(( $(date +%s) - ${otouch:-0} )) -gt "$WINDOW_SECS" ]; then reason="stale-touch"
    elif [ "${SKIP_COLLISION_ASK:-}" = "1" ]; then reason="bypass"
    elif ask_suppressed "$sid" "$2" "$file" "$osid:$oagent"; then reason="suppressed"
    else
      case "$(live_confirm "$osid" "$oagent" "$file")" in
        yes) ;;
        no)  reason="live-unconfirmed" ;;
        *)   [ "$3" -lt 60 ] || reason="pg-down-stale-snapshot" ;;
      esac
    fi
    if [ -z "$reason" ]; then
      wt=$(basename "${xroot:-?}")
      if [ "$own" = "1" ]; then
        ask_reason="${who} (worktree ${wt}) last touched ${rel:-$file} ${mins} min ago. Approve to edit anyway."
        ev="ask-collision-sibling"
      else
        ask_reason="Session ${osid:0:8} (${okind}, branch ${obranch}, worktree ${wt}) last touched ${rel:-$file} ${mins} min ago. Approve to edit anyway."
        ev="ask-collision"
      fi
      ctx="Collision: ${ask_reason} The user was asked to approve this edit; if it is denied, coordinate with that session instead of retrying."
      ask_mark_pending "$sid" "$2" "$file" "$osid:$oagent"
      log_event "$ev" "$sid" "$osid" "$det" >/dev/null 2>&1 &
      emit_ask "$ask_reason" "$ctx"
      return 0
    fi
    log_event "ask-downgraded" "$sid" "$osid" "{\"reason\":\"$reason\",\"file\":$(jq -Rn --arg v "$file" '$v')}" >/dev/null 2>&1 &
  fi
```

- [ ] **Step 4: Verify** — `bash .claude/hooks/test-session-coord-v2.sh` → `ALL PASS` (mutants from Task 8 still `killed 5 / applied 5 / declared 5`).

- [ ] **Step 5: Commit** — message "Session coordination: a confirmed live same-file collision asks the user".

### Task 10: ask-once suppression, promote, shim, mutants, docs

**Files:**

- Modify: `scripts/pg-lab/session-coord.sh` (add `do_promote`; dispatcher `promote)`)
- Modify: `.claude/hooks/session-coord-hook.sh` (synchronous promote; asks-dir cleanup)
- Modify: `docs/rules/harness.md`; regenerate `.github/copilot-instructions.md`
- Modify (local-only, not committed): `docs/superpowers/specs/2026-07-10-pg-session-coordination-design.md` status block
- Test: `.claude/hooks/test-session-coord-v2.sh`

**Interfaces:**

- Consumes: `ask_dir`, `ask_key`, `target_paths`, `log_event`.
- Produces: `session-coord.sh promote --stdin-json` (PostToolUse JSON; pending → approved for each target; local-only, synchronous).

- [ ] **Step 1: Failing tests** — insert above the mutants block:

```bash
# --- ask-once suppression (Task 10) ------------------------------------------------------------
rm -rf "/tmp/claude-session-coord-${ME}.asks"
hold "$OTHER" '' "$R1/src/once.ts" src/once.ts 60
snap "[$(ses "$OTHER" "[$(fil "$R1/src/once.ts" src/once.ts '' 60)]")]"
assert_eq "once: first edit asks" "$(dec "$(consult agentB "$R1/src/once.ts")")" "ask"
POST=$(jq -n --arg s "$ME" --arg f "$R1/src/once.ts" '{session_id:$s, agent_id:"agentB", tool_name:"Edit", tool_input:{file_path:$f}}')
printf '%s' "$POST" | bash "$SHIM" record
M="/tmp/claude-session-coord-${ME}.asks/$(printf '%s\037%s' "$R1/src/once.ts" agentB | shasum | cut -c1-40)"
assert_eq "once: shim promotes synchronously (no wait)" "$(cut -d' ' -f1 "$M" 2>/dev/null)" "approved"
snap "[$(ses "$OTHER" "[$(fil "$R1/src/once.ts" src/once.ts '' 60)]")]"
assert_eq "once: approved holder → warn next time" "$(dec "$(consult agentB "$R1/src/once.ts")")" "none"
assert_eq "once: another agent is asked separately" "$(dec "$(consult agentC "$R1/src/once.ts")")" "ask"
printf 'approved %s:%s %s\n' "$OTHER" "" "$(( $(date +%s) - 960 ))" > "$M"
assert_eq "once: approval older than 15 min → ask again" "$(dec "$(consult agentB "$R1/src/once.ts")")" "ask"
printf 'approved %s:%s %s\n' "someone-else" "" "$(date +%s)" > "$M"
assert_eq "once: approval for a different holder → ask" "$(dec "$(consult agentB "$R1/src/once.ts")")" "ask"
jq -n --arg s "$ME" '{session_id:$s}' | bash "$SHIM" deregister
[ ! -d "/tmp/claude-session-coord-${ME}.asks" ] && echo "ok: deregister removes the asks dir" || { echo "FAIL: asks dir survived deregister"; FAIL=1; }
```

- [ ] **Step 2: Run to verify failure** — `once:` promotion / suppression / deregister cases FAIL, exit 1.

- [ ] **Step 3: Implement `do_promote`** — add before the dispatcher in `session-coord.sh`:

```bash
do_promote() { # PostToolUse JSON on stdin: pending -> approved for each target (the tool RAN, so the user approved)
  local input sid agent d f m st h ts
  input=$(cat)
  sid=$(jq -re '.session_id // empty' <<<"$input" 2>/dev/null) || exit 0
  case "$sid" in ''|.|..|*[!A-Za-z0-9._-]*) exit 0 ;; esac
  d=$(ask_dir "$sid"); [ -d "$d" ] || exit 0
  agent=$(jq -r '.agent_id // ""' <<<"$input" 2>/dev/null)
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    m="$d/$(ask_key "$f" "$agent")"
    [ -f "$m" ] || continue
    read -r st h ts < "$m" || continue
    [ "$st" = pending ] || continue
    printf 'approved %s %s\n' "$h" "$(date +%s)" > "$m"
    log_event "ask-approved" "$sid" "${h%%:*}" "{\"file\":$(jq -Rn --arg v "$f" '$v')}" >/dev/null 2>&1 &
  done <<<"$(target_paths "$input")"
}
```

Add `  promote)          do_promote ;;` to the dispatcher `case`.

- [ ] **Step 4: Shim** — in `.claude/hooks/session-coord-hook.sh`:

next to `[ -n "$SESSION_ID" ] && rm -rf "/tmp/claude-worktree-contracts-${SESSION_ID}"` add:

```bash
  [ -n "$SESSION_ID" ] && rm -rf "/tmp/claude-session-coord-${SESSION_ID}.asks"
```

replace the `register|record|deregister)` arm with:

```bash
  register|record|deregister)
    # Ask-once promotion is a LOCAL file write done synchronously BEFORE record is
    # backgrounded — otherwise the model's next edit can reach consult before the marker
    # flips, and the user gets a second prompt (spec 2026-09-27 §6.4).
    [ "$SUB" = "record" ] && printf '%s' "$INPUT" | bash "$SCRIPT" promote --stdin-json >/dev/null 2>&1
    # --stdin-json is only meaningful to register's CLI/hook-mode branch; record and
    # deregister always read stdin unconditionally and ignore the flag entirely.
    printf '%s' "$INPUT" | bash "$SCRIPT" "$SUB" --stdin-json >/dev/null 2>&1 &
    ;;
```

- [ ] **Step 5: Verify** — `bash .claude/hooks/test-session-coord-v2.sh` and `bash .claude/hooks/test-session-coord.sh` → `ALL PASS`.

- [ ] **Step 6: Mutants** — add to the mutants block of `test-session-coord-v2.sh`, before `run_mutants`:

```bash
mutant "ask becomes allow" "scripts/pg-lab/session-coord.sh" \
  's/permissionDecision:"ask"/permissionDecision:"allow"/'
mutant "live confirm skipped (snapshot trusted)" "scripts/pg-lab/session-coord.sh" \
  's/case "\$\(live_confirm "\$osid" "\$oagent" "\$file"\)" in/case "yes" in/'
mutant "touch window 15 min → 150 min" "scripts/pg-lab/session-coord.sh" \
  's/^WINDOW_SECS=900 /WINDOW_SECS=9000 /'
mutant "approved markers ignored" "scripts/pg-lab/session-coord.sh" \
  's/elif ask_suppressed /elif false \&\& ask_suppressed /'
```

Run: `bash .claude/hooks/test-session-coord-v2.sh` → `mutants: killed 9 / applied 9 / declared 9`, `ALL PASS`.

- [ ] **Step 7: Docs** — append to `docs/rules/harness.md`:

```markdown
## Collision ask (session coordination v2)

- Editing (Edit/Write/MultiEdit or a Bash write) a file that another live session — or a sibling subagent of this session — touched in the last 15 minutes asks the user first, naming the holder. Approving once suppresses further asks for that file and holder for 15 minutes.
- `SKIP_COLLISION_ASK=1` turns the ask into a warning (for `claude -p` / `dontAsk` runs, where an ask resolves to deny).
```

Run `npm run build:copilot-instructions`; stage the regenerated file.

Local-only (gitignored — edit, do not commit): in `docs/superpowers/specs/2026-07-10-pg-session-coordination-design.md`, append to its Status block: `- **Superseded in part (2026-09-27):** the warn-only non-goal is reversed for confirmed live same-file collisions, which now ask — see 2026-09-27-session-coordination-v2-design.md §6.`

- [ ] **Step 8: Commit** — message "Session coordination: ask once per holder; promote approvals synchronously".

- [ ] **Step 9: Ship** — PR Procedure steps 3–8 for `feat/coord-collision-ask`.

---

# After PR 3 — verification prompt

### Task 11: two-session verification doc

**Files:**

- Create: `docs/verification/session-coordination-two-session.md`

**Interfaces:** consumes the shipped hooks; produces a runbook the user executes.

- [ ] **Step 1: Write the doc** with this content:

````markdown
# Two-session coordination verification

Proves the v2 coordination layer end to end on a live machine: collision asks (incl. over
Remote Control), cross-worktree warns, Bash coverage, sibling-subagent asks, and checkpoint
recovery — plus a negative control. Nothing is pushed; no PRs are opened.
Spec: docs/superpowers/specs/2026-09-27-session-coordination-v2-design.md §9.5 (local-only).

## Setup (one terminal)

```bash
cd ~/projects/OCRecipes
git worktree add .claude/worktrees/probe-coord-a -b probe/coord-a origin/main
git worktree add .claude/worktrees/probe-coord-b -b probe/coord-b origin/main
for w in a b; do mkdir -p .claude/worktrees/probe-coord-$w/scratch/coord-probe
  printf 'one\n' > .claude/worktrees/probe-coord-$w/scratch/coord-probe/one.ts
  printf 'two\n' > .claude/worktrees/probe-coord-$w/scratch/coord-probe/two.ts
  printf 'three\n' > .claude/worktrees/probe-coord-$w/scratch/coord-probe/three.ts; done
START=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "START=$START"
```

Launch **session A** in `.claude/worktrees/probe-coord-a` and **session B** in
`.claude/worktrees/probe-coord-b`, each with `claude --permission-mode auto --remote-control`.
Keep your phone on Remote Control.

## Scenarios

Let `A=<absolute path of probe-coord-a>`, `B=<absolute path of probe-coord-b>`.

| #   | Send to               | Prompt                                                                                                                                                                        | Expected                                                                                                                                                                    |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A                     | `Append the line "a1" to $A/scratch/coord-probe/one.ts.`                                                                                                                      | runs normally                                                                                                                                                               |
| 1   | B (wait ≥ 60 s first) | `Append the line "b1" to $A/scratch/coord-probe/one.ts.`                                                                                                                      | **ask** naming A's session, on the terminal and the phone                                                                                                                   |
| 2   | B                     | `Append the line "b2" to $B/scratch/coord-probe/one.ts.`                                                                                                                      | warn: same file in another worktree                                                                                                                                         |
| 3   | B                     | `Run: rm $A/scratch/coord-probe/one.ts`                                                                                                                                       | **ask** naming A (deny it)                                                                                                                                                  |
| 4   | A                     | `Dispatch a background general-purpose subagent to append "s1" to $A/scratch/coord-probe/two.ts; then dispatch a second background subagent to append "s2" to the same file.` | the second subagent's edit **asks**, naming the first subagent — reaches the phone                                                                                          |
| 5   | A                     | `Append "c1" to $A/scratch/coord-probe/three.ts, dispatch a general-purpose subagent to read that file, then run: git checkout -- scratch/coord-probe/three.ts`               | afterwards `bash scripts/checkpoint.sh list` shows a checkpoint whose tree has "c1"; `git restore --source=<ref> --worktree -- scratch/coord-probe/three.ts` brings it back |
| 6   | A and B               | A: `Append "n" to $A/scratch/coord-probe/three.ts.` B: `Append "n" to $B/scratch/coord-probe/two.ts.`                                                                         | **negative control:** no ask, no warn                                                                                                                                       |

## Evidence (observed / attempted)

```bash
psql -X -qtA -d postgresql://localhost/ocrecipes_lab -c "SELECT event, count(*) FROM harness.coordination_log WHERE ts >= '$START' GROUP BY 1 ORDER BY 1"
git for-each-ref refs/checkpoints/ --format='%(refname) %(committerdate:iso8601)'
```

Pass when: `ask-collision` ≥ 2 (scenarios 1, 3) of 2 attempted; `ask-collision-sibling` ≥ 1 of 1;
`warn-worktree` ≥ 1 of 1; a checkpoint ref exists and restores scenario 5's line; scenario 6
added **no** ask/warn rows (compare counts taken just before and just after it). Record the
phone observations for scenarios 1 and 4.

## Cleanup

```bash
git worktree remove --force .claude/worktrees/probe-coord-a
git worktree remove --force .claude/worktrees/probe-coord-b
git branch -D probe/coord-a probe/coord-b
psql -X -q -d postgresql://localhost/ocrecipes_lab -c "DELETE FROM harness.coordination_log WHERE ts >= '$START'"
```
````

- [ ] **Step 2: Commit and ship** — own branch `docs/coord-verification`, PR Procedure steps 1–8 (docs-only PR).

---

## Self-review record

- **Spec coverage:** §4 → Tasks 2–4; §5.1/§5.3 → Tasks 7–8; §5.2 → Tasks 5–6; §6.1–§6.3/§6.5 → Task 9; §6.4 → Tasks 9–10; §7.1 → Tasks 2–4; §7.2 → Tasks 7–10; §7.3 → Tasks 5–6 (unedited `test-git-safety.sh`); §7.4 → Task 1 + mutant blocks in Tasks 4, 6, 8, 10; §9.0 → done in brainstorm (§9.0.1); §9.1–§9.4 → PR 0–3; §9.5 → Task 11; §10 → Tasks 4, 10.
- **Spec mutant table vs plan:** all §7.4 rows are present except "`checkpoint.sh`: dropping `-p "$prev"`" (present as "previous-checkpoint parent dropped") — every row is covered; the §7.1 "performance" test is a budget smoke, not a stat-cache proof (a copied-vs-fresh index is not observable at 2,000 files) — the 0-byte-index failure is what forces the copy.
- **Type/name consistency:** `emit_write_targets --relative`, `resolve_write_targets <cwd>`, `target_paths <json>`, `consult_match <file> <sid> <agent> <snap>`, `decide_and_emit <sid> <agent> <age> <file> <record>`, `live_confirm`, `ask_dir`/`ask_key`/`ask_mark_pending`/`ask_suppressed`, `do_promote` — used identically in every task.
