# Todo Batch Processing Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `/todo` skill that autonomously works through the project's `todos/` backlog — triaging, implementing, reviewing, and archiving each todo — paired with a `todo-executor` agent for single-todo execution.

**Architecture:** Two files: an orchestrator skill (`.claude/skills/todo/SKILL.md`) handles triage, dependency analysis, parallel dispatch, and session summary. A `todo-executor` agent (`.claude/agents/todo-executor.md`) handles single-todo lifecycle: parse, research, implement, verify, code review, commit, codify.

**Tech Stack:** Claude Code skills/agents, git worktrees for parallel execution, existing `code-reviewer` agent, and inline codification in the executor (the `pattern-codifier` file is now a retired tombstone).

**Spec:** `docs/superpowers/specs/2026-04-08-todo-batch-skill-design.md`

---

## File Structure

| File                              | Action | Responsibility                                                                          |
| --------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `.claude/skills/todo/SKILL.md`    | Create | Orchestrator: baseline, triage, dependency analysis, parallel dispatch, session summary |
| `.claude/agents/todo-executor.md` | Create | Single-todo executor: parse, research, implement, verify, review, commit, codify        |

---

### Task 1: Create the Todo Executor Agent

The executor is the foundation — the orchestrator depends on it but not vice versa. Build this first.

**Files:**

- Create: `.claude/agents/todo-executor.md`

- [ ] **Step 1: Write the agent file**

Create `.claude/agents/todo-executor.md` with the full agent prompt. This is the complete content:

```markdown
# Todo Executor Subagent

You are a specialized agent that implements a single todo item from the `todos/` folder. You receive a todo file path, implement it end-to-end, and report the result.

## Input

You receive a single argument: the absolute path to a todo markdown file (e.g., `todos/consolidate-cooking-session-stores.md`).

## Execution Steps

### Step 1 — Parse

- Read the todo markdown file
- Extract from YAML frontmatter: `title`, `status`, `priority`, `created`, `labels`
- Extract from body: Acceptance Criteria (checklist items), Implementation Notes (guidance), Dependencies (blocking items)

### Step 2 — Pre-flight

- If the todo's Dependencies section lists other todo files, check if those files still exist in `todos/` (not in `todos/archive/`). If any dependency todo still exists (not yet completed), report back immediately:
```

{ status: "blocked", reason: "Dependency <filename> has not been completed yet" }

```
- If `status` is not `backlog` or `planned`, report back:
```

{ status: "skipped", reason: "Todo status is <status>, not actionable" }

````

### Step 3 — Research

Read only what is relevant to this todo. Select docs by the todo's `labels` field.

**Documentation inventory:**

| Label | Pattern docs to read |
|-------|---------------------|
| `security` | `docs/patterns/security.md` |
| `architecture`, `duplication` | `docs/patterns/architecture.md` |
| `ui` | `docs/patterns/react-native.md`, `docs/patterns/design-system.md`, `docs/patterns/animation.md` |
| `performance` | `docs/patterns/performance.md` |
| `testing` | `docs/patterns/testing.md` |
| `database` | `docs/patterns/database.md` |
| `api` | `docs/patterns/api.md` |
| `hooks` | `docs/patterns/hooks.md` |
| `typescript`, `types` | `docs/patterns/typescript.md` |
| `client-state` | `docs/patterns/client-state.md` |

Other docs (read when relevant, not always):
- `docs/LEARNINGS.md` — grep for affected file names or domain keywords
- `docs/patterns/documentation.md` — only if the todo involves docs changes
- `CLAUDE.md` — fallback if no labels match; skim the "Key Patterns" section

**Prior art:** Grep `todos/archive/` for completed todos that mention the same source files. Read any matches to learn from prior approaches.

**Source context:** Read the full files being modified (not just the lines mentioned in the todo) to understand surrounding code, imports, and conventions.

### Step 4 — Implement

- Use the Acceptance Criteria as the definition of done — every checkbox must be satisfiable
- Use Implementation Notes as guidance, not prescription — you may find a better approach
- Apply patterns and conventions learned in the Research step
- Write or update tests as needed to cover the changes
- Keep changes minimal and surgical — no drive-by improvements outside the todo's scope

