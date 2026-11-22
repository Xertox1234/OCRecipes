# Harness Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four Claude Code hook guardrails that surface silent commit failures, block commits on main, warn on over-batched Bash calls, and re-read PR state after write commands.

**Architecture:** Four independent shell hooks wired into `.claude/settings.json`. PreToolUse hooks fire before the command and can block; PostToolUse hooks fire after and emit `additionalContext`. Each hook gets a hermetic shell test and a dedicated CI step in the `checks` job. PRs 1 & 2 are independent; PRs 3 & 4 are independent.

**Tech Stack:** Bash, jq, git, gh CLI, `.claude/settings.json` hook registry, GitHub Actions ci.yml.

---

## Task 1: commit-verify.sh (PR: fix/commit-verify-hook)

**Files:**

- Create: `.claude/hooks/commit-verify.sh`
- Create: `.claude/hooks/test-commit-verify.sh`
- Modify: `.claude/settings.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1.1: Create the feature branch**

```bash
git switch -c fix/commit-verify-hook
```

- [ ] **Step 1.2: Write the test first**

Create `.claude/hooks/test-commit-verify.sh`:

```bash
#!/usr/bin/env bash
# Tests for commit-verify.sh — run from project root.
# Hermetic: uses real git in a temp repo; no external tools needed.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/commit-verify.sh"
PASS=0; FAIL=0

# Run the hook with a given command string. Uses real git in TMPDIR.
run_hook() {
  local cmd="$1"
  local input
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  echo "$input" | bash "$HOOK" 2>/dev/null
}

