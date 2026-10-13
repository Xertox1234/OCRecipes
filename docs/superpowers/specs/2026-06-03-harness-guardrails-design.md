# Harness Guardrails Design

**Date:** 2026-06-03
**Status:** Approved
**Scope:** Four durable guardrails for recurring Claude Code harness friction patterns

---

## Overview

Four recurring friction patterns in the Claude Code harness each cause compounding wasted cycles:

1. **Pre-commit hook silent abort** — tail-piped `git commit` swallows the blocked-commit exit code; Claude proceeds as if the commit succeeded.
2. **Branch drift** — mid-session the active branch drifts to `main`; next commit creates a local commit on the protected branch before push fails.
3. **Over-batched parallel Bash calls** — ≥5 concurrent Bash tool calls in one response interleave stdout/stderr; Claude misattributes errors and chases phantom failures.
4. **Hallucinated tool output** — Claude reports PR numbers, merge status, or test counts from earlier context without re-verifying; values may be stale or from a different session.

**Chosen approach:** Mechanical hooks for patterns 1 and 2 (crisp, deterministic invariants); lightweight timing-nudge hook + explicit CLAUDE.md rule for pattern 3 (per-turn batch count not mechanically observable); PostToolUse re-read nudge + CLAUDE.md rule for pattern 4 (hallucinations happen in text generation, not tool calls).

---

## Pattern 1 — Commit Verification (PostToolUse Hook)

### Hook: `commit-verify.sh`

**Type:** PostToolUse, matcher `Bash`
**Blocks:** No (PostToolUse cannot undo a completed call)
**Purpose:** Detect a silently blocked or failed commit and surface it immediately.

**Invariant:** A successful `git commit` clears all staged changes. If staged files remain after a `git commit` command, the commit was blocked or failed.

**Logic:**

1. Extract `tool_input.command` from hook event JSON.
2. Regex-match for `git commit` using the same anchored pattern as `kimi-review.sh` to reject substring matches (`echo git commit`, `commit-graph`, etc.):
   ```
   ^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)
   ```
3. If not matched → `exit 0`.
4. Run `git diff --cached --name-only`.
5. Run `git log --oneline -1` to capture current HEAD.
6. **If staged files remain:** emit `additionalContext` warning:
   > "git commit was silently blocked or failed — staged changes still exist: [files]. HEAD has not advanced (still at [sha] [subject]). Do not proceed as if the commit succeeded. Investigate pre-commit hook output or re-attempt."
7. **If no staged files:** emit `additionalContext` confirmation:
   > "Commit verified: staged changes cleared. HEAD is now [sha] [subject]."

**`settings.json` change:** Add PostToolUse `Bash` entry for `commit-verify.sh` after the existing `lsp-nudge.sh` entry.

### Test: `test-commit-verify.sh`

Located at `.claude/hooks/test-commit-verify.sh` (matches existing convention — `test-kimi-review.sh`, `test-inject-patterns.sh`, etc. live directly in `.claude/hooks/`). Each new test script also gets a dedicated CI step in `ci.yml` so it runs in the gate.

Test cases:

- **Blocked commit (staged files remain):** scaffold temp git repo, stage a file, simulate hook event JSON with a `git commit` command; assert `additionalContext` contains `"silently blocked"`.
- **Clean commit (no staged files):** stage + commit a file via real `git commit`, simulate hook event; assert `additionalContext` contains `"Commit verified"`.
- **Non-commit command:** simulate hook event with `git status`; assert hook exits silently (no JSON output).

---

## Pattern 2 — Branch Preflight (PreToolUse Hook)

### Hook: `branch-preflight.sh`

**Type:** PreToolUse, matcher `Bash`
**Blocks:** Yes (`permissionDecision: deny`)
**Purpose:** Prevent commits on `main`/`master` or a detached HEAD before they happen.

**Logic:**

1. Extract `tool_input.command`. Regex-match for `git commit` (same RE as above).
2. If not matched → `exit 0`.
3. Run `git symbolic-ref --short HEAD 2>/dev/null`.
4. **Three cases:**
   - Branch is `main` or `master` → deny:
     > "Refusing to commit on `main` — branch protection will reject the push. Switch to a feature branch first: `git switch -c <branch-name>`."
   - `symbolic-ref` exits non-zero (detached HEAD) → deny:
     > "HEAD is detached — committing here creates an unreachable commit. Create a named branch first: `git switch -c <branch-name>`."
   - Any other named branch → `exit 0` (silent).
