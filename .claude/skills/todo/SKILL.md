---
name: todo
description: Use when you have todos in todos/ with status backlog or planned and want to implement them autonomously in parallel
---

You are running the todo orchestrator. This workflow cleans up prior runs, triages the backlog, plans execution order, dispatches executor agents, and reports results. **Never skip phases.**

## Phase 0 — Cleanup Sweep

Before anything else, clear leftovers from previous `/todo` runs. This phase **always runs** and **never aborts** the workflow — if a step fails (e.g. `gh` is unauthenticated), report it and continue to Phase 1.

1. **Force-remove leftover executor worktrees.** Executor worktrees are created _locked_, so `git worktree prune` alone silently skips them and they accumulate forever. Force-remove every one. Use the non-`--porcelain` form and expand a leading `~` manually — some environments proxy `git` (e.g. this project's `rtk` hook, see CLAUDE.md/RTK.md) and rewrite `--porcelain`'s output into a condensed, non-standard single-line format with `~`-shorthand paths, which breaks a `^worktree ` anchor silently (zero matches, no error) and which `read`-into-a-variable does not tilde-expand at use time:

   ```bash
   git worktree list | awk '/\.claude\/worktrees\/agent-/ {print $1}' | while read -r wt; do
     wt="${wt/#\~/$HOME}"
     git worktree unlock "$wt" 2>/dev/null
     git worktree remove --force "$wt" 2>/dev/null && echo "removed worktree: $wt"
   done
   git worktree prune
   ```

2. **Delete stale remote branches.** Every `/todo` run pushes a `todo/<slug>` branch for its PR; nothing deletes it after the PR merges, so they pile up on `origin`. Delete every remote branch whose PRs are **all `MERGED`** — but never one with an open PR, never one whose PR was closed WITHOUT merging (that is a rejection signal, not cleanup — see below), and never `main` or the current branch:

   ```bash
   git fetch --prune --quiet
   CURRENT=$(git branch --show-current)
   # Start clean: sweep outputs must never survive from a previous run — a skipped sweep
   # (gh failure / limit cap) would otherwise leave stale lists for later steps to trust.
   rm -f /tmp/todo-open-prs.txt /tmp/todo-delete-branches.txt /tmp/todo-closed-unmerged-branches.txt
   # ONE fetch of every PR; the open/merged/closed views below derive from it. gh returns
   # newest-first, so a truncated fetch silently drops the OLDEST PRs — exactly the ones
   # the sweep needs. If the returned count EQUALS the limit, treat the sweep as
   # unreliable: keep the open-PR list (best available data for Phase 2) but skip branch
   # deletion this run and note the skip in the Phase 5 summary.
   gh pr list --state all --limit 1000 --json headRefName,state > /tmp/todo-all-prs.json \
     || { rm -f /tmp/todo-all-prs.json; echo "gh pr list failed — step SKIPPED"; }
   if [ -s /tmp/todo-all-prs.json ]; then
     jq -r '.[] | select(.state=="OPEN")   | .headRefName' /tmp/todo-all-prs.json | sort -u > /tmp/todo-open-prs.txt
     if [ "$(jq 'length' /tmp/todo-all-prs.json)" -eq 1000 ]; then
       echo "PR fetch hit the --limit cap — sweep unreliable; skipping branch deletion this run"
     else
       jq -r '.[] | select(.state=="MERGED") | .headRefName' /tmp/todo-all-prs.json | sort -u > /tmp/todo-merged-prs.txt
       jq -r '.[] | select(.state=="CLOSED") | .headRefName' /tmp/todo-all-prs.json | sort -u > /tmp/todo-closed-prs.txt
       git branch -r --format='%(refname:short)' | sed 's#^origin/##' \
         | grep -vxE "HEAD|main|${CURRENT:-main}" | sort -u > /tmp/todo-remote-branches.txt
       # Delete only all-MERGED branches: ≥1 merged PR, no open PR, no closed-unmerged PR.
       comm -12 /tmp/todo-merged-prs.txt /tmp/todo-remote-branches.txt \
         | comm -23 - /tmp/todo-open-prs.txt \
         | comm -23 - /tmp/todo-closed-prs.txt > /tmp/todo-delete-branches.txt
       # Closed WITHOUT merging and no open PR = a rejected implementation — never sweep
       # it silently; carry this list to the Phase 5 attention section.
       comm -12 /tmp/todo-closed-prs.txt /tmp/todo-remote-branches.txt \
         | comm -23 - /tmp/todo-open-prs.txt > /tmp/todo-closed-unmerged-branches.txt
       if [ -s /tmp/todo-delete-branches.txt ]; then
         xargs git push origin --delete < /tmp/todo-delete-branches.txt
         git fetch --prune --quiet
       fi
     fi
   fi
   ```

   If the `gh` call fails (unavailable, unauthenticated, network), the block above deletes the temp file and this step is **SKIPPED** — no stale `/tmp` lists survive for later phases to trust, no branch deletion happens, and Phase 2 fetches its own open-PR list (worktree cleanup in step 1 still ran). Continue.

3. **Report** what was cleaned: count of worktrees removed and the list of remote branches deleted (or "nothing to clean"). If `/tmp/todo-closed-unmerged-branches.txt` is non-empty, or the sweep was skipped (gh failure or the `--limit` cap), carry that in orchestrator state — Phase 5 surfaces both.

4. **Sync the local default branch (`main`).** PRs from prior runs land via auto-merge or the user's review (possibly from another session), so those todos may already be archived on `origin/main` while the local checkout still shows them at the old path — and the backlog would otherwise re-pick an already-merged todo. Fast-forward local `main`. Like the rest of Phase 0 this **never aborts** the run, and it is **ff-only so it never disturbs parallel work**:

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

   Store as `MAIN_CHECKOUT` (e.g., `/Users/williamtower/projects/OCRecipes`). Pass it to every executor spawn in Phase 4 via the `Main checkout:` line in the prompt. Executors use it to resolve paths outside their worktree when a gitignored artifact must survive worktree teardown (same gitignore/worktree pitfall the `/audit` skill fixed). Solution files (`docs/solutions/...`) are git-tracked: executors write them worktree-relative and commit them on the todo branch (see `/codify`).

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

   **Awaiting merge (skip).** A completed todo's archive move rides its unmerged PR branch, so the local `todos/*.md` still says `backlog` until that PR merges (auto-merge or the user's review) — triage must not re-pick it. Reuse **this run's** open-PR list from Phase 0 step 2 (`/tmp/todo-open-prs.txt`); only if Phase 0's gh step was skipped, fetch it now (`gh pr list --state open --limit 1000 --json headRefName --jq '.[].headRefName' | sort -u > /tmp/todo-open-prs.txt` — never trust a `/tmp` file left by a previous run; Phase 0 rewrites or deletes it every run precisely so this step can trust it). Skip any actionable todo whose slug (filename minus `.md`) **exactly matches** an open `todo/<branch-slug>` branch — executors are required to use the exact filename slug as the branch name, so exact match is the only join. A match means the todo is already implemented and its PR is awaiting merge; re-dispatching would re-implement it and collide with its own open PR. Carry the skipped set (with each todo's PR branch) in orchestrator state and list it in the Phase 5 summary under "Awaiting merge". If the list cannot be fetched at all, continue without this check (the executor's Step 2 remote-branch probe and Step 10 push-collision triage are the downstream backstops).

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
3. **Check inter-todo dependencies.** Also parse each todo's Dependencies section. If a todo lists another todo filename as a dependency and that file still exists in `todos/` (not yet archived on `main`), do **not** schedule the dependent in this run at all — even if the dependency completes in an earlier batch, its archive lands on `main` only when its PR merges (auto-merge or the user's review — either way, not yet), so a same-run dispatch of the dependent is guaranteed to report `blocked` (wasted worktree + researcher + executor). The skip reason depends on the dependency's actual state — never claim a PR merge will unblock it unless that PR exists:
   - Dependency has an **open `todo/*` PR** (check the Phase 0/2 open-PR list): skip with reason `gated on <dependency>'s PR (<branch>) landing` → Phase 5 "Gated on a pending PR".
   - Dependency has **no PR** (quality-dropped, previously failed, or never attempted): skip with reason `gated on <dependency> — not implemented yet` → Phase 5 "Gated on a dependency (not yet implemented)". The unblock is re-authoring or a future run of the dependency, not a merge.
   - Dependency is **scheduled in THIS run**: defer the wording — at Phase 5 time use the dependency's actual outcome (PR opened → first bullet; failed/blocked → second bullet).
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

