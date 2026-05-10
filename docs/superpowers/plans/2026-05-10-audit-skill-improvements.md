# Audit Skill Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `.claude/skills/audit/SKILL.md` to use git worktree isolation, per-fix `kimi-review` with domain-matched `--patterns`, and remove the outdated Phase 6 code-reviewer subagent step.

**Architecture:** Single-file markdown edit. No code tests apply — verification is done with `grep` after each edit to confirm old text is gone and new text is present. Two commits: one for content additions (Tasks 1–4), one for structural renumbering and cleanup (Tasks 5–7).

**Tech Stack:** Edit tool, Bash grep, git commit.

---

## Files

| File                            | Change            |
| ------------------------------- | ----------------- |
| `.claude/skills/audit/SKILL.md` | All 7 tasks below |

---

### Task 1: Clarify Phase 2 agent batching instruction

The current text says "four batches: 4, 4, 4, 3" implying 15 invocations; actual audits run 7 (one per domain row). Fix both occurrences.

**Files:**

- Modify: `.claude/skills/audit/SKILL.md:24` and `:58`

- [ ] **Step 1: Replace line 24 (mapping section preamble)**

Find:

```
**For `full` or `pre-launch` scopes:** Launch agents for all domains (batch in groups of 4 — e.g., four batches: 4, 4, 4, 3 — not all at once).
```

Replace with:

```
**For `full` or `pre-launch` scopes:** Launch **one agent invocation per domain row** (7 total). Batch in two groups — first 4 domains, then 3 — to avoid overwhelming context. The "Primary Agent(s)" column shows which agent type to use for each invocation; list both agents in the prompt when two are shown.
```

- [ ] **Step 2: Replace line 58 (Phase 2 Discovery step 1 sub-bullet)**

Find:

```
   - `full` or `pre-launch`: launch agents for all domains (batch in groups of 4 — e.g., four batches: 4, 4, 4, 3 — to avoid overwhelming context)
```

Replace with:

```
   - `full` or `pre-launch`: launch one agent invocation per domain row (7 total) in two batches — first 4 domains, then 3
```

- [ ] **Step 3: Verify both old strings are gone**

```bash
grep "four batches" .claude/skills/audit/SKILL.md
```

Expected: no output (both occurrences removed).

- [ ] **Step 4: Verify new text is present**

```bash
grep "one agent invocation per domain row" .claude/skills/audit/SKILL.md | wc -l
```

Expected: `2`

---

### Task 2: Add worktree creation steps to Phase 1

Phase 1 currently ends at "4. Record the baseline in the manifest header". Add two steps after it before the blank line that starts Phase 2.

**Files:**

- Modify: `.claude/skills/audit/SKILL.md:53`

- [ ] **Step 1: Add worktree steps after baseline recording**

Find:

```
4. Record the baseline in the manifest header

## Phase 2: Discovery
```

Replace with:

````
4. Record the baseline in the manifest header
5. Capture the current branch:
   ```bash
   git branch --show-current
   # If output is empty (detached HEAD), use: git rev-parse --abbrev-ref HEAD
````

6. Create and enter an audit worktree — all subsequent phases run from it:
   ```bash
   git worktree add .worktrees/audit-$(date +%Y-%m-%d) HEAD
   ```
   Or use `EnterWorktree` if available. All Phases 2–6 run from this worktree. It is cleaned up after the Phase 6 commit.

## Phase 2: Discovery

````

- [ ] **Step 2: Verify the worktree steps are present**

```bash
grep "audit worktree" .claude/skills/audit/SKILL.md
````

Expected: line containing "Create and enter an audit worktree"

- [ ] **Step 3: Verify Phase 1 still ends cleanly before Phase 2 header**

```bash
grep -A2 "cleaned up after the Phase 6 commit" .claude/skills/audit/SKILL.md
```

Expected: next non-blank line is `## Phase 2: Discovery`

---

### Task 3: Add per-fix kimi-review step to Phase 3

Insert a new step 7 (kimi-review) between the existing step 6 (Verify) and step 7 (Update manifest). Renumber old step 7 → 8 and old step 8 → 9.

**Files:**

- Modify: `.claude/skills/audit/SKILL.md:84–97`

- [ ] **Step 1: Replace the verify→update→next block**

Find:

```
6. **Verify** the fix landed:
   - Grep/read the fixed code to confirm the change is present
   - Run the specific test file(s) to confirm they pass
7. Update manifest:
   - Status → `verified`
   - Verification column → what you checked (e.g., "grep confirms userId param; 83/83 tests pass")
8. Move to the next finding
```

Replace with:

````
6. **Verify** the fix landed:
   - Grep/read the fixed code to confirm the change is present
   - Run the specific test file(s) to confirm they pass
