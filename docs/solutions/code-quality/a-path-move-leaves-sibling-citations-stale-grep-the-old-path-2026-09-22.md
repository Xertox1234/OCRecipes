---
title: "A path move leaves every other citation of the old path stale — sweep the corpus for the OLD path string, not the hunk you came to edit"
track: bug
category: code-quality
tags: [harness, documentation, code-quality, citations, todos]
module: shared
applies_to: ["docs/solutions/**/*.md", "todos/**/*.md", "docs/**/*.md"]
symptoms: ["A doc cites todos/archive/<slug>.md (or any moved path) that does not exist on the branch", "A PR corrects one occurrence of a stale path and leaves an identical occurrence a few lines away in the same file", "A Related Files entry is repointed while the Why or Background prose still carries the pre-move path", "Review finds the second occurrence the author's own diff did not"]
created: 2026-09-22
severity: low
---

# A path move leaves every other citation of the old path stale — sweep the corpus for the OLD path string, not the hunk you came to edit

## Problem

When a file moves — a todo archived, un-archived, or renamed; a solution doc re-categorised — every
citation of its **old** path anywhere in the corpus becomes false at once. The author fixes the
citation in front of them (the one in the hunk they came to edit) and ships the rest, because
nothing mechanical objects: a markdown citation of a non-existent path is not a lint error, and
`scripts/check-solution-frontmatter.js` validates frontmatter, not body text.

## Symptoms

- A doc cites `todos/archive/<slug>.md` while `ls` says the file lives at `todos/<slug>.md` (or
  the reverse, after an archive).
- A PR corrects one occurrence of the stale path and leaves an identical occurrence a few lines
  away in the **same file**.
- `## Related Files` is repointed; the `## Why` prose still carries the pre-move path.

## Root Cause

The edit is driven by the **hunk** (the section under the cursor) rather than by the **target**
(the string that changed). Sweeping by location or phrasing returns an open set — you find the
occurrences you happen to look at. Sweeping by the moved path returns a closed set — every
occurrence, or none.

Measured on PR #960 (reviewed 2026-09-21). The E2E-cache todo had been un-archived by PR #918, so
`todos/archive/P3-2026-08-31-e2e-ios-job-cache-pods-and-deriveddata.md` no longer existed. The PR
corrected that path in the companion solution doc's `## Related Files` (with a note explaining the
un-archive) and left the identical string in the same file's `## Why` section, earlier in the
same file. Review found the second; the fix was one commit (`fb1ae735`) and one extra review round.

## Solution

Before committing any change that moves, renames, archives or un-archives a file, sweep by the
old path string and fix every live hit in the same commit:

```bash
git grep -nF 'todos/archive/P3-2026-08-31-e2e-ios-job-cache-pods-and-deriveddata.md'
```

Justify each survivor explicitly. A historical Updates-log line that describes the old location in
the past tense is fine; a live citation ("see `<old path>`") is not. For a todo, the old path is
`todos/<slug>.md` on archive and `todos/archive/<slug>.md` on un-archive.

## Prevention

- Sweep by **target string**, never by the section you are in. Do it **after** the last edit — a
  rewrite can re-introduce the path.
- A `/todo` executor's codification step already repoints `## Related Files` in the one
  near-duplicate solution doc it knows about; that is one file, not the corpus.
- A reviewer who finds one stale citation should grep for the string before filing, so the finding
  names every occurrence and the fix needs one round, not two.

## Related Files

- `docs/solutions/conventions/ci-cache-key-inputs-must-precede-mutating-step-2026-09-02.md` — the
  file with one fixed and one missed citation (PR #960: the Related Files one fixed by `138b9091`, the missed Why one by `fb1ae735`)
- `scripts/check-solution-frontmatter.js` — validates frontmatter only; body citations are not
  checked by anything

## See Also

- [an archive move git reads as delete plus add](an-archive-move-git-reads-as-delete-plus-add-mis-scopes-the-review-stamp-2026-09-17.md) — the same event (an archive move) with a different casualty (the review stamp's scope digest)
- [a merge invalidates positional references](a-merge-invalidates-positional-references-into-a-file-it-did-not-change-2026-09-15.md) — line-number citations rot on a merge the way path citations rot on a move
- [resumed reviewer never stamps](../conventions/resumed-reviewer-never-stamps-re-adjudicate-by-fresh-dispatch-2026-09-22.md) — the review round this finding came from