### Executor dispatch (shared by both batch types)

Every executor is a `todo-executor` agent spawned in an **isolated worktree** via the Agent tool with these parameters:

```
Agent({
  description: "Execute todo: <todo title>",
  subagent_type: "general-purpose",
  isolation: "worktree",
  prompt: "You are a todo executor agent. Follow the instructions in .claude/agents/todo-executor.md exactly.\n\nYour todo file: todos/<filename>.md\nBase branch: <BASE_BRANCH>\nMain checkout: <MAIN_CHECKOUT>\n\nExecute all steps in order and report the result."
})
```

Substitute the actual branch name you recorded in Phase 1 (e.g., `feat/nutrition-inline-drawers`) for `<BASE_BRANCH>` and the actual main checkout path (e.g., `/Users/williamtower/projects/OCRecipes`) for `<MAIN_CHECKOUT>`. Never pass the literal text `<BASE_BRANCH>` or `<MAIN_CHECKOUT>`.

### Parallel Batches

For each batch marked parallel, spawn one executor per todo using the dispatch call above — launch all agents in the batch simultaneously (up to 4), then wait for all to complete before proceeding.

### Sequential Batches

For each batch marked sequential, spawn a **single** executor using the dispatch call above. Run one at a time, waiting for each to complete before starting the next.

