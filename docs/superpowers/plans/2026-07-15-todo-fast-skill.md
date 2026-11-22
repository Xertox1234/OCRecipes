# `/todo-fast` Accelerated Single-Todo Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `todo-executor.md`'s unscoped, repeated full-suite verification (the actual bottleneck behind slow single-todo runs) once in shared infrastructure, then add a new `/todo-fast` skill that decomposes a single medium/high/critical todo into parallel-safe sub-tasks via the `Plan` agent where possible, on top of that fix.

**Architecture:** Part A (Tasks 1–2) is a surgical fix to shared, existing files: a new `--uncommitted` mode on `scripts/preflight.sh`, and a rewrite of `todo-executor.md`'s Step 5 to use it plus overlap the full CI-parity suite with Step 6's review dispatch. Part B (Tasks 3–4) is net-new: a narrow `todo-fast-implementer` agent that implements one assigned slice inside a worktree it doesn't own, and a `todo-fast` orchestrator skill that decomposes a todo (via the `Plan` agent), dispatches implementer(s) concurrently into one shared worktree, and otherwise rides Part A's fixed pipeline by direct reference. Task 5 is end-to-end validation.

**Tech Stack:** Bash (`scripts/preflight.sh`, hook self-tests), Markdown-as-instructions (Claude Code skills/agents — `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`), git worktrees, the Claude Code `Agent`/`advisor` tool surface.

## Global Constraints

- Never commit or push directly to `main` — this work lands on a dedicated feature branch (e.g. `feat/todo-fast-skill`), never reusing an unrelated in-progress branch.
- `docs/superpowers/` (this plan, the design spec it implements) is gitignored project-wide — never `git add -f` it; only the four files listed below under New/Modified Artifacts are tracked and committed.
- TDD applies literally to Task 1 (`scripts/preflight.sh` is executable Bash with a real test harness). Tasks 2–4 modify or create Markdown instructions consumed by an LLM, not code a test runner executes — their "test cycle" is an explicit before/after consistency read-through (spelled out per-task below), not a vitest/bash test. Task 5 is the closest thing to an integration test for the whole feature and must not be skipped.
- Follow existing conventions exactly: the new agent file mirrors `todo-executor.md`/`todo-researcher.md`'s frontmatter and step-numbering style; the new skill file mirrors `.claude/skills/todo/SKILL.md`'s phase-based structure and Agent-dispatch code-block style.
- Every new hook test file must land directly in `.claude/hooks/` matching the `test-*.sh` glob `scripts/run-hook-tests.sh` already discovers automatically — no separate registration step exists or is needed.
- Frequent, small commits — one per task at minimum.

## New / Modified Artifacts

1. `scripts/preflight.sh` — modified (Task 1): new `--uncommitted` flag.
2. `.claude/hooks/test-preflight-uncommitted-scope.sh` — new (Task 1): TDD test for the flag.
3. `.claude/agents/todo-executor.md` — modified (Task 2): Step 5 rewritten into 5a/5b; Step 6 item 3 and Step 7 items 5–6 get small cross-referencing edits.
4. `.claude/agents/todo-fast-implementer.md` — new (Task 3).
5. `.claude/skills/todo-fast/SKILL.md` — new (Task 4).

---

### Task 1: `scripts/preflight.sh` — `--uncommitted` scope mode

**Files:**

- Modify: `scripts/preflight.sh`
- Create: `.claude/hooks/test-preflight-uncommitted-scope.sh`

**Interfaces:**

- Consumes: nothing from other tasks — this is the first task, self-contained.
- Produces: `scripts/preflight.sh --fast --uncommitted` — a mode Task 2 depends on referencing verbatim in `todo-executor.md`'s rewritten Step 5a.

**Confirmed by reading the script before writing this task:** in `--fast` mode, `preflight.sh` computes `BASE=$(git merge-base HEAD origin/main ...)` (line 41) and diffs `BASE..HEAD` — committed history only ("push gate semantics", per its own header comment). It has no visibility into uncommitted working-tree changes. A todo-executor's implementation is uncommitted at verify time (commit happens later, in Step 8) — invoking today's `--fast` mid-pipeline would see zero changed files and silently no-op instead of actually checking the diff. Separately confirmed: the existing pass-stamp write (lines 105–108) is unconditional once `tests_skipped=0` and is NOT gated by `PREFLIGHT_DRY_RUN` — so a naive `--uncommitted` implementation would write a stamp keyed to the CURRENT (pre-implementation) HEAD, which is the wrong commit to certify (the real implementation lands on a later commit, at Step 8). The fix below scopes the diff off the working tree in `--uncommitted` mode and explicitly skips the stamp write in that mode.

- [ ] **Step 1: Write the failing tests**

Create `.claude/hooks/test-preflight-uncommitted-scope.sh`:

```bash
#!/usr/bin/env bash
# Tests scripts/preflight.sh --fast --uncommitted: scope the changed-file set off the
# working tree vs HEAD, not committed BASE..HEAD (push-gate semantics) — needed for
# mid-pipeline verification (todo-executor.md Step 5a) where the implementation is not
# yet committed; comparing against origin/main there would see zero changes and
# silently no-op. Also confirms --uncommitted never writes a pass-stamp (the current
# HEAD hasn't received the implementation yet — a stamp for it would certify the wrong
# commit; the real one lands later, at todo-executor.md Step 8).
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/preflight.sh"
PASS=0; FAIL=0
BIN=$(mktemp -d); trap 'rm -rf "$BIN"' EXIT

pg_stub() { # $1 = exit code pg_isready returns (0 = reachable)
  cat > "$BIN/pg_isready" <<EOF
#!/usr/bin/env bash
exit $1
EOF
  chmod +x "$BIN/pg_isready"
}

make_repo_with_uncommitted_ts() {
  local d; d=$(mktemp -d)
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
  echo "export const x = 1" > "$d/foo.ts"
  git -C "$d" add foo.ts   # staged, but NEVER committed — the point of this test
  printf '%s' "$d"
}

run_dry() { # $1 repo, remaining args = preflight flags. Captures dry-run stdout+stderr.
  local repo; repo="$1"; shift
  ( cd "$repo" && PATH="$BIN:$PATH" PREFLIGHT_DRY_RUN=1 PREFLIGHT_STAMP_FILE="$repo/.stamp" bash "$SCRIPT" "$@" 2>&1 )
}

assert_contains()     { if printf '%s' "$2" | grep -q "$3"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (missing: $3)"; FAIL=$((FAIL+1)); fi; }
assert_not_contains()  { if printf '%s' "$2" | grep -q "$3"; then echo "FAIL: $1 (unexpectedly present: $3)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }
assert_no_stamp_file() { if [ -f "$2" ]; then echo "FAIL: $1 (stamp WAS written)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }

pg_stub 0

R=$(make_repo_with_uncommitted_ts)
OUT=$(run_dry "$R" --fast --uncommitted)
assert_contains     "uncommitted ts file IS scoped in with --uncommitted" "$OUT" "foo.ts"
assert_no_stamp_file "--uncommitted mode never writes a pass-stamp" "$R/.stamp"
rm -rf "$R"

R=$(make_repo_with_uncommitted_ts)
OUT=$(run_dry "$R" --fast)
assert_not_contains "uncommitted ts file is NOT scoped without --uncommitted (push-gate semantics unchanged)" "$OUT" "foo.ts"
rm -rf "$R"

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
```

