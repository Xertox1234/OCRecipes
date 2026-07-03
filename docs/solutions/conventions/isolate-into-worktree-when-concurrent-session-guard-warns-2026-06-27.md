---
title: Isolate into a worktree when the concurrent-session guard warns
track: knowledge
category: conventions
module: shared
tags: [git, worktree, concurrent-session, isolation, shared-checkout, workflow]
created: '2026-06-27'
---

# Isolate into a worktree when the concurrent-session guard warns

## Rule

When the `.claude/hooks` concurrent-session guard warns that another Claude session has
touched this working tree **and** you are about to mutate git state in a **multi-edit**
session, move your work into an isolated git worktree (superpowers:using-git-worktrees) —
*even if* a heavy tool (Stryker, a native build) appears to need the shared main checkout.
Run that tool's phase **first** in the main checkout, then isolate before the long tail of
edits/commits.

## Smell patterns

- A PreToolUse warning: "another Claude session has been active in this same working tree …
  you are about to mutate git state."
- You're about to make many commits over a long session while a second session is live.
- You decline isolation because "tool X can't run in a worktree" — then keep committing in
  the shared checkout anyway.

## Why

Declining isolation because *"Stryker can't resolve its binary in a worktree"* let the
parallel session commit its own work directly onto the shared feature branch (the exact
git-churn hazard the guard warns about). Recovery meant branching off the last clean commit
to exclude the foreign commit — avoidable friction, and it left a divergent `origin` branch
to clean up.

The tool concern was real but **mis-weighted**: the Stryker-heavy phase (baselining,
killing survivors) is precisely the part that finishes *early*; the long tail (docs,
commits, PR) runs fine in a worktree — `npm`/`npx` resolve binaries via the parent
`node_modules`, and the post-checkout hook links `.env`. So the correct sequence is
heavy-tool-phase-first-in-main, then isolate.

Two shared-state desyncs in one session make the rule concrete: (a) the parallel session's
commit landed on the shared branch; (b) a later `git stash pop` hit a conflict because
`main`'s agent file had advanced under a *sibling* codify. Both are the same failure —
shared mutable state diverging from what you last saw. Branch/worktree off **fresh**
`origin/main` and reconcile against what's actually there, not what you remember.

## Exceptions

- A single short edit (one commit) on a quiet checkout doesn't need a worktree.
- If a tool genuinely must run **repeatedly interleaved** with edits and cannot run in a
  worktree, stay in the main checkout but adopt the defensive fallback: commit each unit
  immediately (durable in git, not just the tree) and verify branch/HEAD before every
  commit. (Note: a worktree's post-checkout `docs/solutions` *directory symlink* currently
  breaks Stryker's sandbox copy — see the related P3 — which is the real, narrow reason
  Stryker can't run in a worktree today.)

## Related Files

- `.claude/hooks/` — the concurrent-session guard (warn-only PreToolUse)
- `.husky/post-checkout` — links `.env` + gitignored dirs into new worktrees

## See Also

- [run codify agent updates before the PR merges](run-codify-agent-updates-before-pr-merges-2026-06-27.md) — a related shared-state ordering rule from the same session
