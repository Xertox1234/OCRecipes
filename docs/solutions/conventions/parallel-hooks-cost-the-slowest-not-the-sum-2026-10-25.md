---
title: "Before merging hooks or processes for speed, check whether they already run in parallel — Claude Code runs matching hooks in parallel, so a call waits for the slowest hook, not the sum"
track: knowledge
category: conventions
tags: [harness, hooks, performance, measurement]
module: shared
applies_to: [".claude/settings.json", ".claude/hooks/**/*.sh"]
created: 2026-10-25
---

# Parallel hooks cost the slowest one, not the sum

## Rule

Before proposing to merge several hooks (or any processes) into one to save time, find out whether they
run one after another or at the same time. If at the same time, the wait per call is the **slowest**
one (MAX), and a single sequential replacement costs roughly the SUM minus the saved process starts,
which is usually slower.

## Why

Claude Code's hooks reference: "When an event fires, its matching hooks run in parallel."
(https://code.claude.com/docs/en/hooks, "Hook handler fields", read 2026-10-25.)

The 2026-10-23 dispatcher todo assumed the costs add up (July note: 9 hooks, ~60–75 ms summed). Measured
2026-10-25 on the 10 Bash PreToolUse hooks (median of 5 runs):

| Payload | SUM | MAX (what a call waits) | One dispatcher, estimated |
| --- | --- | --- | --- |
| `ls -la` | 146 ms | 25 ms | ~60 ms |
| `git commit` | 246 ms | 50 ms | ~160 ms |
| `gh pr merge` | 372 ms | 183 ms | ~290 ms |

A fast-path hook costs ~10 ms per process, and bare bash plus one jq parse ~5 ms. Merging saves those
starts in CPU time but runs every check in a row, so each call gets slower. The todo was closed as no-go
(#1558).

## Examples

- To cut wall time, look at the MAX hook for the payload (`guard-outward-cli` at 183 ms on
  `gh pr merge`), not at the count of hooks.
- To cut CPU without changing wall time, a hook's `if` field (permission-rule syntax, for example
  `"Bash(git *)"`) skips spawning it for commands it has nothing to check.
- Report a hook-timing claim with both columns. A bare sum reads as a wait time.

## Exceptions

- Prompt or agent hooks beyond 12 queue (12 run at once), so with many of those the sum starts to
  matter. Command hooks are not affected.

## Related Files

- `todos/archive/P3-2026-10-23-single-dispatcher-for-bash-hooks.md`: full table, including PostToolUse
- `.claude/settings.json`: the hook list

## See Also

- [relative hooksPath runs no hooks in worktrees](../logic-errors/relative-hookspath-runs-no-git-hooks-in-linked-worktrees-2026-10-25.md): the other finding from the same 2026-10-23 harness review todos