7. **kimi-review** the fix — run from the audit worktree root:
   ```bash
   kimi-review --scope "[one-line fix description]" --patterns [domain]
````

Domain → `--patterns` mapping:

| Finding Domain | `--patterns` value |
| -------------- | ------------------ |
| security       | `security`         |
| performance    | `performance`      |
| data-integrity | `database`         |
| architecture   | `architecture`     |
| code-quality   | `typescript,api`   |
| camera / RN-UX | `react-native`     |
| accessibility  | `react-native`     |

Response handling:

- **CRITICAL finding**: stop, surface to user, fix before proceeding — re-run tests + kimi-review
- **WARNING finding**: fix inline as part of this finding, re-run tests + kimi-review
- **SUGGESTION**: proceed — note in manifest Verification column if worth tracking for codification

8. Update manifest:
   - Status → `verified`
   - Verification column → what you checked (e.g., "grep confirms userId param; 83/83 tests pass; kimi-review clean")
9. Move to the next finding

````

- [ ] **Step 2: Verify kimi-review step is present**

```bash
grep "kimi-review the fix" .claude/skills/audit/SKILL.md
````

Expected: line containing `**kimi-review** the fix`

- [ ] **Step 3: Verify step 9 exists (old step 8 renumbered)**

```bash
grep "^9\. Move to the next finding" .claude/skills/audit/SKILL.md
```

Expected: one matching line

---

### Task 4: Replace Phase 4 Copilot delegate with kimi-write guidance

Remove the `npm run copilot:delegate` instructions and the "Never delegate JWT/auth..." paragraph. Replace with kimi-write guidance.

**Files:**

- Modify: `.claude/skills/audit/SKILL.md:104–111`

- [ ] **Step 1: Replace the Copilot delegate block**

Find:

````
4. For low/deferred items that are scoped docs, tests, code-quality, simple performance, or simple refactor work with clear files and acceptance criteria, run:
   ```bash
   npm run copilot:delegate:dry-run -- todos/<filename>.md
   npm run copilot:delegate -- todos/<filename>.md
````

If live delegation succeeds, add the GitHub Issue URL to the todo's `github_issue` field and the manifest Deferred Items table. If `@copilot` assignment fails, leave the todo local and report the failure clearly; do not mark Copilot delegation as complete.

Never delegate JWT/auth, IAP receipt validation, secrets, health-data boundaries, goal-safety behavior, schema/migrations, production data handling, or broad architecture changes without a human-approved plan. Copilot work must arrive as a PR for human review; no auto-merge and no direct commits to `main`.

```

Replace with:
```

4. For low/deferred items that are straightforward boilerplate or test-only work with clear files and acceptance criteria, use `kimi-write` to generate a first pass — review the output before committing. For items requiring human judgment or broad architecture decisions, leave the todo local and note the rationale clearly in the Deferred Items table.

````

- [ ] **Step 2: Verify copilot references are gone**

```bash
grep "copilot" .claude/skills/audit/SKILL.md
````

Expected: no output

- [ ] **Step 3: Verify kimi-write guidance is present**

```bash
grep "kimi-write" .claude/skills/audit/SKILL.md
```

Expected: one line with the kimi-write instruction

- [ ] **Step 4: Commit content additions (Tasks 1–4)**

```bash
git add .claude/skills/audit/SKILL.md
git commit -m "feat(audit-skill): add worktree isolation, per-fix kimi-review, clarify batching, replace copilot with kimi-write"
```

---

### Task 5: Remove Phase 6 (Code Review subagent)

Delete the entire Phase 6 section from its header through the last line before the Phase 7 header.

**Files:**

- Modify: `.claude/skills/audit/SKILL.md:128–139`

- [ ] **Step 1: Delete the Phase 6 section**

Find:

```
## Phase 6: Code Review

Before committing, dispatch the code-reviewer subagent against all changed files to catch anything missed during per-fix verification.

1. Run the code-reviewer subagent (`.claude/agents/code-reviewer.md`) with:
   - The list of all modified files from Phase 3
   - A one-line description of each fix (copy from the manifest)
   - The instruction: "Report CRITICAL / HIGH / MEDIUM / LOW / PASS per file. Focus on correctness, security, and pattern compliance. Do not flag style preferences."
2. For each CRITICAL or HIGH finding: fix immediately (follow Phase 3 rules — read, fix, verify, update manifest)
3. For MEDIUM findings: use judgment — fix if quick, defer with todo if non-trivial
4. For LOW findings: defer unless trivial one-liners
5. Re-run `npm run test:run` and `npm run check:types` after any review fixes

## Phase 7: Commit Fixes
```

Replace with:

```
## Phase 7: Commit Fixes
```

- [ ] **Step 2: Verify Phase 6 header is gone**

```bash
grep "## Phase 6: Code Review" .claude/skills/audit/SKILL.md
```

Expected: no output

- [ ] **Step 3: Verify code-reviewer subagent reference is gone**

```bash
grep "code-reviewer subagent" .claude/skills/audit/SKILL.md
```

Expected: no output

---

