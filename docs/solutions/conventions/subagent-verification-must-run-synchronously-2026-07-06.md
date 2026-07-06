---
title: "A dispatched subagent must run its own verification synchronously — backgrounding it strands the agent with no notification"
track: knowledge
category: conventions
tags: [agents, subagents, background-tasks, verification, todo-skill]
module: shared
applies_to: [".claude/agents/**/*.md"]
created: 2026-07-06
---

# A dispatched subagent must run its own verification synchronously — backgrounding it strands the agent with no notification

## Rule

When a subagent (a `todo-executor`, or any agent spawned via the Agent/Task tool) needs to run its own verification commands — `npm run test:run`, `check:types`, `lint`, or any other gate it must pass before proceeding — it must run them **synchronously, in the foreground**, and read the actual output before continuing. Never launch a verification command with a backgrounded/detached execution mode and then stop to "wait for it."

## Why

The orchestrator gets an automatic notification when a dispatched **agent** finishes, even if that agent is running in the background. This is a harness-level mechanism scoped to agent dispatch, not to arbitrary shell commands. There is no equivalent mechanism for a subagent's own **backgrounded shell command**: nothing re-invokes the subagent when its own background process completes. If a subagent backgrounds its verification step and then ends its turn to "wait," it strands itself — the harness sees no live background children for that subagent and reports it to the orchestrator as complete, but the subagent itself never receives a nudge to check the result or continue. The work already done sits uncommitted and unreported until the orchestrator notices the malformed final message and explicitly resumes the subagent with an instruction to check state and proceed.

This recurred twice in one `/todo` session: two independent `todo-executor` agents each backgrounded their own `npm run test:run`/`lint` and reported a final message like "Waiting for the two background verification commands to complete" or "I'll wait for the lint completion notification now, without further tool calls" — with no structured result (no `COMMIT`/`PR_URL`/etc). In both cases the actual implementation was complete and correct in the worktree; only the wrap-up (commit, push, PR, guard) never ran, because the agent was waiting on a notification that would never arrive at its level.

## Smell patterns

- A subagent's final/last message is a variant of "waiting for the background verification/test/lint to complete," with no final structured report.
- A subagent's task-notification fires with `status: completed` but the result text is not a proper final report for that agent's contract (e.g. a `todo-executor` with no `COMMIT`/`BRANCH`/`PR_URL`/`STATUS`).
- Inspecting the subagent's worktree directly (`git status`, `git log`) shows complete, correct, but **uncommitted** implementation work — the work happened; only the reporting steps after verification never ran.

## Exceptions

None for verification gates specifically — a subagent should never background a command whose pass/fail result it needs before its next decision. (Backgrounding is fine for genuinely fire-and-forget side effects the subagent does not need to observe, e.g. a best-effort telemetry log — see [fire-and-forget-non-critical-background](../design-patterns/fire-and-forget-non-critical-background-2026-05-13.md) for that distinct, unrelated pattern.)

## Related Files

- `.claude/agents/todo-executor.md` — Step 5 (Verify), updated 2026-07-06 with an explicit foreground-only instruction alongside this solution

## See Also

- [fire-and-forget-non-critical-background](../design-patterns/fire-and-forget-non-critical-background-2026-05-13.md) — the inverse case: when backgrounding IS correct, because the caller doesn't need the result
