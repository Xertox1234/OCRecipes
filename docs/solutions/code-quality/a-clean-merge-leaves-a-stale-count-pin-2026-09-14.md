---
title: "Two branches that each add assertions leave the merged tree's count pin too low — git never conflicts because the two sides never textually disagree about the pin line, and with strict:false CI never re-runs"
track: bug
category: code-quality
tags: [harness, hooks, testing, safety-gate, bash, security]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh", ".github/workflows/*.yml"]
symptoms: ["two PRs are each green and `git merge-tree` reports no conflict, but the second one turns main red on the next push run", "a hook suite fails with 'assertion total is N, expected M' immediately after an unrelated PR merged", "`gh pr view` shows mergeStateStatus CLEAN for a PR whose suite will fail once its sibling lands", "a pinned EXPECTED_TOTAL / EXPECTED_ROWS is correct on each branch alone and wrong on their union"]
created: 2026-09-14
severity: high
---

# A clean merge leaves a stale count pin

## Problem

Every hook suite in this repo pins its own assertion total
(`EXPECTED_TOTAL`, `EXPECTED_ROWS`, `EXPECTED_PRECISE_GAPS`). The pin is the thing that
catches a silently skipped assertion — without it a `command not found` mid-loop
subtracts a row and the suite still prints a clean pass/0 fail.

That pin is also a single line holding a **number derived from the whole file** — so it is
the one line in the suite whose correct value depends on every *other* line, including
lines a different branch adds.

The intuition is that two branches bumping one line must conflict. Measured, they do not,
because in practice **the two sides never textually disagree about the pin line**:

- one side may *introduce* the pin while the other only adds rows, so the second side has
  no pin line to update and the two edits are disjoint; or
- both sides may compute the *same* new value and make the byte-identical edit, which git
  merges silently — agreement is precisely what makes it invisible.

Either way the merged tree carries **both** branches' rows under a pin that was correct for
only one of them. A pin that genuinely differs on the two sides is the case git *does*
catch; it is not the dangerous one.

## Symptoms

See frontmatter. The tell is that each PR is green in isolation and `merge-tree` reports
no conflict, so nothing in the normal workflow surfaces it until it is on `main`.

## Root Cause

Measured 2026-09-14 across three independent suites, by materialising the simulated merge
(`git merge-tree --write-tree` -> `git commit-tree` -> `git archive | tar -x`) and running
each suite's own runner against it. Re-measured at the branch heads quoted below after
eight repair commits had landed, because the first reading described a tree that no longer
existed:

| pair | `merge-tree` | suite on the merged tree | why no conflict |
| --- | --- | --- | --- |
| git-safety: 965 ⊕ 956, **either order** | **clean** | `220 passed, 1 failed` — `assertion total is 220, expected 153` | **disjoint edits**: 965 *adds* the pin (`main` has none); 956 adds rows only |
| merge-review-guard: 964 then 957 | **clean** | `109 passed, 2 failed` — `assertion total is 110, expected 95` | **identical edits**: both sides write `EXPECTED_TOTAL=80` -> `95` |
| outward-CLI corpus: any two of 968/967/966/957 | CONFLICT | n/a — git blocks it | overlapping row blocks |

Heads: 965 `24a40f8b`, 956 `a59100c1`, 964 `042fda74`, 957 `76c035d1`, base `68ac77f1`.

Controls, same sandbox and runner, because a merged-tree failure means nothing without
them: `test-git-safety.sh` on plain `main` is `126 passed, 0 failed` (and carries **no
pin at all** — 965 is the branch that introduces one); 965 alone is `153/0`; 956 alone is
`193/0`. For the merge-review lane, plain `main` already shows exactly 1 failure (a sandbox
artifact — the tar-extract has no `.git`), and both branches alone show that same 1, so the
merged tree's SECOND failure is the real one.

Two details are worth more than the totals:

**The git-safety lane is order-independent.** Both `965 then 956` and `956 then 965`
produce the identical `220 passed, 1 failed`. There is no competing pin value to choose
between, so there is no "merge this one first" that saves you — the usual remedy for a
merge-coupled file does not apply.

**The merge-review lane fails *because* the branches agreed.** 964 and 957 each added 15
assertions and each independently arrived at 95. Git merged the byte-identical change with
nothing to report. Had they disagreed — say 94 and 96 — git would have raised a conflict
and a human would have looked. The silent case is the one where both sides are individually
right.

The outward-CLI row is the instructive contrast: that lane conflicts, so **git protects
it**. The dangerous lanes are the ones git calls clean.

### Why it reaches `main` instead of the PR

`main`'s branch protection has `required_status_checks.strict = false` (verify:
`gh api repos/<owner>/<repo>/branches/main/protection --jq '.required_status_checks.strict'`).
A PR therefore merges on **its own existing green**, without being brought up to date and
without re-running CI against the new `main`. So the second merge in a lane lands
unverified and the failure appears on `main`'s own push run, not on the PR that caused it.

CI does run these suites — via `scripts/run-hook-tests.sh`, which GLOBS
`.claude/hooks/test-*.sh` inside the required `Lint · Types · Patterns` check. A
literal-filename grep of `.github/workflows/` misses that; only the corpus script is named
outright. So "is this suite even in CI?" is not answerable by grepping the workflow.

## Solution

**Within a lane, only the FIRST merge may ride its existing green.** Every successor must
be synced to `main` and re-verified BEFORE merging.

Note what this does *not* say. Picking a better order is not a fix: the git-safety lane
above fails identically in both directions. Re-verification after the sync is the whole
remedy; the ordering only decides which branch has to do it.

Find the lanes combinatorially, not from an overlap table:

```bash
base=$(git rev-parse main)
for a in "${BRANCHES[@]}"; do for b in "${BRANCHES[@]}"; do
  [ "$a" = "$b" ] && continue
  t=$(git merge-tree --write-tree "$base" "$a" | head -1)
  c=$(git commit-tree "$t" -p "$base" -m sim)
  git merge-tree --write-tree "$c" "$b" >/dev/null 2>&1 \
    && echo "$a -> $b : clean (verify the SUITE, not just the merge)" \
    || echo "$a -> $b : CONFLICT (git protects this one)"
done; done
```

Then run the affected suite against the materialised merge tree — a clean `merge-tree`
is the signal to check, not the all-clear.

**Recompute the pin; never compute it arithmetically.** "main's 602 plus each branch's
delta" is wrong whenever two branches add a row with the same id, and the corpus check
covers "rows, gap totals, **per-ID manifests**". Run the script and read the true number
off it. Do this separately per pin: a branch can LOWER one (a PR that closes gaps takes
`EXPECTED_PRECISE_GAPS` 31 -> 24), so after a gap-adding predecessor neither the old nor
the new value is right.

## Prevention

- Treat a pinned total as **merge-coupled state**, like a migration number — two branches
  touching one need an explicit re-verification, not a merge.
- **Adding a pin to a suite that did not have one is the highest-risk version of this.**
  Every other open branch touching that suite was written against a base with no pin, so
  none of them can update it and none of them will conflict with you. Before introducing a
  pin, check what else is open against that file.
- When adding a suite, add the pin (every sibling has one), and say in its comment that it
  must be re-derived from a clean run, never hand-incremented.
- A green PR plus a clean `merge-tree` is not evidence the union is green. Under
  `strict:false` nothing else will check before it lands.

## Related Files

- `scripts/run-hook-tests.sh` — the glob loop that puts every `.claude/hooks/test-*.sh`
  into the required check
- `.claude/hooks/repro-outward-cli-corpus.sh` — the one suite named literally in CI

## See Also

- [A pin records its VALUE but must also record whether it is CORRECT](a-pin-records-its-value-but-must-also-record-whether-it-is-correct-2026-09-13.md) — the same pin, one layer in: this doc is about two branches, that one about one branch's verdict
- [A measurement belongs to the tree it was taken on](a-measurement-belongs-to-the-tree-it-was-taken-on-2026-09-13.md) — why re-deriving the pin on the MERGED tree is the only valid reading
- [A clean zero needs its denominator](a-control-that-runs-before-the-work-cannot-validate-it-2026-09-07.md) — why the per-branch controls above are load-bearing