5. Both deny messages include current HEAD SHA for orientation.

**Escape hatch:** `SKIP_BRANCH_PREFLIGHT=1 git commit ...` (inline prefix sets the var in the shell running git; Claude Code's hook reads Claude Code's process env, so this escape must be set in the _shell that launched Claude Code_, not inline — document alongside `SKIP_KIMI_REVIEW=1` in `kimi-review-architecture.md`).

**`settings.json` change:** Prepend `branch-preflight.sh` _before_ the existing `kimi-review.sh` PreToolUse entry — branch check fires first; a blocked branch avoids a wasted kimi-review call.

### Test: `test-branch-preflight.sh`

Located at `.claude/hooks/test-branch-preflight.sh`. Gets a dedicated CI step.

Test cases:

- **On `main`:** scaffold repo on `main`, simulate `git commit` event; assert `permissionDecision: deny` JSON, reason mentions `main`.
- **Detached HEAD:** `git checkout --detach HEAD`; assert deny JSON, reason mentions `detached`.
- **Feature branch:** create and checkout `todo/my-feature`; assert hook exits silently with no JSON output.
- **Non-commit command:** simulate `git status` event on `main`; assert silence (hook only fires on commits).
- **Escape hatch:** set `SKIP_BRANCH_PREFLIGHT=1`, simulate `git commit` on `main`; assert hook exits silently.

---

## Pattern 3 — Batch-Size Timing Nudge (PreToolUse Hook + CLAUDE.md Rule)

### Hook: `batch-size-guard.sh`

**Type:** PreToolUse, matcher `Bash`
**Blocks:** Never (nudge only)
**Purpose:** Detect concurrent Bash call bursts via a sliding timestamp window and warn before output interleaving causes misattribution.

**Logic:**

1. Temp file: `/tmp/claude-bash-batch-${UID}` (per-user, OS-reaped on reboot).
2. Append current epoch second (`date +%s`) to file.
3. Trim lines older than 10 seconds (prevents unbounded growth):
   ```bash
   NOW=$(date +%s)
   awk -v now="$NOW" '(now - $1) <= 10' "$BATCH_FILE" > "${BATCH_FILE}.tmp" && mv "${BATCH_FILE}.tmp" "$BATCH_FILE"
   ```
4. Count lines within the last 2 seconds.
5. If count ≥ 5: emit `additionalContext`:
   > "Batch-size warning: N Bash calls in the last 2 s detected. If results look inconsistent or a command appears to have failed without explanation, re-run it alone before diagnosing. Recommended maximum: 4 parallel Bash calls per response."
6. If count < 5: `exit 0` (silent).

### CLAUDE.md Rule

Added to the "Key Patterns" section:

> **Parallel Bash tool calls:** Never issue more than 4 independent `Bash` tool calls in a single response. When results look inconsistent or a command appears to have failed without explanation, re-run it alone before diagnosing. Sequential commands within a single `Bash` call (`&&`, `;`) are unaffected by this limit.

### Test: `test-batch-size-guard.sh`

Located at `.claude/hooks/test-batch-size-guard.sh`. Gets a dedicated CI step.

Test cases:

- **Burst detected:** seed temp file with 5 timestamps all equal to `$NOW`; assert `additionalContext` contains `"Batch-size warning"` and the count ≥ 5.
- **Under threshold:** seed file with 2 recent timestamps; assert hook exits silently.
- **File trimmed:** seed file with 5 lines at `$NOW - 20` (old) and 1 line at `$NOW`; assert hook is silent and file retains only the 1 recent line.
- **No temp file:** run hook cold (no existing file); assert no crash and hook is silent.

---

## Pattern 4 — PR Verification Nudge (PostToolUse Hook + CLAUDE.md Rule)

### Hook: `pr-verify.sh`

**Type:** PostToolUse, matcher `Bash`
**Blocks:** Never (nudge only)
**Purpose:** After a `gh pr` write command, immediately re-read the PR state and inject verified values as `additionalContext` — ensuring Claude reports the real PR number, URL, and state rather than values from earlier context.