### Task 6: Rename Phase 7 → Phase 6, Phase 8 → Phase 7

Update headers, body references, and the Phase 7 preamble to remove the stale "after code review is clean" text.

**Files:**

- Modify: `.claude/skills/audit/SKILL.md` (multiple lines)

- [ ] **Step 1: Rename Phase 7 Commit header and fix preamble**

Find:

```
## Phase 7: Commit Fixes

After code review is clean:

1. Stage all changed files (code fixes + review fixes + manifest + changelog + any new todos)
```

Replace with:

```
## Phase 6: Commit Fixes

After Phase 5 closes out:

1. Stage all changed files (code fixes + manifest + changelog + any new todos)
```

- [ ] **Step 2: Rename Phase 8 Codify header**

Find:

```
## Phase 8: Codify (patterns, learnings & agent updates)
```

Replace with:

```
## Phase 7: Codify (patterns, learnings & agent updates)
```

- [ ] **Step 3: Update Phase 8 Important note (now Phase 7)**

Find:

```
**Important:** Codify findings from both Phase 3 (audit fixes) and Phase 6 (code review fixes) — the codifier should see the complete picture.
```

Replace with:

```
**Important:** Codify all findings from Phase 3, including any corrections triggered by kimi-review — the codifier should see the complete picture.
```

- [ ] **Step 4: Verify no old Phase 7/Phase 8 headers remain**

```bash
grep "## Phase 7: Commit\|## Phase 8:" .claude/skills/audit/SKILL.md
```

Expected: no output

- [ ] **Step 5: Verify new Phase 6/Phase 7 headers are present**

```bash
grep "## Phase 6: Commit\|## Phase 7: Codify" .claude/skills/audit/SKILL.md
```

Expected: two matching lines

---

### Task 7: Update "why the order" rationale and Rules section, then commit

Replace the stale rationale and three Rules entries that reference old phase numbers or the removed code-reviewer step.

**Files:**

- Modify: `.claude/skills/audit/SKILL.md:202–217`

- [ ] **Step 1: Update the "why the order" rationale block**

Find:

```
**Why the order is review → commit → codify:**

- Code review happens before the commit so review fixes and audit fixes land in one commit (clean diff)
- Codification happens after both, so the codifier sees the complete picture — audit fixes AND review fixes
- Separate commits (fix vs docs) keep the fix diff reviewable without docs noise
- If codification reveals issues, the fixes are already safely committed
```

Replace with:

```
**Why the order is fix → commit → codify:**

- kimi-review runs per-fix inside Phase 3, so every fix is reviewed and verified before it reaches Phase 6 (Commit)
- Committing before codifying keeps the fix diff clean and reviewable without docs noise
- Codification happens last so the codifier sees the complete picture — all verified fixes, including any corrections triggered by kimi-review
- If codification reveals issues, the fixes are already safely committed
```

- [ ] **Step 2: Update the three stale Rules entries**

Find:

```
- **No documentation during the fix phase.** Fix code first (Phases 3-7). Codify patterns after (Phase 8).
- **Code review is not optional.** Every audit must run Phase 6 before committing. It catches what per-fix verification misses and feeds the codifier complete input.
```

Replace with:

```
- **No documentation during the fix phase.** Fix code first (Phases 3-6). Codify patterns after (Phase 7).
- **kimi-review is not optional.** Every fix in Phase 3 must pass kimi-review before being marked `verified`. It catches what test-based verification misses and feeds the codifier complete input.
```

- [ ] **Step 3: Update the Codification rule**

Find:

```
- **Codification is not optional.** Every audit must run Phase 8 to extract knowledge. But it happens AFTER fixes and review are committed.
```

Replace with:

```
- **Codification is not optional.** Every audit must run Phase 7 to extract knowledge. But it happens AFTER fixes are committed.
```

- [ ] **Step 4: Verify all stale references are gone**

```bash
grep "Phase 8\|Phase 7: Commit\|code review is not optional\|review → commit\|review fixes" .claude/skills/audit/SKILL.md
```

Expected: no output

- [ ] **Step 5: Verify new Rules text is present**

```bash
grep "kimi-review is not optional\|fix → commit → codify\|Phases 3-6" .claude/skills/audit/SKILL.md
```

Expected: three matching lines

- [ ] **Step 6: Full sanity check — count total Phase headers**

```bash
grep "^## Phase" .claude/skills/audit/SKILL.md
```

Expected output (exactly 7 lines):

```
## Phase 1: Setup
## Phase 2: Discovery
## Phase 3: Fix (one at a time)
## Phase 4: Defer
## Phase 5: Close
## Phase 6: Commit Fixes
## Phase 7: Codify (patterns, learnings & agent updates)
```

- [ ] **Step 7: Commit renumbering and cleanup**

```bash
git add .claude/skills/audit/SKILL.md
git commit -m "feat(audit-skill): renumber phases, update rationale and rules after removing Phase 6 code review"
```
