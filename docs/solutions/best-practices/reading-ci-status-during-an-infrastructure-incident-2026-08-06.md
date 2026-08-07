---
title: Reading CI status during an infrastructure incident
track: knowledge
category: best-practices
module: shared
tags: [ci, github-actions, architecture, testing, workflow, verification]
applies_to: [.github/workflows/*.yml, .github/workflows/*.yaml]
symptoms: ["A gate keyed on all checks completed passes while jobs were cancelled or timed out", "gh pr checks reports 0 failed but far fewer checks than the workflow defines", "A check name contains a literal unexpanded expression", "gh run list --commit returns nothing for a commit that has runs"]
created: '2026-08-06'
---

# Reading CI status during an infrastructure incident

## When this applies

During a CI provider incident — the GitHub Actions major outage of **2026-08-06** is the
worked example — the usual reading of a PR's checks is unsafe. Every item below was
earned during that outage, and each one describes a way a run looks green, looks done,
or looks absent while none of those is true.

This is an operational checklist for a human or agent deciding "can I merge this?", not
a review rule. It has deliberately **no agent-file entry**.

## The checklist

### 1. Count SUCCESSES, not completions

Cancelled jobs and timed-out jobs both report status `completed`. A gate keyed on "all
checks completed" reads a half-dead run as done. Filter on the **conclusion** (`success`)
and count it; never treat `completed` as a verdict.

### 2. Check the registered check COUNT against the expected full set

A run can register a fraction of its jobs and report no failures, because the jobs that
would have failed never registered. PR #764 showed **4** registered checks where **10**
were expected, and `gh pr checks` summarised that as "0 failed". "Nothing failed" over a
truncated set is not information.

**Compare against the count expected _at this stage_, not the total.** A job with
`needs:` does not register until its dependency completes, so a healthy in-progress run
is legitimately short. In `.github/workflows/ci.yml`, `test` (3 shards),
`integration-http` and `coverage` all declare `needs: checks` — so **4 registered while
"Lint · Types · Patterns" is still pending is the normal early state**, not a symptom.
A raw count against the total false-positives on every run in that window, which is the
fastest way to make this checklist item ignored. What is diagnostic is a short count
**after** the gating job has concluded.

### 3. An unexpanded `${{ }}` in a check NAME is a hard tell

A check named literally:

```
Tests (shard ${{ matrix.shard }}/${{ strategy.job-total }})
```

means the workflow **never expanded its job matrix** — the tests did not run and cannot
run. That run can never produce a verdict; do not wait on it, re-trigger it. Any literal
`${{` in a rendered check name is the same signal.

### 4. Distinguish "queued" from `completed/failure`

A **queued** check will eventually run: waiting is bounded and correct. A check that is
`completed` with conclusion `failure` is **dead** and needs an explicit re-trigger —
waiting on it is unbounded, and during an incident it is the most common way an hour
disappears. Read the pair (status, conclusion), never status alone.

### 5. Use the Checks API, not `gh run list --commit`

During recovery, `gh run list --commit <sha>` returned **empty** for commits whose runs
the Checks API listed correctly. The workflow-runs view and the checks view are
different backends with different recovery curves; the Checks API is the one that
matches what branch protection evaluates.

### 6. Re-verify against the CURRENT base after a long block

A PR blocked for hours accumulates base drift, so its eventual green was computed
against a **stale** merge-base. Main moved **five commits** while #764 was stuck. The
merge was justified explicitly rather than assumed: a clean `git merge-tree --write-tree`
**plus zero file overlap** between the PR's diff and everything main had gained in the
interim, checked file by file. Either alone is weaker — a clean merge-tree proves no
textual conflict, not no semantic one, and overlap is what tells you whether the green
tick still describes the code that will land.

## Exceptions

- **Outside an incident, the ordinary reading is fine.** This checklist trades speed for
  certainty; applying all six to every routine PR is waste.
- **A repo-wide required check that has just been added** has its own failure mode
  (the run validates the merge ref, not main's tip) that is not incident-specific — see
  the sibling doc below.

## Related Files

- `.github/workflows/ci.yml` — the job matrix whose expansion item 3 checks for

## See Also

- [a-newly-required-ci-check-cannot-validate-itself-2026-08-06.md](a-newly-required-ci-check-cannot-validate-itself-2026-08-06.md) — the non-incident cousin: a green tick computed on the merge ref says nothing about main's current tip
- [batch-merge-can-invalidate-clean-mergeable-state-2026-07-06.md](batch-merge-can-invalidate-clean-mergeable-state-2026-07-06.md) — the same base-drift hazard when several PRs land in sequence
- [../conventions/ci-failure-must-reproduce-against-merge-ref-not-branch-head-2026-07-16.md](../conventions/ci-failure-must-reproduce-against-merge-ref-not-branch-head-2026-07-16.md) — item 6's other half: a stale branch's CI tests branch ⊕ current-main, so reproduce failures against the merge ref
- [promote-ci-check-to-required-status-check-2026-06-22.md](promote-ci-check-to-required-status-check-2026-06-22.md) — how the expected check set is defined, which item 2 counts against
