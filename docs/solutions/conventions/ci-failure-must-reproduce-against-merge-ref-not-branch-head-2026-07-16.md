---
title: "A PR's CI failure must be reproduced against the merge ref, not the bare branch head"
track: knowledge
category: conventions
module: shared
tags: [ci, github-actions, debugging, git, pull-request]
created: '2026-07-16'
---

# A PR's CI failure must be reproduced against the merge ref, not the bare branch head

## Rule

When a `pull_request`-triggered CI job fails and won't reproduce locally, don't spend the reproduction budget testing the PR branch's bare HEAD. `actions/checkout@v5` on a `pull_request` event checks out `refs/pull/<N>/merge` — a GitHub-generated synthetic commit merging the branch into the *current* target branch — not the branch tip itself. Confirm this before ruling anything in or out:

```bash
gh run view <run-id> --log | grep -iE "checkout|refs/pull"
# look for: git checkout --progress --force refs/remotes/pull/<N>/merge
```

If the branch is stale relative to its base, every CI run is testing "branch content ⊕ whatever the base looks like right now" — and the base can keep moving between runs even with zero pushes to the PR branch. A failure that "started happening after my push" can really mean "started happening because the base moved between the last green run and this one," with the pushed diff completely uninvolved.

## Why

On this PR, a fix commit was pushed and CI failed 3/3 times on a crash with no import-graph connection to anything the fix touched. The instinct was to distrust "it's a flake" (3/3 identical failure is real signal, not noise) but to keep hunting inside the diff for the cause — bisecting file-by-file, checking casings, checking the lockfile *within the branch's own range*. None of it found anything, because the actual deterministic delta wasn't in the branch's diff at all: it was in the ~40 commits the base (`main`) had advanced by since the branch's merge-base, which every CI run silently re-merged in.

The tell was there in the local reproduction results, not the diff: reproducing the bare branch head — in isolation, in a hand-picked batch, and in a full 6250-test unsharded run — was 100% clean, while CI was 100% red on the same commit. A clean bare-branch local run should never be treated as "this is environment-specific, hand it to the user as an override decision" until the *actual artifact CI built* has also been tried locally and still passes. It hadn't been.

## Examples

Given a stale PR branch and a failing CI run:

```bash
git fetch origin main
git worktree add ../scratch-merge-test <branch-or-commit-to-test>
cd ../scratch-merge-test
git merge origin/main --no-edit    # rebuilds the refs/pull/N/merge equivalent
npm ci                              # fresh install, matching CI's npm ci (not your stale local node_modules)
CI=1 npx vitest run --shard=1/3     # or whatever CI's actual invocation is
```

Bisect from there by testing (a) the branch's pre-fix commit merged with current main, and (b) bare current main alone. If (a) reproduces and (b) doesn't, the bug is a genuine interaction that neither side's diff shows in isolation — not a regression in the pushed commit, and not a pure environment flake either.

## Exceptions

If the branch is at or near its base (no meaningful drift), the merge ref and the bare head are close enough that this distinction rarely matters — this is specifically a stale-branch trap. Long-lived stacked-PR branches and any branch that's sat open for more than a handful of days are the ones worth checking first.

## Related Files

- `.github/workflows/ci.yml` — confirms the `pull_request` trigger and matrix shard invocation

## See Also

- [../runtime-errors/react-navigation-elements-png-asset-crashes-vitest-at-scale-2026-07-16.md](../runtime-errors/react-navigation-elements-png-asset-crashes-vitest-at-scale-2026-07-16.md) — the bug this methodology actually uncovered
