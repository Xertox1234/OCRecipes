---
title: "git diff can never show wholly untracked files — scoping mid-pipeline verification off it silently misses new files"
track: bug
category: logic-errors
tags: [git, diff, untracked-files, preflight, scoping, verification]
module: scripts
applies_to: ["scripts/preflight.sh", ".claude/hooks/*.sh"]
symptoms: [A new file created during implementation is silently absent from a changed-file scope, Lint/type-check/related-tests never run against a file that was clearly just written, A test written moments ago for the exact bug being fixed is not included in a "scoped fast check"]
created: 2026-07-15
severity: medium
---

# git diff can never show wholly untracked files — scoping mid-pipeline verification off it silently misses new files

## Problem

`git diff [--diff-filter=ACMR] <ref> -- <pathspec>` was used to scope a mid-pipeline verification step (`scripts/preflight.sh --fast --uncommitted`, added to let `todo-executor.md` Step 5a check an implementation's changed files *before* a commit exists) to "the files this implementation touched." A brand-new file that had never been `git add`ed — a very common case for a TDD-heavy workflow that writes new test files and new implementation files — was silently invisible to this scoping, regardless of `--diff-filter` value. Lint/type-check/related-tests would run against zero files and pass trivially, reintroducing the exact "verification silently no-ops" failure the `--uncommitted` mode was built to close, one level down (per-file instead of per-commit).

## Root Cause

`git diff <treeish>` (with no `--cached`) compares the **index** and the **working tree** against `<treeish>` — but a wholly untracked file has no index entry at all. It is structurally outside what `git diff` inspects, no matter which ref, range, or `--diff-filter` value is used. `A` ("Added") in `git diff` output means "staged as new" (has an index entry), not "exists on disk." Only `git status` / `git ls-files --others` walk the raw working tree and can see a file that was never staged.

The bug shipped initially because the test written to cover `--uncommitted` mode staged its fixture file first (`git add foo.ts`) before asserting on it — a reasonable-looking simplification that happened to hide the exact case (an unstaged new file) the mode needed to handle. A task reviewer caught it by empirically reproducing the gap in a scratch repo rather than trusting the diff-filter's apparent completeness.

## Solution

Add a second file-discovery pass, gated to the "since working tree" scoping mode, using `git ls-files --others --exclude-standard` (untracked-but-not-ignored files) with the exact same pathspec as the `git diff` probe it supplements:

```bash
CHANGED=()
while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done \
  < <(git diff --name-only --diff-filter=ACMR "${DIFF_BASE_ARGS[@]}" -- '*.ts' '*.tsx' 2>/dev/null)
if [ "$UNCOMMITTED" -eq 1 ]; then
  # git diff structurally cannot report untracked files (no index entry) — ls-files --others is
  # disjoint by construction from git diff's output (a path is tracked-or-staged XOR untracked,
  # never both), so no dedup is needed between the two loops.
  while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done \
    < <(git ls-files --others --exclude-standard -- '*.ts' '*.tsx' 2>/dev/null)
fi
```

Verify the fix against the specific case the original test masked — a file created but **never** `git add`ed:

```bash
make_repo_with_untracked_file() {
  local d; d=$(mktemp -d)
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
  echo "export const y = 2" > "$d/bar.ts"   # NEVER git add'ed
  printf '%s' "$d"
}
```

## Prevention

Whenever a "changed files" scope is meant to cover uncommitted implementation work (not just committed history), assume new files exist that haven't been staged yet, and pair `git diff` with `git ls-files --others --exclude-standard` explicitly — never rely on `git diff` plus a wider `--diff-filter` alone. When writing the test for such a scope, include a fixture that is deliberately left unstaged; a fixture that stages itself before asserting will not exercise this gap.

## Related Files

- `scripts/preflight.sh` — the `--uncommitted` mode's `CHANGED`/`HOOK_CHANGED` file-discovery blocks
- `.claude/hooks/test-preflight-uncommitted-scope.sh` — the regression test, including the untracked-file assertion added to close this gap
- `.claude/agents/todo-executor.md` — Step 5a, the consumer this scoping mode was built for

## See Also

- [Resolve the diff range once for branch-diff skills](../conventions/resolve-diff-range-once-for-branch-diff-skills-2026-06-20.md) — a sibling case of "the wrong git-diff range silently yields an empty/incomplete result instead of an error"
