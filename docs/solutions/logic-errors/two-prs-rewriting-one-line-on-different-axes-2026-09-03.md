---
title: "Two PRs that rewrite the SAME line on DIFFERENT axes produce one git conflict whose every one-sided resolution silently reverts a verified fix"
track: bug
category: logic-errors
tags: [harness, security, merge-conflict, false-negative, review-process]
module: server
applies_to: [".claude/hooks/**", "server/**", "client/**"]
symptoms: ["Two independently reviewed and merged-green PRs each changed the same source line, each for a different and individually-correct reason", "git reports a single ordinary conflict and both `--ours` and `--theirs` produce a syntactically valid, test-passing file", "A security fix or behavioural fix that CI verified on its own branch is silently absent from main after the merge", "A comment ABOVE the conflicted line still describes a property the resolved code no longer has", "No CI job anywhere ever executed the two changes together"]
created: 2026-09-03
last_updated: '2026-09-03'
severity: critical
---

# Two PRs, one line, two axes: every one-sided resolution reverts something

## Problem

`.claude/hooks/guard-outward-cli.sh` cuts a clause for its `gh api` check. Two PRs
in the same batch each rewrote **that one line**, on axes that do not overlap:

- **PR #912** changed the **source**: `$WORDS` → `$WORDS_DEEP`, so the cut sees inside a
  balanced command substitution.
- **PR #910** changed the **suffix**: a hardcoded literal `[[:space:]]` → the shared
  `${_OUT_POS_SUFFIX}` anchor, closing a confirmed-live brace-glued bypass
  (`gh api{,x} -X POST …` was counted as an occurrence but produced an empty clause, so
  the mutating-HTTP-method deny never fired).

Both PRs were reviewed, both were CI-green, both were correct. Git reported one conflict.

**Every one-sided resolution ships a regression:**

| Resolution | What silently reverts |
|---|---|
| take PR #910's line | the deep read — while the unconflicted comment above still documents it |
| take PR #912's line | the boundary fix — reopening the confirmed-live brace-glued bypass |

Neither reversion changes a test result. Both files pass `bash -n`. The hook suite was
green on each branch alone, and `strict: false` branch protection means GitHub never
recomputes checks against the combination — so **no CI job anywhere executes the two
changes together**. The bad resolution reaches `main` looking exactly like a good one.

## Root Cause

A conflict marker delimits *text*, not *intent*. When two changes to one line are
**orthogonal** — different axis, different reason, no shared vocabulary — git has no way
to represent "both apply" and a human resolving quickly sees two plausible-looking lines
and picks the newer, the longer, or the one whose branch they were thinking about.

The failure is invisible precisely because each side is individually correct. There is
nothing wrong to notice in the losing line.

## Solution

**Resolve by axis, not by side.** For each conflicted line, name every axis that changed
and confirm the resolution carries all of them:

```bash
# For the line in question, diff it against the MERGE BASE from each side separately.
git show "$BASE:path/to/file"   | sed -n "${LINE}p"
git show "$BRANCH_A:path/to/file" | grep -n 'THE_SYMBOL='
git show "$BRANCH_B:path/to/file" | grep -n 'THE_SYMBOL='
```

Three different values for one symbol = two axes = the resolution must combine them, not
choose. In the case above the correct line was neither side's:

```bash
GH_API_CLAUSE=$(printf '%s' "$WORDS_DEEP" | grep -oiE "${_OUT_POS_PREFIX}gh[[:space:]]+api${_OUT_POS_SUFFIX}[^;&|]*" | head -1)
#                                ^^^^^^^^ PR #912's axis          PR #910's axis ^^^^^^^^^^^^^^^^^^^
```

**Combining is not automatically safe — justify it.** Widening both axes widens what the
pattern captures. That is sound *here* only because this clause is **deny-shaped**: its
consumer denies on finding a flag, so over-capture can only ever add a deny. The
sibling `gh pr merge` clause in the same file is **grant-shaped** (it grants a carve-out
on finding `--auto`), and there the deep source would let a decoy substitution manufacture
a grant. Same file, same shape of conflict, opposite correct answer. Ask which direction
over-capture fails in before combining.

**Build the merged tree and run the suite before merging any of them.** The combination is
an artifact CI never builds:

```bash
git switch -c integration/<cluster> main
for br in "${BRANCHES[@]}"; do git merge --no-ff --no-edit "origin/$br" || break; done
bash scripts/run-hook-tests.sh   # the only place the combination is ever executed
```

Then resolve each real PR against `main` by taking the files **byte-identical** from the
integration commit you actually tested (`git checkout <sha> -- <paths>`), rather than
re-resolving by hand per PR and hoping the second resolution matches the first.

## Prevention

- **The unconflicted lines around a conflict are evidence.** Here the comment directly
  above the conflicted line — auto-merged, never shown as conflicting — still said the cut
  reads the deep source. A resolution that contradicts its own surrounding comment is the
  loudest available signal that an axis was dropped. Read the context hunk, not just the
  marker block.
- **A shared-file cluster needs one integration pass before any of it merges.** Detect the
  cluster mechanically rather than by memory:
  ```bash
  for n in "${PRS[@]}"; do gh pr view "$n" --json files --jq ".files[].path" | sed "s|^|$n |"; done \
    | sort -k2 | awk '{c[$2]=c[$2]" "$1} END{for(f in c) if (split(c[f],a," ")>1) print f":"c[f]}'
  ```
- **`strict: false` branch protection means green checks are stale the moment the first PR
  in a cluster merges.** `mergeStateStatus: CLEAN` asserts no *textual* conflict and
  nothing about semantics. Never read it as "verified against current main."
- Related but distinct: `occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md`
  is the SAME-PR version (a detector widened without its sibling consumer). This file is the
  CROSS-PR version, where no single reviewer ever saw both halves.

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — `GH_API_CLAUSE=` (the two-axis line, with a
  `MERGE RESOLUTION 2026-09-03` comment recording why both axes are present) and the
  sibling `CLAUSE=` for the grant-shaped contrast.
- `.claude/hooks/lib/cmd-detect.sh` — `cmd_words` / `cmd_words_deep`, the two sources.

## See Also

- `docs/solutions/logic-errors/occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md`
- `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`
- `docs/solutions/logic-errors/deny-reason-assertion-goes-stale-when-a-stricter-branch-fires-first-2026-09-03.md`
