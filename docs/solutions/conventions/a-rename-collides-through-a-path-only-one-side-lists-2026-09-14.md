---
title: "Archiving a file is a delete+add, so two PRs collide through a path only one of them appears to touch — an overlap table cannot see it"
track: bug
category: conventions
tags: [harness, testing, architecture]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh", "docs/solutions/**/*.md"]
symptoms: ["two PRs share no changed file yet GitHub reports the second as CONFLICTING", "a modify/delete conflict on a todo that one PR archives and another edits in place", "a merge-order plan built from changed-file lists misses a pair that really conflicts", "a backlog todo reappears on main for work that already shipped"]
created: 2026-09-14
severity: medium
---

# A rename collides through a path only one side lists

## Problem

Archiving a todo moves `todos/X.md` to `todos/archive/X.md`. To git that is a **delete
plus an add**, so the two PRs involved can collide even though their changed-file lists
share nothing that looks like the same file:

- PR A archives the todo: its list shows `todos/X.md` (deleted) and `todos/archive/X.md` (added).
- PR B merely edits the live `todos/X.md`: its list shows only `todos/X.md`.

Build a merge-order plan by intersecting changed-file lists and this pair reads as
independent. It is not: whichever lands second hits a modify/delete conflict.

## Symptoms

See frontmatter. The tell is a `CONFLICTING` verdict that a file-overlap map says is
impossible.

## Root Cause

Measured 2026-09-14 over 14 open PRs. An overlap-derived lane map put 965 and 957 in
different lanes and never tested the pair. The full pairwise simulation found them
conflicting:

```
965 -> 957 : CONFLICT (1 shared path)
```

965 archives `todos/P3-…-git-safety-re-derives-….md` while 957 modifies the live copy —
and 957's only change to that file was a one-line pointer fix whose whole value was
superseded by 965's own rewrite of the same file.

The first attempt to find these pairs reproduced the bug it was meant to catch: the
script filtered to pairs that **share a changed path** before simulating, which is
exactly the assumption a rename violates. Removing the filter and testing all 78 pairs
found it.

The content problem is worth separating from the mechanics. Whichever order these merge,
`main` ends up either with a backlog todo for work that already shipped, or with the fix
plus a resurrected live todo. Resolving the textual conflict in either direction gives a
wrong answer; the fix is editorial — drop the file from the PR that only touches it
incidentally.

## Solution

**Enumerate pairs combinatorially. Never prefilter by shared paths.**

```bash
base=$(git rev-parse main)
for a in "${BRANCHES[@]}"; do for b in "${BRANCHES[@]}"; do
  [ "$a" = "$b" ] && continue        # and skip i>j for unordered pairs
  t=$(git merge-tree --write-tree "$base" "$a" | head -1)
  c=$(git commit-tree "$t" -p "$base" -m sim)
  git merge-tree --write-tree "$c" "$b" >/dev/null 2>&1 \
    || echo "$a -> $b : CONFLICT"
done; done
```

`git merge-tree --write-tree` needs no checkout and no working tree, so the whole matrix
is cheap — **105 pairs across 15 branches** ran in seconds. Quote the pair count alongside
the result so a reader can tell a complete matrix from a sampled one, **and check it against
the branch count**: a complete matrix has exactly `C(n,2)` pairs, and `C(15,2) = 105`. An
earlier revision of this sentence said "78 pairs across 14 branches", which is not a
possible pair of numbers — `C(14,2)` is 91 and 78 is `C(13,2)`. The sweep really did test
13 branches at that point; two more PRs were opened during it and the re-run below covers
15. A pair count that does not reconcile with its own branch count is exactly the
sampled-looking-complete failure this paragraph warns about, so do the division.

To confirm a rename is a real archive rather than a duplicate add, use
`git diff --name-status -M main...<branch>` and look for an `R` (with a similarity score);
an archive that also amends the file may legitimately show `D` + `A` instead, and the
content difference is the explanation.

## Prevention

- A changed-file list answers "what did this PR touch", not "what can this PR collide
  with". For ordering decisions, simulate.
- When a PR's only change to a file is a cosmetic pointer fix and another open PR rewrites
  that same file, drop it from the first PR rather than resolving the conflict later.
- The same shape applies to any move: splitting a module behind a barrel, relocating a
  solution doc, renaming a workflow.

`applies_to` deliberately does NOT list `todos/**/*.md`, even though todo archival is the
case that produced this. `npx tsx scripts/lib/path-domains.ts todos/P1-x.md` returns no
domain, so a `todos/**` glob routes to nothing and the doc would never inject however
precise the glob looked — the inert-glob trap in `docs/rules/harness.md`. The paths above
are where someone is working when they plan a merge order.

## See Also

- [A clean merge leaves a stale count pin](../code-quality/a-clean-merge-leaves-a-stale-count-pin-2026-09-14.md) — the mirror failure: a pair git calls CLEAN that is nonetheless broken
- [A sampled corpus described as generated](../code-quality/a-sampled-corpus-described-as-generated-2026-09-13.md) — the prefilter above is exactly that failure, applied to pairs
