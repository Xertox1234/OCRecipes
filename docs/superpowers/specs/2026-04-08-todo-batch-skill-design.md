# Todo Batch Processing Skill — Design Spec

## Overview

A `/todo` skill that autonomously works through the project's `todos/` backlog in priority order, implementing, testing, reviewing, and archiving each todo. Paired with a `todo-executor` agent that handles single-todo implementation.

## Architecture

Two components:

1. **`/todo` Skill** (`.claude/skills/todo/SKILL.md`) — Orchestrator that triages, analyzes dependencies, dispatches executors, and produces a session summary
2. **`todo-executor` Agent** (`.claude/agents/todo-executor.md`) — Implements a single todo end-to-end: parse, implement, verify, code review, commit, codify

## Orchestrator Flow (`/todo` Skill)

### Phase 1 — Baseline

- Run `npm run test:run` and `npm run check:types` to establish a green baseline
- If baseline fails, stop immediately — don't start work on a broken codebase

### Phase 2 — Triage

- Read all `.md` files in `todos/` (excluding `README.md`, `TEMPLATE.md`)
- Parse YAML frontmatter for `status`, `priority`, `created`
- Filter to actionable todos: status is `backlog` or `planned` (skip `in-progress`, `blocked`, `review`, `done`)
- Sort: `critical` > `high` > `medium` > `low`, then oldest `created` date first
- Build the **work queue** — the ordered list of todos to process

### Phase 3 — Dependency Analysis

- For each todo, extract mentioned file paths from the body (Implementation Notes, Acceptance Criteria)
- Build a file-overlap graph: two todos are "dependent" if they reference any of the same files
- Partition into **independent groups** — todos with no file overlap can run in parallel
- Cap parallel group size at 4

### Phase 4 — Execute

- Process groups in priority order
- For independent groups: spawn parallel executor agents in worktrees
- For sequential items (or items overlapping with the current group): wait and run next
- Each executor reports back: `success` (with commit hash) or `failed` (with reason)

### Phase 5 — Session Summary

Print a terminal report (no file written):

```
## Todo Session Summary — YYYY-MM-DD

| # | Todo | Status | Commit | Review Rounds | Notes |
|---|------|--------|--------|---------------|-------|
| 1 | example-todo | completed | abc1234 | 1 | — |
| 2 | another-todo | blocked | — | — | Reason for failure |
```

Tallies:

- Completed: N (with commit hashes)
- Blocked: M (with reasons)
- Remaining in queue: X (todos not reached this session)
- Patterns codified: P
- Final test count: confirms no regression from baseline

Post-session verification:

- Run `npm run test:run` + `npm run check:types` + `npm run lint` one final time
- If anything regressed from baseline, flag immediately

## Executor Flow (`todo-executor` Agent)

### Step 1 — Parse

- Read the todo markdown file
- Extract: title, status, priority, acceptance criteria, implementation notes, dependencies, labels

### Step 2 — Pre-flight

- If the todo lists dependencies on other todos, check if those files still exist in `todos/` (not yet archived). If they do, report `blocked` — the dependency hasn't been completed yet

### Step 3 — Research

Read only what's relevant — don't read everything. Select by label and affected file paths.

**Documentation inventory:**

| Label                         | Pattern docs to read                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `security`                    | `docs/patterns/security.md`                                                                     |
| `architecture`, `duplication` | `docs/patterns/architecture.md`                                                                 |
| `ui`                          | `docs/patterns/react-native.md`, `docs/patterns/design-system.md`, `docs/patterns/animation.md` |
| `performance`                 | `docs/patterns/performance.md`                                                                  |
| `testing`                     | `docs/patterns/testing.md`                                                                      |
| `database`                    | `docs/patterns/database.md`                                                                     |
| `api`                         | `docs/patterns/api.md`                                                                          |
| `hooks`                       | `docs/patterns/hooks.md`                                                                        |
| `typescript`, `types`         | `docs/patterns/typescript.md`                                                                   |
| `client-state`                | `docs/patterns/client-state.md`                                                                 |

Other key docs (read when relevant, not always):