### After Each Batch

1. **Collect results** from all agents in the batch. Each reports one of: `success`, `failed`, `blocked`, `skipped`. Every `skipped`/`blocked` report carries a `REASON_CODE` (enum in the executor's Step 11) — keep it verbatim; Phase 5 routes on it.
2. **Record results** from successful executions. Each successful executor reports `COMMIT`, `BRANCH`, `PR_URL` (a URL, or `null` if PR creation failed), `MERGE_ELIGIBLE` (`yes (auto-merge enabled)` = guard OK, executor already armed `gh pr merge --auto` — nothing further needed; `yes (auto-merge enable FAILED ...)` = guard OK but the `gh pr merge --auto` call itself errored — needs manual merge or review; `held` = guard HOLD via the path or todo-frontmatter gate, with the guard's reason line in parentheses; `review-required` = high/critical/security; `unknown` = guard couldn't evaluate; `n/a` = no PR), `SHORT_CIRCUIT` (a `docs/solutions` path if a verified solution was reused and the researcher skipped, else `none`), `ADVISOR` (`green`, `yellow`, `red`, or `skipped`), and `DEFERRED_WARNINGS`. Keep the `DEFERRED_WARNINGS` lines — Phase 5 surfaces them for triage. Keep the `ADVISOR` values — Phase 5 tallies them.

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

   The **Branch / PR** column shows the PR URL for every todo (all priorities open a PR). Key off each todo's `MERGE_ELIGIBLE`: `yes (auto-merge enabled)` → "auto-merging on green CI"; `yes (auto-merge enable FAILED ...)` → "auto-merge failed to arm — needs manual merge or review"; `held` → "held — guard HOLD (path or todo-frontmatter gate; see the executor's reason line)"; `review-required` → "needs individual review"; `unknown` → "guard couldn't evaluate — review by hand". Show `pending manual creation` if PR creation failed.

   | #   | Todo                                  | Status  | Branch / PR             | Review Rounds | Notes                               |
   | --- | ------------------------------------- | ------- | ----------------------- | ------------- | ----------------------------------- |
   | 1   | Extract suggestion generation service | success | github.com/…/pull/42    | 1             | —                                   |
   | 2   | Storage facade re-exports             | success | github.com/…/pull/43    | 2             | auto-merging on green CI            |
   | 3   | Remix screen reader announcements     | blocked | —                       | 0             | Depends on remix-carousel-badge     |
   | 4   | Fix useCollapsible height test        | failed  | —                       | 1             | Type error in mock setup            |
   | 5   | Fix calorie rounding utility          | success | pending manual creation | 1             | PR creation failed — push succeeded |