Make it executable:

```bash
chmod +x .claude/hooks/test-preflight-uncommitted-scope.sh
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash .claude/hooks/test-preflight-uncommitted-scope.sh`

Expected: `FAIL: uncommitted ts file IS scoped in with --uncommitted (missing: foo.ts)` and `FAIL: --uncommitted mode never writes a pass-stamp (stamp WAS written)` — the current script doesn't recognize `--uncommitted` at all, so it silently falls through to committed-range scoping (no `foo.ts`) and writes a stamp unconditionally. `Results: 1 passed, 2 failed` (the third assertion, "not scoped without --uncommitted", already passes today — that's existing, unchanged behavior).

- [ ] **Step 3: Implement the minimal change**

In `scripts/preflight.sh`, replace the header comment block (lines 2–6):

```bash
# Local pre-push / pre-PR gate. Two modes:
#   scripts/preflight.sh --fast   → fast subset (WIP pushes): tsc + changed-file
#                                   type-aware lint + cheap pattern checks + related tests.
#   scripts/preflight.sh          → full CI parity (PR-branch pushes + before gh pr create);
#                                   writes a HEAD-keyed pass-stamp on success.
```

with:

```bash
# Local pre-push / pre-PR gate. Two modes, plus a scope modifier:
#   scripts/preflight.sh --fast   → fast subset (WIP pushes): tsc + changed-file
#                                   type-aware lint + cheap pattern checks + related tests.
#   scripts/preflight.sh          → full CI parity (PR-branch pushes + before gh pr create);
#                                   writes a HEAD-keyed pass-stamp on success.
#   --fast --uncommitted         → scope --fast's changed-file set off the working tree
#                                   vs HEAD instead of committed BASE..HEAD — for
#                                   mid-pipeline verification BEFORE a commit exists yet
#                                   (see .claude/agents/todo-executor.md Step 5a). Writes
#                                   no pass-stamp in this mode: HEAD hasn't received the
#                                   implementation yet, so stamping it would certify the
#                                   wrong commit.
```

Replace the mode-parsing lines (originally lines 15–16):

```bash
MODE="full"
[ "${1:-}" = "--fast" ] && MODE="fast"
```

with:

```bash
MODE="full"
UNCOMMITTED=0
for arg in "$@"; do
  case "$arg" in
    --fast) MODE="fast" ;;
    --uncommitted) UNCOMMITTED=1 ;;
  esac
done
```

Replace the changed-file computation (originally lines 38–44):

```bash
if [ "$MODE" = "fast" ]; then
  # Files this branch changed vs main (committed range — push gate semantics).
  # NOTE: no `mapfile` — macOS default bash is 3.2, which lacks it. Use a read loop.
  BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD)
  CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done \
    < <(git diff --name-only --diff-filter=ACMR "$BASE" HEAD -- '*.ts' '*.tsx' 2>/dev/null)
```

with:

```bash
if [ "$MODE" = "fast" ]; then
  # Files this branch changed. Two scopes:
  #   default:       vs main (committed range — push gate semantics).
  #   --uncommitted: working tree vs HEAD (mid-pipeline verification BEFORE a commit
  #                  exists — e.g. todo-executor.md Step 5a, which runs before Step 8
  #                  commits the implementation). Comparing against origin/main here
  #                  would see zero changes and silently no-op instead of checking
  #                  anything.
  # NOTE: no `mapfile` — macOS default bash is 3.2, which lacks it. Use a read loop.
  if [ "$UNCOMMITTED" -eq 1 ]; then
    DIFF_BASE_ARGS=(HEAD)
  else
    BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD)
    DIFF_BASE_ARGS=("$BASE" HEAD)
  fi
  CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done \
    < <(git diff --name-only --diff-filter=ACMR "${DIFF_BASE_ARGS[@]}" -- '*.ts' '*.tsx' 2>/dev/null)
```

Replace the `HOOK_CHANGED` computation's diff line (originally part of the same block, immediately below):

```bash
  HOOK_CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && HOOK_CHANGED+=("$f"); done \
    < <(git diff --name-only --diff-filter=ACDMRT "$BASE" HEAD -- '.claude/hooks/' '.husky/' 'scripts/*.sh' 2>/dev/null)
```

with:

```bash
  HOOK_CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && HOOK_CHANGED+=("$f"); done \
    < <(git diff --name-only --diff-filter=ACDMRT "${DIFF_BASE_ARGS[@]}" -- '.claude/hooks/' '.husky/' 'scripts/*.sh' 2>/dev/null)
```

Replace the stamp-write block (originally lines 105–108):

```bash
  if [ "$tests_skipped" -eq 0 ]; then
    git rev-parse HEAD > "$STAMP_FILE" 2>/dev/null || true
    echo "✔ pass-stamp written for $(git rev-parse --short HEAD 2>/dev/null)"
  fi
```

with:

