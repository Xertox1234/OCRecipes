---
title: "A revert built on git reset --mixed plus git checkout -- silently skips every file the reverted commits CREATED, and the fixture that proves it works is the one that cannot fail"
track: bug
category: logic-errors
tags: [harness, git, revert, untracked-files, recovery, verification]
module: shared
applies_to: [".claude/agents/*.md", ".claude/skills/**/*.md"]
symptoms: ["A revert reports success and leaves the bad file on disk", "git checkout -- <file> exits 1 with pathspec did not match any file(s) known to git", "A retry attempt inherits the previous attempt's content for files it did not revisit", "A stray file from a failed attempt appears in the PR diff", "The revert was measured and still missed the common case"]
created: 2026-09-20
severity: medium
---

# A `git reset --mixed` revert only unwinds files that existed at base

## Problem

An agent pipeline that commits mid-run needs a way to unwind those commits when the run
fails. The obvious recipe is `git reset --mixed <base>` (to drop the commits without the
`--hard` this project forbids) followed by the per-file `git checkout -- <file>` the pipeline
already used when nothing was committed.

That recipe is **half a revert**. `reset --mixed` leaves the reverted content in the working
tree in **two different states**, and `git checkout --` can only discard one of them:

| The file… | after `reset --mixed` | `git checkout -- <file>` |
| --- | --- | --- |
| existed at `<base>` | ` M` unstaged modification | restores it, exit 0 |
| was **created** by the reverted commits | `??` untracked | **exit 1**, `pathspec … did not match any file(s) known to git` |

The created file keeps its bad content and stays on disk. If a later step stages "anything
still uncommitted" — which archive/commit steps routinely do — it is committed and ships.

## Symptoms

- A revert step produces no visible error for the file that matters and the bad content is
  still there afterwards.
- `git status --porcelain` after the revert shows `??` entries you expected to be gone.
- Attempt 2 of a retry loop inherits attempt 1's file for any path attempt 2 does not revisit.
- The stray file surfaces much later, as an unexplained extra path in a PR diff.

## Root Cause

Measured under `bash 5.3.15`, one fixture, both cases side by side:

```
after git reset --mixed "$BASE":
   M existing.ts
  ?? created.ts

git checkout -- created.ts
  -> error: pathspec 'created.ts' did not match any file(s) known to git
  created.ts still holds "attempt1-newfile"

control, same run:
git checkout -- existing.ts   -> exit 0, restored to "base"
```

`git checkout -- <path>` resolves the path through the index. A file that does not exist at
the commit you reset to is not in the index afterwards, so there is nothing for it to
restore — and the failure is a non-zero exit on a line whose output nobody reads, not a
crash.

**The second half of this is the reusable part.** The first fix for this revert *was*
measured — and the fixture used two files that both existed at base, so it proved a property
of the fixture, not of the mechanism. A revert fixture that contains no newly-created file
cannot fail in the one way reverts fail. The regression shipped with a commit message
asserting it had been verified.

## Solution

Split the revert by **existence at the base commit**, and pick the operation per file:

```bash
BASE=$(git merge-base origin/<base-branch> HEAD)
git reset --mixed "$BASE"        # never --hard

for f in <the tracked list of files you modified>; do
  if git cat-file -e "$BASE:$f" 2>/dev/null; then
    git checkout -- "$f"         # existed at base — restore it
  else
    rm -f "$f"                   # this run created it — remove that ONE named path
  fi
done
```

`git cat-file -e "$BASE:$f"` is the existence test, and it costs one call per file. `rm -f
"$f"` is a single named path — never `rm -rf`, never a glob. Same fixture after the fix:
both files at base content, zero working-tree entries, zero commits past base.

If nothing was committed yet, the `reset` is a harmless no-op (`HEAD` already equals
`$BASE`) and the loop still does the right thing, so the recipe needs no branch for that
case.

## Prevention

- **Every revert fixture must contain a file the reverted work CREATED.** A fixture of
  pre-existing files only exercises the half that works. This is the cheapest possible
  control and it is the one that was missing.
- **Moving a commit point is a change to every recovery path that depended on where it
  was.** When a pipeline starts committing earlier than it used to, grep for every `git
  checkout --` in it: each one was written against the old timing, and a revert that is now
  a no-op reports success by being silent.
- Untracked files are invisible to more tracked-file operations than just this one — see the
  companion note on `git diff` below. When a step's correctness depends on "the files I
  changed", ask separately what it does with the files you **added**.

## Related Files

- `.claude/agents/todo-executor.md` — the Failure Path revert this was found in, and the
  commit gate whose earlier commit point exposed it.
- `.claude/skills/todo-fast/SKILL.md` — Phase 5's blanket `git checkout -- .` has this same
  gap, and running before the commit gate does **not** save it. Measured on a tree with nothing
  committed, one modified tracked file and one implementer-created file: it exits 0, reverts the
  tracked file, and leaves the untracked one untouched. It is inert *today* only because that
  path aborts the run and the shared worktree is force-removed straight after, so nothing it
  leaves behind can reach a commit — a masked latent gap, not a closed case. Tracked as
  `todos/P3-2026-09-20-todo-fast-phase-5-blanket-revert-leaves-implementer-created-files.md`.

## See Also

- [git-diff-invisible-to-untracked-files](git-diff-invisible-to-untracked-files-2026-07-15.md) — the same underlying fact (untracked files are invisible to tracked-file operations) reached through verification SCOPE rather than through recovery; that one silently under-checks, this one silently under-reverts.
- [a-probe-can-run-and-never-enter-the-regime](../code-quality/a-probe-can-run-and-never-enter-the-regime-2026-09-15.md) — the fixture half of this note, stated generally: a harness that ran and produced a plausible table can still have measured the wrong regime.
