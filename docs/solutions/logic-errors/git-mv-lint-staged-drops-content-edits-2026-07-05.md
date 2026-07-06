---
title: git mv of an edited file can have its content silently reverted by lint-staged
track: bug
category: logic-errors
tags: [git, husky, lint-staged, pre-commit, todo-executor, tooling]
module: shared
symptoms: [A file edited then moved with `git mv` shows the pre-edit content in the commit that just ran, `git status --porcelain` after the commit shows the moved file as modified again with exactly the edits that were supposed to be committed, An archived `/todo` file reads `status: backlog` with unchecked acceptance criteria even though it was set to `status: done` and checked off right before archiving, No error or warning was printed by git or the pre-commit hook — the commit "succeeded" with wrong content]
severity: medium
created: '2026-07-05'
---

# git mv of an edited file can have its content silently reverted by lint-staged

## Problem

A workflow that (1) edits a tracked file's content, then (2) `git mv`s it to a new path, then (3) stages other files and commits, can land a commit whose moved file has its **pre-edit** content — the edits are silently dropped with no error. `git diff HEAD` and `git status` look clean immediately after the commit only because the working tree still has the edited content; the *committed blob* is stale. The gap only surfaces on a later `git status` (which then shows the moved file as freshly "modified") or by explicitly diffing `HEAD` against the working tree.

This is exactly the shape of the `/todo` executor's Step 8 archive step: edit the todo's frontmatter (`status: done`) and body (checked acceptance criteria, an Updates entry), `git mv todos/<file>.md todos/archive/<file>.md`, stage the *other* changed files, commit.

## Symptoms

- `git show HEAD:<moved-path>` shows the OLD content (pre-edit) even though `git mv` was run after editing and a fresh `git status --porcelain` right after the `mv` showed a clean rename (`R100`) with no unstaged component.
- Re-running `git status --porcelain` **after the commit** shows the moved file as ` M` again, with a diff that is exactly the edits that should already have been committed.
- No lint-staged/husky error output pointed at the file — the hook log shows a "Backing up original state..." / "Hiding unstaged changes to partially staged files..." / "Restoring unstaged changes..." sequence completing normally.

## Root Cause

`git mv` on a file that was edited via a direct file write (not `git add`ed yet) does stage a clean rename with the current working-tree content — verified independently by reading the file right after the `mv` and by `git status --porcelain` reporting `R100` with no trailing unstaged diff. The corruption happens **inside the pre-commit hook**, not at `git mv` time: lint-staged's stash-based isolation (`git stash` to back up the full working tree, then a "hide unstaged changes to partially staged files" step meant to isolate exactly the staged diff before running fixers, then "restore unstaged changes" via stash pop) does not reliably preserve a renamed path whose new content was staged only via `git mv`'s implicit add rather than an explicit `git add <newpath>` issued as its own step. The stash/restore dance ends up checking out (or restoring) the old blob for that path instead of the intended one. This reproduced with the project's Husky + lint-staged config (`*.{js,md}` prettier task) — the corrupted file was a `.md` file that matched a lint-staged glob, so it went through the fixer path; whether a file with zero matching lint-staged globs is also affected is untested.

## Solution

Immediately after `git mv <old> <new>`, run an **explicit** `git add <new>` even though `git status` already shows a clean `R100` rename. This re-stages the exact current working-tree content as its own operation, which survives the lint-staged stash/restore cycle. Do this *before* staging the rest of the commit's files, in the same shell step if convenient:

```bash
git mv todos/<file>.md todos/archive/<file>.md
git add todos/archive/<file>.md   # explicit — do not rely on git mv's implicit staging alone
git add <other changed files...>
git commit -m "..."
```

If the mistake already happened (discovered via a post-commit `git status --porcelain` showing the moved file modified again): do **not** amend. Stage the corrected working-tree content and create a **new** commit fixing it — `git add <moved-path> && git commit -m "fix: restore content dropped by git mv + lint-staged"`. This project's convention is new commits over `--amend` except when explicitly requested.

## Prevention

- After any `git mv` + commit sequence, run `git status --porcelain` **once more after the commit completes** (not just right after the `mv`) — a clean tree confirms the commit actually captured the intended content. This is the single cheapest verification step and would have caught this immediately.
- Prefer explicit `git add <moved-path>` over relying on `git mv`'s implicit staging whenever the moved file was edited beforehand and the repo has a lint-staged/husky pre-commit hook that touches the same file's glob.

## Related Files

- `.claude/agents/todo-executor.md` — Step 8 (Commit & Archive) is exactly this sequence
- `.husky/pre-commit` — the hook that runs lint-staged's stash/restore dance
- `package.json` — lint-staged glob config (`*.{js,md}` includes archived todo `.md` files)

## See Also

- [pre-commit skips type-aware ESLint](../conventions/pre-commit-skips-type-aware-eslint-run-it-before-push-2026-06-19.md) — another pre-commit-hook-scope gotcha in this repo's git workflow
