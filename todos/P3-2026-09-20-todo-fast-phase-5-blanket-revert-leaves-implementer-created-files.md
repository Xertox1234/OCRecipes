---
title: "todo-fast Phase 5's blanket `git checkout -- .` leaves every file an implementer CREATED, and is inert today only because the worktree is torn down straight after"
status: in-progress
priority: low
created: 2026-09-20
updated: 2026-09-20
assignee:
labels: [deferred, harness]
github_issue:
---

# A blanket `checkout -- .` is not a revert when the work added files

## Summary

`.claude/skills/todo-fast/SKILL.md` Phase 5 handles a twice-`BLOCKED` implementer by reverting
every implementer's changes with `git -C "$WORKTREE" checkout -- .`. That command reverts
modified **tracked** files and silently ignores every file the implementers **created** — it
resolves paths through the index, and an untracked path has no index entry.

## Measured, 2026-09-20 (bash 5.3.15)

Fixture: nothing committed since base, one modified tracked file, one implementer-created file —
exactly the state an uncommitted `todo-fast-implementer` leaves behind.

```
--- status before Phase 5's revert ---
   M existing.ts
  ?? created.ts
--- git checkout -- .  (the literal Phase 5 command) ---
  exit=0
--- status after ---
  ?? created.ts
  existing.ts = base                  <- reverted
  created.ts  = implementer-newfile   <- SURVIVES
```

Exit 0, no error, no output. The "revert" reports success by being silent.

## Why this is low, not medium

**It cannot ship today.** After a Phase 5 `BLOCKED` failure the whole todo fails, the run aborts,
and Cleanup force-removes the shared worktree unconditionally, so a leftover file never reaches a
commit, a PR, or the main checkout. This is a **latent gap masked by teardown**, not a live
defect — file it, do not rush it.

What makes it worth recording anyway: the mask is incidental. Any future change that keeps the
worktree alive after a Phase 5 failure — a retry, a salvage path, a debugging hold — converts this
straight into the shipped-stray-file defect that
`docs/solutions/logic-errors/reset-mixed-revert-skips-files-the-commits-created-2026-09-20.md`
documents for `todo-executor.md`'s Failure Path.

## Background

Found during PR #1005's final review round. That PR fixed the same defect class in
`todo-executor.md`'s Failure Path, and its solution doc originally asserted Phase 5 "is correct
only because it runs before that commit gate on a tree with nothing committed." A reviewer
constructed the fixture and showed the premise does not imply the conclusion — nothing committed
does not make `checkout -- .` a revert. The doc was corrected in the same PR; this todo is the
follow-up it now points at.

The `SKILL.md` line itself predates PR #1005 (introduced in `11b49261`) and was not changed by it.

## Acceptance Criteria

- [ ] Phase 5's `BLOCKED` revert removes implementer-created files as well as reverting modified
      tracked ones, or the step documents explicitly that it does not and names the teardown as
      the thing that makes that safe.
- [ ] Whatever is chosen is verified with a fixture that contains **a file the implementer
      created** — a fixture of pre-existing files only exercises the half that already works.
- [ ] No `rm -rf` and no `git reset --hard` (CLAUDE.md). A single named `rm -f <path>`, or
      `git clean` scoped to the implementer's own reported file list, are both acceptable shapes.

## Implementation Notes

- The one line is `.claude/skills/todo-fast/SKILL.md`, Phase 5's `BLOCKED` bullet.
- `todo-executor.md`'s Failure Path already carries the existence-split loop this could reuse
  (`git cat-file -e "$BASE:$f"` → `git checkout -- "$f"` or `rm -f "$f"`). Reusing it keeps one
  shape in the repo rather than two.
- Phase 5 has no per-implementer tracked file list today, which is why it reaches for a blanket
  command. Deciding whether implementers should report their created files is the real design
  question here, and is the reason this is not a one-line fix.

## Scope Contract

- **Mechanisms to use:** the existing revert shapes already in the repo.
- **Files in scope:** `.claude/skills/todo-fast/SKILL.md`, and `.claude/agents/todo-fast-implementer.md`
  only if the chosen fix needs implementers to report created files.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #1005 already landed the corrected characterization in the solution doc.

## Risks

- Widening Phase 5's revert to remove untracked files could delete something a human left in the
  shared worktree deliberately. Scope any removal to paths the implementers reported, never a
  blanket clean of the tree.

## Updates

### 2026-09-20

- Filed from PR #1005's final review round, which measured the behaviour above rather than
  inferring it. Low priority because worktree teardown currently masks every consequence.
