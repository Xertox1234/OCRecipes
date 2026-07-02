---
name: todo
description: Use when you have todos in todos/ with status backlog or planned and want to implement them autonomously in parallel
---

You are running the todo orchestrator. This workflow cleans up prior runs, triages the backlog, plans execution order, dispatches executor agents, and reports results. **Never skip phases.**

## Phase 0 — Cleanup Sweep

Before anything else, clear leftovers from previous `/todo` runs. This phase **always runs** and **never aborts** the workflow — if a step fails (e.g. `gh` is unauthenticated), report it and continue to Phase 1.

1. **Force-remove leftover executor worktrees.** Executor worktrees are created _locked_, so `git worktree prune` alone silently skips them and they accumulate forever. Force-remove every one:

   ```bash
   git worktree list --porcelain | awk '/^worktree / && /\.claude\/worktrees\/agent-/ {print $2}' | while read -r wt; do
     git worktree unlock "$wt" 2>/dev/null
     git worktree remove --force "$wt" 2>/dev/null && echo "removed worktree: $wt"
   done
   git worktree prune
   ```

2. **Delete stale remote branches.** Every `/todo` run pushes a `todo/<slug>` branch for its PR; nothing deletes it after the PR merges, so they pile up on `origin`. Delete every remote branch whose PRs are all `MERGED` or `CLOSED` — but never one with an open PR, and never `main` or the current branch:

   ```bash
   git fetch --prune --quiet
   CURRENT=$(git branch --show-current)
   gh pr list --state open --limit 400 --json headRefName --jq '.[].headRefName' | sort -u > /tmp/todo-open-prs.txt
   gh pr list --state all  --limit 400 --json headRefName,state \
     --jq '.[] | select(.state=="MERGED" or .state=="CLOSED") | .headRefName' | sort -u > /tmp/todo-stale-prs.txt
   git branch -r --format='%(refname:short)' | sed 's#^origin/##' \
     | grep -vxE "HEAD|main|${CURRENT:-main}" | sort -u > /tmp/todo-remote-branches.txt
   comm -12 /tmp/todo-stale-prs.txt /tmp/todo-remote-branches.txt \
     | comm -23 - /tmp/todo-open-prs.txt > /tmp/todo-delete-branches.txt
   if [ -s /tmp/todo-delete-branches.txt ]; then
     xargs git push origin --delete < /tmp/todo-delete-branches.txt
     git fetch --prune --quiet
   fi
   ```

   If `gh` is unavailable or unauthenticated, skip this step (worktree cleanup in step 1 still ran) and continue.

3. **Report** what was cleaned: count of worktrees removed and the list of remote branches deleted (or "nothing to clean").

4. **Sync the local default branch (`main`).** PRs from prior runs land via the user's batch-merge (possibly from another session), so those todos may already be archived on `origin/main` while the local checkout still shows them at the old path — and the backlog would otherwise re-pick an already-merged todo. Fast-forward local `main`. Like the rest of Phase 0 this **never aborts** the run, and it is **ff-only so it never disturbs parallel work**:

   ```bash
   git fetch origin main --quiet || true
   CUR=$(git branch --show-current)
   if [ "$CUR" = "main" ] || [ "$CUR" = "master" ]; then
     if [ -z "$(git status --porcelain)" ]; then
       git pull --ff-only -q origin "$CUR" 2>/dev/null && echo "synced local $CUR with origin" \
         || echo "local $CUR not fast-forwardable — skipping (pull manually)"
     else
       echo "skipped main sync — working tree dirty"
     fi
   else
     # Not on the default branch: fast-forward the local main ref without touching the
     # current branch/working tree. Refuses (harmlessly) if it would not be a fast-forward.
     git fetch origin main:main 2>/dev/null && echo "fast-forwarded local main ref" \
       || echo "local main not fast-forwardable — pull manually when on main"
   fi
   ```

   Then proceed to Phase 1.

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

   **Then capture the main checkout's absolute path** using `git rev-parse --git-common-dir` (worktree-aware — `pwd` would be wrong if `/todo` is invoked from inside another worktree):

   ```bash
   MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
   ```

   > **Important:** Shell state does not persist between tool calls — each Bash call runs in a fresh shell. Record the literal output of this command (e.g. `/Users/yourname/projects/OCRecipes`) and substitute it wherever `<MAIN_CHECKOUT>` appears in the spawn prompts below and in the executor's instructions. Do not re-run this command in later phases; use the saved value.

   Store as `MAIN_CHECKOUT` (e.g., `/Users/williamtower/projects/OCRecipes`). Pass it to every executor spawn in Phase 4 via the `Main checkout:` line in the prompt. Executors use it to write gitignored artifacts (`docs/solutions/...`) to the main checkout rather than to their own worktree (where `git worktree remove` would destroy them — same gitignore/worktree pitfall the `/audit` skill fixed); after writing each solution file the executor runs `npm run solutions:db:add -- <that-file>` so the canonical DB and its mirror are updated (see `/codify`).

