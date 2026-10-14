---
title: Run one implementer agent per worktree at a time — a commit's lint-staged stash/restore swallows another agent's unstaged edits and mislabels commits
track: knowledge
category: best-practices
module: shared
tags: [harness, agents, worktree, git, lint-staged]
applies_to: [.claude/agents/**/*.md, .claude/skills/**/*.md]
created: '2026-10-13'
---

# One implementer agent per worktree at a time

## When this applies

An orchestrator, such as superpowers subagent-driven-development or a hand-rolled fan-out, dispatches more than one **code-writing** subagent into the **same** git worktree.

## Rule

- Only one implementer at a time per worktree.
- Read-only reviewers may run alongside it.
- For real parallel implementation, give each implementer its own worktree.
- After every implementer commit, check `git show --stat HEAD` against that implementer's own file list.

## Why

Measured 2026-10-12 (inspired-recipes):
- Two implementers worked in one worktree. Task 3 committed while Task 2's fix was still unstaged.
- lint-staged's pre-commit runs `git stash` on unstaged changes and restores them afterwards. That swallowed Task 2's edits.
- Task 2's next commit then held only Task 3's files, under Task 2's message.
- `git fsck --unreachable` showed ~8 "WIP on <branch>" stash commits, and none held the lost edits. Recovery was to reword the unpushed commit and have Task 2 re-apply its fix.

A worktree isolates you from other **checkouts**, not from other **processes** writing into the same tree.

## Examples

- Ledger the rule as soon as it bites: "no concurrent implementers in this worktree; reviews may run alongside".
- Tell each implementer to stage only its own paths (`git add <paths>`) and to quote `git show --stat HEAD` in its report.

## Related Files

- `.husky/pre-commit` / lint-staged config

## See Also

- [git-mv-lint-staged-drops-content-edits](../logic-errors/git-mv-lint-staged-drops-content-edits-2026-07-05.md) — another lint-staged stash/restore surprise
- [parallel-agent-shared-file-merge-conflicts](parallel-agent-shared-file-merge-conflicts-2026-05-13.md)
