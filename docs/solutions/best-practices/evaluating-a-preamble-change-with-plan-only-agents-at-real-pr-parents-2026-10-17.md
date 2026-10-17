---
title: "Evaluating an agent-prompt or preamble change — plan-only agents at the parent of real PRs, scored against the merged diff, with the bar set before the run"
track: knowledge
category: best-practices
module: shared
tags: [harness, agents, hooks, evals, prompt-engineering, tooling]
applies_to: [.claude/hooks/inject-patterns.sh, .claude/agents/*.md, .claude/skills/**/SKILL.md]
created: '2026-10-17'
---

# Evaluating an agent-prompt or preamble change — plan-only agents at the parent of real PRs, scored against the merged diff, with the bar set before the run

## When this applies

Changing text that steers every agent — the DISCIPLINE preamble in `inject-patterns.sh`, a
reviewer or executor agent body, a skill's instructions — and wanting evidence beyond "it
reads better" before keeping it. Used 2026-10-16 to decide the reuse ladder (#1474).

## Rule

1. **Pick archived todos of mixed shape**, at least one each: client UI, server/DB, camera or
   native-API-adjacent, one whose real PR added a dependency or new file, one tiny. Five is
   enough to see a direction; it is not enough to resolve a one-run difference.
2. **Base each run at the PARENT of the real PR's squash commit.** Find the commit that added
   `todos/archive/<slug>.md` (`git log --diff-filter=A --format=%h -- todos/archive/<slug>.md`);
   its parent is the base. On current main the work already exists and "reuse" trivially wins.
   Take the todo text from that base commit (`git show <parent>:todos/<slug>.md`), or strip the
   post-hoc `## Updates` section from the archived copy.
3. **One read-only worktree per base** via `scripts/oc-worktree.sh <branch> <sha>` with
   `OC_SKIP_NPM_CI=1` (planners read source, not `node_modules`) and `CLAUDE_CODE_SESSION_ID`
   unset — otherwise the script declares a worktree contract and the guards then deny writes to
   the main checkout for the rest of the session. Remove every worktree and branch when done.
4. **Dispatch a `Plan` agent per run**, cheap model, prompt in a file the agent reads (keeps the
   orchestrator's context small): the workspace path, the discipline text under test (old or
   new), the todo, and a fixed field list — FILES_TO_CHANGE, NEW_FILES, NEW_DEPENDENCIES,
   REUSED, TESTS_PLANNED, EST_DIFF_LINES, plus arm-specific fields (which rung held, what was
   not checked). 3 runs per todo per arm; at most 4 agents live.
5. **Set the bar before the first run** and write it down — e.g. keep if no worse on "missed
   required files" and "planned tests", equal or better on "extra new files/dependencies".
6. **Score against the real merged PR** as the human-approved reference: new files and
   dependencies beyond it, required files it had that the plan missed (callers, tests,
   migration files), and whether the plan tested the logic the real PR tested. Fix the scoring
   rules in writing too: a conditional plan ("only if …") counts as not planned; a modified
   file the real PR did not touch counts as extra.

## Why

A preamble is injected at the first Edit, when the agent has already decided its approach;
the cheapest observable proxy for that decision is a plan. Scoring against the merged PR
avoids inventing a rubric: the PR is what a human accepted. Setting the bar first stops the
result from being read as whatever confirms the change.

## Examples

The reuse-ladder eval (30 Sonnet 5.5 runs, ~35K tokens and 3–7 tool uses each, far under
the pre-run estimate): extra new files/deps 0 vs 0; missed required files 18 vs 15 (6 vs 3
once a planner-depth miss shared by both arms was excluded); planned tests for logic the real
PR tested 4/9 vs 8/9. One todo went the other way — the ladder nudged "db:push already
exists" over the repo's migration-file convention — which the report stated plainly.

## Exceptions

- The proxy cannot show code quality, test pass/fail or delivery time; nothing is built.
- A planner that reads 3–7 files misses what a real executor finds; a miss shared by both
  arms is a depth artefact, not a prompt effect — report it, do not count it.
- Todos with a Scope Contract pin the file list and compress any difference between arms.
- Delivering the text in the prompt measures an upper bound on a hook that injects at the
  first Edit. If the timing gap matters, carry the text in the executor body too.
- Planners dispatched with Bash available are read-only by instruction, not by audit; say so.

## Related Files

- `.claude/hooks/inject-patterns.sh` — the preamble under test; its deferral budget never applies to the FIRST domain, so measure any preamble growth against `server/routes/auth.ts` / `client/context/AuthContext.tsx` first-touch, not a scripts test file
- `scripts/oc-worktree.sh` — the worktree creator (`OC_SKIP_NPM_CI=1`, session id unset)
- `.claude/agents/todo-executor.md` — Step 4 carries the ladder caveat; Step 11 reports `NOT_CHECKED`

## See Also

- [rules files stay terse for the inline injection budget](../conventions/rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md) — the size cap the preamble shares
- [priority-order context injection under a size cap](../design-patterns/priority-order-context-injection-under-size-cap-2026-06-05.md) — why the first domain always emits in full