4. **Verify executor agent**: Confirm the file `.claude/agents/todo-executor.md` exists by running:

   ```bash
   test -f .claude/agents/todo-executor.md && echo "found" || echo "missing"
   ```

   If missing, stop immediately and report "Cannot find .claude/agents/todo-executor.md — the executor agent is required. Please restore it before running /todo."

5. **If ANY command fails or any check above returns missing, stop immediately.** Report the failure to the user and exit — do not proceed to Phase 2. The codebase must be green before batch processing begins.

## Phase 2 — Triage

Build the work queue from the `todos/` backlog.

1. Read all `.md` files in `todos/` — **exclude** `README.md`, `TEMPLATE.md`, anything inside `todos/archive/`, and anything inside `todos/deployment/` (deployment/scaling work is parked until launch is financially viable).
2. Parse each file's YAML frontmatter. Extract: `title`, `status`, `priority`, `created`, `labels`.
3. Filter to **actionable** todos: status is `backlog` or `planned`. Skip any todo with status `in-progress`, `blocked`, `review`, or `done`.

   > **Stuck todos**: If any file has `status: in-progress`, it was left mid-run by a crashed executor and is being skipped. To re-queue it, manually edit its frontmatter to `status: backlog` and re-run `/todo`.

   **Awaiting batch-merge (skip).** A completed todo's archive move rides its unmerged PR branch, so the local `todos/*.md` still says `backlog` until the user batch-merges — triage must not re-pick it. Fetch open PR head branches once: `gh pr list --state open --limit 200 --json headRefName --jq '.[].headRefName'`. Skip any actionable todo whose slug (filename minus `.md`) matches an open `todo/<slug>` branch — it is already implemented and awaiting batch-merge; re-dispatching would re-implement it and collide with its own open PR. Carry the skipped set in orchestrator state and list it in the Phase 5 summary under "Awaiting batch-merge". If `gh` is unavailable, continue without this check (the executor's push-collision guard is the downstream backstop).

4. **Quality check.** Catching authoring problems here is much cheaper than spawning a researcher + executor only to have them fail on an incoherent spec. For each actionable todo, scan the body and record any flag that fires:
   - **empty-AC** — the Acceptance Criteria section is missing or contains no `- [ ]` checkbox lines.
   - **thin-IN** — the Implementation Notes section body (text between its heading and the next heading) is shorter than 50 characters after trimming whitespace.
   - **no-files** — the body contains no file reference matching the patterns Phase 3 uses for extraction (`path/to/file.ts`, `path/to/file.ts:123-145`, or backtick-quoted paths).

   Record each flagged todo with the comma-joined list of triggered flags. Multiple flags are possible.

5. Sort the actionable list:
   - **Priority** descending: `critical` > `high` > `medium` > `low`
   - Within the same priority, **oldest `created` date first** (FIFO)
6. Display the work queue as a markdown table with a `Quality` column showing `OK` or the comma-joined flag list:

   | #   | Priority | Title | Quality | Labels | Created |
   | --- | -------- | ----- | ------- | ------ | ------- |
   | 1   | high     | ...   | OK      | ...    | ...     |
   | 2   | medium   | ...   | thin-IN | ...    | ...     |

   **Default behavior:** only todos with `Quality = OK` proceed to Phase 3 and beyond. Flagged todos are dropped from this run's queue and surfaced again in the Phase 5 summary under "Skipped — quality flags" so the user can re-author them and re-run. The dropped set must be carried in orchestrator state for Phase 5.

   If every actionable todo is flagged, report "All actionable todos failed quality checks — re-author and re-run." and exit. If the queue is empty (no actionable todos at all), report "No actionable todos found" and exit.

## Phase 3 — Dependency Analysis

