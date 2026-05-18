---
name: todo
description: Use when you have todos in todos/ with status backlog or planned and want to implement them autonomously in parallel
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

4. **Verify executor agent**: Confirm the file `.claude/agents/todo-executor.md` exists by running:

   ```bash
   test -f .claude/agents/todo-executor.md && echo "found" || echo "missing"
   ```

   If missing, stop immediately and report "Cannot find .claude/agents/todo-executor.md — the executor agent is required. Please restore it before running /todo."

5. **Verify kimi-review is available**: Check that the required API key is set:

   ```bash
   if [[ -z "${WORKER_API_KEY:-}" && -z "${MOONSHOT_API_KEY:-}" ]]; then echo "missing"; else echo "found"; fi
   ```

   If `missing`, stop immediately and report "Cannot run kimi-review — neither WORKER_API_KEY nor MOONSHOT_API_KEY is set. Export one and retry."

6. **If ANY command fails or any check above returns missing, stop immediately.** Report the failure to the user and exit — do not proceed to Phase 2. The codebase must be green before batch processing begins.

## Phase 2 — Triage

Build the work queue from the `todos/` backlog.

1. Read all `.md` files in `todos/` — **exclude** `README.md`, `TEMPLATE.md`, and anything inside `todos/archive/`.
2. Parse each file's YAML frontmatter. Extract: `title`, `status`, `priority`, `created`, `labels`.
3. Filter to **actionable** todos: status is `backlog` or `planned`. Skip any todo with status `in-progress`, `blocked`, `review`, or `done`.

   > **Stuck todos**: If any file has `status: in-progress`, it was left mid-run by a crashed executor and is being skipped. To re-queue it, manually edit its frontmatter to `status: backlog` and re-run `/todo`.

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
  prompt: "You are a todo executor agent. Follow the instructions in .claude/agents/todo-executor.md exactly.\n\nYour todo file: todos/<filename>.md\nBase branch: <BASE_BRANCH>\n\nExecute all steps in order and report the result."
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
  prompt: "You are a todo executor agent. Follow the instructions in .claude/agents/todo-executor.md exactly.\n\nYour todo file: todos/<filename>.md\nBase branch: <BASE_BRANCH>\n\nExecute all steps in order and report the result."
})
```

### After Each Batch

1. **Collect results** from all agents in the batch. Each reports one of: `success`, `failed`, `blocked`, `skipped`.
2. **Record results** from successful executions. Each successful executor reports `COMMIT`, `BRANCH`, `PR_URL` (a URL, `skipped-low-priority`, or `null` if PR creation failed), and `DEFERRED_WARNINGS`. Keep the `DEFERRED_WARNINGS` lines — Phase 5 surfaces them for triage.

Proceed to the next batch in the execution plan.

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

   The **Branch / PR** column shows: the PR URL for medium+ todos; `branch: todo/<slug>` for low-priority todos (no PR was created — merge the branch directly); `pending manual creation` if PR creation failed.

   | #   | Todo                                  | Status  | Branch / PR             | Review Rounds | Notes                               |
   | --- | ------------------------------------- | ------- | ----------------------- | ------------- | ----------------------------------- |
   | 1   | Extract suggestion generation service | success | github.com/…/pull/42    | 1             | —                                   |
   | 2   | Storage facade re-exports             | success | branch: todo/storage-…  | 2             | low priority — no PR, merge branch  |
   | 3   | Remix screen reader announcements     | blocked | —                       | 0             | Depends on remix-carousel-badge     |
   | 4   | Fix useCollapsible height test        | failed  | —                       | 1             | Type error in mock setup            |
   | 5   | Fix calorie rounding utility          | success | pending manual creation | 1             | PR creation failed — push succeeded |

4. **Print tallies:**

   ```
   Completed: N (list PR URLs for medium+; list "branch: todo/<slug>" for low-priority todos; note "PR pending manual creation" for any where PR_URL is null)
   Blocked:   M
   Skipped:   S
   Failed:    F
   Remaining: X (todos still in backlog after this session)
   Patterns codified: P
   Final test count: T (baseline was B)
   ```

   Then **list deferred warnings for triage.** Collect every non-`none` `DEFERRED_WARNINGS` entry from all executors and print them under the heading "Deferred warnings — tell me which (if any) to turn into todos:". Nothing here is filed automatically; the user decides. If there are none, omit the heading.

5. **Print verification result:**

   ```
   Tests: PASS (T tests) | FAIL
   Types: PASS | FAIL (N errors)
   Lint:  PASS | FAIL (N errors)
   ```

6. **Clean up stale worktrees** left behind by crashed or cancelled executors:

   ```bash
   git worktree prune
   ```

## Rules

- **Baseline must be green.** Never start batch processing on a broken codebase.
- **Max 4 parallel agents.** Respect the limit to avoid overwhelming system resources and context.
- **Sequential when scope is unknown.** If a todo mentions no files, it runs alone — never assume it is safe to parallelize.
- **Top-level batch verification happens in Phase 5 only.** Do not run an extra orchestrator-level `npm run test:run` / `check:types` / `lint` pass between batches. Each executor still performs its own scoped verification inside the worktree before reporting success, and the orchestrator runs one final repo-level verification pass at the end.
- **The executor agent does the work.** This orchestrator only triages, dispatches, and summarizes. Never implement todo changes directly.
- **Archive happens in the executor.** Completed todos are moved to `todos/archive/` by the executor agent, not by this orchestrator.
- **Report everything.** Every todo in the queue must appear in the final summary table, even if skipped or blocked.