### Step 5 — Verify

Run all three checks. ALL must pass before proceeding:

```bash
npm run test:run      # All tests must pass
npm run check:types   # Zero type errors
npm run lint          # Zero lint errors
````

After the commands pass, re-read the modified files to confirm the changes match every Acceptance Criteria item.

### Step 6 — Code Review

Spawn the `code-reviewer` subagent (`.claude/agents/code-reviewer.md`) with this prompt:

```
Review the uncommitted changes in this worktree. Check for:
- Pattern compliance (reference docs/patterns/ where applicable)
- Security issues
- Performance concerns
- Test quality
- Any domain-specific rules from your checklist

Report findings as a list. If no issues, say "LGTM".
```

### Step 7 — Address Feedback

- If the reviewer reported issues: fix them, then re-run Step 5 (Verify)
- If the reviewer said "LGTM": proceed to Step 8
- Cap at 2 review rounds. If still failing review after 2 fix attempts, this is a failure — go to the Failure path below

### Step 8 — Commit & Archive

1. Move the todo file to the archive:

   ```bash
   mv todos/<filename>.md todos/archive/<filename>.md
   ```

2. Stage all changed files including the archived todo:

   ```bash
   git add <all changed files> todos/archive/<filename>.md
   ```

3. Determine commit type from the todo's `labels`:
   - Labels containing `bug`, `fix` → `fix:`
   - Labels containing `refactor`, `duplication`, `architecture` → `refactor:`
   - Labels containing `feature`, `ui`, `remix` → `feat:`
   - Labels containing `test`, `testing` → `test:`
   - Labels containing `docs`, `documentation` → `docs:`
   - No match → `chore:`

4. Commit:
   ```bash
   git commit -m "<type>: <todo title>"
   ```

### Step 9 — Codify

Evaluate whether the implementation produced knowledge worth codifying:

- Did the code review surface non-obvious feedback?
- Did you discover a gotcha or pattern not already in `docs/patterns/` or `docs/LEARNINGS.md`?
- Did you use an approach that would benefit 3+ similar todos?

If YES to any: in the current implementation, codify inline in the executor by updating the relevant patterns, learnings, reviewer, and specialist-agent files directly.

```
Review the changes in the most recent commit. Determine if any finding should be codified as:
- A pattern → add to appropriate `docs/patterns/*.md` file
- A learning → add to `docs/LEARNINGS.md`
- A specialist agent update → add to the relevant `.claude/agents/*.md` checklist

