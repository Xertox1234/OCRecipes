---
title: 'Ad hoc git worktrees outside .claude/worktrees/ get no node_modules symlink'
track: knowledge
category: conventions
module: shared
tags: [git, worktree, tooling, husky]
applies_to: [.husky/post-checkout]
created: '2026-07-06'
---

# Ad hoc git worktrees outside .claude/worktrees/ get no node_modules symlink

## Rule

Any `git worktree add` created outside the project's `.claude/worktrees/` convention — an ad hoc verification worktree in `/tmp`, a `--detach` worktree off a raw commit SHA, or any one-off worktree for manual conflict resolution — gets `.env` and `docs/LEARNINGS.md` auto-symlinked by `.husky/post-checkout`, but **not** `node_modules`. Any command needing the toolchain (`vitest`, `eslint`, `tsc`, or a `git commit`/`push` whose hook shells out to `npx`) fails with `env: eslint: No such file or directory` or `ENOENT`, even though the repo state is otherwise correct.

## Smell patterns

- A hook failure naming a binary that's normally on `PATH` inside the repo (`eslint`, `tsc`, `vitest`) from a worktree you created by hand rather than through an agent-dispatch convention.
- `ls <worktree>/node_modules` comes back "No such file or directory" while `.env` is present and correct.

## Why

`.husky/post-checkout`'s symlink list is hardcoded to the two gitignored files a new worktree actually needs to run the app or read project context (`.env`, `docs/LEARNINGS.md`) — it has no `node_modules` case because the executor/audit conventions that motivated it always provision worktrees under `.claude/worktrees/agent-*`, which are set up through a separate provisioning path. A raw `git worktree add <path> <ref>` bypasses that path entirely, so nothing symlinks `node_modules` for it.

## Examples

Symlink it manually before running any toolchain command in the worktree:

```bash
ln -s /absolute/path/to/main-checkout/node_modules /path/to/ad-hoc-worktree/node_modules
```

Hit twice in one session with the identical fix both times: once independently verifying a Babel-plugin behavior claim in a detached `/tmp` worktree, once resolving a merge conflict in an ad hoc worktree created off a PR branch.

## Exceptions

Worktrees created via the `.claude/worktrees/agent-*` convention (todo-executor, audit subagents) don't need this — they're symlinked at creation through a different provisioning path.

## Related Files

- `.husky/post-checkout` — the symlink list that doesn't include `node_modules`

## See Also

- [Isolate into worktree when concurrent-session guard warns](isolate-into-worktree-when-concurrent-session-guard-warns-2026-06-27.md)