Determine which todos can safely run in parallel and which must run sequentially.

1. **Extract file paths** from each todo's full body (Implementation Notes, Acceptance Criteria, any other sections). Match these patterns:
   - Bare paths: `path/to/file.ts`
   - Paths with line ranges: `path/to/file.ts:123-145`
   - Backtick-quoted paths: `` `path/to/file.ts` ``
2. **Build a file-overlap map**: two todos are "dependent" if they share any mentioned file path (ignoring line ranges — file-level granularity).
3. **Check inter-todo dependencies.** Also parse each todo's Dependencies section. If a todo lists another todo filename as a dependency and that file still exists in `todos/` (not yet archived on `main`), do **not** schedule the dependent in this run at all — even if the dependency completes in an earlier batch, its archive lands on `main` only when the user merges its PR, so a same-run dispatch of the dependent is guaranteed to report `blocked` (wasted worktree + researcher + executor). Skip it with reason `gated on merging <dependency>'s PR` and list it in the Phase 5 summary under "Gated on batch-merge".
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

9. **Advisor review of the parallelization plan (gated).** Call the `advisor` tool before dispatching Phase 4 **only when the plan contains at least one parallel batch of 2+ todos**. Skip it for an all-sequential or single-todo plan — those run one executor at a time and cannot hit the parallel-collision failure this gate exists to catch, so the round-trip is not worth it. (If the advisor tool is not available in the session, skip this step.)

   The advisor sees this orchestrator's full transcript — the todo bodies, the file-overlap map from steps 1–2, and the batch plan — and reviews exactly one question: **is any parallel batch unsafe?** Could two todos in the same parallel batch touch the same file (a shared import, a barrel file, or a type the overlap analysis missed), and is anything marked parallel that should be sequential? Two executors editing one file in separate worktrees produce conflicting branches and stacked PRs — expensive and hard to unwind once agents are live.

   Nothing has executed yet, so revising is cheap. If the advisor flags a risky pairing, split the conflicting todos into separate batches (or make the batch sequential), re-display the revised plan, then proceed. Weigh the advice seriously, but it is advisory: if a flag is clearly wrong (the files genuinely do not overlap), note why and continue.

## Phase 4 — Execute

Work through the execution plan batch by batch.

### Parallel Batches

For each batch marked parallel, spawn one `todo-executor` agent per todo, each in an **isolated worktree**.

Substitute the actual branch name you recorded in Phase 1 (e.g., `feat/nutrition-inline-drawers`) for `<BASE_BRANCH>` and the actual main checkout path (e.g., `/Users/williamtower/projects/OCRecipes`) for `<MAIN_CHECKOUT>` in the prompt string. Never pass the literal text `<BASE_BRANCH>` or `<MAIN_CHECKOUT>`.

Use the Agent tool with these parameters:

```
Agent({
  description: "Execute todo: <todo title>",
  subagent_type: "general-purpose",
  isolation: "worktree",
  prompt: "You are a todo executor agent. Follow the instructions in .claude/agents/todo-executor.md exactly.\n\nYour todo file: todos/<filename>.md\nBase branch: <BASE_BRANCH>\nMain checkout: <MAIN_CHECKOUT>\n\nExecute all steps in order and report the result."
})
```

Launch all agents in the batch simultaneously (up to 4). Wait for all to complete before proceeding.

### Sequential Batches

For each batch marked sequential, spawn a **single** `todo-executor` agent.

Substitute the actual branch name you recorded in Phase 1 (e.g., `feat/nutrition-inline-drawers`) for `<BASE_BRANCH>` and the actual main checkout path (e.g., `/Users/williamtower/projects/OCRecipes`) for `<MAIN_CHECKOUT>` in the prompt string. Never pass the literal text `<BASE_BRANCH>` or `<MAIN_CHECKOUT>`.

Run one at a time. Wait for each to complete before starting the next.

Use the Agent tool with these parameters:

```
Agent({
  description: "Execute todo: <todo title>",
  subagent_type: "general-purpose",
  isolation: "worktree",
  prompt: "You are a todo executor agent. Follow the instructions in .claude/agents/todo-executor.md exactly.\n\nYour todo file: todos/<filename>.md\nBase branch: <BASE_BRANCH>\nMain checkout: <MAIN_CHECKOUT>\n\nExecute all steps in order and report the result."
})
```

### After Each Batch

1. **Collect results** from all agents in the batch. Each reports one of: `success`, `failed`, `blocked`, `skipped`.
2. **Record results** from successful executions. Each successful executor reports `COMMIT`, `BRANCH`, `PR_URL` (a URL, or `null` if PR creation failed), `MERGE_ELIGIBLE` (`yes` = guard OK, safe for the user's batch-merge; `held` = guard flagged a sensitive/non-allowlisted path; `review-required` = high/critical/security; `unknown` = guard couldn't evaluate; `n/a` = no PR), `SHORT_CIRCUIT` (a `docs/solutions` path if a verified solution was reused and the researcher skipped, else `none`), `ADVISOR` (`green`, `yellow`, `red`, or `skipped`), and `DEFERRED_WARNINGS`. Keep the `DEFERRED_WARNINGS` lines — Phase 5 surfaces them for triage. Keep the `ADVISOR` values — Phase 5 tallies them.

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

   The **Branch / PR** column shows the PR URL for every todo (all priorities open a PR, and **no PR ever auto-merges** — everything waits for the user's batch-merge). Key off each todo's `MERGE_ELIGIBLE`: `yes` → "ready for batch-merge"; `held` → "held — sensitive path, needs review"; `review-required` → "needs individual review"; `unknown` → "guard couldn't evaluate — review by hand". Show `pending manual creation` if PR creation failed.

   | #   | Todo                                  | Status  | Branch / PR             | Review Rounds | Notes                               |
   | --- | ------------------------------------- | ------- | ----------------------- | ------------- | ----------------------------------- |
   | 1   | Extract suggestion generation service | success | github.com/…/pull/42    | 1             | —                                   |
   | 2   | Storage facade re-exports             | success | github.com/…/pull/43    | 2             | ready for batch-merge               |
   | 3   | Remix screen reader announcements     | blocked | —                       | 0             | Depends on remix-carousel-badge     |
   | 4   | Fix useCollapsible height test        | failed  | —                       | 1             | Type error in mock setup            |
   | 5   | Fix calorie rounding utility          | success | pending manual creation | 1             | PR creation failed — push succeeded |

4. **Print tallies:**

   ```
   Completed: N (list PR URLs; mark "ready for batch-merge" ONLY for `MERGE_ELIGIBLE: yes`; for `held`/`review-required`/`unknown` mark "PR open — needs individual review". NO PR is self-completing — none auto-merge; note "PR pending manual creation" for any where PR_URL is null)
   Blocked:   M
   Skipped:   S
   Failed:    F
   Remaining: X (todos still in backlog after this session)
   Patterns codified: P
   Short-circuited: SC (todos that reused a verified solution and skipped research; list the docs/solutions paths)
   Advisor: G green, Y yellow, R red, S skipped (not available)
   Final test count: T (baseline was B)
   ```

   Then **list quality-flagged todos that were skipped from this run.** Using the dropped set carried over from Phase 2 step 6, print them under the heading "Skipped — quality flags — re-author and re-run to include them:" with one line per todo (todo filename + comma-joined flag list). If none were dropped, omit the heading.

   Then **list PRs ready for batch-merge.** Print every `MERGE_ELIGIBLE: yes` PR under the heading "Ready for batch-merge — say the word and I'll verify green CI + clean tree and squash-merge them:". Nothing merges until the user asks. When they do, for each PR: **re-run `scripts/todo-automerge-guard.sh <n>`** (the overnight classification is advisory — it goes stale if the PR was amended after the executor ran it; exit 0 required), verify CI is green and the local tree is clean (`git status --porcelain`), then `gh pr merge <n> --squash --delete-branch`, skipping any that conflict or now HOLD. This Phase 5 flow is the **single canonical batch-merge procedure** — other docs point here rather than restating it.

   Then **list todos awaiting batch-merge and gated dependents.** Print the Phase 2 "Awaiting batch-merge" skip set (already implemented — PR open from a prior run) and the Phase 3 "Gated on batch-merge" set (dependent todos whose dependency's PR must merge first), each with the PR to merge to unblock them. These are not failures; they clear on the next run after the user merges.

   Then **list deferred warnings for triage.** Collect every non-`none` `DEFERRED_WARNINGS` entry from all executors and print them under the heading "Deferred warnings — tell me which (if any) to turn into todos:". Nothing here is filed automatically; the user decides. If there are none, omit the heading.

   Then **surface actionable blocks.** Dependency-blocks do NOT resolve on their own — they clear only after the user merges the dependency's PR (they belong under "Gated on batch-merge" above, with the PR to merge named). If a `blocked` result's REASON is a **diverged remote `todo/*` branch with no open PR** (it contains `ACTION NEEDED`), print that REASON verbatim under the heading "Blocked — needs a one-time manual fix:" — it will re-block every run until the human clears the stale branch (the executor's reason includes the exact `git push origin --delete …` + re-run steps). Do NOT bury it as an ordinary dependency row.

5. **Print verification result:**

   ```
   Tests: PASS (T tests) | FAIL
   Types: PASS | FAIL (N errors)
   Lint:  PASS | FAIL (N errors)
   ```

6. **Remove this run's executor worktrees.** Force-remove them — a bare `git worktree prune` cannot, because they are created _locked_:

   ```bash
   git worktree list --porcelain | awk '/^worktree / && /\.claude\/worktrees\/agent-/ {print $2}' | while read -r wt; do
     git worktree unlock "$wt" 2>/dev/null
     git worktree remove --force "$wt" 2>/dev/null && echo "removed worktree: $wt"
   done
   git worktree prune
   ```

   This removes worktree directories only — branches and their open PRs are unaffected.

7. **Sync the local default branch with this run's merges.** A `/todo` archive (and its code change) only reaches the local working copy when the merge propagates back — nothing edits local `todos/` in place. After the run, fast-forward local `main` so any PR that merged _during_ this session (a user-requested batch-merge) is reflected locally — **ff-only, never disturbs parallel work**:

   ```bash
   git fetch origin main --quiet || true
   CUR=$(git branch --show-current)
   if { [ "$CUR" = "main" ] || [ "$CUR" = "master" ]; } && [ -z "$(git status --porcelain)" ]; then
     git pull --ff-only -q origin "$CUR" 2>/dev/null && echo "synced local $CUR with origin" \
       || echo "local $CUR not fast-forwardable — pull manually"
   else
     git fetch origin main:main 2>/dev/null && echo "fast-forwarded local main ref" \
       || echo "local main not fast-forwardable — pull manually when on main + clean"
   fi
   ```

   **Open PRs land only via the user's batch-merge** — any still `OPEN` here merges later and cannot be pulled now. List each in the summary; the **next** `/todo` run's Phase 0 sync picks up post-merge state automatically.

## Rules

- **Baseline must be green.** Never start batch processing on a broken codebase.
- **Max 4 parallel agents.** Respect the limit to avoid overwhelming system resources and context.
- **Sequential when scope is unknown.** If a todo mentions no files, it runs alone — never assume it is safe to parallelize.
- **Advisor-gate parallel batches.** Before dispatching any plan with a parallel batch of 2+ todos, run the Phase 3 advisor review — catching an unsafe pairing before agents spin up is far cheaper than untangling stacked PRs after.
- **Top-level batch verification happens in Phase 5 only.** Do not run an extra orchestrator-level `npm run test:run` / `check:types` / `lint` pass between batches. Each executor still performs its own scoped verification inside the worktree before reporting success, and the orchestrator runs one final repo-level verification pass at the end.
- **The executor agent does the work.** This orchestrator only triages, dispatches, and summarizes. Never implement todo changes directly.
- **Archive happens in the executor.** Completed todos are moved to `todos/archive/` by the executor agent, not by this orchestrator.
- **Report everything.** Every todo in the queue must appear in the final summary table, even if skipped or blocked.
- **Self-cleaning.** Phase 0 force-removes leftover worktrees and deletes remote branches whose PRs are all merged or closed; Phase 5 removes this run's worktrees. The user must never have to clean up `todo/*` branches or `agent-*` worktrees by hand.
- **No auto-merge, ever.** Executors never run `gh pr merge`; every PR waits for the user's batch-merge. The orchestrator merges only when the user explicitly asks in Phase 5, after verifying green CI and a clean tree.
- **Auto-sync local `main`.** Phase 0 fast-forwards local `main` at the start (catching merges from prior sessions, which also stops the backlog from re-picking an already-archived todo) and Phase 5 fast-forwards again at the end (catching this run's merges). Always **ff-only** so parallel work is never disturbed — the user must never have to `git pull` by hand to see a completed todo archived locally.
