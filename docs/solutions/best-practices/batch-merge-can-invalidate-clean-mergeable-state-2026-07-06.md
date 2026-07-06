---
title: 'Batch-merging independent PRs: re-verify mergeable_state before each merge, not just once up front'
track: knowledge
category: best-practices
module: shared
tags: [process, git, github, merge-conflicts, batch-merge, ci]
applies_to: [docs/rules/*.md]
created: '2026-07-06'
---

# Batch-merging independent PRs: re-verify mergeable_state before each merge, not just once up front

## When this applies

When merging a batch of N independently-developed PRs (e.g. a `/todo` session's output) in sequence against the same base branch, after each PR's own CI already validated it in isolation and a pre-batch overlap check found every pair "disjoint."

## Smell patterns

- Multiple PRs each touch a "living list" file (a project rules doc, a README-style checklist, a registry) even though their primary code changes are unrelated.
- A parallel-execution file-overlap analysis (used to decide it's safe to run N executors at once) gets reused later to assume merge-time independence too — it wasn't built for that.
- `mergeable_state` was read once, before the batch started, and trusted for every merge in the batch.

## Why

Two independently-implemented PRs can each be `mergeable_state: "clean"` against the base commit they forked from, and still conflict with **each other** once one of them lands — git's mergeability check is pairwise against the *current* base, not against every other PR in the batch. `mergeable_state` is asynchronous and lazily recomputed by GitHub after every push to the base branch, so a value read before the batch started is stale by the second or third merge. A parallel-execution overlap analysis (e.g. the `/todo` skill's Phase 3) only guarantees no two *executors* edited the same file *at the same time* — it says nothing about two PRs both appending to the tail of the same living-list file weeks apart, which merges cleanly against main in isolation but conflicts once the other lands first.

## Examples

In one session, 9 PRs were confirmed CI-green and `mergeable_state: "clean"` up front. Merging the first 5 in sequence succeeded. The 6th failed with a 405 "merge conflict" — GitHub had recomputed `mergeable_state` to `"dirty"` the moment an earlier PR landed, because both PRs appended a new bullet to the end of the same `docs/rules/*.md` file. Resolved by: creating a worktree from the stuck PR's own branch, `git merge origin/main`, manually reconciling the two independent bullet additions (both kept — order didn't matter), re-running lint/types/the PR's own tests locally, pushing (which re-triggers the pre-push fast gate and fresh CI), then merging.

## Exceptions

For a batch where every PR's diff is entirely disjoint from every other PR's diff at the **file** level — verified against the actual PR diffs at merge time, not assumed from planning-time metadata — this risk doesn't materialize.

## Related Files

- `docs/rules/*.md` — living rule-list files are the most common collision point (any PR that adds a rule can collide with any other)
- `.claude/skills/todo/SKILL.md` — Phase 3 dependency analysis models parallel-execution safety, not merge-time safety

## See Also

- [Parallel agent development: shared file ownership creates merge conflicts](parallel-agent-shared-file-merge-conflicts-2026-05-13.md) — sibling lesson, same root cause (shared "living" files) at a different stage (planning-time coordination vs. merge-time integration)
- [Delete a branch only after confirming its PR is merged](../conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md) — same session incident, downstream consequence
