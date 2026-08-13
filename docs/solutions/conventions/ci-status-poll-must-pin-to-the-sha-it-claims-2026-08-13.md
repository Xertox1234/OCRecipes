---
title: A CI-status poll keyed to a PR number can report the previous head's result — pin it to the SHA
track: knowledge
category: conventions
module: shared
tags: [harness, tooling, ci, github, verification, testing]
applies_to: [.claude/skills/**, scripts/**]
created: '2026-08-13'
---

# A CI-status poll keyed to a PR number can report the previous head's result — pin it to the SHA

## Rule

Any automated wait-for-CI must pin to the **commit SHA** whose result it claims to report, not to
the PR number. Poll the head OID and the check states together, and require both to line up:

```bash
SHA=<full-or-short-sha>
until [ "$(gh pr view "$N" --json headRefOid --jq '.headRefOid[0:8]')" = "$SHA" ] \
      && gh pr checks "$N" --json name,bucket | jq -e 'length>0 and all(.[]; .bucket!="pending")' >/dev/null
do sleep 20; done
```

If you push while a poll is already running, **stop the poll and restart it against the new SHA**.

## Smell patterns

- A background wait-for-CI loop is armed, and then a commit is pushed to the same PR (a review fix,
  a lint repair) without touching the loop.
- The success condition is "no check is pending" with no statement of *which commit* those checks
  belong to.
- A CI result is reported in prose without a SHA next to it.

## Why

There is a window, right after a push, in which the new head's check runs have not been registered
yet while the previous head's runs are all complete. A poll whose only condition is "every check is
non-pending" is **satisfied by the old run** during that window, and reports green for a commit CI
has not seen. Nothing errors; the answer is simply about a different commit than the one you are
about to merge.

This is the same failure family as a verification that scans zero inputs — the check runs, exits 0,
and measures something other than what it claims. See
[a verification that scans ZERO inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md).

It also compounds a hazard the merge ritual already names: on this repo the legacy commit-status API
returns `total_count: 0` even when CI is fully green, so an empty status response is a measurement
artifact and never evidence. Both traps have the same shape — a reading that looks like an answer
but is not about the thing you asked.

## Examples

Observed 2026-08-13 on PR #805. A poll was running:

```bash
until gh pr checks 805 --json name,bucket | jq -e 'all(.[]; .bucket!="pending")' >/dev/null
do sleep 20; done          # ← keyed to the PR, not to a commit
```

Review fixes were then pushed, moving the head from `87b777b6` to `5a6ac348`. The loop was stopped
before it could fire, precisely because its green would have described `87b777b6` — the commit the
review had already superseded — while reading as a pass for the new head. It was restarted with the
SHA guard above and only then produced a result that covered the commit actually being merged.

The same discipline applies to the human-readable claim: report "CI green on `8aafefe0`", not "CI
green", so a stale reading is falsifiable by anyone reading the sentence.

## Exceptions

- **A poll that will only ever see one head** (nothing else can push, and you will not) does not
  need the guard — but the guard costs one `gh pr view` per iteration, so prefer it by default.
- **The `--auto` merge path does not need this at all.** `gh pr merge --auto` is evaluated by GitHub
  against the current head, so an armed auto-merge cannot land a commit whose checks did not pass.
  This rule is about *your own* reporting and gating loops.
- **Do not substitute a fixed sleep.** "Wait five minutes then read" has the same defect with worse
  ergonomics — it still cannot say which commit the reading belongs to.

## Related Files

- `.claude/skills/land/SKILL.md` — the merge ritual's CI-truth step, and the commit-status
  measurement artifact it warns about

## See Also

- [A verification that scans ZERO inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md)
  — the same shape: a green that measures something other than the claim
- [A comparison over a LOSSY projection of the value reports a false match](../logic-errors/comparison-over-a-lossy-projection-reports-a-false-match-2026-08-07.md)
  — checking a proxy (the PR) instead of the thing (the commit)