**Matched commands:** `gh pr create`, `gh pr merge`, `gh pr close`, `gh pr edit`.

**Logic:**

1. Extract `tool_input.command`. Check for `gh pr (create|merge|close|edit)`.
2. If not matched → `exit 0`.
3. Run `gh pr view --json number,url,state,title 2>/dev/null`.
4. **If succeeds:** emit `additionalContext`:
   > "PR state verified post-command — #[number], url: [url], state: [OPEN|MERGED|CLOSED], title: \"[title]\". Use these values when reporting, not values from prior context."
5. **If fails** (no current PR, auth error, not in a repo): emit `additionalContext`:
   > "WARNING: could not verify PR state after command (gh pr view failed). Run `gh pr view` manually before reporting PR details."

**`settings.json` change:** Add PostToolUse `Bash` entry for `pr-verify.sh` alongside `lsp-nudge.sh` and `commit-verify.sh`.

### CLAUDE.md Rule

Added to the "Key Patterns" section:

> **Verifying before reporting:** Before reporting a PR number, merge status, commit hash, or test count, always verify with a fresh tool call. Never cite values from prior conversation context — they may be stale or from a different session.

### Test: `test-pr-verify.sh`

Located at `.claude/hooks/test-pr-verify.sh`. Gets a dedicated CI step.

Test cases:

- **Matched command, `gh` succeeds:** stub `gh` on PATH to exit 0 and print fixed JSON (`{"number":42,"url":"...","state":"OPEN","title":"..."}`); simulate `gh pr create` event; assert `additionalContext` contains `"PR state verified"`, PR number 42, and URL.
- **Matched command, `gh` fails:** stub `gh` to exit 1; assert `additionalContext` contains `"WARNING: could not verify"`.
- **Non-matching command (`git status`):** assert hook exits silently.
- **`gh pr view` (read command, not a write):** assert hook exits silently (only write commands trigger verification).

---

## PR Delivery Plan

Four PRs, standard flow (repo-level auto-merge is OFF — watch CI with `gh pr checks <n> --watch`, then merge manually with `gh pr merge <n> --squash --delete-branch`):

| PR branch                   | Hook(s) added         | Test script                | CLAUDE.md change             | Memory entries                 |
| --------------------------- | --------------------- | -------------------------- | ---------------------------- | ------------------------------ |
| `fix/commit-verify-hook`    | `commit-verify.sh`    | `test-commit-verify.sh`    | —                            | 1 (feedback: commit verify)    |
| `fix/branch-preflight-hook` | `branch-preflight.sh` | `test-branch-preflight.sh` | —                            | 1 (feedback: branch preflight) |
| `fix/batch-size-guard`      | `batch-size-guard.sh` | `test-batch-size-guard.sh` | Max-4 Bash rule              | 1 (feedback: batch size)       |
| `fix/pr-verify-hook`        | `pr-verify.sh`        | `test-pr-verify.sh`        | Verify-before-reporting rule | 1 (feedback: PR verify)        |

PRs 1 and 2 are independent and can be implemented in parallel. PRs 3 and 4 are also independent of each other, and independent of 1 and 2.

---

## Files Changed Summary

**New files:**

- `.claude/hooks/commit-verify.sh`
- `.claude/hooks/branch-preflight.sh`
- `.claude/hooks/batch-size-guard.sh`
- `.claude/hooks/pr-verify.sh`
- `.claude/hooks/__tests__/test-commit-verify.sh`
- `.claude/hooks/__tests__/test-branch-preflight.sh`
- `.claude/hooks/__tests__/test-batch-size-guard.sh`
- `.claude/hooks/__tests__/test-pr-verify.sh`

**Modified files:**

- `.claude/settings.json` (4 new hook registrations)
- `CLAUDE.md` (2 new rules: max-4-Bash, verify-before-reporting)
- `docs/kimi-review-architecture.md` (document `SKIP_BRANCH_PREFLIGHT=1` escape hatch)
- `~/.claude/projects/.../memory/MEMORY.md` + 4 new memory files

**Not changed:** `~/.claude/settings.json` (guardrails are project-specific, not global).
