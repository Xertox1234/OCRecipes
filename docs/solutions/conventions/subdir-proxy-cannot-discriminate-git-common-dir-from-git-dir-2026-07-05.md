---
title: "A subdirectory can't discriminate `--git-common-dir` from `--git-dir` — a test needs a real linked worktree"
track: knowledge
category: conventions
tags: [git, hooks, testing, worktree, tooling, ci, hermetic-tests]
module: shared
applies_to: [.claude/hooks/test-*.sh, scripts/lib/*.sh]
created: 2026-07-05
---

# A subdirectory can't discriminate `--git-common-dir` from `--git-dir` — a test needs a real linked worktree

## Rule

When a test's whole purpose is to lock in cwd-invariance across git worktrees (i.e. "this
resolves to the SAME path from the main checkout and from any linked worktree"), never use a
plain **subdirectory** of the main checkout as the worktree proxy. It does not discriminate the
correct `git rev-parse --git-common-dir` keying from a regression to `git rev-parse --git-dir`:
both resolve a subdirectory to the same canonical `<repo>/.git`, so the test passes whichever
implementation is in place. Use a **real linked worktree** (`git worktree add`) instead — that is
the only fixture where the two git-plumbing commands genuinely diverge.

## Why

- `--git-common-dir` and `--git-dir` are **equal in the main checkout and in any plain
  subdirectory of it** — both canonicalize to `<repo>/.git`.
- They **diverge only in a linked worktree**: `--git-common-dir` still resolves to
  `<repo>/.git` (the directory shared by every worktree), while `--git-dir` resolves to
  `<repo>/.git/worktrees/<name>` (that worktree's private admin directory).
- A test that swaps in a subdirectory as the "different cwd" case is testing cwd-*locality*
  (does the path change if you `cd` somewhere under the same repo?), not cwd-*invariance across
  worktrees* — the property that actually matters when a hook or script may run from a linked
  worktree's cwd (e.g. `/todo`'s executor worktrees) while the value it reads/writes was
  produced from the main checkout, or vice versa. A regression from `--git-common-dir` to
  `--git-dir` would go green against the subdirectory case and only break in production, in a
  real worktree — silently.

## Examples

`.claude/hooks/test-preflight-stamp-path.sh` case 5 (added under
`todos/archive/P3-2026-06-28-lock-stamp-path-worktree-invariance-test.md`):

```bash
# Real linked worktree → SAME path as the main checkout. Only a genuine worktree
# discriminates --git-common-dir (correct) from a regression to --git-dir.
( cd "$R3" && git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init )
WT_DIR="$R3/wt"
( cd "$R3" && git worktree add -q "$WT_DIR" -b wt-branch )

P3MAIN=$(key_in "$R3"); P3WT=$(key_in "$WT_DIR")
[ "$P3MAIN" = "$P3WT" ] && ok "linked worktree → same path as main checkout" || bad "worktree drift: $P3MAIN vs $P3WT"
```

Verified by hand during implementation: temporarily changing
`scripts/lib/preflight-stamp-path.sh`'s `git rev-parse --git-common-dir` to `--git-dir` left
the existing subdirectory case (case 3) passing, while the new linked-worktree case correctly
failed with a "worktree drift" message — confirming the subdirectory proxy alone would have let
that regression ship.

`git worktree add` needs a commit to attach to; use an `--allow-empty` commit with inline
`-c user.email=... -c user.name=...` so the fixture never touches the user's real git config
(see `.claude/hooks/test-pr-preflight-guard.sh` case 13, and
`.claude/hooks/test-worktree-deps.sh` for a sibling example that builds a real linked worktree
end-to-end).

## Exceptions

- If a test's target property is genuinely just "does the path change under a plain `cd`"
  (cwd-locality within one checkout, not worktree-invariance), a subdirectory proxy is fine and
  cheaper than spinning up a worktree — don't over-apply this rule to every cwd test.
- `git worktree add` is heavier than a `mkdir`; keep the temp repo minimal (one empty commit) and
  make sure cleanup (`trap ... EXIT`) covers the new temp dir so CI runners aren't left with
  stray worktree registrations.

## Related Files

- `.claude/hooks/test-preflight-stamp-path.sh` — case 5, the fixed test.
- `scripts/lib/preflight-stamp-path.sh` — the helper under test (`--git-common-dir` keying).
- `.claude/hooks/test-worktree-deps.sh` — sibling test already building a real linked worktree.
- `.claude/hooks/test-pr-preflight-guard.sh` — case 13, the `--allow-empty` commit pattern.

## See Also

- [Inherited absolute GIT_DIR overrides `git -C`, corrupting the real repo from a hook self-test](../logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md) — the companion hermeticity concern: once a test's setup performs a *real* mutating commit/worktree-add (not just an inert `git init` on an empty dir), it must also strip inherited git env, or an absolute `GIT_DIR`/`GIT_WORK_TREE` could redirect that mutation onto the real repo.