```bash
  if [ "$tests_skipped" -eq 0 ] && [ "$UNCOMMITTED" -eq 0 ]; then
    git rev-parse HEAD > "$STAMP_FILE" 2>/dev/null || true
    echo "✔ pass-stamp written for $(git rev-parse --short HEAD 2>/dev/null)"
  elif [ "$tests_skipped" -eq 0 ]; then
    echo "✔ scoped check passed (--uncommitted mode — no pass-stamp; HEAD hasn't received these changes yet)"
  fi
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash .claude/hooks/test-preflight-uncommitted-scope.sh`

Expected: `Results: 3 passed, 0 failed`.

- [ ] **Step 5: Run the full existing hook self-test suite to confirm no regression**

Run: `bash scripts/run-hook-tests.sh`

Expected: every existing `test-*.sh` still passes, including `test-preflight-fast-stamp.sh` (its assertions never pass `--uncommitted`, so `UNCOMMITTED` stays `0` and behavior is byte-for-byte unchanged for them) and the new `test-preflight-uncommitted-scope.sh`.

- [ ] **Step 6: Commit**

```bash
git add scripts/preflight.sh .claude/hooks/test-preflight-uncommitted-scope.sh
git commit -m "$(cat <<'EOF'
feat(preflight): add --uncommitted scope mode for mid-pipeline verification

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `todo-executor.md` — scoped + overlapped verification (Step 5 rewrite)

**Files:**

- Modify: `.claude/agents/todo-executor.md` (Step 5, Step 6 item 3, Step 7 items 5–6)

**Interfaces:**

- Consumes: `scripts/preflight.sh --fast --uncommitted` (Task 1).
- Produces: the fixed Step 5/6/7 sequence that Task 4's `todo-fast/SKILL.md` Phase 6 references directly by name ("follow `todo-executor.md` Steps 5 and 6 exactly").

This task has no code to test — `todo-executor.md` is Markdown instructions consumed by an LLM agent, not executable. Its verification step (Step 2 below) is an explicit consistency read-through, not a test run.

- [ ] **Step 1: Replace Step 5**

In `.claude/agents/todo-executor.md`, find this exact block (the entire current Step 5 section, between the `---` before it and the `---` after it):

````markdown
## Step 5 — Verify

Run all three verification commands **synchronously, in the foreground** — never with `run_in_background: true`:

```bash
npm run test:run
npm run check:types
npm run lint
```
````

**Never background these and wait.** Unlike the orchestrator (which gets an automatic notification when a dispatched _agent_ finishes), you get no equivalent notification when your _own_ backgrounded shell command finishes — nothing re-invokes you. If you background a verification command and then stop to "wait for it," you strand yourself: the harness sees no live background children and reports you as complete with no final result, while your real implementation sits uncommitted until the orchestrator notices and explicitly resumes you. Always block on the command and read its real output before proceeding.

All three must pass with zero errors. If any fail:

- Read the error output carefully.
- Fix the issue in the implementation.
- Re-run the failing command to confirm the fix.
- Repeat until all three pass.

After all commands pass, re-read every modified file and confirm the changes match each acceptance criterion. If a criterion is not met, go back to Step 4.

````

Replace it with:

```markdown
## Step 5 — Verify

Two passes: a scoped fast check after implementation and after every fix round (Step 5a), and the full CI-parity suite issued once per review round, overlapped with Step 6's reviewer dispatch rather than run serially before it (Step 5b).

### Step 5a — Scoped fast check

```bash
scripts/preflight.sh --fast --uncommitted
````

This scopes lint and tests to files you've actually changed — working tree vs. `HEAD`, not `origin/main`, since your implementation isn't committed yet at this point (commit happens later, in Step 8). Whole-program `tsc` still runs in full; it can't be scoped. Must pass before proceeding to Step 5b.

If it fails: read the error output, fix the issue, re-run until it passes.

### Step 5b — Full suite, overlapped with review

Once Step 5a passes, move to Step 6. In the SAME turn you dispatch Step 6's reviewer agents, ALSO issue these three commands as ordinary synchronous Bash tool calls — not backgrounded:

```bash
npm run test:run
npm run check:types
npm run lint
```

This is plain multiple-tool-calls-in-one-turn parallelism, the same pattern Step 6 already uses to dispatch several reviewer agents together in one message. **Do not add `run_in_background: true` to these** — that would strand you: unlike the orchestrator (which gets an automatic notification when a dispatched _agent_ finishes), you get no equivalent notification when your _own_ backgrounded shell command finishes — nothing re-invokes you. Issuing them as normal foreground calls alongside the reviewer `Agent()` calls in the same turn gets the same overlap without that risk: the turn simply completes once every call in it — agents and Bash alike — has returned.

All three must pass with zero errors, same as Step 6's reviewers must return before you proceed to Step 7. If any of the three fail, treat it exactly like an unresolved CRITICAL review finding in Step 7: fix it, return to Step 5a to confirm, then repeat Step 5b if a second round is needed (same 2-round cap Step 7 already enforces).

After both the full suite passes and Step 7's feedback is addressed, re-read every modified file and confirm the changes match each acceptance criterion. If a criterion is not met, go back to Step 4.

````

- [ ] **Step 2: Update Step 6 item 3 with a cross-reference to Step 5b**

Find this exact sentence within Step 6's numbered list (item 3):

```markdown
3. **Dispatch the selected reviewers in parallel** (one Agent call each, in a single message), using the dispatch prompt **from `docs/AI_WORKFLOW.md` → Review Policy — read it from that file; it is not restated here** (a previous inline copy drifted). Substitute the agent, its domain lens, the literal `$WORKTREE` path, `$BRANCH`/`$HEAD_SHORT`, the changed-file list, and `todo: <todo title>` as the context label. Each reviewer **must use `git -C "$WORKTREE"`** (its ambient cwd is the main checkout) — otherwise it reviews an empty diff and falsely returns "No findings". Do not use `cd` (a leading `cd` can trigger a permission prompt that stalls an autonomous run).
````

Replace it with:

