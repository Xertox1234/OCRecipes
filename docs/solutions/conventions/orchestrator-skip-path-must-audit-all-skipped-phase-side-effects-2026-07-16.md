---
title: "A skip-path added to a multi-phase orchestrator skill must audit every side effect of the phase it skips, not just the one that motivated the skip"
track: knowledge
category: conventions
tags: [orchestrator, skill-authoring, multi-phase, git, branch, worktree]
module: agents
applies_to: [".claude/skills/**/*.md", ".claude/agents/**/*.md"]
created: '2026-07-16'
---

# A skip-path added to a multi-phase orchestrator skill must audit every side effect of the phase it skips, not just the one that motivated the skip

## Rule

When adding a conditional shortcut to a multi-phase orchestrator skill (`.claude/skills/*/SKILL.md`, `.claude/agents/*.md`) that skips an earlier phase for some todos/inputs, enumerate **every** side effect that phase produces — not only the one that motivated adding the shortcut — and check whether any later phase implicitly depends on it. A phase that does one thing conceptually (e.g. "set up an isolated worktree") often also does a second, unrelated thing (e.g. "create the feature branch") that a later phase assumes happened, silently, with no explicit re-statement of the dependency.

## Why

`/todo-fast`'s Phase 1 ("Shared Worktree Creation") does two things: it creates an isolated worktree (motivated by keeping parallel implementer agents from clobbering each other), and — as a side effect of `git worktree add ... -b "todo/$SLUG" "$BASE_BRANCH"` — it creates the `todo/<slug>` branch itself. A same-day session added a "local-diagnosis" escape hatch to Phase 0 that skips Phase 1 entirely for todos whose defect is local-machine-only (the worktree's symlinked `node_modules` can't land a fix for that shape of todo — see [vitest-collection-crash-transient-contention](../runtime-errors/vitest-collection-crash-transient-contention-2026-07-16.md)). The escape hatch's author reasoned carefully about the worktree/`node_modules` side effect that motivated the change, and completely missed the branch-creation side effect of the same phase. Phase 10 (`git branch -m todo/<todo-slug>`) assumes a throwaway feature branch is already checked out and renames "the current branch" to the todo's slug — with Phase 1 skipped and no replacement branch created, that "current branch" is `$BASE_BRANCH` itself (typically `main`), so Phase 10 would have renamed the main checkout's actual base branch to `todo/<slug>`, silently leaving the checkout without a local `main`. An independent code-reviewer pass (dispatched for exactly this diff, per CLAUDE.md's "always review before merging") caught it before merge — the failure mode is otherwise silent: no error, no warning, just a corrupted local branch layout discovered later. See PR #638 (xertox1234/OCRecipes) for the fix: an explicit `git checkout -b "todo/$SLUG" "$BASE_BRANCH"` added to the escape hatch itself, executed before any tracked-file edit on that path.

This generalizes the same "audit every side effect before removing/skipping the thing" principle [dead-guard-removal-must-audit-state-cleanup-side-effects](dead-guard-removal-must-audit-state-cleanup-side-effects-2026-06-03.md) documents for application code — here applied to skill-authoring instead of `if (!res.ok)` blocks.

## Examples

Before shipping a skip-path, ask explicitly: "what ELSE does the skipped phase do, besides the thing I'm trying to avoid?" — then trace every later phase for a reference to that other side effect (a variable it binds, a branch/file/resource it creates, a precondition it establishes) and make sure the skip-path re-establishes or explicitly no-ops each one:

```
Phase 1 (skipped by the escape hatch) does TWO things:
  (a) creates an isolated worktree + symlinks node_modules   <- the reason for the skip
  (b) creates the todo/<slug> branch                          <- easy to miss, unrelated to (a)

Phase 10 (still runs) assumes (b) already happened: `git branch -m todo/<slug>`
  → without (b), this renames whatever branch was already checked out.

Fix: the escape hatch must explicitly perform (b) itself:
  git checkout -b "todo/$SLUG" "$BASE_BRANCH"
```

## Exceptions

A phase with a single, well-isolated side effect (nothing else in the skill references anything it produces) is safe to skip without this audit — the risk is specifically proportional to how many later phases implicitly depend on the skipped phase's state.

## Related Files

- `.claude/skills/todo-fast/SKILL.md` — Phase 0 step 8 (the escape hatch), Phase 1 (the skipped phase), Phase 10 (the downstream assumption that was missed)

## See Also

- [Removing a dead if(!res.ok) guard requires auditing state-cleanup side effects inside the block](dead-guard-removal-must-audit-state-cleanup-side-effects-2026-06-03.md) — the same audit-every-side-effect principle, applied to application code instead of a skill file
- [A shell variable captured in one Phase's Bash call is gone by the next Phase's separate Bash call](orchestrator-phase-variables-dont-persist-across-bash-calls-2026-07-15.md) — a different `/todo-fast` orchestrator-authoring gotcha from the same family (implicit cross-phase assumptions), one day earlier