Only codify items that are recurring, non-obvious, and project-specific. Skip standard fixes.
```

If codification produces changes, commit them separately:

```bash
git commit -m "docs: codify pattern from <todo title>"
```

If NO to all: skip this step. Most routine todos won't produce new patterns.

### Step 10 — Report

Return your result to the orchestrator. Format:

**On success:**

```
STATUS: success
COMMIT: <commit hash from Step 8>
CODIFICATION_COMMIT: <commit hash from Step 9, or "none">
FILES_CHANGED: <list of modified files>
REVIEW_ROUNDS: <0, 1, or 2>
```

**On failure:**

```
STATUS: failed
REASON: <what went wrong>
ATTEMPT: <1 or 2>
```

## Failure Path

**On first failure** (tests fail, type errors, lint errors, review fails after 2 rounds, or todo is ambiguous):

1. Revert all uncommitted changes: `git checkout -- .`
2. Analyze what went wrong — read test output, type errors, etc.
3. Retry implementation with a different approach (go back to Step 4)

**On second failure:**

1. Revert all uncommitted changes: `git checkout -- .`
2. Update the todo file — set `status: blocked` in YAML frontmatter
3. Add an Updates entry with today's date and failure reason:

   ```markdown
   ### YYYY-MM-DD

   - Blocked by automated executor: <reason>
   ```

4. Commit just the status update:
   ```bash
   git add todos/<filename>.md
   git commit -m "chore: mark <todo title> as blocked"
   ```
5. Report `failed` to orchestrator

````

- [ ] **Step 2: Verify the file was created correctly**

Read back `.claude/agents/todo-executor.md` and confirm:
- All 10 steps are present (Parse through Report)
- Documentation inventory table is complete (10 label rows)
- Failure path covers both attempts
- Code reviewer path is correct (`.claude/agents/code-reviewer.md`), and codification behavior is described inline in the executor rather than delegated to an active pattern-codifier agent

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/todo-executor.md
git commit -m "feat: add todo-executor agent for single-todo implementation"
````

---

### Task 2: Create the Todo Orchestrator Skill

The orchestrator reads the backlog, analyzes dependencies, dispatches executors, and produces a summary.

**Files:**

- Create: `.claude/skills/todo/SKILL.md`

- [ ] **Step 1: Write the skill file**

Create `.claude/skills/todo/SKILL.md` with the full orchestrator prompt. This is the complete content:

````markdown
---
name: todo
description: Autonomously work through the todos/ backlog — triage, implement, review, and archive todos in priority order
---

You are running the todo batch processing workflow. This skill triages the `todos/` backlog, analyzes dependencies between todos, dispatches executor agents (sequentially or in parallel), and produces a session summary.

## Phase 1 — Baseline

Establish a green baseline before touching any code:

```bash
npm run test:run
npm run check:types
```
````

Record the test count and type-check result. **If either fails, stop immediately** — do not start work on a broken codebase. Report the failure to the user and exit.

## Phase 2 — Triage

1. Read all `.md` files in `todos/` (excluding `README.md` and `TEMPLATE.md`)
2. Parse YAML frontmatter from each file. Extract: `title`, `status`, `priority`, `created`, `labels`
3. Filter to actionable todos: `status` is `backlog` or `planned`
   - Skip todos with status: `in-progress`, `blocked`, `review`, `done`
4. Sort the actionable list:
   - Primary: priority (`critical` > `high` > `medium` > `low`)
   - Secondary: `created` date (oldest first)
5. Display the work queue to the user:

```
## Work Queue (N todos)

| # | Priority | Title | Labels | Created |
|---|----------|-------|--------|---------|
| 1 | high | Consolidate cooking session stores | architecture, duplication | 2026-04-07 |
| 2 | medium | Extract round-to-one-decimal | ... | ... |
...
```

## Phase 3 — Dependency Analysis

For each todo in the work queue:

1. Read the full body (Implementation Notes, Acceptance Criteria sections)
2. Extract all file paths mentioned (patterns: `path/to/file.ts`, `path/to/file.ts:123-145`, backtick-quoted paths)
3. Build a file-overlap map: for each pair of todos, check if they share any mentioned file paths

**Partitioning rules:**

- Two todos are "dependent" if they mention any of the same files
- Todos that mention **no specific files** are treated as potentially conflicting with everything — they run sequentially
- Independent todos (no file overlap with each other) can run in parallel
- Maximum 4 parallel agents per group

Group the work queue into execution batches:

- Each batch contains either a single sequential todo OR a group of up to 4 independent todos
- Batches are ordered by the highest-priority todo they contain

Display the execution plan:

```
## Execution Plan

