---
title: "Landing a stacked PR series: merge commits (not squash), re-set each child's base after its parent merges, and ship a hand-written prod migration with any Drizzle schema change"
track: knowledge
category: conventions
module: shared
tags: [database, harness, git, github, stacked-prs, merge, migrations, railway, drizzle]
applies_to: ["migrations/**", "shared/schema.ts"]
created: 2026-10-05
---

# Landing a stacked PR series

Measured landing the seven-PR Sign in with Apple stack (#1260–#1268, 2026-10-05).

## 1. Merge commits, not squash

Each child branch contains its parent's commits. After a SQUASH of the parent, `main`
has those changes as one new commit the child does not share, so the child's merge
base stays at the old `main` and files both sides added (add/add) conflict.
Simulated before merging: squash conflicted at the second PR
(`server/storage/identities.ts`, `shared/schema.ts`); merge commits went clean through
all seven. `main` does not require linear history (`required_linear_history: false`).

Simulate first, without touching any branch:

```bash
M=$(git rev-parse origin/main)
for b in <branches in order>; do
  t=$(git merge-tree --write-tree $M origin/$b) || { echo "$b CONFLICT"; break; }
  M=$(echo sim | git commit-tree $t -p $M -p origin/$b)   # drop "-p origin/$b" to model squash
done
```

Then prove the result: `git diff <main-before> origin/main` must equal the branch's own
delta (same file set and line counts).

## 2. Retarget the child before merging its parent — then re-set its base AFTER

`delete_branch_on_merge` is on, so retarget each child to `main` before its parent
merges. But GitHub caches the PR's base SHA at retarget time: once the parent lands,
the PR's file list still diffs against the OLD `main` (41 files instead of 30 on #1261),
and the merge-review gate keys its review record on that file list, so it refuses the
merge ("none was scoped to PR #N's changed files"). Re-setting the same base
(`update_pull_request base: main`) makes GitHub recompute; confirm with
`gh pr view N --json files --jq '.files|length'` against
`git diff --name-only origin/main...origin/<branch> | wc -l`.

## 3. A Drizzle schema change needs a hand-written prod migration in the PR

Prod runs no `db:push` on deploy and merging to `main` auto-deploys (see `migrations/0016`
header). The stack changed `shared/schema.ts` (nullable `users.password`, three new tables)
and `/api/auth/me` reads a new table, but the plan had no migration task. Caught only at
merge time. Write `migrations/NNNN_*.sql` with the schema change, idempotent, with
Drizzle's constraint names (`{table}_{column}_{reftable}_{refcol}_fk`). Verify it before
anyone runs it in prod: apply it twice to a scratch DB, then `pg_dump --schema-only -t`
the tables and `diff` against a `db:push`-created dev DB (identical, or a later
`db:push` sees drift). The owner applies it to prod BEFORE the merge.
