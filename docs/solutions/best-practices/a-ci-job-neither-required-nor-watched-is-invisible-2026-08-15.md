---
title: "A CI job that is neither required nor watched can fail from its first run forever — prove one green run before counting it as coverage"
track: knowledge
category: best-practices
module: shared
tags: [architecture, testing, ci, github-actions, scheduled-workflows, e2e, maestro, commissioning]
applies_to: [.github/workflows/**, e2e/**]
symptoms: ['A workflow exists and is referred to as coverage, but nobody can name the last time it passed', 'A scheduled job is red on the Actions tab and no one has mentioned it', 'A workflow header says failures "surface on the Actions tab" as if that were a notification mechanism', 'A new workflow landed with a note that it will "need an iteration or two to settle" — and no dated follow-up exists', 'A CI job fails at its FIRST infrastructure step, so its logs never contain anything about the code it was meant to test']
created: '2026-08-15'
---

# A CI job that is neither required nor watched can fail from its first run forever — prove one green run before counting it as coverage

## Rule

Before a workflow counts as coverage, two things must be true:

1. **It has been observed green at least once.** Not "it got further" — green.
2. **Its failures have a path to a human.** A non-required job that nobody reads is not a
   weaker signal than a required one; it is *no* signal.

If either is missing, the workflow's existence tells you nothing about the code, because
**absence of signal is indistinguishable from success.** A job that has never passed and a
job that passes every night look identical from anywhere except the Actions tab.

When you land a workflow that needs commissioning, the follow-through is part of landing
it — not a later nicety.

## Smell patterns

- A workflow header that predicts its own need for iteration ("expect the first runs to
  need an iteration or two to settle") with no dated follow-up anywhere.
- "Failures surface on the Actions tab" written as though it were a notification path.
- A suite described in prose as providing regression coverage, where nobody can point at a
  green run.
- A `schedule`-only workflow with no `pull_request` trigger and no required-check status —
  nothing forces anyone to ever look at it.

## Why

`.github/workflows/e2e-regression.yml` (OCRecipes) failed **34 of 34 runs — zero successes
— from 2026-07-13 to 2026-08-15**. Both jobs died during setup; not one Maestro flow ever
executed. The repo believed it had nightly E2E regression coverage for a month and had
none.

The oldest retained run and the newest fail with byte-identical errors, so this was never a
regression. It never worked.

Three properties combined to make a month of nothing look like a month of coverage:

- **`schedule`-only.** No PR ever triggered it, so no one encountered it while working.
- **Deliberately not a required check.** That call was reasonable and documented — E2E is
  slow and flaky, and gating merges on an unproven suite erodes trust in required checks.
  *The non-required status is not the defect.* The defect is that nothing replaced the
  attention that being required would have bought.
- **A claimed notification path that was not one.** The header asserted failures surface
  "on the Actions tab (and via GitHub's scheduled-workflow failure notifications)."
  Empirically, 34 consecutive failures surfaced to no one.

Worth naming separately: the job died at its **first infrastructure step**, so its logs
contain nothing about the app at all. That makes the failure *less* visible, not more — a
log full of `##[error]Formula postgresql@14 is not installed` reads as an environment
hiccup rather than a suite that has never run. The concrete gotcha, for the record: GitHub's
hosted macOS runner images do **not** ship a startable Postgres, so
`brew services start postgresql@14 || brew services start postgresql` fails on both the pin
and the fallback. The step's comment asserting "macOS runners ship Postgres but leave it
stopped" was false when it was written.

## Examples

Ask the question that separates "red today" from "never green" — one command, and it is the
first thing to run when a workflow's health is in doubt:

```bash
gh run list --workflow="E2E Regression" --limit 100 \
  --json conclusion --jq '[.[].conclusion] | group_by(.) | map({(.[0]): length}) | add'
# {"failure":34}   ← no success key at all: it has never passed
```

Then confirm whether it is one break or an original defect, by comparing the oldest
retained run against the newest:

```bash
gh run list --workflow="<name>" --limit 100 --json databaseId,createdAt --jq '.[-1]'
npm run ci:failed-logs -- <that-run-id>   # identical errors to today's ⇒ never worked
```

Commissioning a workflow that needs iteration:

- Iterate with `workflow_dispatch` on a branch. Do not push a change and wait for the
  nightly — a 24-hour feedback loop is how a suite reaches 34 failures.
- Budget for **layers**. A job that dies at step one has an entirely unexercised remainder;
  fixing the first error reveals the next, it does not finish the job.
- Close the loop on notification, or accept that the job is decorative.

When a workflow has been red indefinitely, the honest options are **commission** or
**delete** — not a third state where it exists and is red. Deleting it and recording that
the coverage is manual is strictly better than a permanent red, which quietly trains
everyone to ignore the Actions tab.

## Exceptions

- A genuinely advisory, non-required job is fine — *provided someone reads it*. The rule is
  about attention, not about required-check status. If you want it required, that is a
  separate, deliberate promotion (see See Also).
- A brand-new workflow may legitimately be red for a short, bounded commissioning window.
  What makes it a defect is the window never closing and nothing tracking it.

## Related Files

- `.github/workflows/e2e-regression.yml` — the workflow; the false premise is in the
  `Start Postgres` step comment
- `todos/P2-2026-08-15-e2e-regression-workflow-has-never-passed.md` — the full diagnosis of
  both jobs and the commission-or-delete decision
- `todos/archive/P3-2026-07-09-e2e-regression-gating-maestro.md` — where the (defensible)
  not-a-required-check decision was made
- `e2e/README.md` — flow inventory and coverage gaps

## See Also

- [A newly-required CI check cannot validate itself](a-newly-required-ci-check-cannot-validate-itself-2026-08-06.md) — the mirror case: a check whose own green tick proves the wrong thing
- [Promote a CI check to a required status check](promote-ci-check-to-required-status-check-2026-06-22.md) — the mechanics, if the answer is to make it required
- [A CI set-up job failure is never your code](../conventions/ci-set-up-job-failure-is-never-your-code-2026-08-06.md) — how to recognise the infrastructure-step failure class quickly
- [A verification that scans ZERO inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the same family one level down: a check that runs but proves nothing
