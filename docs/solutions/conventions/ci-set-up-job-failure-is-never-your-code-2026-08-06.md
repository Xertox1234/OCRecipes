---
title: 'A CI job that dies in "Set up job" failed before your code was checked out — never yours'
track: knowledge
category: conventions
module: shared
tags: [ci, github-actions, harness, tooling, flake, transient, triage, agents]
applies_to: [.github/workflows/**, .github/workflows/*.yml, scripts/**/*.sh, .husky/**]
symptoms: [Multiple unrelated PRs go red at the same time, A docs-only PR fails a test or mutation job it cannot possibly affect, main itself goes red on a commit that passed every check before merge, `gh run view --log-failed` returns nothing at all]
created: '2026-08-06'
---

# A CI job that dies in "Set up job" failed before your code was checked out — never yours

## Rule

Before diagnosing a red CI check, read **which step** failed. If the failed step is `Set up job`,
the runner never reached checkout — the failure is infrastructure and cannot be caused by the diff.
Re-run it; do not change code.

```bash
gh run view <run-id> --json jobs \
  | jq -r '.jobs[] | select(.conclusion=="failure") | .steps[] | select(.conclusion=="failure") | .name'
```

Typical body: `Failed to resolve action download info. Error: Service Unavailable`.

## Smell patterns

- Several unrelated PRs, plus `main`, all going red inside the same window.
- A PR that changes **only** documentation failing a unit-test, coverage, or mutation job.
- Reaching for `git revert` on a just-merged commit because `main` is red — before opening the log.

## Why

The wrong response is available and tempting. A red `Analyze` or `Tests (shard 3/3)` on a PR that
touches routing logic *looks* like it implicates the routing logic, and "fix the code until CI goes
green" would then mean changing correct code to chase an outage. Seeing `main` red on a
just-merged commit is worse — it reads as "you shipped a regression" and invites a revert.

Step identity settles it without any judgement call: GitHub resolves and downloads the actions a
job needs **before** running `actions/checkout`. A failure at that point happened when the
repository content was not yet present, so no property of the diff can have contributed.

The decisive evidence is usually the PR that cannot be at fault. A docs-only PR failing a mutation
job is not a mystery to investigate — it is proof that the common factor is the platform.

## Examples

Classify by step name, **not** by grepping logs:

```bash
# WRONG — a queued re-run has NO logs, and `grep -q` on empty input returns non-zero,
# so "I could not check" is silently rendered as "this is a real failure".
gh run view "$rid" --log-failed | grep -q 'Failed to resolve action download info'

# RIGHT — step names are populated from the API even while the run is queued.
steps=$(gh run view "$rid" --json status,jobs \
  | jq -r 'select(.status=="completed") | .jobs[] | select(.conclusion=="failure")
           | .steps[] | select(.conclusion=="failure") | .name' | sort -u)
[ "$steps" = "Set up job" ] && gh run rerun "$rid"   # infra: re-run, do not touch code
```

Also re-run **cancelled** required checks: they block auto-merge and never self-heal, and a watcher
that only looks for `fail` will wait forever on them.

## Exceptions

`Set up job` can fail for a genuinely repo-caused reason — a malformed `uses:` reference or a
deleted action version in the workflow file. That is still not a *diff* problem unless the diff
touched `.github/workflows/**`. Check whether the range touched the workflow before dismissing it.

## Related Files

- `scripts/ci-failed-logs.sh` — `npm run ci:failed-logs -- <run-id>`, the project entry point

## See Also

- [CI failure must reproduce against the merge ref](ci-failure-must-reproduce-against-merge-ref-not-branch-head-2026-07-16.md) — the other misattribution trap
- [empty probe output needs an exit-code check](../logic-errors/empty-probe-output-needs-exit-code-check-2026-07-02.md) — why the log-grep classifier above fails open
