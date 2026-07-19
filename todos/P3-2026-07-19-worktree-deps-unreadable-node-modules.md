---
title: "worktree-deps.sh: unreadable node_modules is indistinguishable from cache-noise and becomes a replace target"
status: backlog
priority: low
created: 2026-07-19
updated: 2026-07-19
assignee:
labels: [deferred, harness, worktrees]
github_issue:
---

# worktree-deps.sh treats an unreadable node_modules like cache-noise

## Summary

The PR #669 cache-noise fix decides "dot-entries only" via
`find "$nm" -mindepth 1 -maxdepth 1 -not -name '.*' -print -quit 2>/dev/null | grep -q .`.
An existing-but-unreadable `node_modules` (e.g. restrictive permissions / root-owned
residue) produces zero stdout lines exactly like a genuinely empty one, so it now falls
through to the `rm -rf` + symlink replacement — where the pre-#669 bare `[ ! -e ]` guard
left it untouched. Make the noise check readability-aware (skip, don't replace, what it
cannot inspect).

## Background

Flagged as a non-blocking NOTE by the PR #669 pre-merge code review (2026-07-19); also
recorded as an accepted residual in the `project_worktree_provisioning` memory note.
Practical likelihood is low — the hook only touches worktrees under the two
harness-managed roots (`.claude/worktrees/*`, `.worktrees/*`), which are created by the
same local user in a single-machine dev context — hence P3, not a defect fix rushed into
#669. The right posture for a guard that deletes: fail toward "leave it alone" whenever
the inspection itself fails.

## Acceptance Criteria

- [ ] The replace branch runs only when the directory was actually inspectable — e.g.
      require `[ -r "$nm" ] && [ -x "$nm" ]` before the `find`, else skip the worktree's
      node_modules entirely (leave-alone, matching pre-#669 behavior for that case)
- [ ] Regression test in `.claude/hooks/test-worktree-deps.sh`: a `chmod 000`
      node_modules is NOT removed and NOT symlinked (restore permissions in cleanup so
      the trap's `rm -rf "$TMP"` still works; skip the case when running as root, where
      permission bits don't bind)
- [ ] Existing 20-case suite stays green; cache-noise replacement and real-install
      non-clobber behavior unchanged

## Implementation Notes

- `.claude/hooks/worktree-deps.sh` — the noise-check branch added by PR #669 (locate via
  `grep -n 'mindepth' .claude/hooks/worktree-deps.sh`).
- `.claude/hooks/test-worktree-deps.sh` — follow the existing throwaway-repo fixture
  pattern; note the EXIT trap does `rm -rf "$TMP"`, so restore `chmod` before exit.

## Dependencies

- None (PR #669 merged 2026-07-19).

## Risks

- None beyond the hook itself; the change narrows (never widens) the delete path.