assert_contains() {
  local name="$1" needle="$2" out="$3"
  if printf '%s' "$out" | grep -qF "$needle"; then
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

# --- Set up a temp git repo ---
TMPDIR_REPO=$(mktemp -d)
trap 'rm -rf "$TMPDIR_REPO"' EXIT
git -C "$TMPDIR_REPO" init -q
git -C "$TMPDIR_REPO" config user.email "test@test"
git -C "$TMPDIR_REPO" config user.name "Test"
# Initial commit so the repo has a HEAD
echo "init" > "$TMPDIR_REPO/init.txt"
git -C "$TMPDIR_REPO" add init.txt
git -C "$TMPDIR_REPO" commit -q -m "init"

# Stage a file (simulates a blocked commit — staged files remain)
echo "content" > "$TMPDIR_REPO/staged.ts"
git -C "$TMPDIR_REPO" add staged.ts

# Override git to run against TMPDIR_REPO
export GIT_DIR="$TMPDIR_REPO/.git"
export GIT_WORK_TREE="$TMPDIR_REPO"

# Test 1: staged files remain after git commit → warn about silent block
OUT=$(run_hook "git commit -m 'test'")
assert_contains "blocked commit: warns silently blocked" "silently blocked" "$OUT"
assert_contains "blocked commit: lists staged file" "staged.ts" "$OUT"

# Clear staged files (simulate a clean commit)
git -C "$TMPDIR_REPO" commit -q -m "add staged" 2>/dev/null || true

# Test 2: no staged files → confirm commit succeeded
OUT=$(run_hook "git commit -m 'test'")
assert_contains "clean commit: emits Commit verified" "Commit verified" "$OUT"

# Test 3: non-commit command → silence
OUT=$(run_hook "git status")
assert_silent "non-commit command is silent" "$OUT"

# Test 4: substring that shouldn't match (echo containing git commit text)
OUT=$(run_hook "echo 'git commit is great'")
assert_silent "substring false match is silent" "$OUT"

unset GIT_DIR GIT_WORK_TREE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

- [ ] **Step 1.3: Run the test to confirm it fails (hook doesn't exist yet)**

```bash
bash .claude/hooks/test-commit-verify.sh
```

Expected: `FAIL: blocked commit: warns silently blocked` (and similar) because the hook file doesn't exist.

- [ ] **Step 1.4: Create `.claude/hooks/commit-verify.sh`**

```bash
#!/usr/bin/env bash
# PostToolUse(Bash) — verify a git commit actually landed.
# If staged files remain after a git commit command, the commit was silently
# blocked (by a pre-commit hook deny) or failed. Surface that immediately so
# Claude does not proceed as if the commit succeeded.
# NEVER blocks: always exits 0.
set -uo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Match only real `git commit` invocations (same RE as kimi-review.sh).
GIT_COMMIT_RE='^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
[[ "$CMD" =~ $GIT_COMMIT_RE ]] || exit 0

STAGED=$(git diff --cached --name-only 2>/dev/null || true)
HEAD_LINE=$(git log --oneline -1 2>/dev/null || echo "(no commits yet)")

if [ -n "$STAGED" ]; then
  FILES_LIST=$(printf '%s' "$STAGED" | tr '\n' ' ')
  MSG="git commit was silently blocked or failed — staged changes still exist: ${FILES_LIST}. HEAD has not advanced (still at: ${HEAD_LINE}). Do not proceed as if the commit succeeded. Investigate pre-commit hook output and re-attempt."
else
  MSG="Commit verified: staged changes cleared. HEAD is now: ${HEAD_LINE}."
fi

jq -n --arg m "$MSG" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": $m
  }
}'
exit 0
```

Make it executable:

```bash
chmod +x .claude/hooks/commit-verify.sh
```

- [ ] **Step 1.5: Run the test to confirm all 4 cases pass**

```bash
bash .claude/hooks/test-commit-verify.sh
```

Expected:

```
PASS: blocked commit: warns silently blocked
PASS: blocked commit: lists staged file
PASS: clean commit: emits Commit verified
PASS: non-commit command is silent
PASS: substring false match is silent
Results: 5 passed, 0 failed
```

- [ ] **Step 1.6: Wire the hook into `.claude/settings.json`**

In `.claude/settings.json`, add a new PostToolUse entry for `Bash` immediately after the `lsp-nudge.sh` entry. The PostToolUse section currently looks like:

```json
"PostToolUse": [
  {
    "matcher": "EnterWorktree",
    "hooks": [{ "type": "command", "command": "bash .claude/hooks/worktree-deps.sh", "timeout": 15, "statusMessage": "Provisioning worktree dependencies..." }]
  },
  {
    "matcher": "Bash",
    "hooks": [{ "type": "command", "command": "bash .claude/hooks/lsp-nudge.sh", "timeout": 10, "statusMessage": "" }]
  },
  {
    "matcher": "Edit|Write|MultiEdit",
    "hooks": [{ "type": "command", "command": "file=$(jq -r '.tool_input.file_path // empty'); case \"$file\" in *.ts|*.tsx|*.js|*.jsx|*.cjs|*.mjs) ESLINT_NO_TYPE_AWARE=1 npx eslint --no-warn-ignored --fix \"$file\" ;; esac", "timeout": 60, "statusMessage": "eslint --fix on changed file..." }]
  }
]
```

Add the new entry after `lsp-nudge.sh`:

```json
  {
    "matcher": "Bash",
    "hooks": [{ "type": "command", "command": "bash .claude/hooks/commit-verify.sh", "timeout": 10, "statusMessage": "Verifying commit landed..." }]
  },
```

- [ ] **Step 1.7: Add CI step to `.github/workflows/ci.yml`**

Immediately after the `Kimi review engine tests` step (around line 64), add:

```yaml
- name: Commit-verify hook tests
  run: bash .claude/hooks/test-commit-verify.sh
```

- [ ] **Step 1.8: Make test script executable**

```bash
chmod +x .claude/hooks/test-commit-verify.sh
```

- [ ] **Step 1.9: Verify the diff looks clean**

```bash
git diff --stat
```

Expected: 3 files changed (`.claude/hooks/commit-verify.sh` new, `.claude/hooks/test-commit-verify.sh` new, `.claude/settings.json` modified, `.github/workflows/ci.yml` modified).

- [ ] **Step 1.10: Stage and commit**

```bash
git add .claude/hooks/commit-verify.sh .claude/hooks/test-commit-verify.sh .claude/settings.json .github/workflows/ci.yml
git commit -m "fix: add commit-verify PostToolUse hook to surface silently blocked commits

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 1.11: Push and open PR**

```bash
git push -u origin fix/commit-verify-hook
gh pr create --title "fix: commit-verify hook surfaces silently blocked commits" --body "$(cat <<'EOF'
## Summary
- Adds `.claude/hooks/commit-verify.sh` (PostToolUse/Bash): detects when staged files remain after a `git commit` command, which means the pre-commit hook silently blocked the commit
- Emits `additionalContext` warning when blocked; confirmation when clean
- Adds hermetic shell test with 5 cases
- Adds CI step in the `checks` job

## Test plan
- [ ] `bash .claude/hooks/test-commit-verify.sh` passes locally (5/5)
- [ ] CI `checks` job passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Task 2: branch-preflight.sh (PR: fix/branch-preflight-hook)

**Files:**

- Create: `.claude/hooks/branch-preflight.sh`
- Create: `.claude/hooks/test-branch-preflight.sh`
- Modify: `.claude/settings.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/kimi-review-architecture.md`

- [ ] **Step 2.1: Create the feature branch (from main)**

```bash
git switch main
git switch -c fix/branch-preflight-hook
```

- [ ] **Step 2.2: Write the test first**

Create `.claude/hooks/test-branch-preflight.sh`:

```bash
#!/usr/bin/env bash
# Tests for branch-preflight.sh — run from project root.
# Hermetic: uses a temp git repo; no external tools needed beyond git + jq.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/branch-preflight.sh"
PASS=0; FAIL=0

run_hook() {
  local cmd="$1"
  local input
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  echo "$input" | bash "$HOOK" 2>/dev/null
}

assert_deny() {
  local name="$1" out="$2"
  if printf '%s' "$out" | grep -q '"permissionDecision": "deny"'; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected deny)"
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

# Set up a temp git repo
REPO=$(mktemp -d)
trap 'rm -rf "$REPO"' EXIT
git -C "$REPO" init -q
git -C "$REPO" config user.email "t@t"
git -C "$REPO" config user.name "T"
echo "x" > "$REPO/x.txt"
git -C "$REPO" add x.txt
git -C "$REPO" commit -q -m "init"

export GIT_DIR="$REPO/.git"
export GIT_WORK_TREE="$REPO"

# Test 1: on main → deny
OUT=$(run_hook "git commit -m 'oops'")
assert_deny "commit on main is denied" "$OUT"

# Test 2: deny message mentions 'main'
if printf '%s' "$OUT" | grep -q 'main'; then
  echo "PASS: deny message mentions main"; PASS=$((PASS+1))
else
  echo "FAIL: deny message should mention main"
  FAIL=$((FAIL+1))
fi

# Test 3: detached HEAD → deny
git -C "$REPO" checkout --detach HEAD -q 2>/dev/null
OUT=$(run_hook "git commit -m 'oops'")
assert_deny "commit on detached HEAD is denied" "$OUT"

# Test 4: feature branch → silent
git -C "$REPO" switch -c fix/my-feature -q 2>/dev/null
OUT=$(run_hook "git commit -m 'ok'")
assert_silent "commit on feature branch is silent" "$OUT"

# Test 5: non-commit command on main → silent
git -C "$REPO" switch main -q 2>/dev/null
OUT=$(run_hook "git status")
assert_silent "non-commit command is silent even on main" "$OUT"

# Test 6: SKIP_BRANCH_PREFLIGHT=1 on main → silent
OUT=$(SKIP_BRANCH_PREFLIGHT=1 run_hook "git commit -m 'skip'")
assert_silent "SKIP_BRANCH_PREFLIGHT=1 bypasses deny on main" "$OUT"

unset GIT_DIR GIT_WORK_TREE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

- [ ] **Step 2.3: Run to confirm failure**

```bash
bash .claude/hooks/test-branch-preflight.sh
```

Expected: failures because hook doesn't exist yet.

- [ ] **Step 2.4: Create `.claude/hooks/branch-preflight.sh`**

```bash
#!/usr/bin/env bash
# PreToolUse(Bash) — block git commit when HEAD is on main/master or detached.
# Commits on main are rejected by branch protection at push time; catching them
# here prevents a confusing local commit that then fails to push.
# Hard-blocks (permissionDecision: deny) — this is never correct in this project.
# Escape: set SKIP_BRANCH_PREFLIGHT=1 in the shell that launched Claude Code.
set -uo pipefail

[ -n "${SKIP_BRANCH_PREFLIGHT:-}" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

GIT_COMMIT_RE='^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
[[ "$CMD" =~ $GIT_COMMIT_RE ]] || exit 0

HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

if [ -z "$BRANCH" ]; then
  REASON="HEAD is detached (at ${HEAD_SHA}) — committing here creates an unreachable commit. Create a named branch first: git switch -c <branch-name>"
elif [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  REASON="Refusing to commit on \`${BRANCH}\` — branch protection will reject the push. Switch to a feature branch first: git switch -c <branch-name> (current HEAD: ${HEAD_SHA})"
else
  exit 0
fi

jq -n --arg r "$REASON" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": $r
  }
}'
exit 0
```

```bash
chmod +x .claude/hooks/branch-preflight.sh
```

- [ ] **Step 2.5: Run test to confirm all 6 cases pass**

```bash
bash .claude/hooks/test-branch-preflight.sh
```

Expected:

```
PASS: commit on main is denied
PASS: deny message mentions main
PASS: commit on detached HEAD is denied
PASS: commit on feature branch is silent
PASS: non-commit command is silent even on main
PASS: SKIP_BRANCH_PREFLIGHT=1 bypasses deny on main
Results: 6 passed, 0 failed
```

- [ ] **Step 2.6: Wire into `.claude/settings.json`**

In the `PreToolUse` array, `branch-preflight.sh` must come **before** the `kimi-review.sh` entry so a wrong-branch commit fails fast without invoking the reviewer. The PreToolUse Bash entries currently start with `kimi-review.sh`. Prepend:

```json
{
  "matcher": "Bash",
  "hooks": [{ "type": "command", "command": "bash .claude/hooks/branch-preflight.sh", "timeout": 10, "statusMessage": "Checking branch before commit..." }]
},
```

The `kimi-review.sh` entry follows unchanged.

- [ ] **Step 2.7: Add CI step to `.github/workflows/ci.yml`**

After the `Commit-verify hook tests` step (or after `Kimi review engine tests` if Task 1 hasn't merged yet):

```yaml
- name: Branch-preflight hook tests
  run: bash .claude/hooks/test-branch-preflight.sh
```

- [ ] **Step 2.8: Document escape hatch in `docs/kimi-review-architecture.md`**

Find the `SKIP_KIMI_REVIEW semantics per surface` section. Add a new subsection immediately after it:

```markdown
### SKIP_BRANCH_PREFLIGHT semantics

`SKIP_BRANCH_PREFLIGHT=1` bypasses the branch-preflight PreToolUse hook. Like
`SKIP_KIMI_REVIEW`, an inline prefix (`SKIP_BRANCH_PREFLIGHT=1 git commit ...`)
**does NOT reach** the Claude Code PreToolUse hook — it must be set in the shell
that launched Claude Code before the session started.

Use this only when intentionally working directly on `main` in a context where
branch protection is disabled (e.g. a fresh local repo, a non-OCRecipes project).
```

- [ ] **Step 2.9: Make test executable, check diff, commit**

```bash
chmod +x .claude/hooks/test-branch-preflight.sh
git diff --stat
git add .claude/hooks/branch-preflight.sh .claude/hooks/test-branch-preflight.sh .claude/settings.json .github/workflows/ci.yml docs/kimi-review-architecture.md
git commit -m "fix: add branch-preflight PreToolUse hook to block commits on main

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 2.10: Push and open PR**

```bash
git push -u origin fix/branch-preflight-hook
gh pr create --title "fix: branch-preflight hook blocks commits on main/detached HEAD" --body "$(cat <<'EOF'
## Summary
- Adds `.claude/hooks/branch-preflight.sh` (PreToolUse/Bash): denies `git commit` when on `main`, `master`, or detached HEAD
- Prepended before `kimi-review.sh` so wrong-branch commits fail fast
- Escape hatch: `SKIP_BRANCH_PREFLIGHT=1` (must be set in the shell that launched Claude Code)
- Documents escape alongside `SKIP_KIMI_REVIEW` in `kimi-review-architecture.md`
- 6-case hermetic shell test + CI step

## Test plan
- [ ] `bash .claude/hooks/test-branch-preflight.sh` passes locally (6/6)
- [ ] CI `checks` job passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Task 3: batch-size-guard.sh (PR: fix/batch-size-guard)

**Files:**

- Create: `.claude/hooks/batch-size-guard.sh`
- Create: `.claude/hooks/test-batch-size-guard.sh`
- Modify: `.claude/settings.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`
- Create: `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/feedback_batch_size_bash_calls.md`
- Modify: `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/MEMORY.md`

- [ ] **Step 3.1: Create feature branch**

```bash
git switch main
git switch -c fix/batch-size-guard
```

- [ ] **Step 3.2: Write the test first**

Create `.claude/hooks/test-batch-size-guard.sh`:

```bash
#!/usr/bin/env bash
# Tests for batch-size-guard.sh — run from project root.
# Hermetic: no git, no network. Manipulates /tmp files directly.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/batch-size-guard.sh"
PASS=0; FAIL=0

# Each test uses a unique temp file to avoid cross-test contamination.
make_batch_file() { mktemp /tmp/claude-bash-batch-test-XXXXXX; }

run_hook() {
  local batch_file="$1" cmd="${2:-git status}"
  local input
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  echo "$input" | BATCH_FILE_OVERRIDE="$batch_file" bash "$HOOK" 2>/dev/null
}

assert_contains() {
  local name="$1" needle="$2" out="$3"
  if printf '%s' "$out" | grep -qF "$needle"; then
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

NOW=$(date +%s)

# Test 1: burst — 5 timestamps in the same second → warn
F1=$(make_batch_file)
for _ in 1 2 3 4 5; do echo "$NOW" >> "$F1"; done
OUT=$(run_hook "$F1")
assert_contains "burst of 5 emits batch-size warning" "Batch-size warning" "$OUT"
rm -f "$F1"

# Test 2: under threshold — 2 recent timestamps → silent
F2=$(make_batch_file)
echo "$NOW" >> "$F2"
echo "$NOW" >> "$F2"
OUT=$(run_hook "$F2")
assert_silent "2 recent calls is silent" "$OUT"
rm -f "$F2"

# Test 3: old entries trimmed — 5 entries at now-20 + 1 recent → silent + file trimmed
F3=$(make_batch_file)
OLD=$((NOW - 20))
for _ in 1 2 3 4 5; do echo "$OLD" >> "$F3"; done
echo "$NOW" >> "$F3"
OUT=$(run_hook "$F3")
assert_silent "5 old + 1 recent is silent (old trimmed)" "$OUT"
# Verify trim: only 1 line should remain (the recent one, plus the one appended by hook run)
LINE_COUNT=$(wc -l < "$F3")
if [ "$LINE_COUNT" -le 2 ]; then
  echo "PASS: old lines were trimmed (line count: $LINE_COUNT)"; PASS=$((PASS+1))
else
  echo "FAIL: expected trim to leave ≤2 lines, got $LINE_COUNT"
  FAIL=$((FAIL+1))
fi
rm -f "$F3"

# Test 4: cold start (no file) → silent, no crash
F4="/tmp/claude-bash-batch-test-nonexistent-$$"
rm -f "$F4"
OUT=$(run_hook "$F4")
assert_silent "cold start (no file) is silent" "$OUT"
rm -f "$F4"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

- [ ] **Step 3.3: Run to confirm failure**

```bash
bash .claude/hooks/test-batch-size-guard.sh
```

Expected: failures because hook doesn't exist.

- [ ] **Step 3.4: Create `.claude/hooks/batch-size-guard.sh`**

```bash
#!/usr/bin/env bash
# PreToolUse(Bash) — nudge when ≥5 Bash calls fire within 2 seconds.
# Concurrent batch calls interleave stdout/stderr and cause phantom failures.
# NEVER blocks: always exits 0.
set -uo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0

# Allow test override of the temp file path.
BATCH_FILE="${BATCH_FILE_OVERRIDE:-/tmp/claude-bash-batch-${UID}}"

NOW=$(date +%s)

# Append current timestamp.
printf '%s\n' "$NOW" >> "$BATCH_FILE"

# Trim lines older than 10 seconds to prevent unbounded growth.
CUTOFF=$((NOW - 10))
awk -v cutoff="$CUTOFF" '$1 > cutoff' "$BATCH_FILE" > "${BATCH_FILE}.tmp" 2>/dev/null \
  && mv "${BATCH_FILE}.tmp" "$BATCH_FILE" 2>/dev/null || true

# Count calls within the last 2 seconds.
WINDOW_START=$((NOW - 2))
RECENT=$(awk -v ws="$WINDOW_START" '$1 >= ws {count++} END {print count+0}' "$BATCH_FILE" 2>/dev/null || echo 0)

if [ "$RECENT" -ge 5 ]; then
  jq -n --argjson n "$RECENT" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "additionalContext": ("Batch-size warning: " + ($n|tostring) + " Bash calls in the last 2 s. If results look inconsistent or a command appears to have failed without explanation, re-run it alone before diagnosing. Recommended maximum: 4 parallel Bash calls per response.")
    }
  }'
fi
exit 0
```

```bash
chmod +x .claude/hooks/batch-size-guard.sh
```

- [ ] **Step 3.5: Run test to confirm 5 cases pass**

```bash
bash .claude/hooks/test-batch-size-guard.sh
```

Expected:

```
PASS: burst of 5 emits batch-size warning
PASS: 2 recent calls is silent
PASS: 5 old + 1 recent is silent (old trimmed)
PASS: old lines were trimmed (line count: ...)
PASS: cold start (no file) is silent
Results: 5 passed, 0 failed
```

- [ ] **Step 3.6: Wire into `.claude/settings.json`**

Add a new PreToolUse entry for `Bash` after the `branch-preflight.sh` entry (or after `kimi-review.sh` if Task 2 hasn't merged). It never blocks so order within PreToolUse Bash entries doesn't matter functionally, but placing it after the blocking hooks keeps blocking logic first:

```json
{
  "matcher": "Bash",
  "hooks": [{ "type": "command", "command": "bash .claude/hooks/batch-size-guard.sh", "timeout": 10, "statusMessage": "" }]
},
```

- [ ] **Step 3.7: Add CI step**

In `.github/workflows/ci.yml`, after the last hook test step:

```yaml
- name: Batch-size guard hook tests
  run: bash .claude/hooks/test-batch-size-guard.sh
```

- [ ] **Step 3.8: Add rule to `CLAUDE.md`**

In the `## Key Patterns` section, add before the closing of that section:

```markdown
**Parallel Bash tool calls:** Never issue more than 4 independent `Bash` tool calls in a single response. When results look inconsistent or a command appears to have failed without explanation, re-run it alone before diagnosing. Sequential commands within a single `Bash` call (`&&`, `;`) are unaffected by this limit.
```

- [ ] **Step 3.9: Add memory entry**

Create `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/feedback_batch_size_bash_calls.md`:

```markdown
---
name: feedback-batch-size-bash-calls
description: Max 4 parallel Bash tool calls per response — over-batching interleaves stdout and triggers phantom failure chasing
metadata:
  type: feedback
---

Never issue more than 4 independent `Bash` tool calls in a single response message.

**Why:** When 5+ Bash calls run concurrently in one response, Claude Code dispatches them in parallel. Their stdout/stderr interleaves in unpredictable order. Claude then misattributes errors from one call to another and chases phantom failures that don't exist in isolation.

**How to apply:** Cap parallel `Bash` tool calls at 4 per response. Sequential commands within one call (`&&`, `;`) don't count — they're fine. If results look inconsistent after a batched run, re-run the suspicious command alone before diagnosing. The `batch-size-guard.sh` PreToolUse hook emits a warning when ≥5 calls fire within 2 s.
```

Add to `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/MEMORY.md` under the Workflow section:

```
- [Max 4 parallel Bash calls per response](feedback_batch_size_bash_calls.md) — over-batching interleaves stdout and triggers phantom failure chasing; batch-size-guard.sh nudges at ≥5
```

- [ ] **Step 3.10: Make test executable, check diff, commit**

```bash
chmod +x .claude/hooks/test-batch-size-guard.sh
git diff --stat
git add .claude/hooks/batch-size-guard.sh .claude/hooks/test-batch-size-guard.sh .claude/settings.json .github/workflows/ci.yml CLAUDE.md
git commit -m "fix: add batch-size-guard PreToolUse hook and max-4-Bash CLAUDE.md rule

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 3.11: Push and open PR**

```bash
git push -u origin fix/batch-size-guard
gh pr create --title "fix: batch-size-guard hook warns on ≥5 concurrent Bash calls" --body "$(cat <<'EOF'
## Summary
- Adds `.claude/hooks/batch-size-guard.sh` (PreToolUse/Bash): nudge-only hook that detects ≥5 Bash calls in a 2-second sliding window via a per-user temp file; never blocks
- Adds CLAUDE.md rule: max 4 independent Bash tool calls per response
- Adds memory entry for the rule
- 5-case hermetic shell test + CI step

## Test plan
- [ ] `bash .claude/hooks/test-batch-size-guard.sh` passes locally (5/5)
- [ ] CI `checks` job passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Task 4: pr-verify.sh (PR: fix/pr-verify-hook)

**Files:**

- Create: `.claude/hooks/pr-verify.sh`
- Create: `.claude/hooks/test-pr-verify.sh`
- Modify: `.claude/settings.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`
- Create: `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/feedback_pr_verify_before_reporting.md`
- Modify: `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/MEMORY.md`

- [ ] **Step 4.1: Create feature branch**

```bash
git switch main
git switch -c fix/pr-verify-hook
```

- [ ] **Step 4.2: Write the test first**

Create `.claude/hooks/test-pr-verify.sh`:

```bash
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
  if printf '%s' "$out" | grep -qF "$needle"; then
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

# Test 1: gh pr create, gh succeeds → verified message with PR number
OUT=$(run_hook "gh pr create --title 'foo' --body 'bar'" "success")
assert_contains "gh pr create + gh succeeds: PR verified message" "PR state verified" "$OUT"
assert_contains "gh pr create + gh succeeds: PR number present" "42" "$OUT"
assert_contains "gh pr create + gh succeeds: URL present" "https://github.com" "$OUT"

# Test 2: gh pr merge, gh fails → warning message
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

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

- [ ] **Step 4.3: Run to confirm failure**

```bash
bash .claude/hooks/test-pr-verify.sh
```

Expected: failures because hook doesn't exist.

- [ ] **Step 4.4: Create `.claude/hooks/pr-verify.sh`**

```bash
#!/usr/bin/env bash
# PostToolUse(Bash) — after a gh pr write command, re-read PR state and inject
# verified values as additionalContext so Claude reports from source, not memory.
# NEVER blocks: always exits 0.
set -uo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Match write-side gh pr commands only (not gh pr view/list/checks/etc).
printf '%s' "$CMD" | grep -Eq '(^|[[:space:]])gh[[:space:]]+pr[[:space:]]+(create|merge|close|edit)([[:space:]]|$)' || exit 0

PR_JSON=$(gh pr view --json number,url,state,title 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$PR_JSON" ]; then
  NUM=$(printf '%s' "$PR_JSON" | jq -r '.number' 2>/dev/null || echo "?")
  URL=$(printf '%s' "$PR_JSON" | jq -r '.url' 2>/dev/null || echo "?")
  STATE=$(printf '%s' "$PR_JSON" | jq -r '.state' 2>/dev/null || echo "?")
  TITLE=$(printf '%s' "$PR_JSON" | jq -r '.title' 2>/dev/null || echo "?")
  MSG="PR state verified post-command — #${NUM}, url: ${URL}, state: ${STATE}, title: \"${TITLE}\". Use these values when reporting, not values from prior context."
else
  MSG="WARNING: could not verify PR state after command (gh pr view failed). Run \`gh pr view\` manually before reporting PR details."
fi

jq -n --arg m "$MSG" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": $m
  }
}'
exit 0
```

```bash
chmod +x .claude/hooks/pr-verify.sh
```

- [ ] **Step 4.5: Run test to confirm 5 cases pass**

```bash
bash .claude/hooks/test-pr-verify.sh
```

Expected:

```
PASS: gh pr create + gh succeeds: PR verified message
PASS: gh pr create + gh succeeds: PR number present
PASS: gh pr create + gh succeeds: URL present
PASS: gh pr merge + gh fails: warning emitted
PASS: git status does not trigger pr-verify
PASS: gh pr view (read command) does not trigger pr-verify
PASS: gh pr close triggers pr-verify
Results: 7 passed, 0 failed
```

- [ ] **Step 4.6: Wire into `.claude/settings.json`**

Add a new PostToolUse `Bash` entry alongside `lsp-nudge.sh` and `commit-verify.sh`:

```json
{
  "matcher": "Bash",
  "hooks": [{ "type": "command", "command": "bash .claude/hooks/pr-verify.sh", "timeout": 15, "statusMessage": "Verifying PR state..." }]
},
```

- [ ] **Step 4.7: Add CI step**

```yaml
- name: PR-verify hook tests
  run: bash .claude/hooks/test-pr-verify.sh
```

- [ ] **Step 4.8: Add rule to `CLAUDE.md`**

In the `## Key Patterns` section, add alongside the batch-size rule:

```markdown
**Verifying before reporting:** Before reporting a PR number, merge status, commit hash, or test count, always verify with a fresh tool call. Never cite values from prior conversation context — they may be stale or from a different session.
```

- [ ] **Step 4.9: Add memory entry**

Create `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/feedback_pr_verify_before_reporting.md`:

```markdown
---
name: feedback-pr-verify-before-reporting
description: Always re-read PR number/URL/state from source before reporting — never cite from prior context
metadata:
  type: feedback
---

Before reporting a PR number, merge status, commit hash, or test count, verify with a fresh tool call. Never cite values seen earlier in the conversation.

**Why:** Claude may report PR numbers, test counts, or merge status from earlier context or from a different session. These values can be stale, wrong, or entirely hallucinated. The `pr-verify.sh` PostToolUse hook injects verified PR state after `gh pr create/merge/close/edit`, but for any other case the rule must be applied manually.

**How to apply:** When about to write "PR #N was merged" or "N tests passed", run `gh pr view` / `gh pr checks` / `git log --oneline -1` first. Report the live output, not the value from context.
```

Add to `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/MEMORY.md` under the Workflow section:

```
- [Verify before reporting PR/hash/test results](feedback_pr_verify_before_reporting.md) — never cite prior-context values; pr-verify.sh injects live state after gh pr write commands
```

- [ ] **Step 4.10: Make test executable, check diff, commit**

```bash
chmod +x .claude/hooks/test-pr-verify.sh
git diff --stat
git add .claude/hooks/pr-verify.sh .claude/hooks/test-pr-verify.sh .claude/settings.json .github/workflows/ci.yml CLAUDE.md
git commit -m "fix: add pr-verify PostToolUse hook and verify-before-reporting CLAUDE.md rule

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 4.11: Push and open PR**

```bash
git push -u origin fix/pr-verify-hook
gh pr create --title "fix: pr-verify hook re-reads PR state after gh pr write commands" --body "$(cat <<'EOF'
## Summary
- Adds `.claude/hooks/pr-verify.sh` (PostToolUse/Bash): after `gh pr create/merge/close/edit`, immediately re-reads PR state via `gh pr view --json` and injects verified number/url/state/title as `additionalContext`
- Adds CLAUDE.md rule: verify before reporting PR number, hash, or test count
- Adds memory entry for the rule
- 7-case hermetic shell test (stubs `gh` on PATH) + CI step

## Test plan
- [ ] `bash .claude/hooks/test-pr-verify.sh` passes locally (7/7)
- [ ] CI `checks` job passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-merge memory updates

After all 4 PRs merge, add two final memory entries for the two new hooks that emit `additionalContext` for commit verification (the `commit-verify` and `branch-preflight` hooks). These can be added directly to the memory directory without a PR:

Create `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/feedback_commit_verify_hook.md`:

```markdown
---
name: feedback-commit-verify-hook
description: commit-verify.sh PostToolUse hook surfaces silently blocked commits; staged files remaining = blocked
metadata:
  type: feedback
---

After any `git commit` Bash tool call, the `commit-verify.sh` PostToolUse hook checks for staged files. If staged files remain, the commit was silently blocked by the pre-commit hook (kimi-review deny or Husky exit 1) and HEAD did not advance.

**Why:** When `git commit` is tail-piped (e.g. `git commit -m "..." 2>&1 | tail -5`), the pipe's exit code (0 from `tail`) masks the blocked commit's exit code. Claude sees no error and proceeds as if committed.

**How to apply:** When `commit-verify.sh` emits "silently blocked", stop. Do not push. Investigate the pre-commit output or re-run the commit without the pipe to see the real error.
```

Create `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/feedback_branch_preflight_hook.md`:

```markdown
---
name: feedback-branch-preflight-hook
description: branch-preflight.sh PreToolUse hook blocks git commit on main/master or detached HEAD before it happens
metadata:
  type: feedback
---

The `branch-preflight.sh` PreToolUse hook denies `git commit` when the active branch is `main`, `master`, or detached HEAD.

**Why:** Mid-session branch drift (user checks out main in their terminal, or a merge lands HEAD on main) causes the next commit to land on the protected branch. Branch protection rejects the push — but the local commit exists and diagnosing the failure wastes cycles.

**How to apply:** If the hook denies a commit, run `git switch -c <branch-name>` first. Escape hatch: `SKIP_BRANCH_PREFLIGHT=1` set in the shell that launched Claude Code (inline prefix does NOT reach the PreToolUse hook).
```

Add both to `MEMORY.md` under Workflow:

```
- [commit-verify hook surfaces blocked commits](feedback_commit_verify_hook.md) — staged files remaining after git commit = silently blocked; don't proceed as if committed
- [branch-preflight hook blocks commits on main](feedback_branch_preflight_hook.md) — PreToolUse deny on main/detached HEAD; use git switch -c first
```