```markdown
3. **Dispatch the selected reviewers in parallel** (one Agent call each, in a single message), using the dispatch prompt **from `docs/AI_WORKFLOW.md` → Review Policy — read it from that file; it is not restated here** (a previous inline copy drifted). Substitute the agent, its domain lens, the literal `$WORKTREE` path, `$BRANCH`/`$HEAD_SHORT`, the changed-file list, and `todo: <todo title>` as the context label. Each reviewer **must use `git -C "$WORKTREE"`** (its ambient cwd is the main checkout) — otherwise it reviews an empty diff and falsely returns "No findings". Do not use `cd` (a leading `cd` can trigger a permission prompt that stalls an autonomous run). **In this same message, also issue Step 5b's full-suite commands** (`npm run test:run`, `npm run check:types`, `npm run lint`) as parallel Bash tool calls alongside these Agent calls — see Step 5b for why.
```

- [ ] **Step 3: Update Step 7 items 5–6**

Find this exact pair of list items within Step 7:

```markdown
5. After fixing, re-run Step 5 (verify) to ensure fixes did not break anything.
6. If fixes were non-trivial, run Step 6 again (second review round).
```

Replace with:

```markdown
5. After fixing, re-run Step 5a (scoped fast check) to confirm the fix didn't break anything.
6. If fixes were non-trivial, run Step 6 again (second review round) — overlapped with a second Step 5b (full suite) pass, per Step 5b.
```

