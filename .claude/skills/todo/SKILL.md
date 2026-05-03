---
name: todo
description: Autonomously work through the todos/ backlog — triage, implement, review, and archive todos in priority order
---

You are running the todo orchestrator. This workflow triages the backlog, plans execution order, dispatches executor agents, and reports results. **Never skip phases.**

## Phase 1 — Baseline

Establish a green baseline before touching any code.

1. Run all three commands:
   ```bash
   npm run test:run
   npm run check:types
   npm run lint
   ```
2. Record the **test count** (e.g., "1327 tests passed"), the **type-check result** (e.g., "0 errors"), and the **lint result** (e.g., "0 warnings, 0 errors").
3. **Capture the base branch** before creating any worktrees:

   ```bash
   git branch --show-current
   ```

   If the output is empty (detached HEAD state), fall back to:

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

   If that also returns `HEAD`, stop immediately and report "cannot determine base branch — HEAD is detached. Please check out a named branch before running /todo." Do not proceed to Phase 2.

   Store the branch name as `BASE_BRANCH` (e.g., `feat/nutrition-inline-drawers` or `main`). Pass it to every executor spawn in Phase 4 via the `Base branch:` line in the prompt.

4. **If ANY command fails, stop immediately.** Report the failure to the user and exit — do not proceed to Phase 2. The codebase must be green before batch processing begins.

## Phase 2 — Triage

Build the work queue from the `todos/` backlog.

1. Read all `.md` files in `todos/` — **exclude** `README.md`, `TEMPLATE.md`, and anything inside `todos/archive/`.
2. Parse each file's YAML frontmatter. Extract: `title`, `status`, `priority`, `created`, `labels`.
3. Filter to **actionable** todos: status is `backlog` or `planned`. Skip any todo with status `in-progress`, `blocked`, `review`, or `done`.
4. Sort the actionable list:
   - **Priority** descending: `critical` > `high` > `medium` > `low`
   - Within the same priority, **oldest `created` date first** (FIFO)
5. Display the work queue as a markdown table:

   | #   | Priority | Title | Labels | Created |
   | --- | -------- | ----- | ------ | ------- |
   | 1   | high     | ...   | ...    | ...     |

   If the queue is empty, report "No actionable todos found" and exit.

## Phase 3 — Dependency Analysis

Determine which todos can safely run in parallel and which must run sequentially.

1. **Extract file paths** from each todo's full body (Implementation Notes, Acceptance Criteria, any other sections). Match these patterns:
   - Bare paths: `path/to/file.ts`
   - Paths with line ranges: `path/to/file.ts:123-145`
   - Backtick-quoted paths: `` `path/to/file.ts` ``
2. **Build a file-overlap map**: two todos are "dependent" if they share any mentioned file path (ignoring line ranges — file-level granularity).
3. **Check inter-todo dependencies.** Also parse each todo's Dependencies section. If a todo lists another todo filename as a dependency and that file still exists in `todos/` (not yet archived), it cannot run until after the dependency completes. Schedule it in a later batch, after the dependency's batch.
4. **Todos that mention NO specific files must run sequentially.** Unknown scope means they could potentially conflict with anything.
5. **Independent todos** (disjoint file sets, and each mentions at least one file) can run in parallel.
6. **Max 4 parallel agents per batch.** If more than 4 independent todos exist, split them into multiple batches.
7. **Group into execution batches** ordered by the highest-priority todo in each batch. Within a batch, maintain the priority/date sort from Phase 2.
8. Display the execution plan:

   ```
   Batch 1 (parallel — 3 todos):
     - [high] Extract suggestion generation service
     - [high] Storage facade re-exports
     - [medium] Extract round-to-one-decimal utility

   Batch 2 (sequential — scope unknown):
     - [medium] Remix screen reader announcements

   Batch 3 (parallel — 2 todos):
     - [low] Fix useCollapsible height test type error
     - [low] Extract toDateString utility
   ```

## Phase 4 — Execute

Work through the execution plan batch by batch.

### Parallel Batches

For each batch marked parallel, spawn one `todo-executor` agent per todo, each in an **isolated worktree**.

Substitute the actual branch name you recorded in Phase 1 (e.g., `feat/nutrition-inline-drawers`) for `<BASE_BRANCH>` in the prompt string. Never pass the literal text `<BASE_BRANCH>`.

Use the Agent tool with these parameters:

```
Agent({
  description: "Execute todo: <todo title>",
  subagent_type: "general-purpose",
  isolation: "worktree",
  prompt: "You are a todo executor agent. Follow the instructions in .claude/agents/todo-executor.md exactly.\n\nYour todo file: todos/<filename>.md\nBase branch: <BASE_BRANCH>\n\nExecute all 11 steps and report the result."
})
```

Launch all agents in the batch simultaneously (up to 4). Wait for all to complete before proceeding.

### Sequential Batches

For each batch marked sequential, spawn a **single** `todo-executor` agent.

Substitute the actual branch name you recorded in Phase 1 (e.g., `feat/nutrition-inline-drawers`) for `<BASE_BRANCH>` in the prompt string. Never pass the literal text `<BASE_BRANCH>`.

Run one at a time. Wait for each to complete before starting the next.

Use the Agent tool with these parameters:

```
Agent({
  description: "Execute todo: <todo title>",
  subagent_type: "general-purpose",
  isolation: "worktree",
  prompt: "You are a todo executor agent. Follow the instructions in .claude/agents/todo-executor.md exactly.\n\nYour todo file: todos/<filename>.md\nBase branch: <BASE_BRANCH>\n\nExecute all 11 steps and report the result."
})
```

### After Each Batch

1. **Collect results** from all agents in the batch. Each reports one of: `success`, `failed`, `blocked`, `skipped`.
2. **Record PR URLs and commit hashes** from successful executions. Each successful executor reports `PR_URL` (may be `null` if PR creation failed) and `COMMIT`.
3. **Run a post-batch type check** on the base branch to confirm it was not corrupted by the worktree setup:
   ```bash
   npm run check:types
   ```
   Run this on the BASE branch (not inside any worktree). If it fails, halt the session immediately and report to the user. Do not start the next batch.

If the type check passes, proceed to the next batch in the execution plan.

## Phase 5 — Session Summary

After all batches have been executed (or after early termination):

1. **Post-session verification** — run the full suite one final time:

   ```bash
   npm run test:run
   npm run check:types
   npm run lint
   ```

2. **Compare test count** against the Phase 1 baseline. Flag any regressions (fewer tests passing than before). New tests added by todos are expected and welcome.

3. **Print the summary table:**

   | #   | Todo                                  | Status  | PR                      | Review Rounds | Notes                               |
   | --- | ------------------------------------- | ------- | ----------------------- | ------------- | ----------------------------------- |
   | 1   | Extract suggestion generation service | success | github.com/…/pull/42    | 1             | —                                   |
   | 2   | Storage facade re-exports             | success | github.com/…/pull/43    | 2             | Medium review finding deferred      |
   | 3   | Remix screen reader announcements     | blocked | —                       | 0             | Depends on remix-carousel-badge     |
   | 4   | Fix useCollapsible height test        | failed  | —                       | 1             | Type error in mock setup            |
   | 5   | Fix calorie rounding utility          | success | pending manual creation | 1             | PR creation failed — push succeeded |

4. **Print tallies:**

   ```
   Completed: N (list PR URLs; note "PR pending manual creation" for any where PR_URL is null)
   Blocked:   M
   Skipped:   S
   Failed:    F
   Remaining: X (todos still in backlog after this session)
   Patterns codified: P
   Final test count: T (baseline was B)
   ```

5. **Print verification result:**
   ```
   Tests: PASS (T tests) | FAIL
   Types: PASS | FAIL (N errors)
   Lint:  PASS | FAIL (N errors)
   ```

## Rules

- **Baseline must be green.** Never start batch processing on a broken codebase.
- **Max 4 parallel agents.** Respect the limit to avoid overwhelming system resources and context.
- **Sequential when scope is unknown.** If a todo mentions no files, it runs alone — never assume it is safe to parallelize.
- **Verify after each batch.** Run `npm run check:types` on the base branch before starting the next batch. The full test suite runs only in Phase 5 — never run `npm run test:run` between batches. This is an accepted tradeoff: type-check only between batches trades speed for test-failure latency; if a batch introduces a test regression it won't surface until Phase 5.
- **The executor agent does the work.** This orchestrator only triages, dispatches, and summarizes. Never implement todo changes directly.
- **Archive happens in the executor.** Completed todos are moved to `todos/archive/` by the executor agent, not by this orchestrator.
- **Report everything.** Every todo in the queue must appear in the final summary table, even if skipped or blocked.