4. **Print tallies:**

   ```
   Completed: N (list PR URLs; mark "auto-merging on green CI" for `MERGE_ELIGIBLE: yes (auto-merge enabled)`; mark "auto-merge failed to arm" for `yes (auto-merge enable FAILED ...)`; for `held`/`review-required`/`unknown` mark "PR open — needs individual review". Note "PR pending manual creation" for any where PR_URL is null)
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

   Then **report auto-merge status.** For every `MERGE_ELIGIBLE: yes (auto-merge enabled)` PR, nothing further is needed — the executor already ran `gh pr merge --auto --squash --delete-branch`, so GitHub squash-merges it automatically the instant required CI checks pass. List these under "Auto-merging on green CI (no action needed):" with their PR URLs, for visibility only. For any `MERGE_ELIGIBLE: yes (auto-merge enable FAILED ...)` PR, the executor's `gh pr merge --auto` call itself failed — list it under "Auto-merge failed to arm — needs manual `gh pr merge --auto --squash --delete-branch <n>`, or individual review:". `held` / `unknown` / `review-required` PRs are unaffected by this change — list them exactly as before, under "Needs individual review:", for the user to review and merge by hand.

   Then **list todos awaiting merge and gated dependents.** Route executor results on `REASON_CODE` first; matching on reason-text prefixes is the legacy fallback for a report that lacks the field. Four groups:
   - **Awaiting merge** — the Phase 2 skip set **plus any executor `skipped` result with `REASON_CODE: OPEN_PR_COLLISION`** (legacy fallback: reason begins `already implemented`; take the PR URL from the reason), each with the PR that must land to unblock it — note whether that PR is auto-merging (nothing to do) or needs individual review (per the reason text) rather than assuming the user must merge it.
   - **Gated on a pending PR** — Phase 3 dependents whose dependency HAS an open PR, each with that PR.
   - **Gated on a dependency (not yet implemented)** — Phase 3 dependents whose dependency has no PR (quality-dropped, failed, or never attempted). These do NOT clear on a merge — flag them: the dependency needs re-authoring or a future run first.
   - **Stale branch — self-clears next run** — executor `skipped` results with `REASON_CODE: STALE_BRANCH_MERGED` (legacy fallback: reason begins `stale todo/`) — a leftover branch whose PRs all MERGED; Phase 0's sweep deletes it and the todo re-runs then — no action needed. (A branch whose PR was closed WITHOUT merging is never in this group — that blocks with `REASON_CODE: PR_CLOSED_UNMERGED` and lands under "Blocked — needs a one-time manual fix" below.)

   None of these are failures. The first two clear on the next run after the user merges; the stale-branch group clears on the next run automatically; only the not-yet-implemented group needs the user's attention.

   **Producer contract:** every listing group in this summary is a **terminal state for the run** — the overnight `/goal` DONE condition in `docs/todo-automation-runbook.md` derives from "appears in some listing group", and that paste block's enumeration lists each of these headings by exact name (see its `/goal` completion-condition section). Never add, rename, or remove a listing group without updating that enumeration in the same change.

   Then **list deferred warnings for triage.** Collect every non-`none` `DEFERRED_WARNINGS` entry from all executors and print them under the heading "Deferred warnings — tell me which (if any) to turn into todos:". Nothing here is filed automatically; the user decides. If there are none, omit the heading.

   Then **surface actionable blocks.** Dependency-blocks (`REASON_CODE: DEPENDENCY_GATED`) do NOT resolve on their own — route each into the gated listings above ("Gated on a pending PR" if the dependency's PR is open; "Gated on a dependency (not yet implemented)" if it has none). If a `blocked` result carries `REASON_CODE: ORPHAN_BRANCH`, `PR_CHECK_FAILED`, or `PR_CLOSED_UNMERGED` (legacy fallback: its REASON contains `ACTION NEEDED`), print that REASON verbatim under the heading "Blocked — needs a one-time manual fix:" — it will re-block every run until the human clears it (the executor's reason includes the exact steps). Do NOT bury it as an ordinary dependency row. In the same section, also print any closed-unmerged `todo/*` branches Phase 0 found (`/tmp/todo-closed-unmerged-branches.txt`) — each is a rejection signal (its PR was closed without merging); the user decides whether the todo is still wanted — and note if Phase 0 skipped the branch sweep (gh failure or the `--limit` cap).

5. **Print verification result:**

   ```
   Tests: PASS (T tests) | FAIL
   Types: PASS | FAIL (N errors)
   Lint:  PASS | FAIL (N errors)
   ```

6. **Remove this run's executor worktrees.** Force-remove them — a bare `git worktree prune` cannot, because they are created _locked_. Use the non-`--porcelain` form and expand a leading `~` manually (see the Phase 0 note on why: a `git` proxy in this environment can rewrite `--porcelain` output into a condensed, `~`-shorthand format that silently breaks a `^worktree ` anchor):

   ```bash
   git worktree list | awk '/\.claude\/worktrees\/agent-/ {print $1}' | while read -r wt; do
     wt="${wt/#\~/$HOME}"
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

   **Open PRs land only via auto-merge or the user's review** — any still `OPEN` here merges later and cannot be pulled now. List each in the summary; the **next** `/todo` run's Phase 0 sync picks up post-merge state automatically.

## Rules

- **Baseline must be green.** Never start batch processing on a broken codebase.
- **Max 4 parallel agents.** Respect the limit to avoid overwhelming system resources and context.
- **Sequential when scope is unknown.** If a todo mentions no files, it runs alone — never assume it is safe to parallelize.
- **Advisor-gate parallel batches.** Before dispatching any plan with a parallel batch of 2+ todos, run the Phase 3 advisor review — catching an unsafe pairing before agents spin up is far cheaper than untangling stacked PRs after.
- **Top-level batch verification happens in Phase 5 only.** Do not run an extra orchestrator-level `npm run test:run` / `check:types` / `lint` pass between batches. Each executor still performs its own scoped verification inside the worktree before reporting success, and the orchestrator runs one final repo-level verification pass at the end.
- **The executor agent does the work.** This orchestrator only triages, dispatches, and summarizes. Never implement todo changes directly.
- **Archive happens in the executor.** Completed todos are moved to `todos/archive/` by the executor agent, not by this orchestrator.
- **Report everything.** Every todo in the queue must appear in the final summary table, even if skipped or blocked.
- **Self-cleaning.** Phase 0 force-removes leftover worktrees and deletes remote branches whose PRs are **all merged** (a branch whose PR was closed WITHOUT merging is a rejection signal — surfaced in Phase 5, never auto-swept); Phase 5 removes this run's worktrees. The user must never have to clean up `todo/*` branches or `agent-*` worktrees by hand.
- **Auto-merge only through the guard.** Executors enable GitHub's native `gh pr merge --auto --squash --delete-branch` ONLY when `todo-automerge-guard.sh` returns exit 0 (low/medium priority, non-`security`, safe-path-only) — it then merges itself once CI is green, no orchestrator or user step. Every other PR (`held`, `unknown`, `review-required`) stays open and is never auto-merged; the user reviews and merges those individually.
- **Auto-sync local `main`.** Phase 0 fast-forwards local `main` at the start (catching merges from prior sessions, which also stops the backlog from re-picking an already-archived todo) and Phase 5 fast-forwards again at the end (catching this run's merges). Always **ff-only** so parallel work is never disturbed — the user must never have to `git pull` by hand to see a completed todo archived locally.