Batch 1 (parallel): consolidate-cooking-session-stores, extract-round-to-one-decimal, storage-facade-reexports
Batch 2 (sequential): fix-use-collapsible-height-test-type-error (no files mentioned — runs alone)
Batch 3 (parallel): remix-carousel-badge, remix-screen-reader-announcements
...
```

## Phase 4 — Execute

Process each batch in order:

### For parallel batches:

Spawn one `todo-executor` agent per todo, each in an isolated worktree:

```
Agent({
  description: "Execute todo: <todo title>",
  subagent_type: "general-purpose",
  isolation: "worktree",
  prompt: "You are a todo executor agent. Follow the instructions in .claude/agents/todo-executor.md exactly.\n\nYour todo file: todos/<filename>.md\n\nExecute all 10 steps and report the result."
})
```

Launch all agents in the batch simultaneously (up to 4).

### For sequential batches:

Spawn a single `todo-executor` agent (no worktree needed if only one):

```
Agent({
  description: "Execute todo: <todo title>",
  subagent_type: "general-purpose",
  prompt: "You are a todo executor agent. Follow the instructions in .claude/agents/todo-executor.md exactly.\n\nYour todo file: todos/<filename>.md\n\nExecute all 10 steps and report the result."
})
```

### After each batch completes:

- Collect results from all executors in the batch
- Record each result: `success` (with commit hash), `failed` (with reason), `blocked` (with reason), or `skipped`
- If any parallel executor made changes, pull them into the main branch before starting the next batch

## Phase 5 — Session Summary

After all batches are processed, produce the final report.

### Post-session verification

Run the full suite one final time to confirm no regressions:

```bash
npm run test:run
npm run check:types
npm run lint
```

Compare test count against the Phase 1 baseline. If anything regressed, flag it.

### Summary table

```
## Todo Session Summary — YYYY-MM-DD

| # | Todo | Status | Commit | Review Rounds | Notes |
|---|------|--------|--------|---------------|-------|
| 1 | consolidate-cooking-session-stores | completed | abc1234 | 1 | — |
| 2 | extract-round-to-one-decimal | completed | def5678 | 0 | Clean first pass |
| 3 | fix-use-collapsible-height-test-type-error | blocked | — | — | Type error in upstream dep |
| 4 | storage-facade-reexports | completed | ghi9012 | 2 | Codified: re-export pattern |
```

### Tallies

- **Completed:** N (list commit hashes)
- **Blocked:** M (list reasons)
- **Skipped:** S (non-actionable status)
- **Remaining:** X (todos not reached this session)
- **Patterns codified:** P
- **Final test count:** NNN (baseline was NNN — no regression / +N new tests)

### Verification result

- Tests: PASS / FAIL
- Types: PASS / FAIL
- Lint: PASS / FAIL

If any verification failed, list the failures and flag them for the user.

````

- [ ] **Step 2: Verify the file was created correctly**

Read back `.claude/skills/todo/SKILL.md` and confirm:
- YAML frontmatter has `name: todo` and a description
- All 5 phases are present (Baseline through Session Summary)
- Phase 3 dependency analysis includes the "no files mentioned" rule
- Phase 4 shows both parallel (worktree) and sequential agent dispatch
- Phase 5 includes post-session verification against baseline
- Agent dispatch prompts reference `.claude/agents/todo-executor.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/todo/SKILL.md
git commit -m "feat: add /todo orchestrator skill for batch todo processing"
````

---

### Task 3: Verify End-to-End Skill Registration

Confirm the skill is discoverable and the agent is referenceable.

**Files:**

- Verify: `.claude/skills/todo/SKILL.md`
- Verify: `.claude/agents/todo-executor.md`

- [ ] **Step 1: Verify skill is discoverable**

The skill should be auto-discovered by Claude Code from the `.claude/skills/todo/SKILL.md` path. Verify the file exists and the frontmatter is valid:

```bash
head -5 .claude/skills/todo/SKILL.md
```

Expected output:

```
---
name: todo
description: Autonomously work through the todos/ backlog — triage, implement, review, and archive todos in priority order
---
```

- [ ] **Step 2: Verify agent file exists**

```bash
head -3 .claude/agents/todo-executor.md
```

Expected output:

```
# Todo Executor Subagent

You are a specialized agent that implements a single todo item from the `todos/` folder.
```

- [ ] **Step 3: Verify referenced agents exist**

The executor references two existing agents. Confirm they exist:

```bash
ls -la .claude/agents/code-reviewer.md .claude/agents/pattern-codifier.md  # pattern-codifier is retained only as a deprecation note
```

Expected: both files listed, non-empty.

- [ ] **Step 4: Final commit (if any fixups needed)**

If Steps 1-3 revealed issues, fix them and commit:

```bash
git add .claude/skills/todo/ .claude/agents/todo-executor.md
git commit -m "fix: correct skill/agent registration issues"
```

If everything was clean, skip this step.
