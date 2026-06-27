---
status: backlog
priority: low
labels: [deferred, testing, tooling]
---

# Stryker mutation can't run locally inside a post-checkout git worktree (docs/solutions symlink)

## Background

Surfaced while running mutation targets from an isolated git worktree during the
mutation-scope-expansion work (PR #468). Stryker sandboxes a run by **copying** the
project into `.stryker-tmp/sandbox-*`. In a worktree, the `.husky/post-checkout` hook
links `docs/solutions` as a **directory symlink** to the main checkout, and Stryker's
`copyfile` cannot sandbox a directory symlink:

```
Error: ENOTSUP: operation not supported on socket, copyfile
  '<worktree>/docs/solutions' -> '<worktree>/.stryker-tmp/sandbox-XXXX/docs/solutions'
```

Every `npm run test:mutation` / `npm run mutation:explore` invocation in such a worktree
crashes before producing a score. CI is unaffected (no post-checkout symlink there), and
the main checkout is fine (`docs/solutions` is a real gitignored dir, copies cleanly).

Attempted fix during PR #468 — adding `"docs"` to `stryker.conf.mjs` `ignorePatterns` —
did **not** prune the symlink (Stryker still copied `docs/solutions`), so it was reverted
rather than ship a non-working change. The correct ignore glob / mechanism needs
investigation (possibly `docs/**`, an explicit symlink skip, or Stryker's `--ignorePatterns`
semantics for symlinked subdirs).

## Acceptance Criteria

- [ ] `npm run mutation:explore -- <src> <test>` completes (emits a score) when run from a
      `.claude/worktrees/*` worktree, not just the main checkout.
- [ ] Fix is config-only (`stryker.conf.mjs` / `stryker.explore.conf.mjs`) or a post-checkout
      hook tweak — no change to the mutation targets or break thresholds.
- [ ] Verified: a known target (e.g. `macro-gap-context`) reports its expected score from a
      worktree, matching the main-checkout / CI number.

## Implementation Notes

- Root cause: `copyfile` on a symlink-to-directory returns `ENOTSUP`; symlink-to-file
  (`.env`, `docs/LEARNINGS.md`) follows through fine — only `docs/solutions` crashes.
- Files in scope: `stryker.conf.mjs` (ignorePatterns), `stryker.explore.conf.mjs`,
  possibly `.husky/post-checkout` (how it links gitignored dirs).
- Confirm whatever glob is chosen actually prunes the symlink — the bare `"docs"` pattern
  did not. Test from an actual worktree, since the main checkout won't reproduce it.
- Low priority: mutation gates run in CI; local mutation runs from a worktree are rare.
