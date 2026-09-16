---
title: "A merge invalidates positional references into a file it did not change — the cited file stays byte-identical and every citation still becomes wrong"
track: bug
category: code-quality
tags: [harness, hooks, bash, git, code-review]
module: shared
applies_to: [".claude/hooks/*.sh", "scripts/**/*.sh", "todos/**/*.md", "docs/solutions/**/*.md"]
symptoms: ["A comment cites other-file.sh:NNNN and the symbol is 78-249 lines away", "Citations were correct when written, nobody edited the cited file, and they are all wrong now", "git diff shows the cited file is byte-identical between your branch and main", "A todo's Acceptance Criteria points an executor into an unrelated comment", "Two long-lived branches each cite the same third file at different line numbers"]
created: 2026-09-15
severity: medium
---

# A merge invalidates positional references into a file it did not change

## Problem

A comment block in `.claude/hooks/repro-outward-cli-corpus.sh` cited eleven symbols
in `.claude/hooks/guard-outward-cli.sh` by `path:line`. Every one was correct when
written and every one was wrong at review time:

| symbol | how far the merge moved it |
| --- | --- |
| `_OUT_REPO_FLAG_RE` | +78 |
| `_OUT_POS_PREFIX` | +92 |
| `GH_MERGE_VALUE_FLAGS` | +249 |
| `GH_MUTATING_RE` | +249 |

The shifts are recorded, the destinations are not, and that is deliberate — see
below. **This table originally gave both.** It listed each symbol's new absolute
line, measured correctly at the time of writing, and review found all four wrong
before this file had even merged: the commit that landed immediately before it
added 130 lines to `guard-outward-cli.sh` while being titled about a different
file entirely, so every destination was off by exactly +130. A document about
merge-delivered positional staleness had its own evidence invalidated by a merge,
one commit before it shipped. Nothing better argues for the rule it is here to
state, so the incident is kept rather than quietly corrected.

The confusing part, and the reason it survived a review round: **`guard-outward-cli.sh`
was byte-identical between `origin/main` and the branch.**

```bash
git diff origin/main...HEAD -- .claude/hooks/guard-outward-cli.sh   # empty
```

Nothing that was cited had changed. The citations were wrong anyway.

## Symptoms

- A comment cites `other-file.sh:NNNN`; the named symbol is there, just not at that line.
- The offsets are large (78-249 lines here) and cluster on a few values rather than
  varying smoothly — a sign of insertion above, not of the symbol moving. Three
  distinct deltas means three insertion points upstream of the citations.
- `git diff main...HEAD -- <cited file>` is EMPTY, which makes the citations look
  like they cannot have decayed.
- A todo's Acceptance Criteria names a line number and a future executor lands in
  unrelated code.

## Root Cause

The branch was cut when `guard-outward-cli.sh` was shorter. `main` then grew that
file (unrelated work). The branch merged `main`, which replaced its copy of the
guard with main's longer one — but the *citing* file's comments were written against
the branch's older copy and were carried through the merge untouched, because
nothing in them conflicted.

So the decay is delivered by an operation that touches neither the citing comment
nor the cited symbol. The usual mental model — "a reference decays when someone
edits above it" — is correct but incomplete: **the edit above it can arrive in your
branch from somebody else's work, through a merge, in a file you never opened.**
A merge is precisely the operation that delivers those edits silently and in bulk.

A second-order trap: the *source* branch's citations are fine on the source branch,
and the *target* branch's citations are fine on the target. Neither side's review
sees a problem. Only the merged tree is wrong, and only the merged tree is what
ships.

## Solution

Delete the line numbers. Cite the NAME.

```bash
# BEFORE — decays on any merge that lengthens the cited file
#      _OUT_GATED_BIN   guard-outward-cli.sh:2274   6 branches
#      GH_MERGE_VALUE_FLAGS guard-outward-cli.sh:2493  25 branches

# AFTER — grep resolves this on any tree, forever
#      All of these live in guard-outward-cli.sh, cited BY NAME and not by line
#      number on purpose.
#      _OUT_GATED_BIN            6 branches
#      GH_MERGE_VALUE_FLAGS     25 branches
```

**Re-deriving the numbers is the wrong repair.** A re-derived number is correct
exactly until the next merge, and it re-arms the same trap for the next reader.
Deleting it is strictly better: the name is stable, greppable, and self-verifying.
This is the same "prefer deleting an unsafe instruction over re-specifying it"
judgement that applies to stale prose generally.

Scope the repair to references YOUR branch added. Pre-existing citations on `main`
are not yours to churn in an unrelated PR — establish which are which:

```bash
git show origin/main:path/to/citing-file | grep -cE 'cited-file\.sh:[0-9]+'
grep -cE 'cited-file\.sh:[0-9]+' path/to/citing-file
```

## Prevention

- Do not write `path:line` for anything outside the file you are editing. Inside
  one file a line number is merely fragile; across files it is fragile AND
  invalidated by other people's merges.
- When a long-lived branch takes a merge, treat every cross-file positional
  reference in the diff as suspect by default — the merge is the event that
  breaks them, so the merge commit is where they must be re-checked.
- A mechanical sweep is cheap:
  ```bash
  grep -nE '[A-Za-z0-9_-]+\.sh:[0-9]+' <file>
  ```
  For each hit, resolve the symbol and compare. Anything that does not match is
  a finding, not a nit — the whole value of the comment is that it points somewhere.

## Related Files

- `.claude/hooks/repro-outward-cli-corpus.sh` — carried the eleven stale citations
- `.claude/hooks/guard-outward-cli.sh` — the cited file, byte-identical throughout
- `.claude/hooks/repro-outward-cli-corpus.sh` — carries the surviving note, "WHY THIS
  BLOCK CITES NAMES AND NOT LINE NUMBERS", written when the citations were stripped

## See Also

- [[a-positional-reference-decays-anchor-instead-2026-09-13]] — the general rule; this
  file is the merge-delivered special case, where the cited file never changes
- [[a-measurement-belongs-to-the-tree-it-was-taken-on-2026-09-13]] — same shape for
  figures rather than locations
- [[a-clean-merge-leaves-a-stale-count-pin-2026-09-14]] — the same merge delivering
  the same class of staleness to a pinned count
