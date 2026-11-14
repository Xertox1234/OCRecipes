---
title: "Stacked PRs: every base merge gives the stacked PR a new head — run the E2E platform check once, after the last base lands"
track: knowledge
category: best-practices
module: shared
tags: [harness, testing, architecture, dependencies]
symptoms: ["a stacked native PR needs a fresh review and a fresh E2E run after each base PR merges", "an in-flight E2E run is wasted because main moved", "merge-review-guard denies: no completed E2E run exists for the new head"]
applies_to: [.claude/skills/land/SKILL.md, .github/workflows/e2e-regression.yml, scripts/harness/platform-scope.sh, package-lock.json]
created: 2026-11-09
---

# Stacked PRs: every base merge gives the stacked PR a new head — run the E2E platform check once, after the last base lands

## When this applies

Several PRs are stacked or otherwise touch the same file (almost always `package-lock.json`). One or more of them is in real-platform scope (`scripts/harness/platform-scope.sh`: native, SDK or upload changes), so `merge-review-guard.sh` requires a completed E2E run and a code-reviewer record **on that PR's exact final head**.

## Rule

Order the merges so that the PR needing E2E is the **last** to change, and start its E2E run only when nothing else is left to land:

1. Merge every PR that doesn't need E2E first, including other stacked children.
2. Then merge `origin/main` into the platform-scope PR once, resolve, push, and start E2E and the confirmation review together on that head.
3. Merge it as soon as both pass. Don't land anything else that touches its files in between.

## Why

A squash merge rewrites the base's commits, and any later merge to `main` that touches the PR's files forces a fresh `merge origin/main`. Each one gives the PR a new head, which voids its review record and its E2E run. That costs about two hours of CI for a run the guard no longer counts. The review-dispatch mod also refuses to review until `main` is merged in. On 2026-11-09 (#1814–#1818), #1816 (runtime 5.2.0) had its E2E started after #1815 merged, then had to cancel it halfway and start again when #1817 (zod 4) landed and changed the lockfile. That was one wasted E2E run and an extra review round. Running #1816's E2E after #1817 merged would have needed exactly one run.

## Exceptions

- A JS-only stacked child with no platform scope just needs CI and a review on its final head after the base merges. Order matters less, but it still needs a fresh review per new head.
- Retarget every stacked child to `main` **before** merging its base with `--delete-branch`. Deleting the base branch closes the PRs stacked on it.

## Related Files

- `.claude/skills/land/SKILL.md` (merge ritual), `.claude/hooks/merge-review-guard.sh` (E2E + review-record gate)
- `scripts/harness/platform-scope.sh`, `.github/workflows/e2e-regression.yml`

## See Also

- [verifying a dependency bump](verifying-a-dependency-bump-before-push-2026-11-09.md) — step 6: rebuilding a lockfile from main after each base merge