- [ ] **Step 4: Consistency read-through (this task's "test")**

Read the modified `.claude/agents/todo-executor.md` Steps 5, 6, and 7 top to bottom as a single agent following them would. Confirm, in order:

1. Step 5a's command (`scripts/preflight.sh --fast --uncommitted`) matches Task 1's actual flag name exactly.
2. Step 5b's instruction to issue full-suite commands "in the same turn you dispatch Step 6's reviewer agents" is consistent with Step 6 item 3's added cross-reference sentence — they describe the same single event from each step's own vantage point, not two different events.
3. Step 7 items 5–6 reference "Step 5a" and "Step 5b" by the same names Step 5 itself now uses — no stale reference to a single undifferentiated "Step 5".
4. Nothing else in the file (Step 0's workspace assertion, Step 8's commit sequence, Step 10's push/PR sequence, the Step 11 report format, the `REASON_CODE` enum) mentions "Step 5" in a way this rewrite invalidates — grep to confirm:

```bash
grep -n "Step 5" .claude/agents/todo-executor.md
```

Expected: every match is either inside the new Step 5 section itself, or one of the two cross-references just added (Step 6 item 3, Step 7 item 5) — no orphaned reference elsewhere in the file.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/todo-executor.md
git commit -m "$(cat <<'EOF'
perf(todo): scope interim verification and overlap full suite with review

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `todo-fast-implementer` agent

**Files:**

- Create: `.claude/agents/todo-fast-implementer.md`

**Interfaces:**

- Consumes: nothing from other tasks — this agent's prompt (worktree path, assigned Acceptance Criteria, assigned files, research brief) is supplied entirely by Task 4's dispatch code at runtime, not by anything fixed at authoring time.
- Produces: the `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED` report format Task 4's Phase 5 dispatch logic parses.

No code to test — this is a new agent definition, Markdown instructions. Its verification is a consistency read-through against `todo-executor.md` Step 0 (Step 1 below) and `subagent-driven-development`'s status protocol (Step 2 below).

- [ ] **Step 1: Write the agent file**

Create `.claude/agents/todo-fast-implementer.md`:

````markdown
---
name: todo-fast-implementer
description: Implements one assigned slice of a single todo (or the whole todo, when not decomposed) inside a shared worktree that /todo-fast already created — implementation only, never verification, commit, or PR.
---

# Todo-Fast Implementer Agent

You implement ONE assigned slice of a todo's Acceptance Criteria, inside a git worktree that already exists — created by the `/todo-fast` orchestrator before you were dispatched, and possibly shared concurrently with other implementer agents working on other, disjoint files of the SAME todo. You do not verify, commit, push, or create a PR — the orchestrator does all of that once, after every dispatched implementer (yourself included) has reported back.

## Step 0 — Workspace Assertion (mandatory, do this FIRST)

Your prompt gives you an absolute worktree path. Your very first action, before reading or editing anything, is:

```bash
cd "<the worktree path from your prompt>"
pwd
git rev-parse --show-toplevel
```
````

- If `pwd` does not exactly match the path you were given, report `BLOCKED` with reason `"could not enter the assigned worktree — pwd is <pwd>"` and stop. Do not edit anything.
- This explicit `cd` is not optional. It is what lets `.claude/hooks/guard-worktree-isolation.sh` — the PreToolUse hook that blocks an Edit/Write whose absolute path escapes a worktree into the main checkout — actually protect you. That hook keys its enforcement off your session's tracked cwd; a bare `git -C <path>` never changes that, only an actual `cd` does. Skipping this step leaves you with no structural protection against an absolute-path mistake landing in the user's live main checkout.

## Step 1 — Read Your Assignment

Your prompt specifies:

- **Todo file** — read it for full context (title, Summary, Risks), even though you only implement your assigned slice.
- **Your assigned Acceptance Criteria items** — the specific checkboxes you must satisfy. Ignore any other checkbox in the todo; another implementer (or nobody, if undecomposed) owns it.
- **Your assigned files** — the ONLY files you may Edit or Write. If satisfying your assigned criteria seems to require touching a file outside this list, stop and report `NEEDS_CONTEXT` with reason `"assigned criteria appear to require <file>, which is outside my assigned file list"` — do not silently expand your own scope. The whole safety guarantee behind running concurrently in a shared worktree with other implementers depends on every implementer staying inside its assigned files.
- **Research brief** — library notes, project context, and global patterns gathered before you were dispatched (or a verified-solution citation, if the todo short-circuited). Use it as guidance, same as `todo-executor.md` Step 4 uses its own research brief.

## Step 2 — Implement

1. Use your assigned Acceptance Criteria items as the definition of done for your slice. Every one of your assigned checkboxes must be satisfied.
2. Use the todo's Implementation Notes for approach guidance where they apply to your slice, but your assigned Acceptance Criteria take precedence if they conflict.
3. Apply any patterns surfaced in your research brief. Follow existing project conventions — do not invent new ones.
4. Keep changes minimal and confined to your assigned files. Do not refactor adjacent code, add features, or touch anything outside your assignment — another concurrent implementer may be editing neighboring code at this exact moment, and your only safety margin is that your file sets never overlap.
5. Track every file you actually modify — you report this list in Step 4.

## Step 3 — Self-Check

Re-read your assigned files' diffs. Confirm every one of your assigned Acceptance Criteria items is satisfied. If one is not met, return to Step 2 for that item specifically.

## Step 4 — Report

Return exactly one of:

```
STATUS: DONE
FILES_CHANGED: <list of files you modified — must be a subset of your assigned file list>
NOTES: <one line, or "none">
```

```
STATUS: DONE_WITH_CONCERNS
FILES_CHANGED: <list>
CONCERNS: <what you're unsure about — e.g. an assumption you made, a pattern you weren't fully certain applied>
```

```
STATUS: NEEDS_CONTEXT
NEEDED: <exactly what information you're missing to proceed>
```

```
STATUS: BLOCKED
REASON: <why you cannot complete your assigned criteria>
```

Never run `npm run test:run`, `check:types`, `lint`, `git commit`, `git push`, or any PR-creation command — none of that is your job. The orchestrator verifies, reviews, commits, and ships the combined result of every implementer's work together, once, after you report.

````

- [ ] **Step 2: Consistency read-through (this task's "test")**

Confirm, reading the new file against its two references:

1. Step 0's workspace assertion pattern (`pwd`, `git rev-parse --show-toplevel`, `blocked` on mismatch) matches `todo-executor.md` Step 0's own assertion pattern in structure, adapted for a worktree path supplied in the prompt rather than one the agent was auto-dispatched into.
2. Step 4's four report statuses (`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`) exactly match the four statuses `subagent-driven-development`'s `SKILL.md` "Handling Implementer Status" section defines — same names, same casing, no fifth invented status and none renamed.

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/todo-fast-implementer.md
git commit -m "$(cat <<'EOF'
feat(todo-fast): add todo-fast-implementer agent

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
````

---

### Task 4: `todo-fast` orchestrator skill

**Files:**

- Create: `.claude/skills/todo-fast/SKILL.md`

**Interfaces:**

- Consumes: `todo-executor.md` Steps 1, 2, 3, 3.5, 5, 6, 7, 8, 10, 11 (Tasks 1–2, by reference — not copied); `todo-fast-implementer` (Task 3, dispatched by name); `.claude/skills/codify/SKILL.md` and `.claude/skills/land/SKILL.md` (invoked by name, unmodified); the `Plan` and `advisor` tools (used, not modified).
- Produces: the `/todo-fast <path>` entry point itself — nothing downstream in this plan depends on its internals, but its report format (Step 11-equivalent) reuses `todo-executor.md`'s `REASON_CODE` enum verbatim, so anything that later parses `/todo-fast` output can reuse existing `/todo` parsing logic unchanged.

No code to test — this is a new orchestrator skill, Markdown instructions. Its "test cycle" is the consistency read-through in Step 4 below, and the full end-to-end dry run in Task 5.

- [ ] **Step 1: Write the skill frontmatter and Phase 0–1**

Create `.claude/skills/todo-fast/SKILL.md` with this content (more phases appended in the next two steps — write this much first):

````markdown
---
name: todo-fast
description: Use to accelerate a single medium/high/critical todo — decomposes it into parallel-safe sub-tasks via the Plan agent where possible, dispatches concurrent todo-fast-implementer agents in one shared worktree, and rides todo-executor.md's (now-fixed) research/verify/review/commit/codify/PR pipeline for everything else.
---

You are running the todo-fast orchestrator for a single todo. Unlike `/todo`, this skill never scans the backlog — it operates on exactly the todo file you were given. **Never skip phases.**

## Phase 0 — Preflight

1. **Parse the todo.** Read the todo file at the given path. Extract YAML frontmatter (`title`, `status`, `priority`, `created`, `labels`, `github_issue`) and body sections (Acceptance Criteria, Implementation Notes, Dependencies, Risks) — same extraction as `todo-executor.md` Step 1.

2. **Scope guard.** If `priority` is `low`, stop and report: "This todo is priority `low` — it already fast-tracks through `/todo`'s auto-merge guard path. Use `/todo` instead; `/todo-fast`'s extra machinery (decomposition, shared worktree, `/land` handoff) doesn't pay for itself here." Do not proceed.

3. **Status gate.** If `status` is not `backlog` or `planned`, report `skipped` with reason `"status is <actual status>, expected backlog or planned"` and stop — same as `todo-executor.md` Step 2.1.

4. **Dependency check.** If the Dependencies section lists other todo files that still exist under `todos/` (not archived), report `blocked` with the list and stop — same as `todo-executor.md` Step 2.2.

5. **Legacy delegation gate.** If the todo has a `github_issue` frontmatter value, report `skipped` with reason `legacy github_issue todo: <url> — needs manual triage` — same as `todo-executor.md` Step 2.3.

6. **Remote-branch probe.** Run `git ls-remote --heads origin todo/<todo-slug>` (slug = filename minus `.md`). If it returns any output, run the same five-outcome collision triage `todo-executor.md` Step 2.4 / Step 10 defines (`OPEN_PR_COLLISION`, `STALE_BRANCH_MERGED`, `PR_CLOSED_UNMERGED`, `ORPHAN_BRANCH`, `PR_CHECK_FAILED`) and stop before doing any work if it fires.

7. **Capture the base branch and main checkout**, same as `/todo`'s own Phase 1 step 3: `git branch --show-current` (or `git rev-parse --abbrev-ref HEAD` if empty; stop if that also returns `HEAD` — detached HEAD is not supported) → `BASE_BRANCH`. `git rev-parse --path-format=absolute --git-common-dir` → derive `MAIN_CHECKOUT` as its parent directory.

## Phase 1 — Shared Worktree Creation

Create ONE worktree for the entire run — every subsequent agent (research, `Plan`, implementer(s), reviewers) operates inside it:

```bash
SLUG="<todo filename minus .md>"
git worktree add ".claude/worktrees/agent-todo-fast-$SLUG" -b "todo/$SLUG" "$BASE_BRANCH"
WORKTREE="$(cd ".claude/worktrees/agent-todo-fast-$SLUG" && pwd)"
```
````

Record `$WORKTREE` (absolute path) — every dispatch prompt below substitutes it in literally, never the placeholder text.

**Dispatch contract, by agent type** — this determines whether an agent needs to `cd` or can use `git -C`:

- **Read-only agents** (`Plan` in Phase 3, `todo-researcher` in Phase 2, reviewers in Phase 6): no `cd`. They only run read/diff commands — use `git -C "$WORKTREE"` for any git operation. No Edit/Write access, so `.claude/hooks/guard-worktree-isolation.sh` (the PreToolUse hook that blocks an edit escaping a worktree into the main checkout) never applies to them regardless.
- **`todo-fast-implementer` agents (Phase 5):** the prompt's first instruction must be an explicit `cd "$WORKTREE"`, then `pwd` and `git rev-parse --show-toplevel` to confirm — mirroring `todo-executor.md` Step 0. This is required, not optional: a dispatched subagent does not inherit the parent session's cwd, and `git -C` never changes a session's _tracked_ cwd — but `guard-worktree-isolation.sh` keys its protection off exactly that tracked cwd (its `.cwd` field, matched against `*/.claude/worktrees/agent-*`). Skip the `cd` and the implementer loses the same structural protection `todo-executor` gets for free via `isolation: "worktree"`.

Naming the worktree under `.claude/worktrees/agent-*` is deliberate — it matches `/todo`'s own Phase 0/5 cleanup sweep glob, so a crashed `/todo-fast` run is also swept by the next `/todo` invocation as a backstop, on top of this skill's own cleanup (see the Cleanup section near the end of this file).

````

- [ ] **Step 2: Append Phase 2–5**

Append this content to the end of `.claude/skills/todo-fast/SKILL.md`:

```markdown
## Phase 2 — Research

Follow `todo-executor.md` Step 3 exactly (verified-solution read-back in `docs/solutions/`, the short-circuit gate, or a `todo-researcher` dispatch on a miss) — unchanged, reused verbatim. Every git command in this phase uses `git -C "$WORKTREE"`.

## Phase 3 — Decomposition

**Cheap pre-check.** Extract file references from the todo's Implementation Notes and Acceptance Criteria — the same three patterns `.claude/skills/todo/SKILL.md`'s Phase 3 already uses: bare paths (`path/to/file.ts`), paths with line ranges (`path/to/file.ts:123-145`), backtick-quoted paths. If fewer than 2 distinct files are mentioned, skip straight to Phase 5 with exactly one `todo-fast-implementer` covering the whole todo — there is nothing to decompose.

**Otherwise, dispatch `Plan`**, giving it the shared worktree path so it inspects the actual files rather than judging disjointness from the todo's prose alone:

````

Agent({
description: "Decompose todo into parallel-safe sub-tasks",
subagent_type: "Plan",
model: "sonnet",
prompt: "Todo: <full todo body>.\n\nWorktree to inspect (read-only — use `git -C <$WORKTREE>` or Read tool calls against this path; do not edit anything): <$WORKTREE>\n\nPropose a split of the Acceptance Criteria into sub-tasks where each sub-task's affected files are COMPLETELY DISJOINT from every other sub-task's. Before proposing, actually read each candidate file in the worktree and check for shared imports, shared barrel-file re-exports, or shared type definitions between candidate sub-tasks — do not rely on the todo's prose description alone. If no safe disjoint split exists, say so explicitly and explain why (cite the specific shared import/file you found). For each sub-task you propose, list: (1) the exact Acceptance Criteria items it covers, (2) the exact file paths it will touch. Cap at 4 sub-tasks."
})

```

Read the response:

- **No safe split reported, or the `Agent()` call errors:** fall back to exactly one `todo-fast-implementer` for the whole todo (same as the pre-check miss above). This is expected to be the common outcome — tightly-coupled component+utils+test clusters are a normal todo shape, not an edge case.
- **A split is proposed:** carry it forward as `decomposition_plan` (list of {criteria, files} per sub-task) for Phase 4's advisor gate and Phase 5's dispatch.

## Phase 4 — Advisor Pre-check

Follow `todo-executor.md` Step 3.5's mechanism exactly (call `advisor()` with no parameters — your transcript, including the todo, the research brief, and `decomposition_plan` if one exists, forwards automatically). Write the SAME framing note Step 3.5 specifies, with one addition appended to its questions:

> Is the proposed decomposition safe? Could any two sub-tasks' file sets actually overlap (a shared import, a barrel file, a type the split missed)? Is anything grouped together that should be split, or split that should be grouped?

(Omit this addition if Phase 3 found no split — there's nothing to gate.)

Same verdict handling as `todo-executor.md` Step 3.5: `GREEN` → proceed silently; `YELLOW: <reason>` → proceed, record the reason in `DEFERRED_WARNINGS`; `RED: <reason>` → do not implement, report `blocked: advisor red-flag: <reason>` (Step 11's block-path format), todo stays at `backlog`. If the advisor flags the decomposition specifically (not the overall approach), discard `decomposition_plan` and fall back to one `todo-fast-implementer` for the whole todo rather than force the split. Same unparseable-response and advisor-unavailable fallbacks as Step 3.5 (`YELLOW: advisor returned prose without a verdict line`; `ADVISOR: skipped` if the tool errors).

## Phase 5 — Parallel Implementation

Dispatch one `todo-fast-implementer` per entry in `decomposition_plan` (or exactly one, covering the whole todo, if Phase 3/4 found no safe split) — up to 4, all in the SAME message so they run concurrently:

```

Agent({
description: "Implement sub-task: <sub-task summary>",
subagent_type: "general-purpose",
model: "sonnet",
prompt: "You are a todo-fast-implementer agent. Follow .claude/agents/todo-fast-implementer.md exactly.\n\nShared worktree (absolute path — cd here FIRST, before anything else): <$WORKTREE>\nTodo file: todos/<filename>.md\nYour assigned Acceptance Criteria items: <list>\nYour assigned files (touch ONLY these): <list>\nResearch brief: <Phase 2's brief or short-circuit citation>\n\nImplement your assigned scope and report your status."
})

```

If only one implementer is dispatched (no decomposition), its "assigned Acceptance Criteria items" is the todo's full Acceptance Criteria list and its "assigned files" is every file the todo's Implementation Notes/Acceptance Criteria mention (or "no specific files named — use your judgment from the todo body" if none were extracted).

**Handling reports:**
- **`DONE` / `DONE_WITH_CONCERNS`:** record the concern (if any) for the Step 11 report; proceed once every dispatched implementer has reported one of these two, or handled per below.
- **`NEEDS_CONTEXT`:** provide the missing context and re-dispatch that ONE implementer (same prompt, plus the added context). Other concurrent implementers are unaffected — they're on disjoint files.
- **`BLOCKED`:** re-dispatch that ONE implementer once (same two-attempt cap `todo-executor.md`'s Failure Path uses). If still `BLOCKED`, the **whole todo** fails: revert every implementer's changes (`git -C "$WORKTREE" checkout -- .`), report `failed` (Step 11's failure format), and skip the rest of this run. A todo with unmet Acceptance Criteria is never archived, regardless of how many other sub-tasks independently succeeded.

**DB-serial todos:** if the todo touches `shared/schema.ts`, `migrations/`, `drizzle`, or `db:push`, Phase 3's `Plan` dispatch prompt must additionally instruct: "bucket every DB-touching Acceptance Criterion into ONE non-parallel sub-task — it cannot run concurrently with anything else." That sub-task's implementer prompt gets the same `db-serial-lock.sh` block `.claude/skills/todo/SKILL.md`'s Phase 4 "DB-serial todos only" section already specifies (resolve `WATCH_PID`, `db-serial-lock.sh acquire --watch-pid`, retry-once-on-exit-2 semantics, release on completion) — copy that block verbatim into the prompt, substituting the worktree path.
```

- [ ] **Step 3: Append Phase 6–11, Cleanup, and Rules**

Append this content to the end of `.claude/skills/todo-fast/SKILL.md`:

```markdown
## Phase 6 — Verify + Review

Follow `todo-executor.md` Steps 5 (as fixed in Task 2 — scoped-fast check via `scripts/preflight.sh --fast --uncommitted`, then the full CI-parity suite issued in the same turn as Step 6's reviewer dispatch) and 6 (reviewer selection/dispatch) exactly, unchanged from what those steps now specify. Every git command uses `git -C "$WORKTREE"`; every Bash command that isn't a git command (e.g. `npm run test:run`) runs with its cwd set to `$WORKTREE` (prefix with `(cd "$WORKTREE" && ...)` rather than a bare `cd` in your own session, so your own tracked cwd — which `guard-worktree-isolation.sh` checks — never drifts away from wherever Phase 0 started you).

## Phase 7 — Address Feedback

Follow `todo-executor.md` Step 7 exactly — same CRITICAL/WARNING/SUGGESTION tiering, same `DEFERRED_WARNINGS` field, same 2-round cap.

## Phase 8 — Commit & Archive

Follow `todo-executor.md` Step 8 exactly — mark `done`, move to `todos/archive/`, stage both paths, commit with the same label→type mapping.

## Phase 9 — Codify

Invoke the `/codify` skill directly (via the Skill tool) rather than following `todo-executor.md` Step 9's inline routing logic — `/codify`'s `SKILL.md` is the canonical routing rubric Step 9 already points at; this phase calls it directly instead of re-deriving its steps.

## Phase 10 — Push & PR

Follow `todo-executor.md` Step 10 exactly (branch naming, non-fast-forward collision triage, PR body template, Copilot review request, `todo-automerge-guard.sh` eligibility check).

**One addition, after the guard eligibility check resolves:**

- `MERGE_ELIGIBLE: yes (auto-merge enabled)` → nothing further, exactly as today.
- Any other outcome (`held`, `review-required`, `unknown`) → invoke the **`/land`** skill before Phase 11. `/land` assesses merge-readiness and handles branch cleanup — it does not change who decides to merge: `merge-approval-guard.sh` already blocks any agent-executed `gh pr merge` regardless of which skill leads there, so `/land`'s role here is strictly to present the readiness assessment and options.

## Phase 11 — Report

Same structured report as `todo-executor.md` Step 11 (`STATUS`, `COMMIT`, `BRANCH`, `PR_URL`, `MERGE_ELIGIBLE`, `CODIFICATION_COMMIT`, `SOLUTION_FILE`, `FILES_CHANGED`, `SHORT_CIRCUIT`, `REVIEW_ROUNDS`, `ADVISOR`, `DEFERRED_WARNINGS`), same `REASON_CODE` enum. Add two fields:
```

SUB_TASKS: <N — 1 if no decomposition, 2-4 if Plan proposed a split>
LAND_INVOKED: <yes | no (auto-merge enabled, not needed) | n/a (no PR)>

````

## Cleanup

Force-remove the shared worktree at the end of the run, success or failure:

```bash
git worktree unlock ".claude/worktrees/agent-todo-fast-$SLUG" 2>/dev/null
git worktree remove --force ".claude/worktrees/agent-todo-fast-$SLUG" 2>/dev/null
git worktree prune
````

(Its `agent-*` naming means a crashed run that skips this step is also swept by the next `/todo` invocation's Phase 0 cleanup sweep, as a backstop.)

## Rules

- **Max 4 parallel `todo-fast-implementer` agents** — same ceiling `/todo` uses for parallel batches.
- **One shared worktree for the whole run** — never a fresh one per implementer; that's what makes a single combined commit possible without a merge step.
- **Explicit `cd`, not `git -C`, for implementer agents** — the structural safety guarantee of running concurrently in a shared worktree depends on it (Phase 1).
- **Decomposition failure is the expected common case, not an error** — always have a working single-implementer fallback path.
- **Never duplicate `todo-executor.md`'s verify/review/commit/codify/PR logic** — reference it, per Phases 6–10 above.
- **A todo with any `BLOCKED` sub-task after retry reverts entirely** — no partial-credit half-merges.

````

- [ ] **Step 4: Consistency read-through (this task's "test")**

Read the complete `.claude/skills/todo-fast/SKILL.md` top to bottom and confirm:

1. Every phase number referenced anywhere in the file (e.g. Phase 4's "Phase 3's `Plan` dispatch prompt", Phase 5's references to Phase 3/4) actually exists and matches what that phase covers.
2. Every `todo-executor.md` step cited by number (Steps 1, 2, 3, 3.5, 5, 6, 7, 8, 10, 11) matches the CURRENT step numbering in `.claude/agents/todo-executor.md` after Task 2's edits — re-open that file and confirm no drift:

```bash
grep -n "^## Step" .claude/agents/todo-executor.md
````

3. The `Agent()` dispatch blocks (Phase 3's `Plan` call, Phase 5's `todo-fast-implementer` call) use the exact agent names `Plan` and `general-purpose` (the latter because `todo-fast-implementer` is a new custom agent type the Agent tool resolves by the instructions given in its prompt, following the same convention `.claude/skills/todo/SKILL.md`'s own executor dispatch already uses for `todo-executor`).
4. Phase 1's `.cwd`-based dispatch contract for implementers matches Task 3's `todo-fast-implementer.md` Step 0 exactly — same mechanism described from both sides (the orchestrator's dispatch contract and the implementer's own workspace assertion).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/todo-fast/SKILL.md
git commit -m "$(cat <<'EOF'
feat(todo-fast): add accelerated single-todo orchestrator skill

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: End-to-end validation

**Files:**

- No permanent files — this task creates and discards temporary todo files under `todos/` to exercise the pipeline, and does not modify any file created in Tasks 1–4.

**Interfaces:**

- Consumes: everything from Tasks 1–4, exercised together for the first time.
- Produces: a go/no-go signal for the whole feature. Do not consider this plan complete until both dry runs below behave as expected.

This is the integration test the spec's Validation Plan section calls for. `/todo-fast` orchestrates multiple agents and a shared worktree — the only way to validate that end-to-end is to actually run it, twice, against two todos shaped to exercise the two different code paths (decomposable vs. not).

- [ ] **Step 1: Create a genuinely decomposable temporary todo**

Create `todos/P3-temp-validation-decomposable.md` (temporary — deleted in Step 3, never committed):

```markdown
---
title: "Validation: decomposable temp todo (delete after /todo-fast dry run)"
status: backlog
priority: medium
created: 2026-07-15
labels: [testing]
---

# Validation: decomposable temp todo

## Summary

Temporary todo to validate /todo-fast's decomposition path. Not a real product change — delete this file after the dry run in Task 5 of docs/superpowers/plans/2026-07-15-todo-fast-skill.md.

## Acceptance Criteria

- [ ] Add a one-line comment `// validation-a` to the top of `client/constants/theme.ts`
- [ ] Add a one-line comment `// validation-b` to the top of `server/routes/index.ts`

## Implementation Notes

These two files share no imports and are in unrelated subsystems (client theming vs. server route registration) — a correct decomposition splits this into two sub-tasks, one per file.
```

Run: `/todo-fast todos/P3-temp-validation-decomposable.md`

Expected:

- Phase 3's pre-check finds 2 distinct files and dispatches `Plan`.
- `Plan` proposes a 2-way split (one sub-task per file — they share no imports).
- Phase 4's advisor call returns `GREEN` (or `YELLOW` with an unrelated reason) — not `RED` on the decomposition itself, since the split genuinely is safe.
- Phase 5 dispatches 2 `todo-fast-implementer` agents concurrently in the same worktree; both report `DONE`.
- Phase 6 runs the scoped-fast check, then the full suite overlapped with review; both pass (a two-comment change should not break anything).
- The run reaches Phase 11 with `SUB_TASKS: 2`.

If `Plan` does NOT propose a split for this deliberately-disjoint example, that is a finding against Task 4's Phase 3 prompt wording — revisit it before continuing.

- [ ] **Step 2: Create a non-decomposable temporary todo**

Create `todos/P3-temp-validation-nondecomposable.md` (temporary — deleted in Step 3, never committed):

```markdown
---
title: "Validation: non-decomposable temp todo (delete after /todo-fast dry run)"
status: backlog
priority: medium
created: 2026-07-15
labels: [testing]
---

# Validation: non-decomposable temp todo

## Summary

Temporary todo to validate /todo-fast's single-implementer fallback path. Not a real product change — delete this file after the dry run in Task 5 of docs/superpowers/plans/2026-07-15-todo-fast-skill.md.

## Acceptance Criteria

- [ ] Add a one-line comment `// validation-c` to the top of `client/constants/theme.ts`
- [ ] Add a corresponding one-line comment `// validation-c-note` immediately below it, referencing the same change

## Implementation Notes

Both Acceptance Criteria items touch the SAME file (`client/constants/theme.ts`) — this cannot safely decompose into disjoint sub-tasks. Confirms the single-implementer fallback path.
```

Run: `/todo-fast todos/P3-temp-validation-nondecomposable.md`

Expected:

- Phase 3's pre-check finds only 1 distinct file and skips `Plan` entirely (no decomposition round-trip spent on an obviously-non-splittable case).
- Phase 5 dispatches exactly 1 `todo-fast-implementer` covering the whole todo; it reports `DONE`.
- The run reaches Phase 11 with `SUB_TASKS: 1`.

- [ ] **Step 3: Confirm the isolation guard fires as expected, then clean up**

As a one-off manual check (not a permanent test), confirm `.claude/hooks/guard-worktree-isolation.sh` actually denies an out-of-scope edit: in either dry run's worktree, while it's still checked out, attempt (via a throwaway Bash call from your own session, not from a dispatched agent) an `Edit` tool call targeting an absolute path under the MAIN checkout (not the worktree) — confirm the hook denies it with the expected reason text. This is the structural safety guarantee the whole shared-worktree model depends on (Task 3 Step 0, Task 4 Phase 1's dispatch contract) — confirm it once, live, rather than trusting the read-throughs alone.

Then delete both temporary todo files and any PR/branch they produced (they were never meant to ship):

```bash
rm -f todos/P3-temp-validation-decomposable.md todos/P3-temp-validation-nondecomposable.md
git worktree list   # confirm no leftover agent-todo-fast-* worktrees from the dry runs
```

If either dry run left a PR open, close it without merging (it's throwaway validation content, not real product work) and delete its branch.

- [ ] **Step 4: Report the outcome**

Summarize both dry runs' actual behavior against the "Expected" bullets in Steps 1 and 2. If either diverged, fix the relevant task's file (Task 3 or Task 4) and re-run only the diverged dry run — do not re-run both from scratch unless both diverged.
