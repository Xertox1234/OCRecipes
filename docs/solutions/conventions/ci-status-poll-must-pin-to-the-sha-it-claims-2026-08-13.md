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
the PR number. Strongest form — ask for the checks **of that SHA**, so every answer is bound to the
commit by construction rather than by inference:

```bash
# "finished?" and "green?" are different questions — ask them separately.
gh api "repos/{owner}/{repo}/commits/$SHA/check-runs" \
  --jq '[.check_runs[]] | length>0 and all(.[]; .status=="completed")'    # finished
gh api "repos/{owner}/{repo}/commits/$SHA/check-runs" \
  --jq '[.check_runs[]] | length>0 and all(.[]; .conclusion=="success")'  # green
```

A **failed** check is `status: "completed"`, and so is a **cancelled** one — so the first predicate
alone is a *completion* gate, never a pass. Reporting it as "CI green" is the same vacuous-success
mistake this rule exists to prevent.

`cancelled` is the likelier accident of the two, because pushing a new commit cancels the previous
head's in-flight runs. That produces the perfect trap: a poll still watching the old head sees its
runs flip to `completed`, announces done, and the conclusions are a mix of `cancelled` and
`success`. Observed on this branch 2026-08-13 — `6d39ce78`'s runs were cancelled by the push of
`99dfd912`, and a poll left armed on the old SHA reported "CI COMPLETE" for them.

Weaker but often adequate — correlate the head OID with the check states:

```bash
SHA=<full-or-short-sha>   # compared as a PREFIX, so either length works
until case "$(gh pr view "$N" --json headRefOid --jq .headRefOid)" in "$SHA"*) true;; *) false;; esac \
      && gh pr checks "$N" --json name,bucket | jq -e 'length>0 and all(.[]; .bucket!="pending")' >/dev/null
do sleep 20; done
```

Compare as a prefix, not with `=` against a fixed slice. `--jq '.headRefOid[0:8]'` returns exactly
8 characters, so an equality test silently never matches a full 40-char SHA **or** git's default
7-char short SHA — the loop just spins forever, which reads as "CI is slow".

**Know what that second form does and does not prove.** It is two independent API calls — `gh pr
view` resolves `pullRequest.headRefOid`, `gh pr checks` resolves the commit's `statusCheckRollup` —
with no shared response tying them to the same commit, and `gh pr checks --json` exposes **no
oid/sha field at all** (its full field set is `bucket, completedAt, description, event, link, name,
startedAt, state, workflow`). So it is a *correlation*, not an atomic read: it closes the window
this rule is about, but a head change landing between the two calls is still unobserved. Prefer the
SHA-keyed form when the claim matters.

The `length>0` guard is not optional in either form. `jq 'all(.[]; …)'` is **vacuously true on an
empty array**, so without it a poll passes the instant the check list is empty — which is exactly
the state right after a push.

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
  strictly need the guard — but pinning is free in the SHA-keyed form (the SHA *is* the query) and
  costs one extra `gh pr view` per iteration in the weaker one, so prefer it by default.
- **The `--auto` merge path does not need this at all.** `gh pr merge --auto` is evaluated
  server-side by GitHub against the PR's current head on every push, so an armed auto-merge cannot
  land a commit whose checks did not pass. This rule is about *your own* reporting and gating loops.
  Read the exception narrowly: a **non-`--auto`** `gh pr merge` fired after a poll is precisely the
  case that does need pinning — and `gh` ships a native flag for it, `--match-head-commit SHA`
  (present in `gh` 2.95.0), which refuses the merge if the head moved. Prefer it over a hand-rolled
  guard.
- **Do not substitute a fixed sleep.** "Wait five minutes then read" has the same defect with worse
  ergonomics — it still cannot say which commit the reading belongs to.
- **Pin to the PR *head*, not to the squash-merge commit.** Squash-merging creates a new commit that
  CI never ran on. Measured on this repo 2026-08-13: the PR head `8aafefe0` has 10 check-runs, all
  `completed`/`success`, while the resulting squash commit `7a50a1db` on `main` has **`total_count:
  0`**. Asking a post-merge SHA "were your checks green?" gets an empty set — which is precisely why
  the `length>0` guard matters: without it, an empty set answers **yes**.

## Related Files

- `.claude/skills/land/SKILL.md` — the merge ritual's CI-truth step, and the commit-status
  measurement artifact it warns about

## See Also

- [A verification that scans ZERO inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md)
  — the same shape: a green that measures something other than the claim
- [A comparison over a LOSSY projection of the value reports a false match](../logic-errors/comparison-over-a-lossy-projection-reports-a-false-match-2026-08-07.md)
  — checking a proxy (the PR) instead of the thing (the commit)