- `docs/LEARNINGS.md` — bug post-mortems and gotchas (grep for affected file/domain)
- `docs/patterns/documentation.md` — only if the todo involves docs changes
- `CLAUDE.md` — fallback if no labels match; skim the "Key Patterns" section

**Prior art** — Grep `todos/archive/` for completed todos that touched the same files (learn from how they were solved)

**Source context** — Read the full files being modified (not just the lines mentioned in the todo) to understand surrounding code

### Step 4 — Implement

- Use acceptance criteria as the definition of done
- Use implementation notes as guidance (not prescription — may find a better approach)
- Apply patterns and conventions learned in the Research step

### Step 5 — Verify

- Run `npm run test:run` — all tests must pass
- Run `npm run check:types` — zero type errors
- Run `npm run lint` — zero lint errors
- Re-read modified files to confirm changes match acceptance criteria

### Step 6 — Code Review

- Spawn the `code-reviewer` subagent (`.claude/agents/code-reviewer.md`) against the uncommitted diff
- Reviewer checks: pattern compliance, security, performance, test quality, domain-specific rules

### Step 7 — Address Feedback

- If reviewer finds issues: fix them, re-run verification (Step 5)
- If clean: proceed
- Cap at 2 review rounds — if still failing review after 2 fix attempts, treat as failure

### Step 8 — Commit & Archive

- Stage changed files + the archived todo
- Move the todo file from `todos/` to `todos/archive/`
- Commit with conventional message derived from labels:
  - Labels map to: `fix:`, `refactor:`, `feat:`, `test:`, `docs:` — fallback to `chore:`
  - Message format: `<type>: <todo title> (resolves todo)`

### Step 9 — Codify

- If the code review surfaced non-obvious feedback or the implementation established a reusable pattern, run the `pattern-codifier` agent (`.claude/agents/pattern-codifier.md`)
- Codifier decides: add to `docs/patterns/*.md`, `docs/LEARNINGS.md`, or update specialist agents (same decision matrix as the audit skill)
- If nothing worth codifying, skip — most routine todos won't produce new patterns
- Codification changes get a separate commit: `docs: codify pattern from <todo title>`

### Step 10 — Report

Return to orchestrator:

- Success: `{ status: "success", commitHash, codificationCommitHash?, filesChanged, reviewRounds }`
- Failed: `{ status: "failed", reason, attempt }`

## Error Handling

### Retry Budget

- On first failure (tests fail, type errors, lint errors, or ambiguous todo): revert all uncommitted changes, analyze what went wrong, retry with a different approach
- On second failure: revert all uncommitted changes, update the todo file with `status: blocked` and an Updates entry with today's date and failure reason, commit just the status update, report `failed` to orchestrator

### Failure Modes

| Failure                              | Action                             |
| ------------------------------------ | ---------------------------------- |
| Baseline fails                       | Stop session immediately           |
| Todo has unmet dependency            | Skip, report `blocked`             |
| Tests fail after implementation      | Retry once with different approach |
| Code review fails after 2 fix rounds | Revert, mark `blocked`             |
| Type errors or lint errors           | Treat same as test failure         |
| Post-session verification regression | Flag immediately in summary        |

## Parallelism Strategy

- Extract file paths mentioned in each todo's Implementation Notes and Acceptance Criteria
- Two todos are "dependent" if they mention any overlapping files
- Todos that mention no specific files are treated as potentially conflicting with everything — they run sequentially (safest default since their scope is unknown)
- Independent todos are grouped and dispatched as parallel worktree-isolated subagents
- Maximum 4 parallel agents per group (per project convention)
- Groups are processed in priority order — highest-priority group runs first, then next group after it completes

## Files

| File                              | Purpose                                  |
| --------------------------------- | ---------------------------------------- |
| `.claude/skills/todo/SKILL.md`    | Orchestrator skill (invoked via `/todo`) |
| `.claude/agents/todo-executor.md` | Single-todo executor agent               |

## Dependencies

- Existing `.claude/agents/code-reviewer.md` — used in Step 5
- Existing `.claude/agents/pattern-codifier.md` — used in Step 8
- `todos/TEMPLATE.md` — defines the frontmatter schema
- `todos/archive/` — destination for completed todos
